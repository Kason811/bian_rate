#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill COIN-M perpetual daily volume history into SQLite.

Fetch up to 3 years of daily volume for symbols already present in the local DB.
If a symbol launched later, Binance will only return the available history.
"""

from __future__ import annotations

from binance.client import Client

from binance_coin_funding_rate_collector import LOOKBACK_YEARS, fetch_volume_metrics, get_coin_perpetual_symbols
from sqlite_store import (
    create_collector_run,
    finalize_collector_run,
    initialize_database,
    persist_daily_volume_metrics,
    sqlite_connection,
    upsert_symbols,
)


def load_target_symbols(conn) -> list[str]:
    rows = conn.execute(
        """
        SELECT DISTINCT symbol
        FROM daily_funding_metrics
        ORDER BY symbol
        """
    ).fetchall()
    return [str(row[0]) for row in rows]


def main() -> None:
    client = Client()

    with sqlite_connection() as conn:
        initialize_database(conn)
        target_symbols = load_target_symbols(conn)
        if not target_symbols:
            raise RuntimeError("SQLite 中没有可回填的交易对，请先准备 funding 数据。")

        all_symbols, contract_sizes = get_coin_perpetual_symbols(client)
        selected_symbols = [symbol for symbol in all_symbols if symbol in set(target_symbols)]
        if not selected_symbols:
            raise RuntimeError("交易所当前活跃交易对与 SQLite 中的交易对没有交集。")

        run_id = create_collector_run(conn, lookback_years=LOOKBACK_YEARS, symbol_count=len(selected_symbols))

        try:
            upsert_symbols(conn, selected_symbols, contract_sizes, deactivate_missing=False)
            _, volume_history = fetch_volume_metrics(client, selected_symbols, contract_sizes)

            persisted = 0
            for symbol, volume_df in volume_history.items():
                persisted += persist_daily_volume_metrics(conn, symbol, volume_df, run_id)

            finalize_collector_run(
                conn,
                run_id=run_id,
                status="completed",
                skipped_symbol_count=len(selected_symbols) - len(volume_history),
                notes=f"backfilled daily volume history for {len(volume_history)} symbols",
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

    print(f"Backfilled daily volume history for {len(volume_history)} symbols, {persisted} rows written.")


if __name__ == "__main__":
    main()
