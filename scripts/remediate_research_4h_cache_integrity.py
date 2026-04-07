#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKFILL = ROOT_DIR / "scripts" / "backfill_research_4h_klines.py"
AUDIT = ROOT_DIR / "scripts" / "audit_recent_research_intraday_integrity.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-remediate recent 4h/8h research cache gaps with one 4h cache rerun.")
    parser.add_argument("--report", default="run/research-4h-cache-integrity.json")
    parser.add_argument("--window-days", type=int, default=14)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def load_report(path_value: str) -> tuple[Path, dict]:
    path = Path(path_value)
    if not path.is_absolute():
        path = ROOT_DIR / path
    payload = json.loads(path.read_text(encoding="utf-8"))
    return path, payload


def run_command(args: list[str]) -> None:
    subprocess.run(args, cwd=ROOT_DIR, check=True)


def main() -> None:
    args = parse_args()
    report_path, report = load_report(args.report)
    needs_rerun = report.get("status") != "ok"
    result = {
        "report_path": str(report_path),
        "status": report.get("status"),
        "first_missing_any_open": report.get("first_missing_any_open"),
        "executed": False,
    }
    print(json.dumps(result, ensure_ascii=False))

    if not args.execute or not needs_rerun:
        return

    print("[research-4h-remediate] rerun 4h cache refresh", flush=True)
    run_command([sys.executable, str(BACKFILL)])
    run_command([sys.executable, str(AUDIT), "--window-days", str(max(args.window_days, 1)), "--output", str(report_path)])


if __name__ == "__main__":
    main()
