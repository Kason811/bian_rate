#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import existing Excel outputs into SQLite so the web app can read historical data
without waiting for a fresh Binance collection run.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List

import pandas as pd

from sqlite_store import (
    create_collector_run,
    build_weekly_symbol_metrics,
    finalize_collector_run,
    initialize_database,
    persist_daily_funding_metrics,
    persist_daily_volume_metrics,
    persist_funding_quality_audit,
    persist_volume_quality_audit,
    persist_market_snapshots,
    persist_monthly_funding_metrics,
    persist_weekly_funding_metrics,
    sqlite_connection,
    upsert_symbols,
)

ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = ROOT / "coin_funding_rate_outputs"
DAILY_DIR = OUTPUT_ROOT / "daily"

CATEGORY_MAP = {
    "BTCUSD_PERP": "Core",
    "ETHUSD_PERP": "Core",
    "BNBUSD_PERP": "Core",
    "XRPUSD_PERP": "Core",
    "ADAUSD_PERP": "Core",
    "SOLUSD_PERP": "Momentum",
    "DOGEUSD_PERP": "Momentum",
    "SUIUSD_PERP": "Momentum",
    "WIFUSD_PERP": "Momentum",
    "WLDUSD_PERP": "Momentum",
    "AAVEUSD_PERP": "Momentum",
    "AVAXUSD_PERP": "Momentum",
    "NEARUSD_PERP": "Momentum",
    "UNIUSD_PERP": "Defensive",
    "ETCUSD_PERP": "Defensive",
    "FILUSD_PERP": "Defensive",
    "LINKUSD_PERP": "Defensive",
    "LTCUSD_PERP": "Defensive",
    "DOTUSD_PERP": "Defensive",
    "TRXUSD_PERP": "Defensive",
    "BCHUSD_PERP": "Defensive",
    "XLMUSD_PERP": "Defensive",
}

FOCUS_BASKET = ["BTCUSD_PERP", "ETHUSD_PERP", "BNBUSD_PERP", "SOLUSD_PERP", "XRPUSD_PERP"]


def latest_summary_workbook() -> Path:
    candidates = sorted(OUTPUT_ROOT.glob("费率统计表_近37个月_*.xlsx"))
    if not candidates:
        raise FileNotFoundError("No 37-month summary workbook found in coin_funding_rate_outputs")
    return candidates[-1]


def symbol_to_contract(symbol_short: str) -> str:
    return f"{symbol_short}USD_PERP"


def load_monthly_metrics(workbook: Path) -> pd.DataFrame:
    monthly = pd.read_excel(workbook, sheet_name="MonthlySummary")
    month_col = monthly.columns[0]
    monthly = monthly.rename(columns={month_col: "metric_month"})
    monthly = monthly[monthly["metric_month"].notna()]
    monthly = monthly[monthly["metric_month"] != "总计"]
    monthly["metric_month"] = monthly["metric_month"].astype(str)
    return monthly


def load_volume_metrics(workbook: Path) -> pd.DataFrame:
    volume = pd.read_excel(workbook, sheet_name="30天日平均成交量")
    volume["Symbol"] = volume["Symbol"].astype(str)
    volume = volume[volume["FetchStatus"] == "OK"].copy()
    volume["contract_symbol"] = volume["Symbol"].map(symbol_to_contract)
    return volume


def load_daily_metrics() -> Dict[str, pd.DataFrame]:
    daily_metrics: Dict[str, pd.DataFrame] = {}
    for path in sorted(DAILY_DIR.glob("*_daily_funding.xlsx")):
        symbol = path.name.replace("_daily_funding.xlsx", "")
        df = pd.read_excel(path, sheet_name="DailyData", usecols=["date", "daily_funding_rate"])
        df["date"] = pd.to_datetime(df["date"])
        df["daily_funding_rate"] = pd.to_numeric(df["daily_funding_rate"], errors="coerce").fillna(0.0)
        df["funding_event_count"] = 1
        daily_metrics[symbol] = df
    return daily_metrics


def build_monthly_symbol_frame(symbol: str, daily_df: pd.DataFrame) -> pd.DataFrame:
    temp = daily_df.copy()
    temp["metric_month"] = temp["date"].dt.to_period("M").astype(str)
    return (
        temp.groupby("metric_month", as_index=False)
        .agg(
            monthly_funding_rate=("daily_funding_rate", "sum"),
            positive_days=("daily_funding_rate", lambda s: int((s > 0).sum())),
            negative_days=("daily_funding_rate", lambda s: int((s < 0).sum())),
            zero_days=("daily_funding_rate", lambda s: int((s == 0).sum())),
        )
    )


def build_import_funding_quality_audit(symbol: str, daily_df: pd.DataFrame) -> dict[str, object]:
    day_count = int(len(daily_df))
    min_events_per_day = int(daily_df["funding_event_count"].min()) if not daily_df.empty else 0
    max_events_per_day = int(daily_df["funding_event_count"].max()) if not daily_df.empty else 0
    return {
        "symbol": symbol,
        "raw_event_count": 0,
        "duplicate_event_count": 0,
        "first_funding_time": None,
        "last_funding_time": None,
        "inferred_interval_hours": 0.0,
        "gap_count": 0,
        "max_gap_hours": 0.0,
        "day_count": day_count,
        "days_with_zero_events": 0,
        "min_events_per_day": min_events_per_day,
        "max_events_per_day": max_events_per_day,
        "completeness_score": 60.0,
        "status": "imported",
        "notes": "imported from daily excel without raw funding events",
    }


def build_import_volume_quality_audit(symbol: str, volume_df: pd.DataFrame) -> dict[str, object]:
    if volume_df.empty:
        return {
            "symbol": symbol,
            "source_type": "excel_avg_30d",
            "kline_row_count": 0,
            "first_metric_date": None,
            "last_metric_date": None,
            "day_count": 0,
            "gap_count": 0,
            "max_gap_days": 0,
            "avg_usd_volume": 0.0,
            "min_usd_volume": 0.0,
            "max_usd_volume": 0.0,
            "completeness_score": 0.0,
            "status": "empty",
            "notes": "no imported volume rows",
        }

    values = pd.to_numeric(volume_df["usd_volume"], errors="coerce").fillna(0.0)
    date_text = pd.Timestamp(volume_df["date"].iloc[0]).strftime("%Y-%m-%d")
    return {
        "symbol": symbol,
        "source_type": "excel_avg_30d",
        "kline_row_count": int(len(volume_df)),
        "first_metric_date": date_text,
        "last_metric_date": date_text,
        "day_count": int(len(volume_df)),
        "gap_count": 0,
        "max_gap_days": 0,
        "avg_usd_volume": float(values.mean()),
        "min_usd_volume": float(values.min()),
        "max_usd_volume": float(values.max()),
        "completeness_score": 40.0,
        "status": "imported",
        "notes": "imported from workbook 30d average volume only",
    }


def main() -> None:
    workbook = latest_summary_workbook()
    daily_metrics = load_daily_metrics()
    if not daily_metrics:
        raise RuntimeError("No daily funding workbooks found under coin_funding_rate_outputs/daily")

    volume_metrics = load_volume_metrics(workbook)
    symbols = sorted(daily_metrics.keys())
    contract_sizes = {symbol: 1.0 for symbol in symbols}

    with sqlite_connection() as conn:
        initialize_database(conn)
        run_id = create_collector_run(conn, lookback_years=3, symbol_count=len(symbols))

        try:
            upsert_symbols(conn, symbols, contract_sizes)
            for symbol, category in CATEGORY_MAP.items():
                conn.execute("UPDATE symbols SET category = ? WHERE symbol = ?", (category, symbol))

            for symbol, daily_df in daily_metrics.items():
                persist_daily_funding_metrics(conn, symbol, daily_df, run_id)
                persist_weekly_funding_metrics(conn, symbol, build_weekly_symbol_metrics(daily_df), run_id)
                persist_monthly_funding_metrics(conn, symbol, build_monthly_symbol_frame(symbol, daily_df), run_id)
                persist_funding_quality_audit(conn, run_id, build_import_funding_quality_audit(symbol, daily_df))

            reference_date = max(df["date"].max() for df in daily_metrics.values())
            for row in volume_metrics.itertuples(index=False):
                symbol = str(row.contract_symbol)
                avg_usd = float(row.AvgDailyUSDVolume)
                volume_df = pd.DataFrame(
                    {
                        "date": [pd.Timestamp(reference_date)],
                        "usd_volume": [avg_usd],
                        "contract_volume": [avg_usd],
                    }
                )
                persist_daily_volume_metrics(conn, symbol, volume_df, run_id)
                persist_volume_quality_audit(conn, run_id, build_import_volume_quality_audit(symbol, volume_df))

            monthly_summary = (
                pd.read_excel(workbook, sheet_name="MonthlySummary")
                .rename(columns={pd.read_excel(workbook, sheet_name="MonthlySummary").columns[0]: "metric_month"})
            )
            monthly_summary = monthly_summary[monthly_summary["metric_month"].notna()]
            monthly_summary = monthly_summary[monthly_summary["metric_month"] != "总计"].copy()
            monthly_summary["metric_month"] = monthly_summary["metric_month"].astype(str)
            monthly_summary = monthly_summary.set_index("metric_month")
            monthly_summary.columns = [symbol_to_contract(str(col).replace("*", "")) for col in monthly_summary.columns]
            monthly_summary = monthly_summary.apply(pd.to_numeric, errors="coerce").fillna(0.0)

            high_liquidity_symbols = [
                str(row.contract_symbol)
                for row in volume_metrics.itertuples(index=False)
                if float(row.AvgDailyUSDVolume) >= 150_000_000
            ]
            persist_market_snapshots(conn, monthly_summary, FOCUS_BASKET, high_liquidity_symbols, run_id)

            finalize_collector_run(
                conn,
                run_id=run_id,
                status="completed",
                skipped_symbol_count=0,
                notes=f"imported from existing output workbook {workbook.name}",
            )
        except Exception as exc:
            finalize_collector_run(
                conn,
                run_id=run_id,
                status="failed",
                skipped_symbol_count=0,
                notes=str(exc)[:500],
            )
            raise

    print(f"Imported outputs into SQLite from {workbook}")


if __name__ == "__main__":
    main()
