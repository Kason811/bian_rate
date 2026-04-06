#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from binance_coin_funding_rate_collector import (
    GROUP_TIMEZONE,
    REQUEST_SLEEP_SECONDS,
    build_funding_quality_audit,
    build_volume_quality_audit,
    compute_daily_funding,
)
from sqlite_store import (
    build_monthly_symbol_metrics,
    build_weekly_symbol_metrics,
    create_collector_run,
    finalize_collector_run,
    initialize_database,
    persist_daily_funding_metrics,
    persist_daily_volume_metrics,
    persist_funding_quality_audit,
    persist_monthly_funding_metrics,
    persist_raw_funding_rates,
    persist_volume_quality_audit,
    persist_weekly_funding_metrics,
    sqlite_connection,
    upsert_symbols,
)

BASE_URL = "https://dapi.binance.com"
BTC_SYMBOL = "BTCUSD_PERP"
BTC_PAIR = "BTCUSD"
API_LIMIT = 1000
MAX_RETRIES = 6
KLINE_WINDOW_DAYS = 200
FUNDING_WINDOW_DAYS = 180


def api_get(path: str, params: dict[str, object]) -> object:
  query = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
  url = f"{BASE_URL}{path}?{query}"
  for attempt in range(1, MAX_RETRIES + 1):
    try:
      with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))
    except Exception:
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
  raise RuntimeError(f"request failed: {url}")


def fetch_contract_size(symbol: str) -> float:
  payload = api_get("/dapi/v1/exchangeInfo", {})
  if not isinstance(payload, dict):
    raise RuntimeError("exchangeInfo payload invalid")
  for row in payload.get("symbols", []):
    if row.get("symbol") == symbol:
      return float(row.get("contractSize", 1.0))
  raise RuntimeError(f"contract size not found for {symbol}")


def fetch_full_funding_history(symbol: str) -> pd.DataFrame:
  rows: list[dict[str, object]] = []
  cursor = 0
  now_ms = int(time.time() * 1000)
  window_ms = FUNDING_WINDOW_DAYS * 86_400_000 - 1
  while cursor < now_ms:
    end_time = min(cursor + window_ms, now_ms)
    batch = api_get(
      "/dapi/v1/fundingRate",
      {"symbol": symbol, "startTime": cursor, "endTime": end_time, "limit": API_LIMIT},
    )
    if not isinstance(batch, list):
      raise RuntimeError("funding payload invalid")
    if batch:
      rows.extend(batch)
    next_cursor = end_time + 1
    if next_cursor <= cursor:
      break
    cursor = next_cursor
    time.sleep(REQUEST_SLEEP_SECONDS)

  if not rows:
    return pd.DataFrame(columns=["fundingTime", "fundingRate"])

  frame = pd.DataFrame(rows)
  raw_row_count = len(frame)
  frame["fundingTime"] = pd.to_datetime(frame["fundingTime"], unit="ms", utc=True)
  frame["fundingRate"] = pd.to_numeric(frame["fundingRate"], errors="coerce").fillna(0.0)
  frame.drop_duplicates(subset="fundingTime", inplace=True)
  frame.attrs["raw_row_count"] = raw_row_count
  return frame.sort_values("fundingTime").reset_index(drop=True)


def fetch_full_daily_volume(symbol: str, contract_size: float) -> pd.DataFrame:
  rows: list[dict[str, float | pd.Timestamp]] = []
  cursor = 0
  now_ms = int(time.time() * 1000)
  window_ms = KLINE_WINDOW_DAYS * 86_400_000 - 1

  while cursor < now_ms:
    end_time = min(cursor + window_ms, now_ms)
    batch = api_get(
      "/dapi/v1/klines",
      {
        "symbol": symbol,
        "interval": "1d",
        "startTime": cursor,
        "endTime": end_time,
        "limit": 1500,
      },
    )
    if not isinstance(batch, list):
      raise RuntimeError("kline payload invalid")
    if not batch:
      next_cursor = end_time + 1
      if next_cursor <= cursor:
        break
      cursor = next_cursor
      time.sleep(REQUEST_SLEEP_SECONDS)
      continue

    for entry in batch:
      contract_volume = float(entry[5])
      rows.append(
        {
          "date": pd.to_datetime(int(entry[0]), unit="ms", utc=True).tz_convert(GROUP_TIMEZONE).tz_localize(None),
          "contract_volume": contract_volume,
          "usd_volume": contract_volume * contract_size,
        }
      )

    next_cursor = end_time + 1
    if next_cursor <= cursor:
      break
    cursor = next_cursor
    time.sleep(REQUEST_SLEEP_SECONDS)

  if not rows:
    return pd.DataFrame(columns=["date", "contract_volume", "usd_volume"])

  return pd.DataFrame(rows).sort_values("date").drop_duplicates(subset="date", keep="last").reset_index(drop=True)


def fetch_full_weekly_continuous_klines(pair: str) -> list[list[object]]:
  rows: list[list[object]] = []
  cursor = 0
  now_ms = int(time.time() * 1000)
  while True:
    batch = api_get(
      "/dapi/v1/continuousKlines",
      {"pair": pair, "contractType": "PERPETUAL", "interval": "1w", "startTime": cursor, "limit": 1500},
    )
    if not isinstance(batch, list) or not batch:
      break
    rows.extend(batch)
    cursor = int(batch[-1][0]) + 1
    if len(batch) < 1500:
      break
    time.sleep(REQUEST_SLEEP_SECONDS)
  deduped = {int(row[0]): row for row in rows}
  return [deduped[key] for key in sorted(deduped) if int(deduped[key][6]) < now_ms]


def write_weekly_kline_cache(rows: list[list[object]]) -> Path:
  output_path = ROOT / "web" / "lib" / "btc-weekly-klines.json"
  output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  return output_path


def main() -> None:
  contract_size = fetch_contract_size(BTC_SYMBOL)
  funding_df = fetch_full_funding_history(BTC_SYMBOL)
  if funding_df.empty:
    raise RuntimeError("BTC funding history empty")
  daily_funding = compute_daily_funding(funding_df, group_timezone=GROUP_TIMEZONE)
  weekly_funding = build_weekly_symbol_metrics(daily_funding)
  monthly_funding = build_monthly_symbol_metrics(daily_funding)
  volume_df = fetch_full_daily_volume(BTC_SYMBOL, contract_size)
  if volume_df.empty:
    raise RuntimeError("BTC volume history empty")
  weekly_klines = fetch_full_weekly_continuous_klines(BTC_PAIR)
  if not weekly_klines:
    raise RuntimeError("BTC weekly klines empty")

  run_id: int | None = None
  with sqlite_connection() as conn:
    initialize_database(conn)
    upsert_symbols(conn, [BTC_SYMBOL], {BTC_SYMBOL: contract_size}, deactivate_missing=False)
    run_id = create_collector_run(conn, 99, 1)
    try:
      persist_raw_funding_rates(conn, BTC_SYMBOL, funding_df, run_id)
      persist_daily_funding_metrics(conn, BTC_SYMBOL, daily_funding, run_id)
      persist_weekly_funding_metrics(conn, BTC_SYMBOL, weekly_funding, run_id)
      persist_monthly_funding_metrics(conn, BTC_SYMBOL, monthly_funding, run_id)
      persist_daily_volume_metrics(conn, BTC_SYMBOL, volume_df, run_id)
      persist_funding_quality_audit(conn, run_id, build_funding_quality_audit(BTC_SYMBOL, funding_df, daily_funding, int(funding_df.attrs.get("raw_row_count", len(funding_df)))))
      persist_volume_quality_audit(conn, run_id, build_volume_quality_audit(BTC_SYMBOL, volume_df))
      finalize_collector_run(
        conn,
        run_id=run_id,
        status="completed",
        skipped_symbol_count=0,
        notes=f"BTC full-history backfill; funding_days={len(daily_funding)}; volume_days={len(volume_df)}; weekly_klines={len(weekly_klines)}",
      )
    except Exception as exc:
      finalize_collector_run(conn, run_id=run_id, status="failed", skipped_symbol_count=0, notes=str(exc)[:500])
      raise

  output_path = write_weekly_kline_cache(weekly_klines)
  print(f"BTC funding rows: {len(funding_df)}")
  print(f"BTC daily funding rows: {len(daily_funding)}")
  print(f"BTC daily volume rows: {len(volume_df)}")
  print(f"BTC weekly klines: {len(weekly_klines)}")
  print(f"Wrote {output_path}")


if __name__ == "__main__":
  main()
