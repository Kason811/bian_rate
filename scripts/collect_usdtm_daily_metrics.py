#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from binance_coin_funding_rate_collector import (
    AVG_VOLUME_WINDOW_DAYS,
    DEFAULT_VOLUME_LOOKBACK_EXTRA_DAYS,
    GROUP_TIMEZONE,
    REQUEST_SLEEP_SECONDS,
    build_funding_quality_audit,
    compute_daily_funding,
    compute_aggregate_refresh_bounds,
    refresh_symbol_aggregates,
    resolve_lookback_days,
)
from scripts.backfill_usdtm_research_history import (
    build_usdtm_volume_quality_audit,
    fetch_full_daily_volume,
    fetch_full_funding_history,
    load_usdtm_targets,
)
from sqlite_store import (
    create_collector_run,
    finalize_collector_run,
    initialize_database,
    persist_daily_funding_metrics,
    persist_daily_volume_metrics,
    persist_funding_quality_audit,
    persist_raw_funding_rates,
    persist_volume_quality_audit,
    sqlite_connection,
    upsert_symbol_records,
)


def build_start_ms(lookback_days: int) -> int:
  utc_now = datetime.now(timezone.utc)
  start_time = utc_now - timedelta(days=lookback_days)
  return int(start_time.timestamp() * 1000)


def main() -> None:
  parser = argparse.ArgumentParser(description="Collect incremental USDT-M daily funding and volume into SQLite.")
  parser.add_argument("--timezone", default=GROUP_TIMEZONE, help="Aggregation timezone, e.g. Asia/Shanghai.")
  parser.add_argument(
    "--lookback-days",
    type=int,
    default=14,
    help="Funding incremental window in days.",
  )
  parser.add_argument(
    "--volume-lookback-days",
    type=int,
    default=45,
    help="Volume incremental window in days.",
  )
  args = parser.parse_args()

  funding_lookback_days = resolve_lookback_days(args.lookback_days)
  volume_lookback_days = resolve_lookback_days(args.volume_lookback_days)
  volume_lookback_days = max(
    volume_lookback_days,
    funding_lookback_days,
    AVG_VOLUME_WINDOW_DAYS + DEFAULT_VOLUME_LOOKBACK_EXTRA_DAYS,
  )

  funding_start_ms = build_start_ms(funding_lookback_days)
  volume_start_ms = build_start_ms(volume_lookback_days)
  targets = load_usdtm_targets()
  if not targets:
    raise RuntimeError("no matched USDT-M perpetual symbols found")

  with sqlite_connection() as conn:
    initialize_database(conn)
    upsert_symbol_records(conn, targets, deactivate_missing=False)
    run_id = create_collector_run(
      conn,
      lookback_years=max(1, math.ceil(funding_lookback_days / 365)),
      symbol_count=len(targets),
    )
    try:
      for index, target in enumerate(targets, start=1):
        symbol = str(target["symbol"])
        base_asset = str(target["base_asset"])
        print(f"[{index}/{len(targets)}] USDT-M {symbol} funding+volume ...", flush=True)

        funding_df = fetch_full_funding_history(symbol, funding_start_ms)
        daily_funding = compute_daily_funding(funding_df, group_timezone=args.timezone)
        volume_df = fetch_full_daily_volume(symbol, volume_start_ms)
        if daily_funding.empty:
          print(f"[warn] {symbol} funding empty in window", flush=True)
        if volume_df.empty:
          print(f"[warn] {symbol} volume empty in window", flush=True)

        persist_raw_funding_rates(conn, symbol, funding_df, run_id)
        persist_daily_funding_metrics(conn, symbol, daily_funding, run_id)
        if not daily_funding.empty:
          refresh_symbol_aggregates(conn, symbol, daily_funding, run_id)
        persist_daily_volume_metrics(conn, symbol, volume_df, run_id)
        persist_funding_quality_audit(
          conn,
          run_id,
          build_funding_quality_audit(
            symbol,
            funding_df,
            daily_funding,
            raw_row_count=int(funding_df.attrs.get("raw_row_count", len(funding_df))),
          ),
        )
        persist_volume_quality_audit(conn, run_id, build_usdtm_volume_quality_audit(symbol, volume_df))
        conn.commit()
        latest_funding = (
          pd.Timestamp(daily_funding["date"].max()).strftime("%Y-%m-%d")
          if not daily_funding.empty
          else "n/a"
        )
        latest_volume = (
          pd.Timestamp(volume_df["date"].max()).strftime("%Y-%m-%d")
          if not volume_df.empty
          else "n/a"
        )
        print(
          f"  {base_asset}: funding_days={len(daily_funding)} latest_funding={latest_funding} "
          f"volume_days={len(volume_df)} latest_volume={latest_volume}",
          flush=True,
        )
        time.sleep(REQUEST_SLEEP_SECONDS)

      finalize_collector_run(
        conn,
        run_id=run_id,
        status="completed",
        skipped_symbol_count=0,
        notes=(
          f"USDT-M incremental daily metrics; funding_lookback_days={funding_lookback_days}; "
          f"volume_lookback_days={volume_lookback_days}"
        ),
      )
    except Exception as exc:
      finalize_collector_run(conn, run_id=run_id, status="failed", skipped_symbol_count=0, notes=str(exc)[:500])
      raise


if __name__ == "__main__":
  main()
