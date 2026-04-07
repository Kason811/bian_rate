#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from binance_coin_funding_rate_collector import REQUEST_SLEEP_SECONDS
from sqlite_store import sqlite_connection

COINM_BASE_URL = "https://dapi.binance.com"
USDTM_BASE_URL = "https://fapi.binance.com"
KLINE_LIMIT = 1500
MAX_RETRIES = 6
INTERVAL = "3d"


def api_get(base_url: str, path: str, params: dict[str, object]) -> object:
  query = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
  url = f"{base_url}{path}?{query}"
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
    except urllib.error.HTTPError:
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
    except Exception:
      if attempt == MAX_RETRIES:
        raise
      time.sleep(REQUEST_SLEEP_SECONDS * (2 ** attempt))
  raise RuntimeError(f"request failed: {url}")


def load_coinm_targets() -> list[str]:
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


def load_usdtm_targets() -> list[tuple[str, str]]:
  wanted = set(load_coinm_targets())
  payload = api_get(USDTM_BASE_URL, "/fapi/v1/exchangeInfo", {})
  if not isinstance(payload, dict):
    raise RuntimeError("exchangeInfo payload invalid")
  targets: list[tuple[str, str]] = []
  for row in payload.get("symbols", []):
    if row.get("contractType") != "PERPETUAL" or row.get("status") != "TRADING":
      continue
    if row.get("quoteAsset") != "USDT":
      continue
    base_asset = str(row.get("baseAsset"))
    if base_asset not in wanted:
      continue
    targets.append((base_asset, str(row["symbol"])))
  return sorted(targets)


def fetch_coinm_3day_klines(base_asset: str) -> list[list[object]]:
  rows: list[list[object]] = []
  cursor = 0
  now_ms = int(time.time() * 1000)
  pair = f"{base_asset}USD"
  while True:
    batch = api_get(
      COINM_BASE_URL,
      "/dapi/v1/continuousKlines",
      {
        "pair": pair,
        "contractType": "PERPETUAL",
        "interval": INTERVAL,
        "startTime": cursor,
        "limit": KLINE_LIMIT,
      },
    )
    if not isinstance(batch, list) or not batch:
      break
    rows.extend(batch)
    cursor = int(batch[-1][0]) + 1
    if len(batch) < KLINE_LIMIT:
      break
    time.sleep(REQUEST_SLEEP_SECONDS)
  deduped = {int(row[0]): row for row in rows}
  return [deduped[key] for key in sorted(deduped) if int(deduped[key][6]) < now_ms]


def fetch_usdtm_3day_klines(symbol: str) -> list[list[object]]:
  rows: list[list[object]] = []
  cursor = 0
  now_ms = int(time.time() * 1000)
  while True:
    batch = api_get(
      USDTM_BASE_URL,
      "/fapi/v1/klines",
      {
        "symbol": symbol,
        "interval": INTERVAL,
        "startTime": cursor,
        "limit": KLINE_LIMIT,
      },
    )
    if not isinstance(batch, list) or not batch:
      break
    rows.extend(batch)
    cursor = int(batch[-1][0]) + 1
    if len(batch) < KLINE_LIMIT:
      break
    time.sleep(REQUEST_SLEEP_SECONDS)
  deduped = {int(row[0]): row for row in rows}
  return [deduped[key] for key in sorted(deduped) if int(deduped[key][6]) < now_ms]


def write_cache(market: str, base_asset: str, rows: list[list[object]]) -> Path:
  output_dir = ROOT / "web" / "lib" / "research-klines" / market / "3day"
  output_dir.mkdir(parents=True, exist_ok=True)
  output_path = output_dir / f"{base_asset}.json"
  output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  return output_path


def main() -> None:
  coinm_targets = load_coinm_targets()
  for base_asset in coinm_targets:
    rows = fetch_coinm_3day_klines(base_asset)
    output_path = write_cache("coinm", base_asset, rows)
    print(f"coinm {base_asset}: {len(rows)} 3day klines -> {output_path}", flush=True)

  usdtm_targets = load_usdtm_targets()
  for base_asset, symbol in usdtm_targets:
    rows = fetch_usdtm_3day_klines(symbol)
    output_path = write_cache("usdtm", base_asset, rows)
    print(f"usdtm {base_asset}: {len(rows)} 3day klines -> {output_path}", flush=True)


if __name__ == "__main__":
  main()
