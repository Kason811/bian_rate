#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebuild daily / weekly / monthly funding metrics and audits from funding_rates_raw.

This is the recovery path for:
- backfilling funding audits without calling Binance again
- rebuilding aggregates under a different timezone in the future
"""

from __future__ import annotations

import argparse
import sqlite3

import pandas as pd

from binance_coin_funding_rate_collector import GROUP_TIMEZONE, build_funding_quality_audit, compute_daily_funding
from sqlite_store import (
    build_monthly_symbol_metrics,
    build_weekly_symbol_metrics,
    create_collector_run,
    finalize_collector_run,
    initialize_database,
    persist_daily_funding_metrics,
    persist_funding_quality_audit,
    persist_monthly_funding_metrics,
    persist_weekly_funding_metrics,
    sqlite_connection,
)


def load_raw_funding(conn: sqlite3.Connection) -> dict[str, pd.DataFrame]:
    rows = conn.execute(
        """
        SELECT symbol, funding_time, funding_rate
        FROM funding_rates_raw
        ORDER BY symbol, funding_time
        """
    ).fetchall()
    by_symbol: dict[str, list[tuple[str, str, float]]] = {}
    for row in rows:
        by_symbol.setdefault(str(row["symbol"]), []).append((str(row["symbol"]), str(row["funding_time"]), float(row["funding_rate"])))

    frames: dict[str, pd.DataFrame] = {}
    for symbol, items in by_symbol.items():
        df = pd.DataFrame(items, columns=["symbol", "fundingTime", "fundingRate"])
        df["fundingTime"] = pd.to_datetime(df["fundingTime"], utc=True, format="mixed")
        df["fundingRate"] = pd.to_numeric(df["fundingRate"], errors="coerce").fillna(0.0)
        df.attrs["raw_row_count"] = len(df)
        frames[symbol] = df[["fundingTime", "fundingRate"]]
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild funding aggregates from SQLite raw funding data.")
    parser.add_argument("--timezone", default=GROUP_TIMEZONE, help="Timezone used for daily/weekly/monthly aggregation.")
    args = parser.parse_args()

    with sqlite_connection() as conn:
        initialize_database(conn)
        raw_by_symbol = load_raw_funding(conn)
        if not raw_by_symbol:
            raise RuntimeError("funding_rates_raw 为空，无法重建 funding 聚合。")

        run_id = create_collector_run(conn, lookback_years=3, symbol_count=len(raw_by_symbol))
        try:
            rebuilt = 0
            for symbol, funding_df in raw_by_symbol.items():
                daily_df = compute_daily_funding(funding_df, group_timezone=args.timezone)
                weekly_df = build_weekly_symbol_metrics(daily_df)
                monthly_df = build_monthly_symbol_metrics(daily_df)
                audit = build_funding_quality_audit(
                    symbol,
                    funding_df,
                    daily_df,
                    raw_row_count=int(funding_df.attrs.get("raw_row_count", len(funding_df))),
                )

                rebuilt += persist_daily_funding_metrics(conn, symbol, daily_df, run_id)
                persist_weekly_funding_metrics(conn, symbol, weekly_df, run_id)
                persist_monthly_funding_metrics(conn, symbol, monthly_df, run_id)
                persist_funding_quality_audit(conn, run_id, audit)

            finalize_collector_run(
                conn,
                run_id=run_id,
                status="completed",
                skipped_symbol_count=0,
                notes=f"rebuilt funding aggregates from raw with timezone={args.timezone}",
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

    print(f"Rebuilt funding aggregates for {len(raw_by_symbol)} symbols with timezone={args.timezone}.")


if __name__ == "__main__":
    main()
