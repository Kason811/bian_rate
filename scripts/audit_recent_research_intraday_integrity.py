#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, List

ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "data" / "bian_rate.sqlite3"
KLINE_ROOT = ROOT_DIR / "web" / "lib" / "research-klines"
FOUR_HOUR_MS = 4 * 60 * 60 * 1000
EIGHT_HOUR_MS = 8 * 60 * 60 * 1000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit recent 4h/8h research cache integrity for COIN-M and USDT-M.")
    parser.add_argument("--window-days", type=int, default=14)
    parser.add_argument("--output", default="run/research-4h-cache-integrity.json")
    return parser.parse_args()


def load_active_symbols() -> list[tuple[str, str]]:
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            """
            SELECT market_type, base_asset
            FROM symbols
            WHERE is_active = 1
              AND market_type IN ('COINM_PERPETUAL', 'USDTM_PERPETUAL')
            ORDER BY market_type, base_asset
            """
        ).fetchall()
    finally:
        conn.close()
    result: list[tuple[str, str]] = []
    for market_type, base_asset in rows:
        market = "coinm" if market_type == "COINM_PERPETUAL" else "usdtm"
        result.append((market, str(base_asset)))
    return result


def latest_closed_open_ms(now_ms: int, interval_ms: int) -> int:
    return (now_ms // interval_ms) * interval_ms - interval_ms


def expected_starts(end_open_ms: int, interval_ms: int, periods: int) -> list[int]:
    return [end_open_ms - interval_ms * offset for offset in range(periods - 1, -1, -1)]


def load_4h_rows(market: str, symbol: str) -> list[list]:
    path = KLINE_ROOT / market / "4h" / f"{symbol}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def iso_utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def summarize_symbol(market: str, symbol: str, recent_4h_expected: list[int], recent_8h_expected: list[int]) -> Dict[str, object]:
    rows = load_4h_rows(market, symbol)
    path = KLINE_ROOT / market / "4h" / f"{symbol}.json"
    if not rows:
        return {
            "market": market,
            "symbol": symbol,
            "status": "failed",
            "cache_file": str(path),
            "four_hour_rows": 0,
            "eight_hour_rows": 0,
            "latest_4h_open": None,
            "latest_8h_open": None,
            "missing_4h_count": len(recent_4h_expected),
            "missing_8h_count": len(recent_8h_expected),
            "incomplete_8h_count": len(recent_8h_expected),
            "first_missing_4h_open": iso_utc(recent_4h_expected[0]) if recent_4h_expected else None,
            "first_missing_8h_open": iso_utc(recent_8h_expected[0]) if recent_8h_expected else None,
            "first_incomplete_8h_open": iso_utc(recent_8h_expected[0]) if recent_8h_expected else None,
            "first_missing_any_open": iso_utc(recent_4h_expected[0]) if recent_4h_expected else None,
            "notes": ["缺4h缓存文件"],
        }

    opens = sorted({int(row[0]) for row in rows})
    open_set = set(opens)
    latest_4h_open = opens[-1] if opens else None
    bucket_counts: dict[int, int] = defaultdict(int)
    for open_ms in opens:
        bucket_counts[(open_ms // EIGHT_HOUR_MS) * EIGHT_HOUR_MS] += 1
    eight_hour_opens = sorted(bucket_counts.keys())
    eight_hour_open_set = set(eight_hour_opens)
    latest_8h_open = eight_hour_opens[-1] if eight_hour_opens else None

    missing_4h = [open_ms for open_ms in recent_4h_expected if open_ms not in open_set]
    missing_8h = [open_ms for open_ms in recent_8h_expected if open_ms not in eight_hour_open_set]
    incomplete_8h = [open_ms for open_ms in recent_8h_expected if bucket_counts.get(open_ms, 0) != 2]
    notes: list[str] = []

    if len(opens) < 360:
        notes.append(f"4h K线不足({len(opens)}/360)")
    if len(eight_hour_opens) < 270:
        notes.append(f"8h派生K线不足({len(eight_hour_opens)}/270)")
    if missing_4h:
        notes.append(f"最近窗口缺4h桶({len(missing_4h)})")
    if missing_8h:
        notes.append(f"最近窗口缺8h桶({len(missing_8h)})")
    if incomplete_8h:
        notes.append(f"最近窗口8h桶不完整({len(incomplete_8h)})")
    if latest_4h_open != recent_4h_expected[-1]:
        notes.append("最新4h桶未更新到最近已收线")
    if latest_8h_open != recent_8h_expected[-1]:
        notes.append("最新8h桶未更新到最近已收线")

    status = "ok"
    if any(note.startswith("4h K线不足") or note.startswith("8h派生K线不足") or note == "最新4h桶未更新到最近已收线" or note == "最新8h桶未更新到最近已收线" for note in notes):
        status = "warning"
    if missing_4h or missing_8h or incomplete_8h:
        status = "warning"
    if len(opens) == 0:
        status = "failed"

    first_missing_any = min(
        [value for value in [missing_4h[0] if missing_4h else None, missing_8h[0] if missing_8h else None, incomplete_8h[0] if incomplete_8h else None] if value is not None],
        default=None,
    )
    return {
        "market": market,
        "symbol": symbol,
        "status": status,
        "cache_file": str(path),
        "four_hour_rows": len(opens),
        "eight_hour_rows": len(eight_hour_opens),
        "latest_4h_open": iso_utc(latest_4h_open) if latest_4h_open is not None else None,
        "latest_8h_open": iso_utc(latest_8h_open) if latest_8h_open is not None else None,
        "missing_4h_count": len(missing_4h),
        "missing_8h_count": len(missing_8h),
        "incomplete_8h_count": len(incomplete_8h),
        "first_missing_4h_open": iso_utc(missing_4h[0]) if missing_4h else None,
        "first_missing_8h_open": iso_utc(missing_8h[0]) if missing_8h else None,
        "first_incomplete_8h_open": iso_utc(incomplete_8h[0]) if incomplete_8h else None,
        "first_missing_any_open": iso_utc(first_missing_any) if first_missing_any is not None else None,
        "notes": notes,
    }


def build_report(window_days: int) -> Dict[str, object]:
    now_ms = int(datetime.now(tz=UTC).timestamp() * 1000)
    latest_4h_open = latest_closed_open_ms(now_ms, FOUR_HOUR_MS)
    latest_8h_open = latest_closed_open_ms(now_ms, EIGHT_HOUR_MS)
    recent_4h_expected = expected_starts(latest_4h_open, FOUR_HOUR_MS, max(window_days, 1) * 6)
    recent_8h_expected = expected_starts(latest_8h_open, EIGHT_HOUR_MS, max(window_days, 1) * 3)

    symbols = load_active_symbols()
    reports = [summarize_symbol(market, symbol, recent_4h_expected, recent_8h_expected) for market, symbol in symbols]
    warning_count = sum(1 for row in reports if row["status"] == "warning")
    failed_count = sum(1 for row in reports if row["status"] == "failed")
    status = "ok"
    if failed_count:
        status = "failed"
    elif warning_count:
        status = "warning"

    return {
        "generated_at": datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "window_days": max(window_days, 1),
        "expected_latest_4h_open": iso_utc(latest_4h_open),
        "expected_latest_8h_open": iso_utc(latest_8h_open),
        "active_symbol_count": len(symbols),
        "warning_symbol_count": warning_count,
        "failed_symbol_count": failed_count,
        "status": status,
        "first_missing_any_open": min(
            [row["first_missing_any_open"] for row in reports if row["first_missing_any_open"]],
            default=None,
        ),
        "symbols": reports,
    }


def main() -> None:
    args = parse_args()
    report = build_report(args.window_days)
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT_DIR / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[research-4h-integrity] status={report['status']} "
        f"symbols={report['active_symbol_count']} "
        f"warnings={report['warning_symbol_count']} "
        f"failed={report['failed_symbol_count']} "
        f"latest4h={report['expected_latest_4h_open']} "
        f"latest8h={report['expected_latest_8h_open']}"
    )
    if report["warning_symbol_count"] or report["failed_symbol_count"]:
        for symbol_report in report["symbols"]:
            if symbol_report["status"] == "ok":
                continue
            print(
                f"[research-4h-integrity:{symbol_report['status']}] "
                f"{symbol_report['market']}:{symbol_report['symbol']} "
                f"missing4h={symbol_report['missing_4h_count']} "
                f"missing8h={symbol_report['missing_8h_count']} "
                f"incomplete8h={symbol_report['incomplete_8h_count']} "
                f"latest4h={symbol_report['latest_4h_open']} "
                f"latest8h={symbol_report['latest_8h_open']}"
            )


if __name__ == "__main__":
    main()
