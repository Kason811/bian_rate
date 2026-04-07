#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
import urllib.error
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
    upsert_symbol_records,
)

BASE_URL = "https://fapi.binance.com"
API_LIMIT = 1000
MAX_RETRIES = 6
LOOKBACK_YEARS = 3
KLINE_LIMIT = 1500
FUNDING_WINDOW_DAYS = 330
OUTPUT_DIR = ROOT / "web" / "lib" / "research-klines" / "usdtm" / "week"


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
    except urllib.error.HTTPError as exc:
      if exc.code == 403 and attempt < MAX_RETRIES:
        time.sleep(max(15.0, REQUEST_SLEEP_SECONDS * (8 ** attempt)))
        continue
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
    except Exception:
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
  raise RuntimeError(f"request failed: {url}")


def load_coinm_base_assets() -> list[str]:
  with sqlite_connection() as conn:
    rows = conn.execute(
      """
      SELECT base_asset
      FROM symbols
      WHERE market_type = 'COINM_PERPETUAL'
        AND is_active = 1
      ORDER BY base_asset
      """
    ).fetchall()
  return [str(row["base_asset"]) for row in rows]


def load_usdtm_targets() -> list[dict[str, object]]:
  payload = api_get("/fapi/v1/exchangeInfo", {})
  if not isinstance(payload, dict):
    raise RuntimeError("exchangeInfo payload invalid")

  wanted = set(load_coinm_base_assets())
  targets: list[dict[str, object]] = []
  for row in payload.get("symbols", []):
    if row.get("contractType") != "PERPETUAL" or row.get("status") != "TRADING":
      continue
    if row.get("quoteAsset") != "USDT":
      continue
    base_asset = str(row.get("baseAsset"))
    if base_asset not in wanted:
      continue
    targets.append(
      {
        "symbol": str(row["symbol"]),
        "base_asset": base_asset,
        "quote_asset": "USDT",
        "market_type": "USDTM_PERPETUAL",
        "contract_size": 1.0,
        "category": None,
        "is_active": 1,
      }
    )
  return sorted(targets, key=lambda item: str(item["base_asset"]))


def fetch_symbol_onboard_dates(symbols: list[str]) -> dict[str, int]:
  payload = api_get("/fapi/v1/exchangeInfo", {})
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
      "/fapi/v1/fundingRate",
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


def fetch_full_daily_volume(symbol: str, start_ms: int) -> pd.DataFrame:
  rows: list[dict[str, float | pd.Timestamp]] = []
  cursor = start_ms
  now_ms = int(time.time() * 1000)
  while cursor < now_ms:
    batch = api_get("/fapi/v1/klines", {"symbol": symbol, "interval": "1d", "startTime": cursor, "limit": KLINE_LIMIT})
    if not isinstance(batch, list) or not batch:
      break
    for entry in batch:
      rows.append(
        {
          "date": pd.to_datetime(int(entry[0]), unit="ms", utc=True).tz_convert(GROUP_TIMEZONE).tz_localize(None),
          "contract_volume": float(entry[5]),
          "usd_volume": float(entry[7]),
        }
      )
    cursor = int(batch[-1][0]) + 86_400_000
    if len(batch) < KLINE_LIMIT:
      break
    time.sleep(REQUEST_SLEEP_SECONDS)

  if not rows:
    return pd.DataFrame(columns=["date", "contract_volume", "usd_volume"])

  return pd.DataFrame(rows).sort_values("date").drop_duplicates(subset="date", keep="last").reset_index(drop=True)


def fetch_full_weekly_klines(symbol: str, start_ms: int) -> list[list[object]]:
  rows: list[list[object]] = []
  cursor = start_ms
  now_ms = int(time.time() * 1000)
  while True:
    batch = api_get("/fapi/v1/klines", {"symbol": symbol, "interval": "1w", "startTime": cursor, "limit": KLINE_LIMIT})
    if not isinstance(batch, list) or not batch:
      break
    rows.extend(batch)
    cursor = int(batch[-1][0]) + 1
    if len(batch) < KLINE_LIMIT:
      break
    time.sleep(REQUEST_SLEEP_SECONDS)
  deduped = {int(row[0]): row for row in rows}
  return [deduped[key] for key in sorted(deduped) if int(deduped[key][6]) < now_ms]


def build_usdtm_volume_quality_audit(symbol: str, volume_df: pd.DataFrame) -> dict[str, object]:
  if volume_df.empty:
    return {
      "symbol": symbol,
      "source_type": "usdtm_1d_kline",
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
      "notes": "no kline volume rows returned",
    }

  sorted_volume = volume_df.sort_values("date").drop_duplicates(subset="date", keep="last")
  dates = pd.to_datetime(sorted_volume["date"])
  diffs = dates.diff().dropna().dt.days
  gap_sizes = diffs[diffs > 1]
  gap_count = int(len(gap_sizes))
  max_gap_days = int(gap_sizes.max()) if gap_count else 0
  completeness_score = max(100.0 - min(gap_count * 5.0, 40.0), 0.0)
  notes = ["usd_volume=quote_asset_volume", "source=futures_klines"]
  status = "warning" if gap_count else "ok"
  if len(sorted_volume) < LOOKBACK_YEARS * 365:
    notes.append("short_history_or_new_listing")
  if gap_count:
    notes.append(f"gaps={gap_count}")

  return {
    "symbol": symbol,
    "source_type": "usdtm_1d_kline",
    "kline_row_count": int(len(sorted_volume)),
    "first_metric_date": pd.Timestamp(dates.iloc[0]).strftime("%Y-%m-%d"),
    "last_metric_date": pd.Timestamp(dates.iloc[-1]).strftime("%Y-%m-%d"),
    "day_count": int(len(sorted_volume)),
    "gap_count": gap_count,
    "max_gap_days": max_gap_days,
    "avg_usd_volume": float(sorted_volume["usd_volume"].mean()),
    "min_usd_volume": float(sorted_volume["usd_volume"].min()),
    "max_usd_volume": float(sorted_volume["usd_volume"].max()),
    "completeness_score": round(completeness_score, 2),
    "status": status,
    "notes": ", ".join(notes),
  }


def write_weekly_kline_cache(base_asset: str, rows: list[list[object]]) -> Path:
  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
  output_path = OUTPUT_DIR / f"{base_asset}.json"
  output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  return output_path


def main() -> None:
  targets = load_usdtm_targets()
  if not targets:
    raise RuntimeError("no matched USDT-M perpetual symbols found")
  onboard_dates = fetch_symbol_onboard_dates([str(target["symbol"]) for target in targets])

  run_id: int | None = None
  with sqlite_connection() as conn:
    initialize_database(conn)
    upsert_symbol_records(conn, targets, deactivate_missing=False)
    run_id = create_collector_run(conn, LOOKBACK_YEARS, len(targets))
    try:
      for target in targets:
        symbol = str(target["symbol"])
        base_asset = str(target["base_asset"])
        start_ms = onboard_dates[symbol]
        funding_df = fetch_full_funding_history(symbol, start_ms)
        daily_funding = compute_daily_funding(funding_df, group_timezone=GROUP_TIMEZONE)
        weekly_funding = build_weekly_symbol_metrics(daily_funding)
        monthly_funding = build_monthly_symbol_metrics(daily_funding)
        volume_df = fetch_full_daily_volume(symbol, start_ms)
        weekly_klines = fetch_full_weekly_klines(symbol, start_ms)
        if volume_df.empty or not weekly_klines:
          raise RuntimeError(f"{symbol} missing volume or weekly klines")

        persist_raw_funding_rates(conn, symbol, funding_df, run_id)
        persist_daily_funding_metrics(conn, symbol, daily_funding, run_id)
        persist_weekly_funding_metrics(conn, symbol, weekly_funding, run_id)
        persist_monthly_funding_metrics(conn, symbol, monthly_funding, run_id)
        persist_daily_volume_metrics(conn, symbol, volume_df, run_id)
        persist_funding_quality_audit(conn, run_id, build_funding_quality_audit(symbol, funding_df, daily_funding, int(funding_df.attrs.get("raw_row_count", len(funding_df)))))
        persist_volume_quality_audit(conn, run_id, build_usdtm_volume_quality_audit(symbol, volume_df))
        output_path = write_weekly_kline_cache(base_asset, weekly_klines)
        conn.commit()
        print(f"{base_asset}: funding_days={len(daily_funding)} volume_days={len(volume_df)} weekly_klines={len(weekly_klines)} -> {output_path}", flush=True)
        time.sleep(REQUEST_SLEEP_SECONDS)

      finalize_collector_run(conn, run_id=run_id, status="completed", skipped_symbol_count=0, notes=f"USDT-M research backfill for {len(targets)} matched symbols")
    except Exception as exc:
      finalize_collector_run(conn, run_id=run_id, status="failed", skipped_symbol_count=0, notes=str(exc)[:500])
      raise


if __name__ == "__main__":
  main()
