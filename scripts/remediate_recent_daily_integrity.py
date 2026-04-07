#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
COLLECTOR = ROOT_DIR / "binance_coin_funding_rate_collector.py"
AUDIT = ROOT_DIR / "scripts" / "audit_recent_daily_integrity.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-remediate recent daily integrity gaps with one wider collector rerun.")
    parser.add_argument("--report", default="run/collector-recent-integrity.json")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--end-offset-days", type=int, default=1)
    parser.add_argument("--current-lookback-days", type=int, default=14)
    parser.add_argument("--current-volume-lookback-days", type=int, default=45)
    parser.add_argument("--max-lookback-days", type=int, default=90)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def load_report(path_value: str) -> tuple[Path, dict]:
    path = Path(path_value)
    if not path.is_absolute():
        path = ROOT_DIR / path
    payload = json.loads(path.read_text(encoding="utf-8"))
    return path, payload


def recommended_lookback_days(report: dict, current_lookback_days: int, current_volume_lookback_days: int, max_lookback_days: int) -> tuple[int, int] | None:
    if report.get("status") == "ok":
      return None

    earliest_text = report.get("first_missing_any_date")
    if not earliest_text:
      return None

    earliest_date = datetime.strptime(str(earliest_text), "%Y-%m-%d").replace(tzinfo=UTC)
    generated_at = datetime.strptime(str(report["generated_at"]).replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")
    gap_days = max((generated_at - earliest_date).days, 1)
    funding_days = min(max(current_lookback_days, gap_days + 3), max_lookback_days)
    volume_days = min(max(current_volume_lookback_days, funding_days), max_lookback_days)
    return funding_days, volume_days


def run_command(args: list[str]) -> None:
    subprocess.run(args, cwd=ROOT_DIR, check=True)


def main() -> None:
    args = parse_args()
    report_path, report = load_report(args.report)
    recommendation = recommended_lookback_days(
        report=report,
        current_lookback_days=max(args.current_lookback_days, 1),
        current_volume_lookback_days=max(args.current_volume_lookback_days, 1),
        max_lookback_days=max(args.max_lookback_days, 1),
    )

    result = {
        "report_path": str(report_path),
        "status": report.get("status"),
        "first_missing_any_date": report.get("first_missing_any_date"),
        "recommended_funding_lookback_days": recommendation[0] if recommendation else None,
        "recommended_volume_lookback_days": recommendation[1] if recommendation else None,
        "executed": False,
    }
    print(json.dumps(result, ensure_ascii=False))

    if not args.execute or not recommendation:
        return

    funding_days, volume_days = recommendation
    print(f"[remediate] rerun collector funding={funding_days} volume={volume_days}", flush=True)
    run_command([
        sys.executable,
        str(COLLECTOR),
        "--timezone",
        args.timezone,
        "--lookback-days",
        str(funding_days),
        "--volume-lookback-days",
        str(volume_days),
    ])
    run_command([
        sys.executable,
        str(AUDIT),
        "--timezone",
        args.timezone,
        "--window-days",
        str(max(args.window_days, 1)),
        "--end-offset-days",
        str(max(args.end_offset_days, 0)),
        "--output",
        str(report_path),
    ])


if __name__ == "__main__":
    main()
