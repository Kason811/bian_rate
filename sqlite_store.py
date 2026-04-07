#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQLite persistence helpers for funding-rate collection.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List

import pandas as pd

DB_PATH = Path(__file__).resolve().parent / "data" / "bian_rate.sqlite3"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def sqlite_connection(db_path: Path = DB_PATH) -> Iterator[sqlite3.Connection]:
    ensure_parent_dir(db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_database(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS collector_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            status TEXT NOT NULL,
            lookback_years INTEGER NOT NULL,
            symbol_count INTEGER DEFAULT 0,
            skipped_symbol_count INTEGER DEFAULT 0,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS symbols (
            symbol TEXT PRIMARY KEY,
            base_asset TEXT NOT NULL,
            quote_asset TEXT NOT NULL,
            market_type TEXT NOT NULL,
            contract_size REAL NOT NULL,
            category TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS funding_rates_raw (
            symbol TEXT NOT NULL,
            funding_time TEXT NOT NULL,
            funding_rate REAL NOT NULL,
            run_id INTEGER,
            collected_at TEXT NOT NULL,
            PRIMARY KEY (symbol, funding_time),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE TABLE IF NOT EXISTS daily_funding_metrics (
            symbol TEXT NOT NULL,
            metric_date TEXT NOT NULL,
            daily_funding_rate REAL NOT NULL,
            funding_event_count INTEGER NOT NULL,
            run_id INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol, metric_date),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE TABLE IF NOT EXISTS monthly_funding_metrics (
            symbol TEXT NOT NULL,
            metric_month TEXT NOT NULL,
            monthly_funding_rate REAL NOT NULL,
            positive_days INTEGER NOT NULL,
            negative_days INTEGER NOT NULL,
            zero_days INTEGER NOT NULL,
            run_id INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol, metric_month),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE TABLE IF NOT EXISTS weekly_funding_metrics (
            symbol TEXT NOT NULL,
            metric_week TEXT NOT NULL,
            weekly_funding_rate REAL NOT NULL,
            positive_days INTEGER NOT NULL,
            negative_days INTEGER NOT NULL,
            zero_days INTEGER NOT NULL,
            run_id INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol, metric_week),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE TABLE IF NOT EXISTS funding_quality_audits (
            run_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            raw_event_count INTEGER NOT NULL,
            duplicate_event_count INTEGER NOT NULL,
            first_funding_time TEXT,
            last_funding_time TEXT,
            inferred_interval_hours REAL NOT NULL,
            gap_count INTEGER NOT NULL,
            max_gap_hours REAL NOT NULL,
            day_count INTEGER NOT NULL,
            days_with_zero_events INTEGER NOT NULL,
            min_events_per_day INTEGER NOT NULL,
            max_events_per_day INTEGER NOT NULL,
            completeness_score REAL NOT NULL,
            status TEXT NOT NULL,
            notes TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (run_id, symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol)
        );

        CREATE TABLE IF NOT EXISTS volume_quality_audits (
            run_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            source_type TEXT NOT NULL,
            kline_row_count INTEGER NOT NULL,
            first_metric_date TEXT,
            last_metric_date TEXT,
            day_count INTEGER NOT NULL,
            gap_count INTEGER NOT NULL,
            max_gap_days INTEGER NOT NULL,
            avg_usd_volume REAL NOT NULL,
            min_usd_volume REAL NOT NULL,
            max_usd_volume REAL NOT NULL,
            completeness_score REAL NOT NULL,
            status TEXT NOT NULL,
            notes TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (run_id, symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol)
        );

        CREATE TABLE IF NOT EXISTS daily_volume_metrics (
            symbol TEXT NOT NULL,
            metric_date TEXT NOT NULL,
            usd_volume REAL NOT NULL,
            contract_volume REAL NOT NULL,
            run_id INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol, metric_date),
            FOREIGN KEY (symbol) REFERENCES symbols(symbol),
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE TABLE IF NOT EXISTS market_snapshots (
            snapshot_key TEXT PRIMARY KEY,
            snapshot_date TEXT NOT NULL,
            snapshot_level TEXT NOT NULL,
            focus_index REAL NOT NULL,
            breadth_pct REAL NOT NULL,
            high_liquidity_avg REAL NOT NULL,
            positive_symbol_count INTEGER NOT NULL,
            negative_symbol_count INTEGER NOT NULL,
            zero_symbol_count INTEGER NOT NULL,
            top_symbol TEXT,
            top_funding_rate REAL,
            run_id INTEGER,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES collector_runs(run_id)
        );

        CREATE INDEX IF NOT EXISTS idx_funding_rates_raw_symbol_time
            ON funding_rates_raw(symbol, funding_time);
        CREATE INDEX IF NOT EXISTS idx_daily_funding_metrics_symbol_date
            ON daily_funding_metrics(symbol, metric_date);
        CREATE INDEX IF NOT EXISTS idx_monthly_funding_metrics_symbol_month
            ON monthly_funding_metrics(symbol, metric_month);
        CREATE INDEX IF NOT EXISTS idx_weekly_funding_metrics_symbol_week
            ON weekly_funding_metrics(symbol, metric_week);
        CREATE INDEX IF NOT EXISTS idx_funding_quality_audits_run
            ON funding_quality_audits(run_id);
        CREATE INDEX IF NOT EXISTS idx_volume_quality_audits_run
            ON volume_quality_audits(run_id);
        CREATE INDEX IF NOT EXISTS idx_daily_volume_metrics_symbol_date
            ON daily_volume_metrics(symbol, metric_date);
        CREATE INDEX IF NOT EXISTS idx_market_snapshots_date
            ON market_snapshots(snapshot_date);
        """
    )


def normalize_symbol_label(symbol: str) -> str:
    base = symbol.replace("_PERP", "")
    if base.endswith("USD"):
        base = base[:-3]
    return base


def create_collector_run(conn: sqlite3.Connection, lookback_years: int, symbol_count: int) -> int:
    cursor = conn.execute(
        """
        INSERT INTO collector_runs (started_at, status, lookback_years, symbol_count)
        VALUES (?, 'running', ?, ?)
        """,
        (utc_now_iso(), lookback_years, symbol_count),
    )
    return int(cursor.lastrowid)


def finalize_collector_run(
    conn: sqlite3.Connection,
    run_id: int,
    status: str,
    skipped_symbol_count: int,
    notes: str = "",
) -> None:
    conn.execute(
        """
        UPDATE collector_runs
        SET completed_at = ?, status = ?, skipped_symbol_count = ?, notes = ?
        WHERE run_id = ?
        """,
        (utc_now_iso(), status, skipped_symbol_count, notes, run_id),
    )


def upsert_symbols(
    conn: sqlite3.Connection,
    symbols: List[str],
    contract_sizes: Dict[str, float],
    deactivate_missing: bool = True,
) -> None:
    records = []
    for symbol in symbols:
        base_asset = symbol.replace("_PERP", "")
        quote_asset = "USD" if base_asset.endswith("USD") else ""
        if quote_asset:
            base_asset = base_asset[: -len(quote_asset)]
        records.append(
            {
                "symbol": symbol,
                "base_asset": base_asset,
                "quote_asset": quote_asset or "USD",
                "market_type": "COINM_PERPETUAL",
                "contract_size": float(contract_sizes.get(symbol, 1.0)),
                "category": None,
                "is_active": 1,
            }
        )
    upsert_symbol_records(conn, records, deactivate_missing=deactivate_missing)


def upsert_symbol_records(
    conn: sqlite3.Connection,
    records: List[Dict[str, object]],
    deactivate_missing: bool = True,
) -> None:
    now_iso = utc_now_iso()
    rows = []
    symbols = []
    market_types = []
    for record in records:
        symbol = str(record["symbol"])
        symbols.append(symbol)
        market_type = str(record["market_type"])
        market_types.append(market_type)
        rows.append(
            (
                str(record["symbol"]),
                str(record["base_asset"]),
                str(record["quote_asset"]),
                market_type,
                float(record.get("contract_size", 1.0)),
                record.get("category"),
                int(record.get("is_active", 1)),
                now_iso,
            )
        )

    conn.executemany(
        """
        INSERT INTO symbols (
            symbol, base_asset, quote_asset, market_type, contract_size, category, is_active, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            base_asset = excluded.base_asset,
            quote_asset = excluded.quote_asset,
            market_type = excluded.market_type,
            contract_size = excluded.contract_size,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at
        """,
        rows,
    )

    if deactivate_missing and symbols:
        symbol_placeholders = ",".join("?" for _ in symbols)
        market_type_placeholders = ",".join("?" for _ in market_types)
        conn.execute(
            f"""
            UPDATE symbols
            SET is_active = 0, updated_at = ?
            WHERE market_type IN ({market_type_placeholders})
              AND symbol NOT IN ({symbol_placeholders})
            """,
            [now_iso, *market_types, *symbols],
        )


def _replace_table_slice(
    conn: sqlite3.Connection,
    table: str,
    date_column: str,
    symbol: str,
    rows: Iterable[tuple],
    insert_sql: str,
) -> None:
    row_list = list(rows)
    if not row_list:
        return

    date_values = [row[1] for row in row_list]
    conn.execute(
        f"DELETE FROM {table} WHERE symbol = ? AND {date_column} BETWEEN ? AND ?",
        (symbol, min(date_values), max(date_values)),
    )
    conn.executemany(insert_sql, row_list)


def persist_raw_funding_rates(conn: sqlite3.Connection, symbol: str, funding_df: pd.DataFrame, run_id: int) -> int:
    if funding_df.empty:
        return 0

    collected_at = utc_now_iso()
    rows = [
        (
            symbol,
            pd.Timestamp(row.fundingTime).isoformat(),
            float(row.fundingRate),
            run_id,
            collected_at,
        )
        for row in funding_df.itertuples(index=False)
    ]
    _replace_table_slice(
        conn=conn,
        table="funding_rates_raw",
        date_column="funding_time",
        symbol=symbol,
        rows=rows,
        insert_sql="""
            INSERT INTO funding_rates_raw (symbol, funding_time, funding_rate, run_id, collected_at)
            VALUES (?, ?, ?, ?, ?)
        """,
    )
    return len(rows)


def persist_daily_funding_metrics(
    conn: sqlite3.Connection,
    symbol: str,
    daily_df: pd.DataFrame,
    run_id: int,
) -> int:
    if daily_df.empty:
        return 0

    updated_at = utc_now_iso()
    rows = [
        (
            symbol,
            pd.Timestamp(row.date).strftime("%Y-%m-%d"),
            float(row.daily_funding_rate),
            int(row.funding_event_count),
            run_id,
            updated_at,
        )
        for row in daily_df.itertuples(index=False)
    ]
    _replace_table_slice(
        conn=conn,
        table="daily_funding_metrics",
        date_column="metric_date",
        symbol=symbol,
        rows=rows,
        insert_sql="""
            INSERT INTO daily_funding_metrics (
                symbol, metric_date, daily_funding_rate, funding_event_count, run_id, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """,
    )
    return len(rows)


def build_monthly_symbol_metrics(daily_df: pd.DataFrame) -> pd.DataFrame:
    if daily_df.empty:
        return pd.DataFrame(
            columns=["metric_month", "monthly_funding_rate", "positive_days", "negative_days", "zero_days"]
        )

    temp = daily_df.copy()
    temp["date"] = pd.to_datetime(temp["date"])
    temp["metric_month"] = temp["date"].dt.to_period("M").astype(str)
    grouped = (
        temp.groupby("metric_month", as_index=False)
        .agg(
            monthly_funding_rate=("daily_funding_rate", "sum"),
            positive_days=("daily_funding_rate", lambda s: int((s > 0).sum())),
            negative_days=("daily_funding_rate", lambda s: int((s < 0).sum())),
            zero_days=("daily_funding_rate", lambda s: int((s == 0).sum())),
        )
    )
    return grouped


def build_weekly_symbol_metrics(daily_df: pd.DataFrame) -> pd.DataFrame:
    if daily_df.empty:
        return pd.DataFrame(
            columns=["metric_week", "weekly_funding_rate", "positive_days", "negative_days", "zero_days"]
        )

    temp = daily_df.copy()
    temp["date"] = pd.to_datetime(temp["date"])
    temp["metric_week"] = temp["date"].dt.to_period("W-SUN").astype(str)
    grouped = (
        temp.groupby("metric_week", as_index=False)
        .agg(
            weekly_funding_rate=("daily_funding_rate", "sum"),
            positive_days=("daily_funding_rate", lambda s: int((s > 0).sum())),
            negative_days=("daily_funding_rate", lambda s: int((s < 0).sum())),
            zero_days=("daily_funding_rate", lambda s: int((s == 0).sum())),
        )
    )
    return grouped


def persist_monthly_funding_metrics(
    conn: sqlite3.Connection,
    symbol: str,
    monthly_df: pd.DataFrame,
    run_id: int,
) -> int:
    if monthly_df.empty:
        return 0

    updated_at = utc_now_iso()
    rows = [
        (
            symbol,
            str(row.metric_month),
            float(row.monthly_funding_rate),
            int(row.positive_days),
            int(row.negative_days),
            int(row.zero_days),
            run_id,
            updated_at,
        )
        for row in monthly_df.itertuples(index=False)
    ]
    _replace_table_slice(
        conn=conn,
        table="monthly_funding_metrics",
        date_column="metric_month",
        symbol=symbol,
        rows=rows,
        insert_sql="""
            INSERT INTO monthly_funding_metrics (
                symbol, metric_month, monthly_funding_rate, positive_days, negative_days, zero_days, run_id, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
    )
    return len(rows)


def load_daily_funding_metrics(
    conn: sqlite3.Connection,
    symbol: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    conditions = ["symbol = ?"]
    params: List[object] = [symbol]
    if start_date is not None:
        conditions.append("metric_date >= ?")
        params.append(start_date)
    if end_date is not None:
        conditions.append("metric_date <= ?")
        params.append(end_date)

    query = f"""
        SELECT metric_date AS date, daily_funding_rate, funding_event_count
        FROM daily_funding_metrics
        WHERE {' AND '.join(conditions)}
        ORDER BY metric_date
    """
    frame = pd.read_sql_query(query, conn, params=params)
    if frame.empty:
        return pd.DataFrame(columns=["date", "daily_funding_rate", "funding_event_count"])
    frame["date"] = pd.to_datetime(frame["date"])
    frame["daily_funding_rate"] = pd.to_numeric(frame["daily_funding_rate"], errors="coerce").fillna(0.0)
    frame["funding_event_count"] = pd.to_numeric(frame["funding_event_count"], errors="coerce").fillna(0).astype(int)
    return frame[["date", "daily_funding_rate", "funding_event_count"]]


def persist_weekly_funding_metrics(
    conn: sqlite3.Connection,
    symbol: str,
    weekly_df: pd.DataFrame,
    run_id: int,
) -> int:
    if weekly_df.empty:
        return 0

    updated_at = utc_now_iso()
    rows = [
        (
            symbol,
            str(row.metric_week),
            float(row.weekly_funding_rate),
            int(row.positive_days),
            int(row.negative_days),
            int(row.zero_days),
            run_id,
            updated_at,
        )
        for row in weekly_df.itertuples(index=False)
    ]
    _replace_table_slice(
        conn=conn,
        table="weekly_funding_metrics",
        date_column="metric_week",
        symbol=symbol,
        rows=rows,
        insert_sql="""
            INSERT INTO weekly_funding_metrics (
                symbol, metric_week, weekly_funding_rate, positive_days, negative_days, zero_days, run_id, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
    )
    return len(rows)


def persist_daily_volume_metrics(
    conn: sqlite3.Connection,
    symbol: str,
    volume_df: pd.DataFrame,
    run_id: int,
) -> int:
    if volume_df.empty:
        return 0

    updated_at = utc_now_iso()
    rows = [
        (
            symbol,
            pd.Timestamp(row.date).strftime("%Y-%m-%d"),
            float(row.usd_volume),
            float(row.contract_volume),
            run_id,
            updated_at,
        )
        for row in volume_df.itertuples(index=False)
    ]
    _replace_table_slice(
        conn=conn,
        table="daily_volume_metrics",
        date_column="metric_date",
        symbol=symbol,
        rows=rows,
        insert_sql="""
            INSERT INTO daily_volume_metrics (
                symbol, metric_date, usd_volume, contract_volume, run_id, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """,
    )
    return len(rows)


def persist_market_snapshots(
    conn: sqlite3.Connection,
    monthly_summary: pd.DataFrame,
    focus_basket: List[str],
    high_liquidity_symbols: List[str],
    run_id: int,
) -> int:
    if monthly_summary.empty:
        return 0

    normalized_focus = [normalize_symbol_label(symbol) for symbol in focus_basket]
    normalized_liquidity = [normalize_symbol_label(symbol) for symbol in high_liquidity_symbols]
    updated_at = utc_now_iso()
    rows = []
    for month_period in monthly_summary.index:
        row = monthly_summary.loc[month_period]
        normalized_row = row.copy()
        normalized_row.index = [normalize_symbol_label(str(symbol)) for symbol in normalized_row.index]
        normalized_row = normalized_row.groupby(level=0).sum()

        available_focus = [symbol for symbol in normalized_focus if symbol in normalized_row.index]
        available_liquidity = [symbol for symbol in normalized_liquidity if symbol in normalized_row.index]
        if not available_focus:
            continue

        focus_index = float(normalized_row[available_focus].mean())
        breadth_pct = float((normalized_row > 0).sum() / len(normalized_row) * 100) if len(normalized_row) else 0.0
        high_liquidity_avg = float(normalized_row[available_liquidity].mean()) if available_liquidity else 0.0
        top_symbol = str(normalized_row.sort_values(ascending=False).index[0]) if len(normalized_row) else None
        top_funding_rate = float(normalized_row.max()) if len(normalized_row) else None
        snapshot_date = str(month_period)
        snapshot_key = f"month:{snapshot_date}"

        rows.append(
            (
                snapshot_key,
                snapshot_date,
                "month",
                focus_index,
                breadth_pct,
                high_liquidity_avg,
                int((row > 0).sum()),
                int((row < 0).sum()),
                int((row == 0).sum()),
                top_symbol,
                top_funding_rate,
                run_id,
                updated_at,
            )
        )

    if not rows:
        return 0

    conn.execute("DELETE FROM market_snapshots WHERE snapshot_level = 'month'")
    conn.executemany(
        """
        INSERT INTO market_snapshots (
            snapshot_key, snapshot_date, snapshot_level, focus_index, breadth_pct, high_liquidity_avg,
            positive_symbol_count, negative_symbol_count, zero_symbol_count, top_symbol, top_funding_rate,
            run_id, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def persist_funding_quality_audit(
    conn: sqlite3.Connection,
    run_id: int,
    audit: Dict[str, object],
) -> None:
    conn.execute(
        """
        INSERT INTO funding_quality_audits (
            run_id, symbol, raw_event_count, duplicate_event_count, first_funding_time, last_funding_time,
            inferred_interval_hours, gap_count, max_gap_hours, day_count, days_with_zero_events,
            min_events_per_day, max_events_per_day, completeness_score, status, notes, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, symbol) DO UPDATE SET
            raw_event_count = excluded.raw_event_count,
            duplicate_event_count = excluded.duplicate_event_count,
            first_funding_time = excluded.first_funding_time,
            last_funding_time = excluded.last_funding_time,
            inferred_interval_hours = excluded.inferred_interval_hours,
            gap_count = excluded.gap_count,
            max_gap_hours = excluded.max_gap_hours,
            day_count = excluded.day_count,
            days_with_zero_events = excluded.days_with_zero_events,
            min_events_per_day = excluded.min_events_per_day,
            max_events_per_day = excluded.max_events_per_day,
            completeness_score = excluded.completeness_score,
            status = excluded.status,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        (
            run_id,
            str(audit["symbol"]),
            int(audit["raw_event_count"]),
            int(audit["duplicate_event_count"]),
            audit.get("first_funding_time"),
            audit.get("last_funding_time"),
            float(audit["inferred_interval_hours"]),
            int(audit["gap_count"]),
            float(audit["max_gap_hours"]),
            int(audit["day_count"]),
            int(audit["days_with_zero_events"]),
            int(audit["min_events_per_day"]),
            int(audit["max_events_per_day"]),
            float(audit["completeness_score"]),
            str(audit["status"]),
            str(audit.get("notes", ""))[:500],
            utc_now_iso(),
        ),
    )


def persist_volume_quality_audit(
    conn: sqlite3.Connection,
    run_id: int,
    audit: Dict[str, object],
) -> None:
    conn.execute(
        """
        INSERT INTO volume_quality_audits (
            run_id, symbol, source_type, kline_row_count, first_metric_date, last_metric_date,
            day_count, gap_count, max_gap_days, avg_usd_volume, min_usd_volume, max_usd_volume,
            completeness_score, status, notes, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, symbol) DO UPDATE SET
            source_type = excluded.source_type,
            kline_row_count = excluded.kline_row_count,
            first_metric_date = excluded.first_metric_date,
            last_metric_date = excluded.last_metric_date,
            day_count = excluded.day_count,
            gap_count = excluded.gap_count,
            max_gap_days = excluded.max_gap_days,
            avg_usd_volume = excluded.avg_usd_volume,
            min_usd_volume = excluded.min_usd_volume,
            max_usd_volume = excluded.max_usd_volume,
            completeness_score = excluded.completeness_score,
            status = excluded.status,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        (
            run_id,
            str(audit["symbol"]),
            str(audit["source_type"]),
            int(audit["kline_row_count"]),
            audit.get("first_metric_date"),
            audit.get("last_metric_date"),
            int(audit["day_count"]),
            int(audit["gap_count"]),
            int(audit["max_gap_days"]),
            float(audit["avg_usd_volume"]),
            float(audit["min_usd_volume"]),
            float(audit["max_usd_volume"]),
            float(audit["completeness_score"]),
            str(audit["status"]),
            str(audit.get("notes", ""))[:500],
            utc_now_iso(),
        ),
    )
