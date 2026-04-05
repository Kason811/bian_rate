import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type AuditRow, type BtcWeeklyResearchData, type BtcWeeklyResearchPoint, type MarketSymbol, type MonthlyRateRow, type Point, type ResearchLagStat, type ResearchRegime, type ResearchRegimeStat, type WorkbenchData } from "@/lib/workbench-data";

type DailyFundingRow = { symbol: string; metric_date: string; daily_funding_rate: number };
type WeeklyFundingRow = { symbol: string; metric_week: string; weekly_funding_rate: number };
type MonthlyFundingRow = { symbol: string; metric_month: string; monthly_funding_rate: number };
type VolumeRow = { symbol: string; metric_date: string; usd_volume: number };
type SymbolMetaRow = { symbol: string; is_active: number };
type FundingAuditRow = { symbol: string; status: string; completeness_score: number; gap_count: number; days_with_zero_events: number; notes: string };
type VolumeAuditRow = { symbol: string; status: string; completeness_score: number; day_count: number; gap_count: number; notes: string };

let cachedWorkbenchData: WorkbenchData | null = null;
let cachedDbMtimeMs: number | null = null;
let cachedBtcWeeklyResearchData: BtcWeeklyResearchData | null = null;
let cachedBtcWeeklyResearchDbMtimeMs: number | null = null;

const BTC_WEEKLY_REGIMES: ResearchRegime[] = [
  { start: "2023-10-16", end: "2024-03-11", label: "牛市", tone: "#dcfce7" },
  { start: "2024-03-11", end: "2024-09-09", label: "震荡熊", tone: "#fee2e2" },
  { start: "2024-09-09", end: "2024-12-16", label: "牛市", tone: "#dcfce7" },
  { start: "2024-12-16", end: "2025-04-07", label: "小熊", tone: "#fecaca" },
  { start: "2025-04-07", end: "2025-07-07", label: "牛市", tone: "#bbf7d0" },
  { start: "2025-07-07", end: "2025-10-06", label: "震荡", tone: "#e2e8f0" },
  { start: "2025-10-06", end: "2025-11-17", label: "大熊", tone: "#fca5a5" },
  { start: "2025-11-17", end: "2026-01-19", label: "震荡", tone: "#e2e8f0" },
  { start: "2026-01-19", end: "2026-02-09", label: "小熊", tone: "#fecaca" },
  { start: "2026-02-09", end: "2026-03-30", label: "震荡", tone: "#e2e8f0" },
];

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

function parseWeekRange(metricWeek: string) {
  const [start, end] = metricWeek.split("/");
  return { start, end };
}

function weekRangeLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `${monday.toISOString().slice(0, 10)}/${sunday.toISOString().slice(0, 10)}`;
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

function correlation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftAvg = avgValues(left);
  const rightAvg = avgValues(right);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDiff = left[index] - leftAvg;
    const rightDiff = right[index] - rightAvg;
    numerator += leftDiff * rightDiff;
    leftDenominator += leftDiff ** 2;
    rightDenominator += rightDiff ** 2;
  }
  if (!leftDenominator || !rightDenominator) return 0;
  return numerator / Math.sqrt(leftDenominator * rightDenominator);
}

function findResearchRegime(weekStart: string) {
  return BTC_WEEKLY_REGIMES.find((regime) => weekStart >= regime.start && weekStart < regime.end);
}

function lagCorrelation(points: BtcWeeklyResearchPoint[], metricKey: "fundingRatePct" | "avgVolumeM"): ResearchLagStat {
  const options: ResearchLagStat[] = [];
  for (let lag = 0; lag <= 4; lag += 1) {
    const metricValues: number[] = [];
    const futureReturns: number[] = [];
    for (let index = 0; index + lag < points.length; index += 1) {
      metricValues.push(points[index][metricKey]);
      futureReturns.push(points[index + lag].weeklyReturnPct);
    }
    options.push({
      metric: metricKey === "fundingRatePct" ? "费率领先价格" : "成交量领先价格",
      bestLagWeeks: lag,
      correlation: Number(correlation(metricValues, futureReturns).toFixed(3)),
    });
  }
  return options.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))[0];
}

function loadBtcWeeklyCloses() {
  const klinePath = path.resolve(process.cwd(), "lib", "btc-weekly-klines.json");
  const rows = JSON.parse(fs.readFileSync(klinePath, "utf8")) as Array<[number, string, string, string, string]>;
  return rows.map((row) => {
    const weekStart = new Date(row[0]).toISOString().slice(0, 10);
    const weekEndDate = new Date(row[0]);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    return {
      weekStart,
      weekEnd: weekEndDate.toISOString().slice(0, 10),
      closePrice: Number(row[4]),
    };
  });
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
  // Week/month views are based on recent daily averages, not summed turnover.
  const avgVolumeWeek = avgValues(last7Volumes.map((row) => row.usd_volume));
  const avgVolumeMonth = avgValues(last30Volumes.map((row) => row.usd_volume));
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
    volumeWeekM: toMillion(avgVolumeWeek),
    volumeMonthM: toMillion(avgVolumeMonth),
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
  const databaseMtimeMs = fs.statSync(databasePath).mtimeMs;
  if (cachedWorkbenchData && cachedDbMtimeMs === databaseMtimeMs) {
    return cachedWorkbenchData;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(databasePath, { open: true, readOnly: true });
    const rowCount = db.prepare("SELECT COUNT(*) AS count FROM daily_funding_metrics").get() as { count: number };
    if (!rowCount.count) {
      const emptyData = {
        symbols: [],
        monthlyRateMonths: [],
        monthlyRateRows: [],
        audits: [],
        sourceLabel: "SQLite 无数据",
        updatedAtLabel: "未采集",
        loadError: "daily_funding_metrics 为空，请先运行 collector。",
      };
      cachedWorkbenchData = emptyData;
      cachedDbMtimeMs = databaseMtimeMs;
      return emptyData;
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
      const emptyView = {
        symbols: [],
        monthlyRateMonths,
        monthlyRateRows,
        audits,
        sourceLabel: "SQLite 无可用数据",
        updatedAtLabel: latestDate.latest_date ?? "未知",
        loadError: "SQLite 中没有可供页面展示的聚合结果。",
      };
      cachedWorkbenchData = emptyView;
      cachedDbMtimeMs = databaseMtimeMs;
      return emptyView;
    }

    const result = {
      symbols,
      monthlyRateMonths,
      monthlyRateRows,
      audits,
      sourceLabel: "SQLite 实盘历史数据",
      updatedAtLabel: latestDate.latest_date ?? "未知",
    };
    cachedWorkbenchData = result;
    cachedDbMtimeMs = databaseMtimeMs;
    return result;
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

export async function getBtcWeeklyResearchData(): Promise<BtcWeeklyResearchData> {
  const databasePath = path.resolve(process.cwd(), "..", "data", "bian_rate.sqlite3");
  const databaseMtimeMs = fs.statSync(databasePath).mtimeMs;
  if (cachedBtcWeeklyResearchData && cachedBtcWeeklyResearchDbMtimeMs === databaseMtimeMs) {
    return cachedBtcWeeklyResearchData;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(databasePath, { open: true, readOnly: true });
    const weeklyFunding = db
      .prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week")
      .all("BTCUSD_PERP") as Array<{ metric_week: string; weekly_funding_rate: number }>;
    const dailyVolumes = db
      .prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date")
      .all("BTCUSD_PERP") as Array<{ metric_date: string; usd_volume: number }>;

    if (!weeklyFunding.length || !dailyVolumes.length) {
      return {
        symbol: "BTC",
        timeframe: "week",
        points: [],
        regimes: BTC_WEEKLY_REGIMES,
        lagStats: [],
        regimeStats: [],
        sourceLabel: "SQLite 无 BTC 周线研究数据",
        loadError: "BTC 周费率或成交量数据缺失。",
      };
    }

    const volumeByWeek = new Map<string, number[]>();
    for (const row of dailyVolumes) {
      const bucket = volumeByWeek.get(weekRangeLabel(row.metric_date)) ?? [];
      bucket.push(row.usd_volume);
      volumeByWeek.set(weekRangeLabel(row.metric_date), bucket);
    }

    const prices = loadBtcWeeklyCloses();
    const priceByWeekStart = new Map(prices.map((row) => [row.weekStart, row.closePrice]));

    const points: BtcWeeklyResearchPoint[] = weeklyFunding
      .map((row) => {
        const { start, end } = parseWeekRange(row.metric_week);
        if (start < "2023-10-16" || start >= "2026-03-30") return null;
        const price = priceByWeekStart.get(start);
        if (price == null) return null;
        const regime = findResearchRegime(start);
        const volumes = volumeByWeek.get(row.metric_week) ?? [];
        return {
          weekStart: start,
          weekEnd: end,
          weekLabel: start.slice(5),
          fundingRatePct: toPct(row.weekly_funding_rate),
          avgVolumeM: toMillion(avgValues(volumes)),
          closePrice: Number(price.toFixed(2)),
          weeklyReturnPct: 0,
          regimeLabel: regime?.label ?? "未定义",
          regimeTone: regime?.tone ?? "#e2e8f0",
        };
      })
      .filter((row): row is BtcWeeklyResearchPoint => row !== null);

    for (let index = 0; index < points.length; index += 1) {
      const previous = points[index - 1];
      points[index].weeklyReturnPct = previous ? Number((((points[index].closePrice / previous.closePrice) - 1) * 100).toFixed(3)) : 0;
    }

    const lagStats = [
      lagCorrelation(points, "fundingRatePct"),
      lagCorrelation(points, "avgVolumeM"),
    ];

    const regimeStats: ResearchRegimeStat[] = BTC_WEEKLY_REGIMES.map((regime) => {
      const regimePoints = points.filter((point) => point.weekStart >= regime.start && point.weekStart < regime.end);
      const firstClose = regimePoints[0]?.closePrice ?? 0;
      const lastClose = regimePoints.at(-1)?.closePrice ?? 0;
      const pathReturns = firstClose
        ? regimePoints.map((point) => ((point.closePrice / firstClose) - 1) * 100)
        : [];
      return {
        label: regime.label,
        start: regime.start,
        end: regime.end,
        weeks: regimePoints.length,
        avgFundingRatePct: Number(avgValues(regimePoints.map((point) => point.fundingRatePct)).toFixed(3)),
        avgVolumeM: Number(avgValues(regimePoints.map((point) => point.avgVolumeM)).toFixed(1)),
        cumulativeReturnPct: firstClose && lastClose ? Number((((lastClose / firstClose) - 1) * 100).toFixed(2)) : 0,
        maxAdvancePct: pathReturns.length ? Number(Math.max(...pathReturns).toFixed(2)) : 0,
        maxDrawdownPct: pathReturns.length ? Number(Math.min(...pathReturns).toFixed(2)) : 0,
        positiveFundingWeeks: regimePoints.filter((point) => point.fundingRatePct > 0).length,
        positiveReturnWeeks: regimePoints.filter((point) => point.weeklyReturnPct > 0).length,
      };
    });

    const result = {
      symbol: "BTC",
      timeframe: "week" as const,
      points,
      regimes: BTC_WEEKLY_REGIMES,
      lagStats,
      regimeStats,
      sourceLabel: "SQLite 周费率/周成交量 + Binance BTCUSDT 周收盘价",
    };
    cachedBtcWeeklyResearchData = result;
    cachedBtcWeeklyResearchDbMtimeMs = databaseMtimeMs;
    return result;
  } catch (error) {
    return {
      symbol: "BTC",
      timeframe: "week",
      points: [],
      regimes: BTC_WEEKLY_REGIMES,
      lagStats: [],
      regimeStats: [],
      sourceLabel: "BTC 周线研究数据读取失败",
      loadError: error instanceof Error ? error.message : "unknown error",
    };
  } finally {
    db?.close();
  }
}
