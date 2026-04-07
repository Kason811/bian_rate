#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from binance_coin_funding_rate_collector import REQUEST_SLEEP_SECONDS
from sqlite_store import sqlite_connection

BASE_URL = "https://dapi.binance.com"
MAX_RETRIES = 6
OUTPUT_DIR = ROOT / "web" / "lib" / "research-klines" / "coinm" / "week"


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


def load_coinm_symbols() -> list[tuple[str, str]]:
  with sqlite_connection() as conn:
    rows = conn.execute(
      """
      SELECT base_asset, symbol
      FROM symbols
      WHERE market_type = 'COINM_PERPETUAL'
        AND is_active = 1
      ORDER BY base_asset
      """
    ).fetchall()
  return [(str(row["base_asset"]), str(row["symbol"])) for row in rows]


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


def write_kline_cache(symbol: str, rows: list[list[object]]) -> Path:
  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
  output_path = OUTPUT_DIR / f"{symbol}.json"
  output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  return output_path


def main() -> None:
  symbols = load_coinm_symbols()
  if not symbols:
    raise RuntimeError("no active COIN-M symbols found in database")

  for base_asset, symbol in symbols:
    pair = symbol.replace("_PERP", "")
    rows = fetch_full_weekly_continuous_klines(pair)
    if not rows:
      raise RuntimeError(f"{symbol} weekly klines empty")
    output_path = write_kline_cache(base_asset, rows)
    print(f"{base_asset}: {len(rows)} weekly klines -> {output_path}")
    time.sleep(REQUEST_SLEEP_SECONDS)


if __name__ == "__main__":
  main()
