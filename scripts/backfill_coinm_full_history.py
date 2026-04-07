#!/usr/bin/env python3
from __future__ import annotations

import argparse
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
API_LIMIT = 1000
MAX_RETRIES = 6
KLINE_WINDOW_DAYS = 200
FUNDING_WINDOW_DAYS = 180
OUTPUT_DIR = ROOT / "web" / "lib" / "research-klines" / "coinm" / "week"


def api_get(path: str, params: dict[str, object]) -> object:
  query = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
  url = f"{BASE_URL}{path}?{query}"
  for attempt in range(1, MAX_RETRIES + 1):
    try:
      request = urllib.request.Request(
        url,
        headers={
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
        },
      )
      with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))
    except Exception:
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
  raise RuntimeError(f"request failed: {url}")


def load_coinm_symbols() -> list[str]:
  with sqlite_connection() as conn:
    rows = conn.execute(
      """
      SELECT symbol
      FROM symbols
      WHERE market_type = 'COINM_PERPETUAL'
        AND is_active = 1
      ORDER BY base_asset
      """
    ).fetchall()
  return [str(row["symbol"]) for row in rows]


def fetch_contract_sizes(symbols: list[str]) -> dict[str, float]:
  payload = api_get("/dapi/v1/exchangeInfo", {})
  if not isinstance(payload, dict):
    raise RuntimeError("exchangeInfo payload invalid")
  wanted = set(symbols)
  result: dict[str, float] = {}
  for row in payload.get("symbols", []):
    symbol = row.get("symbol")
    if symbol in wanted:
      result[str(symbol)] = float(row.get("contractSize", 1.0))
  missing = sorted(wanted - set(result))
  if missing:
    raise RuntimeError(f"contract size missing for: {', '.join(missing)}")
  return result


def fetch_symbol_onboard_dates(symbols: list[str]) -> dict[str, int]:
  payload = api_get("/dapi/v1/exchangeInfo", {})
  if not isinstance(payload, dict):
    raise RuntimeError("exchangeInfo payload invalid")
  wanted = set(symbols)
  result: dict[str, int] = {}
  for row in payload.get("symbols", []):
    symbol = row.get("symbol")
    if symbol in wanted:
      onboard_date = int(row.get("onboardDate", 0) or 0)
      if onboard_date > 0:
        result[str(symbol)] = onboard_date
  missing = sorted(wanted - set(result))
  if missing:
    raise RuntimeError(f"onboard date missing for: {', '.join(missing)}")
  return result


def fetch_full_funding_history(symbol: str, start_ms: int) -> pd.DataFrame:
  rows: list[dict[str, object]] = []
  cursor = start_ms
  now_ms = int(time.time() * 1000)
  window_ms = FUNDING_WINDOW_DAYS * 86_400_000 - 1
  while cursor < now_ms:
    end_time = min(cursor + window_ms, now_ms)
    batch = api_get(
      "/dapi/v1/fundingRate",
      {"symbol": symbol, "startTime": cursor, "endTime": end_time, "limit": API_LIMIT},
    )
    if not isinstance(batch, list):
      raise RuntimeError(f"funding payload invalid for {symbol}")
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


def fetch_full_daily_volume(symbol: str, contract_size: float, start_ms: int) -> pd.DataFrame:
  rows: list[dict[str, float | pd.Timestamp]] = []
  cursor = start_ms
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
      raise RuntimeError(f"kline payload invalid for {symbol}")
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


def fetch_full_weekly_continuous_klines(pair: str, start_ms: int) -> list[list[object]]:
  rows: list[list[object]] = []
  cursor = start_ms
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


def write_weekly_kline_cache(base_asset: str, rows: list[list[object]]) -> Path:
  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
  output_path = OUTPUT_DIR / f"{base_asset}.json"
  output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  return output_path


def simplify_symbol(symbol: str) -> str:
  base = symbol.replace("_PERP", "")
  if base.endswith("USD"):
    base = base[:-3]
  return base


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Backfill full COIN-M history into SQLite and research klines.")
  parser.add_argument("--symbols", help="Comma-separated contract symbols or base assets, e.g. ETHUSD_PERP,SOL or ETH,SOL")
  return parser.parse_args()


def normalize_selected_symbols(raw: str, available_symbols: list[str]) -> list[str]:
  wanted = {item.strip().upper() for item in raw.split(",") if item.strip()}
  if not wanted:
    return available_symbols
  result: list[str] = []
  available_set = set(available_symbols)
  for item in wanted:
    contract_symbol = item if item.endswith("USD_PERP") else f"{item}USD_PERP"
    if contract_symbol not in available_set:
      raise RuntimeError(f"unknown or inactive COIN-M symbol: {item}")
    result.append(contract_symbol)
  return sorted(result, key=lambda symbol: simplify_symbol(symbol))


def main() -> None:
  args = parse_args()
  symbols = load_coinm_symbols()
  if not symbols:
    raise RuntimeError("no active COIN-M symbols found")
  if args.symbols:
    symbols = normalize_selected_symbols(args.symbols, symbols)
  contract_sizes = fetch_contract_sizes(symbols)
  onboard_dates = fetch_symbol_onboard_dates(symbols)

  run_id: int | None = None
  with sqlite_connection() as conn:
    initialize_database(conn)
    upsert_symbols(conn, symbols, contract_sizes, deactivate_missing=False)
    run_id = create_collector_run(conn, 99, len(symbols))

  completed = 0
  try:
    for symbol in symbols:
      base_asset = simplify_symbol(symbol)
      start_ms = onboard_dates[symbol]
      funding_df = fetch_full_funding_history(symbol, start_ms)
      if funding_df.empty:
        raise RuntimeError(f"{symbol} funding history empty")
      daily_funding = compute_daily_funding(funding_df, group_timezone=GROUP_TIMEZONE)
      weekly_funding = build_weekly_symbol_metrics(daily_funding)
      monthly_funding = build_monthly_symbol_metrics(daily_funding)
      volume_df = fetch_full_daily_volume(symbol, contract_sizes[symbol], start_ms)
      if volume_df.empty:
        raise RuntimeError(f"{symbol} volume history empty")
      weekly_klines = fetch_full_weekly_continuous_klines(symbol.replace("_PERP", ""), start_ms)
      if not weekly_klines:
        raise RuntimeError(f"{symbol} weekly klines empty")

      with sqlite_connection() as conn:
        persist_raw_funding_rates(conn, symbol, funding_df, run_id)
        persist_daily_funding_metrics(conn, symbol, daily_funding, run_id)
        persist_weekly_funding_metrics(conn, symbol, weekly_funding, run_id)
        persist_monthly_funding_metrics(conn, symbol, monthly_funding, run_id)
        persist_daily_volume_metrics(conn, symbol, volume_df, run_id)
        persist_funding_quality_audit(conn, run_id, build_funding_quality_audit(symbol, funding_df, daily_funding, int(funding_df.attrs.get("raw_row_count", len(funding_df)))))
        persist_volume_quality_audit(conn, run_id, build_volume_quality_audit(symbol, volume_df))

      output_path = write_weekly_kline_cache(base_asset, weekly_klines)
      completed += 1
      print(
        f"[{completed}/{len(symbols)}] {base_asset}: funding_days={len(daily_funding)} "
        f"volume_days={len(volume_df)} weekly_klines={len(weekly_klines)} -> {output_path}",
        flush=True,
      )
      time.sleep(REQUEST_SLEEP_SECONDS)

    with sqlite_connection() as conn:
      finalize_collector_run(
        conn,
        run_id=run_id,
        status="completed",
        skipped_symbol_count=0,
        notes=f"COIN-M full-history backfill for {len(symbols)} symbols",
      )
  except Exception as exc:
    with sqlite_connection() as conn:
      finalize_collector_run(conn, run_id=run_id, status="failed", skipped_symbol_count=len(symbols) - completed, notes=str(exc)[:500])
    raise


if __name__ == "__main__":
  main()
