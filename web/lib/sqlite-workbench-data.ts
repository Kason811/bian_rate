import "server-only";

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type AuditRow, type MarketSymbol, type MonthlyRateRow, type Point, type WorkbenchData } from "@/lib/workbench-data";

type DailyFundingRow = { symbol: string; metric_date: string; daily_funding_rate: number };
type WeeklyFundingRow = { symbol: string; metric_week: string; weekly_funding_rate: number };
type MonthlyFundingRow = { symbol: string; metric_month: string; monthly_funding_rate: number };
type VolumeRow = { symbol: string; metric_date: string; usd_volume: number };
type SymbolMetaRow = { symbol: string; is_active: number };
type FundingAuditRow = { symbol: string; status: string; completeness_score: number; gap_count: number; days_with_zero_events: number; notes: string };
type VolumeAuditRow = { symbol: string; status: string; completeness_score: number; day_count: number; gap_count: number; notes: string };

function toPct(value: number) {
  return Number((value * 100).toFixed(3));
}

function toMillion(value: number) {
  return Number((value / 1_000_000).toFixed(1));
}

function weekLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const week = Math.ceil((diff + start.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthLabel(dateText: string) {
  return dateText.slice(0, 7);
}

function groupSum(rows: { key: string; value: number }[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.key, (map.get(row.key) ?? 0) + row.value);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function groupAvg(rows: { key: string; value: number }[]) {
  const map = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const current = map.get(row.key) ?? { sum: 0, count: 0 };
    current.sum += row.value;
    current.count += 1;
    map.set(row.key, current);
  }
  return [...map.entries()].map(([label, stat]) => ({ label, value: stat.sum / stat.count }));
}

function sumValues(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function avgValues(values: number[]) {
  return values.length ? sumValues(values) / values.length : 0;
}

function stdDev(values: number[]) {
  if (!values.length) return 0;
  const avg = avgValues(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function buildMonthlyRateRow(symbol: string, monthlyRates: MonthlyFundingRow[], allMonths: string[]): MonthlyRateRow {
  const valuesByMonth: Record<string, number> = {};
  for (const row of monthlyRates) {
    valuesByMonth[row.metric_month] = toPct(row.monthly_funding_rate);
  }

  const orderedValues = allMonths
    .map((month) => valuesByMonth[month])
    .filter((value): value is number => typeof value === "number");

  const last1 = orderedValues.slice(-1);
  const last3 = orderedValues.slice(-3);
  const last12 = orderedValues.slice(-12);

  return {
    symbol: symbol.replace("USD_PERP", ""),
    months: valuesByMonth,
    totalRatePct: sumValues(orderedValues),
    avgRatePct: avgValues(orderedValues),
    lastMonthRatePct: sumValues(last1),
    last3MonthsRatePct: sumValues(last3),
    last12MonthsRatePct: sumValues(last12),
    bestMonthRatePct: orderedValues.length ? Math.max(...orderedValues) : 0,
    worstMonthRatePct: orderedValues.length ? Math.min(...orderedValues) : 0,
    volatilityPct: stdDev(orderedValues),
    positiveMonths: orderedValues.filter((value) => value > 0).length,
    negativeMonths: orderedValues.filter((value) => value < 0).length,
    availableMonths: orderedValues.length,
  };
}

function buildSymbol(
  symbol: string,
  symbolMeta: SymbolMetaRow | undefined,
  dailyRates: DailyFundingRow[],
  weeklyRates: WeeklyFundingRow[],
  monthlyRates: MonthlyFundingRow[],
  dailyVolumes: VolumeRow[],
): MarketSymbol {
  const sortedDailyRates = [...dailyRates].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  const sortedWeeklyRates = [...weeklyRates].sort((a, b) => a.metric_week.localeCompare(b.metric_week));
  const sortedMonthlyRates = [...monthlyRates].sort((a, b) => a.metric_month.localeCompare(b.metric_month));
  const sortedVolumes = [...dailyVolumes].sort((a, b) => a.metric_date.localeCompare(b.metric_date));

  const last30Rates = sortedDailyRates.slice(-30);
  const last90Rates = sortedDailyRates.slice(-90);
  const last180Rates = sortedDailyRates.slice(-180);
  const last365Rates = sortedDailyRates.slice(-365);
  const last7Rates = sortedDailyRates.slice(-7);
  const last30Volumes = sortedVolumes.slice(-30);
  const last90Volumes = sortedVolumes.slice(-90);
  const last365Volumes = sortedVolumes.slice(-365);
  const last7Volumes = sortedVolumes.slice(-7);
  const latestRate = sortedDailyRates.at(-1)?.daily_funding_rate ?? 0;
  const latestMonth = sortedMonthlyRates.at(-1)?.monthly_funding_rate ?? 0;
  const previousMonth = sortedMonthlyRates.at(-2)?.monthly_funding_rate ?? 0;
  const previous3Months = sumValues(sortedMonthlyRates.slice(-4, -1).map((row) => row.monthly_funding_rate));
  const previous6Months = sumValues(sortedMonthlyRates.slice(-7, -1).map((row) => row.monthly_funding_rate));
  const previous12Months = sumValues(sortedMonthlyRates.slice(-13, -1).map((row) => row.monthly_funding_rate));
  const previous24Months = sumValues(sortedMonthlyRates.slice(-25, -1).map((row) => row.monthly_funding_rate));

  const avg30Rate = avgValues(last30Rates.map((row) => row.daily_funding_rate));
  const avg90Rate = avgValues(last90Rates.map((row) => row.daily_funding_rate));
  const avg180Rate = avgValues(last180Rates.map((row) => row.daily_funding_rate));
  const avg365Rate = avgValues(last365Rates.map((row) => row.daily_funding_rate));
  const weekRate = sumValues(last7Rates.map((row) => row.daily_funding_rate));
  const latestWeeklyRate = sortedWeeklyRates.at(-1)?.weekly_funding_rate ?? weekRate;
  const variance30 = stdDev(last30Rates.map((row) => row.daily_funding_rate));
  const variance365 = stdDev(last365Rates.map((row) => row.daily_funding_rate));
  const positiveDays30 = last30Rates.filter((row) => row.daily_funding_rate > 0).length;
  const positiveDays90 = last90Rates.filter((row) => row.daily_funding_rate > 0).length;
  const positiveDays180 = last180Rates.filter((row) => row.daily_funding_rate > 0).length;

  const volumeDay = sortedVolumes.at(-1)?.usd_volume ?? 0;
  const volumeWeek = avgValues(last7Volumes.map((row) => row.usd_volume));
  const volumeMonth = avgValues(last30Volumes.map((row) => row.usd_volume));
  const avg30Volume = avgValues(last30Volumes.map((row) => row.usd_volume));
  const avg90Volume = avgValues(last90Volumes.map((row) => row.usd_volume));
  const avg365Volume = avgValues(last365Volumes.map((row) => row.usd_volume));
  const latestMonthLabel = sortedMonthlyRates.at(-1)?.metric_month ?? "";
  const previousMonthLabel = sortedMonthlyRates.at(-2)?.metric_month ?? "";
  const volumeByMonth = new Map<string, number[]>();
  for (const row of sortedVolumes) {
    const label = monthLabel(row.metric_date);
    const bucket = volumeByMonth.get(label) ?? [];
    bucket.push(row.usd_volume);
    volumeByMonth.set(label, bucket);
  }
  const monthVolumeLabels = [...volumeByMonth.keys()].sort();
  const monthAvgDailyVolume = avgValues(volumeByMonth.get(latestMonthLabel) ?? []);
  const prevMonthAvgDailyVolume = avgValues(volumeByMonth.get(previousMonthLabel) ?? []);
  const prev3MonthsAvgDailyVolume = avgValues(monthVolumeLabels.slice(-4, -1).flatMap((label) => volumeByMonth.get(label) ?? []));
  const prev6MonthsAvgDailyVolume = avgValues(monthVolumeLabels.slice(-7, -1).flatMap((label) => volumeByMonth.get(label) ?? []));
  const prev12MonthsAvgDailyVolume = avgValues(monthVolumeLabels.slice(-13, -1).flatMap((label) => volumeByMonth.get(label) ?? []));

  const rateDailyTrend: Point[] = last30Rates.map((row) => ({ label: row.metric_date.slice(5), value: toPct(row.daily_funding_rate) }));
  const rateWeeklyTrend: Point[] = groupSum(
    sortedDailyRates.slice(-84).map((row) => ({ key: weekLabel(row.metric_date), value: toPct(row.daily_funding_rate) })),
  ).slice(-12);
  const rateMonthlyTrend: Point[] = sortedMonthlyRates.slice(-12).map((row) => ({ label: row.metric_month, value: toPct(row.monthly_funding_rate) }));
  const volumeDailyTrend: Point[] = last30Volumes.map((row) => ({ label: row.metric_date.slice(5), value: toMillion(row.usd_volume) }));
  const volumeWeeklyTrend: Point[] = groupAvg(
    sortedVolumes.slice(-84).map((row) => ({ key: weekLabel(row.metric_date), value: toMillion(row.usd_volume) })),
  ).slice(-12);
  const volumeMonthlyTrend: Point[] = groupAvg(
    sortedVolumes.slice(-365).map((row) => ({ key: monthLabel(row.metric_date), value: toMillion(row.usd_volume) })),
  ).slice(-12);

  return {
    symbol: symbol.replace("USD_PERP", ""),
    isActive: Boolean(symbolMeta?.is_active ?? 1),
    rateDayPct: toPct(latestRate),
    rateWeekFromDailyPct: toPct(weekRate),
    rateWeekFromWeeklyPct: toPct(latestWeeklyRate),
    rateWeekPct: toPct(weekRate),
    rateMonthPct: toPct(latestMonth),
    ratePrevMonthPct: toPct(previousMonth),
    ratePrev3MonthsPct: toPct(previous3Months),
    ratePrev6MonthsPct: toPct(previous6Months),
    ratePrev12MonthsPct: toPct(previous12Months),
    ratePrev24MonthsPct: toPct(previous24Months),
    volumeDayM: toMillion(volumeDay),
    volumeWeekM: toMillion(volumeWeek),
    volumeMonthM: toMillion(volumeMonth),
    avg30dVolumeM: toMillion(avg30Volume),
    avg90dVolumeM: toMillion(avg90Volume),
    avg365dVolumeM: toMillion(avg365Volume),
    monthAvgDailyVolumeM: toMillion(monthAvgDailyVolume),
    prevMonthAvgDailyVolumeM: toMillion(prevMonthAvgDailyVolume),
    prev3MonthsAvgDailyVolumeM: toMillion(prev3MonthsAvgDailyVolume),
    prev6MonthsAvgDailyVolumeM: toMillion(prev6MonthsAvgDailyVolume),
    prev12MonthsAvgDailyVolumeM: toMillion(prev12MonthsAvgDailyVolume),
    avg30dRatePct: toPct(avg30Rate),
    avg90dRatePct: toPct(avg90Rate),
    avg180dRatePct: toPct(avg180Rate),
    avg365dRatePct: toPct(avg365Rate),
    rateVolatility30Pct: toPct(variance30),
    rateVolatility365Pct: toPct(variance365),
    positiveDays30,
    positiveDays90,
    positiveDays180,
    rateDailyTrend,
    rateWeeklyTrend,
    rateMonthlyTrend,
    volumeDailyTrend,
    volumeWeeklyTrend,
    volumeMonthlyTrend,
  };
}

export function getWorkbenchData(): WorkbenchData {
  const databasePath = path.resolve(process.cwd(), "..", "data", "bian_rate.sqlite3");
  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(databasePath, { open: true, readOnly: true });
    const rowCount = db.prepare("SELECT COUNT(*) AS count FROM daily_funding_metrics").get() as { count: number };
    if (!rowCount.count) {
      return {
        symbols: [],
        monthlyRateMonths: [],
        monthlyRateRows: [],
        audits: [],
        sourceLabel: "SQLite 无数据",
        updatedAtLabel: "未采集",
        loadError: "daily_funding_metrics 为空，请先运行 collector。",
      };
    }

    const dailyFunding = db.prepare("SELECT symbol, metric_date, daily_funding_rate FROM daily_funding_metrics ORDER BY symbol, metric_date").all() as DailyFundingRow[];
    const weeklyFunding = db.prepare("SELECT symbol, metric_week, weekly_funding_rate FROM weekly_funding_metrics ORDER BY symbol, metric_week").all() as WeeklyFundingRow[];
    const monthlyFunding = db.prepare("SELECT symbol, metric_month, monthly_funding_rate FROM monthly_funding_metrics ORDER BY symbol, metric_month").all() as MonthlyFundingRow[];
    const dailyVolumes = db.prepare("SELECT symbol, metric_date, usd_volume FROM daily_volume_metrics ORDER BY symbol, metric_date").all() as VolumeRow[];
    const symbolMeta = db.prepare("SELECT symbol, is_active FROM symbols").all() as SymbolMetaRow[];
    const latestDate = db.prepare("SELECT MAX(metric_date) AS latest_date FROM daily_funding_metrics").get() as { latest_date: string | null };
    const latestFundingRun = db.prepare("SELECT MAX(run_id) AS run_id FROM funding_quality_audits").get() as { run_id: number | null };
    const latestVolumeRun = db.prepare("SELECT MAX(run_id) AS run_id FROM volume_quality_audits").get() as { run_id: number | null };
    const fundingAudits = latestFundingRun.run_id
      ? (db
          .prepare("SELECT symbol, status, completeness_score, gap_count, days_with_zero_events, notes FROM funding_quality_audits WHERE run_id = ?")
          .all(latestFundingRun.run_id) as FundingAuditRow[])
      : [];
    const volumeAudits = latestVolumeRun.run_id
      ? (db
          .prepare("SELECT symbol, status, completeness_score, day_count, gap_count, notes FROM volume_quality_audits WHERE run_id = ?")
          .all(latestVolumeRun.run_id) as VolumeAuditRow[])
      : [];

    const ratesBySymbol = new Map<string, DailyFundingRow[]>();
    const weeklyBySymbol = new Map<string, WeeklyFundingRow[]>();
    const monthlyBySymbol = new Map<string, MonthlyFundingRow[]>();
    const volumeBySymbol = new Map<string, VolumeRow[]>();
    const symbolMetaBySymbol = new Map(symbolMeta.map((row) => [row.symbol, row]));
    const fundingAuditBySymbol = new Map(fundingAudits.map((row) => [row.symbol, row]));
    const volumeAuditBySymbol = new Map(volumeAudits.map((row) => [row.symbol, row]));

    for (const row of dailyFunding) {
      const bucket = ratesBySymbol.get(row.symbol) ?? [];
      bucket.push(row);
      ratesBySymbol.set(row.symbol, bucket);
    }
    for (const row of weeklyFunding) {
      const bucket = weeklyBySymbol.get(row.symbol) ?? [];
      bucket.push(row);
      weeklyBySymbol.set(row.symbol, bucket);
    }
    for (const row of monthlyFunding) {
      const bucket = monthlyBySymbol.get(row.symbol) ?? [];
      bucket.push(row);
      monthlyBySymbol.set(row.symbol, bucket);
    }
    for (const row of dailyVolumes) {
      const bucket = volumeBySymbol.get(row.symbol) ?? [];
      bucket.push(row);
      volumeBySymbol.set(row.symbol, bucket);
    }

    const symbols = [...ratesBySymbol.keys()]
      .map((symbol) =>
        buildSymbol(
          symbol,
          symbolMetaBySymbol.get(symbol),
          ratesBySymbol.get(symbol) ?? [],
          weeklyBySymbol.get(symbol) ?? [],
          monthlyBySymbol.get(symbol) ?? [],
          volumeBySymbol.get(symbol) ?? [],
        ),
      )
      .sort((a, b) => b.volumeMonthM - a.volumeMonthM);
    const monthlyRateMonths = [...new Set(monthlyFunding.map((row) => row.metric_month))].sort();
    const monthlyRateRows = [...monthlyBySymbol.keys()]
      .map((symbol) => buildMonthlyRateRow(symbol, monthlyBySymbol.get(symbol) ?? [], monthlyRateMonths))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    const audits: AuditRow[] = [...symbolMetaBySymbol.keys()]
      .sort()
      .map((symbol) => {
        const fundingAudit = fundingAuditBySymbol.get(symbol);
        const volumeAudit = volumeAuditBySymbol.get(symbol);
        return {
          symbol: symbol.replace("USD_PERP", ""),
          isActive: Boolean(symbolMetaBySymbol.get(symbol)?.is_active ?? 1),
          fundingStatus: fundingAudit?.status ?? "not_run",
          fundingScore: fundingAudit?.completeness_score ?? 0,
          fundingGapCount: fundingAudit?.gap_count ?? 0,
          fundingZeroEventDays: fundingAudit?.days_with_zero_events ?? 0,
          fundingNotes: fundingAudit?.notes ?? (latestFundingRun.run_id ? "" : "funding 审计尚未运行"),
          volumeStatus: volumeAudit?.status ?? "not_run",
          volumeScore: volumeAudit?.completeness_score ?? 0,
          volumeDayCount: volumeAudit?.day_count ?? 0,
          volumeGapCount: volumeAudit?.gap_count ?? 0,
          volumeNotes: volumeAudit?.notes ?? (latestVolumeRun.run_id ? "" : "volume 审计尚未运行"),
        };
      });

    if (!symbols.length) {
      return {
        symbols: [],
        monthlyRateMonths,
        monthlyRateRows,
        audits,
        sourceLabel: "SQLite 无可用数据",
        updatedAtLabel: latestDate.latest_date ?? "未知",
        loadError: "SQLite 中没有可供页面展示的聚合结果。",
      };
    }

    return {
      symbols,
      monthlyRateMonths,
      monthlyRateRows,
      audits,
      sourceLabel: "SQLite 实盘历史数据",
      updatedAtLabel: latestDate.latest_date ?? "未知",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      symbols: [],
      monthlyRateMonths: [],
      monthlyRateRows: [],
      audits: [],
      sourceLabel: "SQLite 读取失败",
      updatedAtLabel: "-",
      loadError: message,
    };
  } finally {
    db?.close();
  }
}
