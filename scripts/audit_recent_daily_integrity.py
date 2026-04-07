#!/usr/bin/env python3
"""
Audit recent daily funding/volume continuity for active COIN-M symbols.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Set
from zoneinfo import ZoneInfo

ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "data" / "bian_rate.sqlite3"


def iso_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def get_expected_dates(timezone_name: str, window_days: int, end_offset_days: int) -> List[str]:
    local_today = datetime.now(ZoneInfo(timezone_name)).date()
    end_date = local_today - timedelta(days=end_offset_days)
    start_date = end_date - timedelta(days=window_days - 1)
    return [iso_date(datetime.combine(start_date + timedelta(days=offset), datetime.min.time())) for offset in range(window_days)]


def load_active_symbols(conn: sqlite3.Connection, market_type: str) -> List[str]:
    rows = conn.execute(
        """
        SELECT symbol
        FROM symbols
        WHERE market_type = ? AND is_active = 1
        ORDER BY symbol
        """,
        (market_type,),
    ).fetchall()
    return [str(row[0]) for row in rows]


def load_metric_dates(conn: sqlite3.Connection, table: str, symbol: str, start_date: str, end_date: str) -> Set[str]:
    rows = conn.execute(
        f"""
        SELECT metric_date
        FROM {table}
        WHERE symbol = ? AND metric_date BETWEEN ? AND ?
        ORDER BY metric_date
        """,
        (symbol, start_date, end_date),
    ).fetchall()
    return {str(row[0]) for row in rows}


def summarize_symbol(
    symbol: str,
    expected_dates: List[str],
    funding_dates: Set[str],
    volume_dates: Set[str],
) -> Dict[str, object]:
    expected_set = set(expected_dates)
    missing_funding = sorted(expected_set - funding_dates)
    missing_volume = sorted(expected_set - volume_dates)
    missing_both = sorted(set(missing_funding) & set(missing_volume))
    stale = bool(expected_dates and ((funding_dates and max(funding_dates) < expected_dates[-1]) or (volume_dates and max(volume_dates) < expected_dates[-1])))
    status = "ok"
    if missing_funding or missing_volume:
        status = "warning"
    if not funding_dates or not volume_dates:
        status = "failed"
    return {
        "symbol": symbol,
        "status": status,
        "funding_rows": len(funding_dates),
        "volume_rows": len(volume_dates),
        "missing_funding_count": len(missing_funding),
        "missing_volume_count": len(missing_volume),
        "missing_both_count": len(missing_both),
        "last_funding_date": max(funding_dates) if funding_dates else None,
        "last_volume_date": max(volume_dates) if volume_dates else None,
        "first_missing_funding_date": missing_funding[0] if missing_funding else None,
        "first_missing_volume_date": missing_volume[0] if missing_volume else None,
        "first_missing_any_date": min([value for value in [missing_funding[0] if missing_funding else None, missing_volume[0] if missing_volume else None] if value is not None], default=None),
        "stale": stale,
        "missing_funding_preview": missing_funding[:5],
        "missing_volume_preview": missing_volume[:5],
    }


def build_report(timezone_name: str, market_type: str, window_days: int, end_offset_days: int) -> Dict[str, object]:
    expected_dates = get_expected_dates(timezone_name, window_days, end_offset_days)
    if not expected_dates:
        raise ValueError("expected_dates must not be empty")
    start_date = expected_dates[0]
    end_date = expected_dates[-1]

    conn = sqlite3.connect(DB_PATH)
    try:
        active_symbols = load_active_symbols(conn, market_type)
        symbol_reports = []
        warning_symbols = 0
        failed_symbols = 0
        for symbol in active_symbols:
            funding_dates = load_metric_dates(conn, "daily_funding_metrics", symbol, start_date, end_date)
            volume_dates = load_metric_dates(conn, "daily_volume_metrics", symbol, start_date, end_date)
            report = summarize_symbol(symbol, expected_dates, funding_dates, volume_dates)
            symbol_reports.append(report)
            if report["status"] == "warning":
                warning_symbols += 1
            elif report["status"] == "failed":
                failed_symbols += 1

        overall_status = "ok"
        if failed_symbols:
            overall_status = "failed"
        elif warning_symbols:
            overall_status = "warning"

        return {
            "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "timezone": timezone_name,
            "market_type": market_type,
            "window_days": window_days,
            "end_offset_days": end_offset_days,
            "expected_start_date": start_date,
            "expected_end_date": end_date,
            "expected_day_count": len(expected_dates),
            "active_symbol_count": len(active_symbols),
            "warning_symbol_count": warning_symbols,
            "failed_symbol_count": failed_symbols,
            "status": overall_status,
            "first_missing_any_date": min(
                [report["first_missing_any_date"] for report in symbol_reports if report["first_missing_any_date"]],
                default=None,
            ),
            "first_missing_funding_date": min(
                [report["first_missing_funding_date"] for report in symbol_reports if report["first_missing_funding_date"]],
                default=None,
            ),
            "first_missing_volume_date": min(
                [report["first_missing_volume_date"] for report in symbol_reports if report["first_missing_volume_date"]],
                default=None,
            ),
            "symbols": symbol_reports,
        }
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit recent COIN-M daily funding/volume continuity.")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--market-type", default="COINM_PERPETUAL")
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--end-offset-days", type=int, default=1)
    parser.add_argument("--output", default="run/collector-recent-integrity.json")
    args = parser.parse_args()

    report = build_report(
        timezone_name=args.timezone,
        market_type=args.market_type,
        window_days=max(args.window_days, 1),
        end_offset_days=max(args.end_offset_days, 0),
    )

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT_DIR / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"[integrity] status={report['status']} "
        f"symbols={report['active_symbol_count']} "
        f"warnings={report['warning_symbol_count']} "
        f"failed={report['failed_symbol_count']} "
        f"range={report['expected_start_date']}~{report['expected_end_date']}"
    )
    if report["warning_symbol_count"] or report["failed_symbol_count"]:
        for symbol_report in report["symbols"]:
            if symbol_report["status"] == "ok":
                continue
            print(
                f"[integrity:{symbol_report['status']}] {symbol_report['symbol']} "
                f"missing_funding={symbol_report['missing_funding_count']} "
                f"missing_volume={symbol_report['missing_volume_count']} "
                f"last_funding={symbol_report['last_funding_date']} "
                f"last_volume={symbol_report['last_volume_date']}"
            )


if __name__ == "__main__":
    main()
