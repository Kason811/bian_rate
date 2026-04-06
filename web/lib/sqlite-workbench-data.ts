import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AuditRow,
  type BtcWeeklyResearchData,
  type BtcWeeklyResearch2Data,
  type BtcWeeklyResearch2Point,
  type BtcWeeklyResearch2Segment,
  type BtcWeeklyResearch2Summary,
  type BtcWeeklyResearchPoint,
  type ManualResearchRegimeRow,
  type MarketSymbol,
  type MonthlyRateRow,
  type Point,
  type ResearchAutoRegimePoint,
  type ResearchAutoRegimeSegment,
  type ResearchLagStat,
  type ResearchRegime,
  type ResearchRegimeStat,
  type WorkbenchData,
} from "@/lib/workbench-data";

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
let cachedBtcWeeklyResearchCacheKey: string | null = null;
let cachedBtcWeeklyResearch2Data: BtcWeeklyResearch2Data | null = null;
let cachedBtcWeeklyResearch2CacheKey: string | null = null;

type ManualResearchRegimeFileRow = {
  symbol: string;
  start: string;
  end: string;
  label: string;
};

const DEFAULT_MANUAL_REGIMES: ManualResearchRegimeFileRow[] = [
  { symbol: "BTC", start: "2023-10-16", end: "2024-03-11", label: "牛" },
  { symbol: "BTC", start: "2024-03-11", end: "2024-09-09", label: "震荡熊" },
  { symbol: "BTC", start: "2024-09-09", end: "2024-12-16", label: "牛" },
  { symbol: "BTC", start: "2024-12-16", end: "2025-04-07", label: "小熊" },
  { symbol: "BTC", start: "2025-04-07", end: "2025-07-07", label: "牛" },
  { symbol: "BTC", start: "2025-07-07", end: "2025-10-06", label: "震荡" },
  { symbol: "BTC", start: "2025-10-06", end: "2025-11-17", label: "熊" },
  { symbol: "BTC", start: "2025-11-17", end: "2026-01-19", label: "震荡" },
  { symbol: "BTC", start: "2026-01-19", end: "2026-02-09", label: "小熊" },
  { symbol: "BTC", start: "2026-02-09", end: "2026-03-30", label: "震荡" },
];

function toPct(value: number) {
  return Number((value * 100).toFixed(3));
}

function toMillion(value: number) {
  return Number((value / 1_000_000).toFixed(1));
}

function classifyManualRegimeLabel(label: string): -1 | 0 | 1 {
  if (label === "牛" || label === "小牛" || label === "震荡牛") return 1;
  if (label === "震荡熊" || label === "小熊" || label === "熊") return -1;
  return 0;
}

function manualRegimeTone(label: string) {
  if (label === "牛") return "#166534";
  if (label === "小牛") return "#22c55e";
  if (label === "震荡牛") return "#bbf7d0";
  if (label === "震荡") return "#e2e8f0";
  if (label === "震荡熊") return "#fecdd3";
  if (label === "小熊") return "#fca5a5";
  return "#b91c1c";
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

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
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

function findResearchRegime(weekStart: string, regimes: ResearchRegime[]) {
  return regimes.find((regime) => weekStart >= regime.start && weekStart < regime.end);
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lineFit(values: number[], start: number, endExclusive: number) {
  const length = endExclusive - start;
  if (length <= 1) {
    return {
      slope: 0,
      intercept: values[start] ?? 0,
      sse: 0,
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let index = start; index < endExclusive; index += 1) {
    const x = index - start;
    const y = values[index];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = length * sumXX - sumX * sumX;
  const slope = denominator ? (length * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / length;
  let sse = 0;
  for (let index = start; index < endExclusive; index += 1) {
    const fitted = intercept + slope * (index - start);
    sse += (values[index] - fitted) ** 2;
  }

  return { slope, intercept, sse };
}

function splitPriceRegimes(values: number[], minSegmentLength = 5, minImprovementRatio = 0.38) {
  const splitPoints = new Set<number>();

  function visit(start: number, endExclusive: number) {
    if (endExclusive - start < minSegmentLength * 2) return;
    const parentFit = lineFit(values, start, endExclusive);
    if (parentFit.sse <= 0) return;

    let bestSplit = -1;
    let bestChildSse = Number.POSITIVE_INFINITY;

    for (let split = start + minSegmentLength; split <= endExclusive - minSegmentLength; split += 1) {
      const leftFit = lineFit(values, start, split);
      const rightFit = lineFit(values, split, endExclusive);
      const combinedSse = leftFit.sse + rightFit.sse;
      if (combinedSse < bestChildSse) {
        bestChildSse = combinedSse;
        bestSplit = split;
      }
    }

    if (bestSplit < 0) return;
    const improvementRatio = (parentFit.sse - bestChildSse) / parentFit.sse;
    if (improvementRatio < minImprovementRatio) return;

    splitPoints.add(bestSplit);
    visit(start, bestSplit);
    visit(bestSplit, endExclusive);
  }

  visit(0, values.length);
  return [...splitPoints].sort((left, right) => left - right);
}

function heatColor(score: number) {
  if (score >= 0.7) return "#166534";
  if (score >= 0.35) return "#16a34a";
  if (score >= 0.12) return "#86efac";
  if (score > -0.12) return "#cbd5e1";
  if (score > -0.35) return "#fca5a5";
  if (score > -0.7) return "#ef4444";
  return "#991b1b";
}

function manualRegimeClass(label: string) {
  return classifyManualRegimeLabel(label);
}

function autoRegimeClass(score: number, threshold: number): -1 | 0 | 1 {
  if (score >= threshold) return 1;
  if (score <= -threshold) return -1;
  return 0;
}

type AutoRegimeTuning = {
  minSegmentLength: number;
  minImprovementRatio: number;
  trendScale: number;
  drawdownScale: number;
  volatilityScale: number;
  neutralityThreshold: number;
};

type AutoRegimeOverride = {
  start: string;
  end: string;
  stateLabel: string;
  heatScore?: number;
  heatColor?: string;
  note?: string;
};

function normalizeStateLabel(stateLabel: string) {
  if (stateLabel.includes("上") || stateLabel.includes("牛")) return "上行";
  if (stateLabel.includes("下") || stateLabel.includes("熊")) return "下行";
  return "震荡";
}

function stateClassFromLabel(stateLabel: string): -1 | 0 | 1 {
  if (stateLabel === "上行") return 1;
  if (stateLabel === "下行") return -1;
  return 0;
}

function stateLabelFromClass(stateClass: -1 | 0 | 1) {
  if (stateClass > 0) return "上行";
  if (stateClass < 0) return "下行";
  return "震荡";
}

function defaultHeatScoreForState(stateClass: -1 | 0 | 1) {
  if (stateClass > 0) return 0.48;
  if (stateClass < 0) return -0.48;
  return 0;
}

function evaluateBoundaryMatch(manualBoundaries: number[], autoBoundaries: number[], toleranceWeeks = 6) {
  if (!manualBoundaries.length || !autoBoundaries.length) return 0;
  const scores = manualBoundaries.map((manualBoundary) => {
    const distance = Math.min(...autoBoundaries.map((autoBoundary) => Math.abs(autoBoundary - manualBoundary)));
    return clamp(1 - distance / toleranceWeeks, 0, 1);
  });
  return avgValues(scores);
}

function loadAutoRegimeOverrides() {
  const overridesPath = path.resolve(process.cwd(), "lib", "btc-weekly-auto-regime-overrides.json");
  if (!fs.existsSync(overridesPath)) {
    return { overridesPath, overrides: [] as AutoRegimeOverride[], mtimeMs: 0 };
  }

  const raw = JSON.parse(fs.readFileSync(overridesPath, "utf8")) as unknown;
  const rows = Array.isArray(raw) ? raw : [];
  const overrides = rows
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.start !== "string" || typeof row.end !== "string" || typeof row.stateLabel !== "string") {
        return null;
      }
      const override: AutoRegimeOverride = {
        start: row.start,
        end: row.end,
        stateLabel: normalizeStateLabel(row.stateLabel),
        heatScore: typeof row.heatScore === "number" ? row.heatScore : undefined,
        heatColor: typeof row.heatColor === "string" ? row.heatColor : undefined,
        note: typeof row.note === "string" ? row.note : undefined,
      };
      return override;
    })
    .filter((item): item is AutoRegimeOverride => item !== null);

  return { overridesPath, overrides, mtimeMs: fs.statSync(overridesPath).mtimeMs };
}

function loadManualResearchRegimes() {
  const regimesPath = path.resolve(process.cwd(), "lib", "research-manual-regimes.json");
  const rows = fs.existsSync(regimesPath)
    ? (JSON.parse(fs.readFileSync(regimesPath, "utf8")) as unknown)
    : DEFAULT_MANUAL_REGIMES;
  const parsedRows = (Array.isArray(rows) ? rows : DEFAULT_MANUAL_REGIMES)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.symbol !== "string" || typeof row.start !== "string" || typeof row.end !== "string" || typeof row.label !== "string") {
        return null;
      }
      return {
        symbol: row.symbol.trim().toUpperCase(),
        start: row.start,
        end: row.end,
        label: row.label.trim(),
      } satisfies ManualResearchRegimeFileRow;
    })
    .filter((item): item is ManualResearchRegimeFileRow => item !== null)
    .sort((left, right) => (left.symbol === right.symbol ? left.start.localeCompare(right.start) : left.symbol.localeCompare(right.symbol)));
  const safeRows: ManualResearchRegimeFileRow[] = [];
  const lastEndBySymbol = new Map<string, string>();
  for (const row of parsedRows) {
    if (!row.symbol || row.start >= row.end) continue;
    const lastEnd = lastEndBySymbol.get(row.symbol);
    if (lastEnd && row.start < lastEnd) continue;
    safeRows.push(row);
    lastEndBySymbol.set(row.symbol, row.end);
  }
  const mtimeMs = fs.existsSync(regimesPath) ? fs.statSync(regimesPath).mtimeMs : 0;
  return { regimesPath, rows: safeRows, mtimeMs };
}

function buildResearchRegimes(rows: ManualResearchRegimeFileRow[], symbol: string): ResearchRegime[] {
  const source = rows.filter((row) => row.symbol === symbol);
  const fallback = DEFAULT_MANUAL_REGIMES.filter((row) => row.symbol === symbol);
  const picked = source.length ? source : fallback;
  return picked.map((row) => ({
    start: row.start,
    end: row.end,
    label: row.label,
    tone: manualRegimeTone(row.label),
    stateClass: classifyManualRegimeLabel(row.label),
  }));
}

function buildManualResearchRegimeRows(rows: ManualResearchRegimeFileRow[]): ManualResearchRegimeRow[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    start: row.start,
    end: row.end,
    label: row.label,
    tone: manualRegimeTone(row.label),
    stateClass: classifyManualRegimeLabel(row.label),
  }));
}

function classifySegmentHeat(
  cumulativeReturnPct: number,
  maxAdvancePct: number,
  maxDrawdownPct: number,
  volatilityPct: number,
  positiveReturnWeeks: number,
  weeks: number,
  tuning: AutoRegimeTuning,
) {
  const weeklyPathTravel = Math.max(weeks * Math.max(volatilityPct, 0.1), 1);
  const directionalEfficiency = Math.abs(cumulativeReturnPct) / weeklyPathTravel;
  const pathRangePct = Math.max(maxAdvancePct - maxDrawdownPct, Math.abs(cumulativeReturnPct));
  const consistencyScore = ((positiveReturnWeeks / Math.max(weeks, 1)) - 0.5) * 0.95;
  const trendScore = clamp(cumulativeReturnPct / Math.max(weeks * tuning.trendScale, 9), -1.5, 1.5);
  const efficiencyScore = clamp((directionalEfficiency - 0.35) / 0.45, -1, 1);
  const drawdownPenalty = clamp(Math.abs(Math.min(maxDrawdownPct, 0)) / tuning.drawdownScale, 0, 1.5);
  const volatilityPenalty = clamp(volatilityPct / tuning.volatilityScale, 0, 1.2);

  let heatScore = clamp((trendScore * 0.7 + efficiencyScore * 0.45 + consistencyScore - drawdownPenalty * 0.72 - volatilityPenalty * 0.28) / 1.28, -1, 1);

  const longCycleTightRange = weeks >= 8 && pathRangePct <= 10;
  const longCycleLowDrift = weeks >= 8 && Math.abs(cumulativeReturnPct) <= 10 && directionalEfficiency <= 0.55;
  const longCycleMeanRevert = weeks >= 12 && Math.abs(cumulativeReturnPct) <= 12 && pathRangePct <= 18 && directionalEfficiency <= 0.42;

  if (longCycleTightRange || longCycleLowDrift || longCycleMeanRevert) {
    heatScore = clamp(heatScore * 0.18, -0.1, 0.1);
  }

  const stateClass = autoRegimeClass(heatScore, tuning.neutralityThreshold);
  return {
    heatScore: Number(heatScore.toFixed(3)),
    stateClass,
    stateLabel: stateLabelFromClass(stateClass),
    heatColor: heatColor(heatScore),
  };
}

function summarizeAutoSegment(points: ResearchAutoRegimePoint[], index: number): ResearchAutoRegimeSegment | null {
  if (!points.length) return null;
  const firstClose = points[0].closePrice;
  const lastClose = points.at(-1)?.closePrice ?? firstClose;
  const pathReturns = firstClose
    ? points.map((point) => ((point.closePrice / firstClose) - 1) * 100)
    : [];
  const weeklyReturns = points.length >= 2
    ? points.slice(1).map((point, pointIndex) => ((point.closePrice / points[pointIndex].closePrice) - 1) * 100)
    : [];
  const positiveReturnWeeks = weeklyReturns.filter((value) => value > 0).length;
  const weightedHeatScore = Number((avgValues(points.map((point) => point.heatScore))).toFixed(3));
  const stateClass = points[0].stateClass;
  const stateLabel = points[0].stateLabel;
  const source = points[0].source;
  const note = points.find((point) => point.note)?.note;

  return {
    index,
    start: points[0].weekStart,
    end: points.at(-1)?.weekEnd ?? points[0].weekEnd,
    weeks: points.length,
    cumulativeReturnPct: firstClose && lastClose ? Number((((lastClose / firstClose) - 1) * 100).toFixed(2)) : 0,
    maxAdvancePct: pathReturns.length ? Number(Math.max(...pathReturns).toFixed(2)) : 0,
    maxDrawdownPct: pathReturns.length ? Number(Math.min(...pathReturns).toFixed(2)) : 0,
    volatilityPct: Number(stdDev(weeklyReturns).toFixed(3)),
    positiveReturnWeeks,
    heatScore: weightedHeatScore,
    heatColor: heatColor(weightedHeatScore),
    stateClass,
    stateLabel,
    source,
    ...(note ? { note } : {}),
  };
}

function rebuildSegmentsFromPoints(points: ResearchAutoRegimePoint[]) {
  const rebuiltPoints: ResearchAutoRegimePoint[] = [];
  const rebuiltSegments: ResearchAutoRegimeSegment[] = [];
  let bucket: ResearchAutoRegimePoint[] = [];
  let currentIndex = 0;

  const flush = () => {
    if (!bucket.length) return;
    const summary = summarizeAutoSegment(bucket, currentIndex);
    if (!summary) return;
    rebuiltSegments.push(summary);
    for (const point of bucket) {
      rebuiltPoints.push({
        ...point,
        segmentIndex: currentIndex,
        heatScore: summary.heatScore,
        heatColor: summary.heatColor,
        stateClass: summary.stateClass,
        stateLabel: summary.stateLabel,
        source: summary.source,
        note: summary.note,
      });
    }
    currentIndex += 1;
    bucket = [];
  };

  for (const point of points) {
    const lastPoint = bucket.at(-1);
    if (
      lastPoint &&
      (lastPoint.stateClass !== point.stateClass ||
        lastPoint.stateLabel !== point.stateLabel ||
        lastPoint.source !== point.source ||
        (lastPoint.note ?? "") !== (point.note ?? ""))
    ) {
      flush();
    }
    bucket.push(point);
  }
  flush();

  return {
    points: rebuiltPoints,
    segments: rebuiltSegments,
  };
}

function applyAutoRegimeOverrides(
  points: ResearchAutoRegimePoint[],
  overrides: AutoRegimeOverride[],
) {
  if (!overrides.length) {
    return {
      points,
      segments: rebuildSegmentsFromPoints(points).segments,
      overrideCount: 0,
    };
  }

  let overrideCount = 0;
  const adjustedPoints = points.map((point) => {
    const override = overrides.find((item) => point.weekStart >= item.start && point.weekStart < item.end);
    if (!override) return point;
    overrideCount += 1;
    const stateClass = stateClassFromLabel(override.stateLabel);
    const heatScore = Number((override.heatScore ?? defaultHeatScoreForState(stateClass)).toFixed(3));
    return {
      ...point,
      heatScore,
      heatColor: override.heatColor ?? heatColor(heatScore),
      stateClass,
      stateLabel: override.stateLabel,
      source: "manual" as const,
      ...(override.note ? { note: override.note } : {}),
    };
  });

  const rebuilt = rebuildSegmentsFromPoints(adjustedPoints);
  return {
    points: rebuilt.points,
    segments: rebuilt.segments,
    overrideCount,
  };
}

function mergeAutoRegimeSegments(
  segments: ResearchAutoRegimeSegment[],
  points: ResearchAutoRegimePoint[],
) {
  if (!segments.length) {
    return {
      segments: [],
      points: [],
    };
  }

  const pointsBySegment = new Map<number, ResearchAutoRegimePoint[]>();
  for (const point of points) {
    const bucket = pointsBySegment.get(point.segmentIndex) ?? [];
    bucket.push(point);
    pointsBySegment.set(point.segmentIndex, bucket);
  }

  const mergedSegments: ResearchAutoRegimeSegment[] = [];
  const mergedPoints: ResearchAutoRegimePoint[] = [];

  for (const segment of segments) {
    const lastMerged = mergedSegments.at(-1);
    const segmentClass = segment.stateClass;
    const lastClass = lastMerged ? lastMerged.stateClass : null;

    if (lastMerged && lastClass === segmentClass) {
      const currentPoints = pointsBySegment.get(segment.index) ?? [];
      const lastPoints = mergedPoints.filter((point) => point.segmentIndex === lastMerged.index);
      const combinedPoints = [...lastPoints, ...currentPoints];
      const summary = summarizeAutoSegment(combinedPoints, lastMerged.index);
      if (!summary) continue;
      mergedSegments[mergedSegments.length - 1] = summary;
      for (let pointIndex = 0; pointIndex < mergedPoints.length; pointIndex += 1) {
        if (mergedPoints[pointIndex].segmentIndex === lastMerged.index) {
          mergedPoints[pointIndex] = {
            ...mergedPoints[pointIndex],
            heatScore: summary.heatScore,
            heatColor: summary.heatColor,
            stateClass: summary.stateClass,
            stateLabel: summary.stateLabel,
            source: summary.source,
            note: summary.note,
          };
        }
      }

      for (const point of currentPoints) {
        mergedPoints.push({
          ...point,
          segmentIndex: summary.index,
          heatScore: summary.heatScore,
          heatColor: summary.heatColor,
          stateClass: summary.stateClass,
          stateLabel: summary.stateLabel,
          source: summary.source,
          note: summary.note,
        });
      }
      continue;
    }

    const newIndex = mergedSegments.length;
    mergedSegments.push({ ...segment, index: newIndex });
    const currentPoints = pointsBySegment.get(segment.index) ?? [];
    for (const point of currentPoints) {
      mergedPoints.push({
        ...point,
        segmentIndex: newIndex,
      });
    }
  }

  return {
    segments: mergedSegments,
    points: mergedPoints,
  };
}

function manualBoundaryIndexes(points: BtcWeeklyResearchPoint[]) {
  const boundaries: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].regimeLabel !== points[index - 1].regimeLabel) {
      boundaries.push(index);
    }
  }
  return boundaries;
}

function buildAutoRegimesWithTuning(points: BtcWeeklyResearchPoint[], tuning: AutoRegimeTuning) {
  const logPrices = points.map((point) => Math.log(point.closePrice));
  const splitPoints = splitPriceRegimes(logPrices, tuning.minSegmentLength, tuning.minImprovementRatio);
  const boundaries = [0, ...splitPoints, points.length];
  const autoRegimeSegments: ResearchAutoRegimeSegment[] = [];
  const autoRegimePoints: ResearchAutoRegimePoint[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startIndex = boundaries[index];
    const endExclusive = boundaries[index + 1];
    const segmentPoints = points.slice(startIndex, endExclusive);
    if (!segmentPoints.length) continue;

    const firstClose = segmentPoints[0].closePrice;
    const lastClose = segmentPoints.at(-1)?.closePrice ?? firstClose;
    const pathReturns = firstClose
      ? segmentPoints.map((point) => ((point.closePrice / firstClose) - 1) * 100)
      : [];
    const weeklyReturns = segmentPoints.slice(1).map((point) => point.weeklyReturnPct);
    const cumulativeReturnPct = firstClose && lastClose ? ((lastClose / firstClose) - 1) * 100 : 0;
    const maxAdvancePct = pathReturns.length ? Math.max(...pathReturns) : 0;
    const maxDrawdownPct = pathReturns.length ? Math.min(...pathReturns) : 0;
    const volatilityPct = stdDev(weeklyReturns);
    const positiveReturnWeeks = segmentPoints.filter((point) => point.weeklyReturnPct > 0).length;
    const heatMeta = classifySegmentHeat(
      cumulativeReturnPct,
      maxAdvancePct,
      maxDrawdownPct,
      volatilityPct,
      positiveReturnWeeks,
      segmentPoints.length,
      tuning,
    );

    autoRegimeSegments.push({
      index,
      start: segmentPoints[0].weekStart,
      end: segmentPoints.at(-1)?.weekEnd ?? segmentPoints[0].weekEnd,
      weeks: segmentPoints.length,
      cumulativeReturnPct: Number(cumulativeReturnPct.toFixed(2)),
      maxAdvancePct: Number(maxAdvancePct.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      volatilityPct: Number(volatilityPct.toFixed(3)),
      positiveReturnWeeks,
      heatScore: heatMeta.heatScore,
      heatColor: heatMeta.heatColor,
      stateClass: heatMeta.stateClass,
      stateLabel: heatMeta.stateLabel,
      source: "auto",
    });

    for (const point of segmentPoints) {
      autoRegimePoints.push({
        weekStart: point.weekStart,
        weekEnd: point.weekEnd,
        closePrice: point.closePrice,
        heatScore: heatMeta.heatScore,
        heatColor: heatMeta.heatColor,
        segmentIndex: index,
        stateClass: heatMeta.stateClass,
        stateLabel: heatMeta.stateLabel,
        source: "auto",
      });
    }
  }

  const merged = mergeAutoRegimeSegments(autoRegimeSegments, autoRegimePoints);
  const autoPointMap = new Map(merged.points.map((point) => [point.weekStart, point]));
  const comparableWeeks = points.filter((point) => autoPointMap.has(point.weekStart));
  const agreementCount = comparableWeeks.filter((point) => {
    const autoPoint = autoPointMap.get(point.weekStart);
    return autoPoint && manualRegimeClass(point.regimeLabel) === autoPoint.stateClass;
  }).length;
  const manualBoundaries = manualBoundaryIndexes(points);
  const mergedBoundaryIndexes = merged.segments
    .slice(1)
    .map((segment) => points.findIndex((point) => point.weekStart === segment.start))
    .filter((index) => index > 0);
  const boundaryMatch = evaluateBoundaryMatch(manualBoundaries, mergedBoundaryIndexes);
  const manualSegmentCount = manualBoundaries.length + 1;
  const segmentCountPenalty = Math.abs(merged.segments.length - manualSegmentCount);
  const score =
    (comparableWeeks.length ? (agreementCount / comparableWeeks.length) * 100 : 0) +
    boundaryMatch * 22 -
    segmentCountPenalty * 4.2;

  return {
    autoRegimeSegments: merged.segments,
    autoRegimePoints: merged.points,
    autoRegimeAgreementPct: comparableWeeks.length ? Number(((agreementCount / comparableWeeks.length) * 100).toFixed(1)) : 0,
    optimizationScore: score,
  };
}

function buildAutoRegimes(points: BtcWeeklyResearchPoint[], overrides: AutoRegimeOverride[]) {
  const tunings: AutoRegimeTuning[] = [];
  for (const minSegmentLength of [3, 4, 5, 6, 7]) {
    for (const minImprovementRatio of [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]) {
      for (const trendScale of [2.1, 2.6, 3.1, 3.6]) {
        for (const drawdownScale of [10, 13, 16, 20]) {
          for (const volatilityScale of [6.5, 8.5, 10.5]) {
            for (const neutralityThreshold of [0.1, 0.14, 0.18, 0.22]) {
              tunings.push({
                minSegmentLength,
                minImprovementRatio,
                trendScale,
                drawdownScale,
                volatilityScale,
                neutralityThreshold,
              });
            }
          }
        }
      }
    }
  }

  let bestResult: ReturnType<typeof buildAutoRegimesWithTuning> | null = null;
  for (const tuning of tunings) {
    const candidate = buildAutoRegimesWithTuning(points, tuning);
    if (!bestResult || candidate.optimizationScore > bestResult.optimizationScore) {
      bestResult = candidate;
    }
  }

  const overridden = applyAutoRegimeOverrides(bestResult?.autoRegimePoints ?? [], overrides);
  const autoPointMap = new Map(overridden.points.map((point) => [point.weekStart, point]));
  const comparableWeeks = points.filter((point) => autoPointMap.has(point.weekStart));
  const agreementCount = comparableWeeks.filter((point) => {
    const autoPoint = autoPointMap.get(point.weekStart);
    return autoPoint && manualRegimeClass(point.regimeLabel) === autoPoint.stateClass;
  }).length;

  return {
    autoRegimeSegments: overridden.segments,
    autoRegimePoints: overridden.points,
    autoRegimeAgreementPct: comparableWeeks.length ? Number(((agreementCount / comparableWeeks.length) * 100).toFixed(1)) : 0,
    autoOverrideCount: overridden.overrideCount,
  };
}

function loadBtcWeeklyCloses() {
  const klinePath = path.resolve(process.cwd(), "lib", "btc-weekly-klines.json");
  const rows = JSON.parse(fs.readFileSync(klinePath, "utf8")) as Array<[number, string, string, string, string]>;
  const todayUtc = new Date().toISOString().slice(0, 10);
  return rows.map((row) => {
    const weekStart = new Date(row[0]).toISOString().slice(0, 10);
    const weekEndDate = new Date(row[0]);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    return {
      weekStart,
      weekEnd: weekEndDate.toISOString().slice(0, 10),
      closePrice: Number(row[4]),
    };
  }).filter((row) => row.weekEnd < todayUtc);
}

type BtcWeeklyCandle = {
  weekStart: string;
  weekEnd: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
};

type SevenRegimeFamily = "Bull" | "Sideways" | "Bear";

const SEVEN_REGIME_TONE: Record<string, string> = {
  大牛: "#16a34a",
  小牛: "#22c55e",
  震荡牛: "#bbf7d0",
  震荡灰: "#cbd5e1",
  震荡熊: "#fecdd3",
  小熊: "#fca5a5",
  大熊: "#991b1b",
};

const SEVEN_REGIME_FAMILY: Record<string, SevenRegimeFamily> = {
  大牛: "Bull",
  小牛: "Bull",
  震荡牛: "Sideways",
  震荡灰: "Sideways",
  震荡熊: "Sideways",
  小熊: "Bear",
  大熊: "Bear",
};

function loadBtcWeeklyCandles() {
  const klinePath = path.resolve(process.cwd(), "lib", "btc-weekly-klines.json");
  const rows = JSON.parse(fs.readFileSync(klinePath, "utf8")) as Array<[number, string, string, string, string]>;
  const todayUtc = new Date().toISOString().slice(0, 10);
  return rows.map((row) => {
    const weekStart = new Date(row[0]).toISOString().slice(0, 10);
    const weekEndDate = new Date(row[0]);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    return {
      weekStart,
      weekEnd: weekEndDate.toISOString().slice(0, 10),
      openPrice: Number(row[1]),
      highPrice: Number(row[2]),
      lowPrice: Number(row[3]),
      closePrice: Number(row[4]),
    };
  }).filter((row) => row.weekEnd < todayUtc);
}

function rollingMean(values: number[], window: number) {
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= window) sum -= values[index - window];
    const length = Math.min(index + 1, window);
    result.push(sum / length);
  }
  return result;
}

function rollingStd(values: number[], window: number) {
  const result: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1);
    result.push(stdDev(slice));
  }
  return result;
}

function ema(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  const result: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index === 0) {
      result.push(values[index]);
      continue;
    }
    result.push(alpha * values[index] + (1 - alpha) * result[index - 1]);
  }
  return result;
}

function wilderSmooth(values: number[], period: number) {
  const result = new Array<number>(values.length).fill(0);
  if (!values.length) return result;
  let seed = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (index < period) {
      seed += values[index];
      result[index] = seed;
      continue;
    }
    result[index] = result[index - 1] - result[index - 1] / period + values[index];
  }
  return result;
}

function computeAdx(candles: BtcWeeklyCandle[], period: number) {
  const highs = candles.map((item) => item.highPrice);
  const lows = candles.map((item) => item.lowPrice);
  const closes = candles.map((item) => item.closePrice);
  const trueRanges: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const prevClose = index > 0 ? closes[index - 1] : closes[index];
    const prevHigh = index > 0 ? highs[index - 1] : highs[index];
    const prevLow = index > 0 ? lows[index - 1] : lows[index];
    trueRanges.push(Math.max(highs[index] - lows[index], Math.abs(highs[index] - prevClose), Math.abs(lows[index] - prevClose)));
    const upMove = highs[index] - prevHigh;
    const downMove = prevLow - lows[index];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smoothedTr = wilderSmooth(trueRanges, period);
  const smoothedPlusDm = wilderSmooth(plusDm, period);
  const smoothedMinusDm = wilderSmooth(minusDm, period);
  const dx: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const tr = smoothedTr[index];
    if (!tr) {
      dx.push(0);
      continue;
    }
    const plusDi = (smoothedPlusDm[index] / tr) * 100;
    const minusDi = (smoothedMinusDm[index] / tr) * 100;
    const denominator = plusDi + minusDi;
    dx.push(denominator ? (Math.abs(plusDi - minusDi) / denominator) * 100 : 0);
  }

  const adx = new Array<number>(candles.length).fill(25);
  if (!dx.length) return adx;
  let seed = 0;
  for (let index = 0; index < dx.length; index += 1) {
    if (index < period) {
      seed += dx[index];
      adx[index] = 25;
      continue;
    }
    if (index === period) {
      adx[index] = seed / period;
      continue;
    }
    adx[index] = ((adx[index - 1] * (period - 1)) + dx[index]) / period;
  }
  return adx.map((value) => Number((Number.isFinite(value) ? value : 25).toFixed(3)));
}

function computeRsi(values: number[], period: number) {
  if (!values.length) return [];
  const gains = new Array<number>(values.length).fill(0);
  const losses = new Array<number>(values.length).fill(0);
  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains[index] = change > 0 ? change : 0;
    losses[index] = change < 0 ? Math.abs(change) : 0;
  }
  const avgGains = wilderSmooth(gains, period).map((value) => value / period);
  const avgLosses = wilderSmooth(losses, period).map((value) => value / period);
  return values.map((_, index) => {
    if (index < period) return 50;
    const avgLoss = avgLosses[index];
    if (!avgLoss) return 100;
    const rs = avgGains[index] / avgLoss;
    return Number((100 - (100 / (1 + rs))).toFixed(3));
  });
}

function rollingPercentRank(values: number[], window: number) {
  return values.map((current, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1).filter((value) => Number.isFinite(value));
    if (!slice.length) return 50;
    const count = slice.filter((value) => value <= current).length;
    return Number(((count / slice.length) * 100).toFixed(3));
  });
}

type Research2BasePoint = Omit<BtcWeeklyResearch2Point, "confirmedRegime" | "confirmedTone" | "family">;

type SegmentFeaturePoint = Research2BasePoint & {
  trendScore: number;
  volScore: number;
  leverageScore: number;
  participationScore: number;
};

type SevenRegimeSegmentDraft = {
  startIndex: number;
  endIndex: number;
  start: string;
  end: string;
  weeks: number;
  cumulativeReturnPct: number;
  maxAdvancePct: number;
  maxDrawdownPct: number;
  peakToEndDrawdownPct: number;
  avgFundingRatePct: number;
  avgVolumeM: number;
  avgAdx14: number;
  avgBbwPercentile104: number;
  avgWeeklyReturnPct: number;
  weeklyVolatilityPct: number;
  positiveReturnSharePct: number;
  priceSlope: number;
  emaSlope: number;
  smaSlope: number;
  trendScore: number;
  volScore: number;
  leverageScore: number;
  participationScore: number;
  breakoutScore: number;
  riskScore: number;
  peakToTroughDrawdownPct: number;
  peakToTroughWeeks: number;
  label: string;
};

function zscoreSeries(values: number[]) {
  const mean = avgValues(values);
  const deviation = stdDev(values);
  if (!deviation) return values.map(() => 0);
  return values.map((value) => Number(((value - mean) / deviation).toFixed(4)));
}

function linearSlope(values: number[]) {
  if (values.length <= 1) return 0;
  return lineFit(values, 0, values.length).slope;
}

function buildResearch2Scores(points: Research2BasePoint[]) {
  const priceSlope13 = points.map((_, index) => {
    const start = Math.max(0, index - 12);
    return linearSlope(points.slice(start, index + 1).map((item) => Math.log(Math.max(item.closePrice, 1))));
  });
  const emaSlope13 = points.map((_, index) => {
    const start = Math.max(0, index - 12);
    return linearSlope(points.slice(start, index + 1).map((item) => item.ema21));
  });
  const closeToSma200 = points.map((item) => item.sma200 ? (item.closePrice - item.sma200) / item.sma200 : 0);
  const bbwPctCentered = points.map((item) => (item.bbwPercentile104 - 50) / 50);
  const fundingZ = zscoreSeries(points.map((item) => item.fundingRatePct));
  const volumeZ = zscoreSeries(points.map((item) => item.avgVolumeM));
  const adxZ = zscoreSeries(points.map((item) => item.adx14));
  const retZZ = zscoreSeries(points.map((item) => item.returnZ52));
  const trendZ = zscoreSeries(priceSlope13.map((value, index) => value + (emaSlope13[index] * 0.25) + (closeToSma200[index] * 0.8)));
  const bbwZ = zscoreSeries(bbwPctCentered);

  return points.map((point, index) => ({
    ...point,
    trendScore: Number(((trendZ[index] * 0.55) + (retZZ[index] * 0.25) + (adxZ[index] * 0.2)).toFixed(3)),
    volScore: Number(((bbwZ[index] * 0.7) + (adxZ[index] * 0.3)).toFixed(3)),
    leverageScore: Number(((fundingZ[index] * 0.65) + (retZZ[index] * 0.35)).toFixed(3)),
    participationScore: Number(((volumeZ[index] * 0.7) + (adxZ[index] * 0.3)).toFixed(3)),
  }));
}

function segmentFeatureCost(points: SegmentFeaturePoint[], start: number, endExclusive: number) {
  if (endExclusive - start <= 1) return 0;
  const segmentPoints = points.slice(start, endExclusive);
  const logPrices = segmentPoints.map((point) => Math.log(Math.max(point.closePrice, 1)));
  const emaValues = segmentPoints.map((point) => point.ema21);
  const featureKeys: Array<keyof Pick<SegmentFeaturePoint, "trendScore" | "volScore" | "leverageScore" | "participationScore">> = [
    "trendScore",
    "volScore",
    "leverageScore",
    "participationScore",
  ];

  const featureVarianceCost = featureKeys.reduce((sum, key) => {
    const values = segmentPoints.map((point) => point[key]);
    const mean = avgValues(values);
    return sum + values.reduce((inner, value) => inner + (value - mean) ** 2, 0);
  }, 0);

  const priceLinearCost = lineFit(logPrices, 0, logPrices.length).sse * 18;
  const emaLinearCost = lineFit(emaValues, 0, emaValues.length).sse / 5000;
  const returnDriftCost = stdDev(segmentPoints.map((point) => point.weeklyReturnPct)) * segmentPoints.length * 0.12;

  return featureVarianceCost + priceLinearCost + emaLinearCost + returnDriftCost;
}

function bestResearch2Split(points: SegmentFeaturePoint[], start: number, endExclusive: number, minSegmentLength = 5) {
  const parentCost = segmentFeatureCost(points, start, endExclusive);
  let bestSplit = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let split = start + minSegmentLength; split <= endExclusive - minSegmentLength; split += 1) {
    const candidateCost = segmentFeatureCost(points, start, split) + segmentFeatureCost(points, split, endExclusive);
    if (candidateCost < bestCost) {
      bestCost = candidateCost;
      bestSplit = split;
    }
  }
  return {
    bestSplit,
    parentCost,
    bestCost,
    improvementRatio: parentCost > 0 && bestCost < Number.POSITIVE_INFINITY ? (parentCost - bestCost) / parentCost : 0,
  };
}

function splitResearch2Segments(
  points: SegmentFeaturePoint[],
  minSegmentLength = 5,
  segmentPenalty = 7.8,
  maxSegmentLength = 28,
  latestSegmentMinLength = minSegmentLength,
) {
  const pointCount = points.length;
  if (pointCount <= Math.max(minSegmentLength, latestSegmentMinLength)) return [];

  const dp = new Array<number>(pointCount + 1).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(pointCount + 1).fill(-1);
  dp[0] = -segmentPenalty;

  for (let endExclusive = minSegmentLength; endExclusive <= pointCount; endExclusive += 1) {
    const requiredMinLength = endExclusive === pointCount ? latestSegmentMinLength : minSegmentLength;
    if (endExclusive < requiredMinLength) continue;
    const startFloor = Math.max(0, endExclusive - Math.max(maxSegmentLength * 2, minSegmentLength));
    for (let start = 0; start <= endExclusive - requiredMinLength; start += 1) {
      if (start < startFloor && endExclusive - start > maxSegmentLength) continue;
      if (!Number.isFinite(dp[start])) continue;
      const segmentLength = endExclusive - start;
      const overflowPenalty = segmentLength > maxSegmentLength ? (segmentLength - maxSegmentLength) ** 2 * 0.7 : 0;
      const candidate = dp[start] + segmentFeatureCost(points, start, endExclusive) + segmentPenalty + overflowPenalty;
      if (candidate < dp[endExclusive]) {
        dp[endExclusive] = candidate;
        previous[endExclusive] = start;
      }
    }
  }

  const boundaries: number[] = [];
  let cursor = pointCount;
  while (cursor > 0 && previous[cursor] >= 0) {
    boundaries.push(cursor);
    cursor = previous[cursor];
  }
  boundaries.push(0);
  const ordered = boundaries.reverse();
  const splitPoints = ordered.slice(1, -1);

  const refined = new Set<number>(splitPoints);
  const allBoundaries = [0, ...splitPoints, pointCount];
  for (let index = 1; index < allBoundaries.length; index += 1) {
    const start = allBoundaries[index - 1];
    const endExclusive = allBoundaries[index];
    const length = endExclusive - start;
    if (length <= maxSegmentLength) continue;
    const candidate = bestResearch2Split(points, start, endExclusive, minSegmentLength);
    if (candidate.bestSplit > 0 && candidate.improvementRatio >= 0.08) {
      refined.add(candidate.bestSplit);
    }
  }

  return [...refined].sort((left, right) => left - right);
}

function buildResearch2SegmentDraft(points: SegmentFeaturePoint[], startIndex: number, endIndex: number): SevenRegimeSegmentDraft {
  const segmentPoints = points.slice(startIndex, endIndex + 1);
  const firstClose = segmentPoints[0].closePrice;
  const lastClose = segmentPoints.at(-1)?.closePrice ?? firstClose;
  const highestPrice = Math.max(...segmentPoints.map((point) => point.highPrice));
  const pricePath = segmentPoints.map((point) => ((point.closePrice / firstClose) - 1) * 100);
  const weeklyReturns = segmentPoints.map((point) => point.weeklyReturnPct);
  const positiveReturnSharePct = segmentPoints.length ? (segmentPoints.filter((point) => point.weeklyReturnPct > 0).length / segmentPoints.length) * 100 : 0;
  const secondHalf = segmentPoints.slice(Math.floor(segmentPoints.length / 2));
  const secondHalfFirstClose = secondHalf[0]?.closePrice ?? firstClose;
  const secondHalfLastClose = secondHalf.at(-1)?.closePrice ?? secondHalfFirstClose;
  const secondHalfReturnPct = secondHalfFirstClose ? ((secondHalfLastClose / secondHalfFirstClose) - 1) * 100 : 0;
  const logPrices = segmentPoints.map((point) => Math.log(Math.max(point.closePrice, 1)));
  const emaValues = segmentPoints.map((point) => point.ema21);
  const smaValues = segmentPoints.map((point) => point.sma200);
  const trendScore = avgValues(segmentPoints.map((point) => point.trendScore));
  const breakoutScore = (Number((((highestPrice / firstClose) - 1) * 100).toFixed(3)) * 0.6) + (secondHalfReturnPct * 0.4);
  const riskScore = (Math.abs(Math.min(...pricePath)) * 0.65) + (Math.abs(Number((((lastClose / highestPrice) - 1) * 100).toFixed(3))) * 0.35);
  let runningPeak = segmentPoints[0].closePrice;
  let runningPeakIndex = 0;
  let peakToTroughDrawdownPct = 0;
  let peakToTroughWeeks = 1;
  for (let index = 0; index < segmentPoints.length; index += 1) {
    const close = segmentPoints[index].closePrice;
    if (close >= runningPeak) {
      runningPeak = close;
      runningPeakIndex = index;
    }
    const drawdownPct = ((close / runningPeak) - 1) * 100;
    if (drawdownPct <= peakToTroughDrawdownPct) {
      peakToTroughDrawdownPct = drawdownPct;
      peakToTroughWeeks = Math.max(1, index - runningPeakIndex + 1);
    }
  }

  return {
    startIndex,
    endIndex,
    start: segmentPoints[0].weekStart,
    end: segmentPoints.at(-1)?.weekEnd ?? segmentPoints[0].weekEnd,
    weeks: segmentPoints.length,
    cumulativeReturnPct: Number((((lastClose / firstClose) - 1) * 100).toFixed(2)),
    maxAdvancePct: Number(Math.max(...pricePath).toFixed(2)),
    maxDrawdownPct: Number(Math.min(...pricePath).toFixed(2)),
    peakToEndDrawdownPct: Number((((lastClose / highestPrice) - 1) * 100).toFixed(2)),
    avgFundingRatePct: Number(avgValues(segmentPoints.map((point) => point.fundingRatePct)).toFixed(3)),
    avgVolumeM: Number(avgValues(segmentPoints.map((point) => point.avgVolumeM)).toFixed(1)),
    avgAdx14: Number(avgValues(segmentPoints.map((point) => point.adx14)).toFixed(2)),
    avgBbwPercentile104: Number(avgValues(segmentPoints.map((point) => point.bbwPercentile104)).toFixed(1)),
    avgWeeklyReturnPct: Number(avgValues(weeklyReturns).toFixed(3)),
    weeklyVolatilityPct: Number(stdDev(weeklyReturns).toFixed(3)),
    positiveReturnSharePct: Number(positiveReturnSharePct.toFixed(1)),
    priceSlope: Number(linearSlope(logPrices).toFixed(4)),
    emaSlope: Number(linearSlope(emaValues).toFixed(3)),
    smaSlope: Number(linearSlope(smaValues).toFixed(3)),
    trendScore: Number(trendScore.toFixed(3)),
    volScore: Number(avgValues(segmentPoints.map((point) => point.volScore)).toFixed(3)),
    leverageScore: Number(avgValues(segmentPoints.map((point) => point.leverageScore)).toFixed(3)),
    participationScore: Number(avgValues(segmentPoints.map((point) => point.participationScore)).toFixed(3)),
    breakoutScore: Number(breakoutScore.toFixed(2)),
    riskScore: Number(riskScore.toFixed(2)),
    peakToTroughDrawdownPct: Number(peakToTroughDrawdownPct.toFixed(2)),
    peakToTroughWeeks,
    label: "震荡灰",
  };
}

function buildResearch2SegmentDrafts(points: SegmentFeaturePoint[], breakpoints: number[]) {
  const boundaries = [0, ...breakpoints, points.length];
  const segments: SevenRegimeSegmentDraft[] = [];

  for (let index = 1; index < boundaries.length; index += 1) {
    const startIndex = boundaries[index - 1];
    const endIndex = boundaries[index] - 1;
    if (endIndex < startIndex) continue;
    segments.push(buildResearch2SegmentDraft(points, startIndex, endIndex));
  }
  return segments;
}

function buildResearch2Thresholds(segments: SevenRegimeSegmentDraft[]) {
  const cumReturns = segments.map((segment) => segment.cumulativeReturnPct);
  const maxAdvances = segments.map((segment) => segment.maxAdvancePct);
  const maxDrawdowns = segments.map((segment) => segment.maxDrawdownPct);
  const peakToEndDrawdowns = segments.map((segment) => segment.peakToEndDrawdownPct);
  const avgAdx = segments.map((segment) => segment.avgAdx14);
  const avgBbwPct = segments.map((segment) => segment.avgBbwPercentile104);
  const trendScores = segments.map((segment) => segment.trendScore);

  return {
    bullQ65: percentile(cumReturns, 0.65),
    bullQ70: percentile(cumReturns, 0.7),
    bullQ80: percentile(cumReturns, 0.8),
    bullQ90: percentile(cumReturns, 0.9),
    bearQ30: percentile(cumReturns, 0.3),
    bearQ20: percentile(cumReturns, 0.2),
    maxAdvanceQ80: percentile(maxAdvances, 0.8),
    maxAdvanceQ90: percentile(maxAdvances, 0.9),
    maxDrawQ20: percentile(maxDrawdowns, 0.2),
    maxDrawQ10: percentile(maxDrawdowns, 0.1),
    peakToEndQ20: percentile(peakToEndDrawdowns, 0.2),
    adxLowQ35: percentile(avgAdx, 0.35),
    adxHighQ70: percentile(avgAdx, 0.7),
    bbwLowQ35: percentile(avgBbwPct, 0.35),
    bbwHighQ70: percentile(avgBbwPct, 0.7),
    trendQ30: percentile(trendScores, 0.3),
    trendQ70: percentile(trendScores, 0.7),
  };
}

function buildResearch2ThresholdSnapshot(thresholds: ReturnType<typeof buildResearch2Thresholds>) {
  return {
    minSegmentWeeks: 5,
    latestSegmentMinWeeks: 5,
    splitPenalty: 7.8,
    maxSegmentWeeks: 28,
    bullQ65: Number(thresholds.bullQ65.toFixed(3)),
    bullQ70: Number(thresholds.bullQ70.toFixed(3)),
    bullQ80: Number(thresholds.bullQ80.toFixed(3)),
    bullQ90: Number(thresholds.bullQ90.toFixed(3)),
    bearQ30: Number(thresholds.bearQ30.toFixed(3)),
    bearQ20: Number(thresholds.bearQ20.toFixed(3)),
    maxAdvanceQ80: Number(thresholds.maxAdvanceQ80.toFixed(3)),
    maxAdvanceQ90: Number(thresholds.maxAdvanceQ90.toFixed(3)),
    maxDrawQ20: Number(thresholds.maxDrawQ20.toFixed(3)),
    maxDrawQ10: Number(thresholds.maxDrawQ10.toFixed(3)),
    peakToEndQ20: Number(thresholds.peakToEndQ20.toFixed(3)),
    adxLowQ35: Number(thresholds.adxLowQ35.toFixed(3)),
    adxHighQ70: Number(thresholds.adxHighQ70.toFixed(3)),
    bbwLowQ35: Number(thresholds.bbwLowQ35.toFixed(3)),
    bbwHighQ70: Number(thresholds.bbwHighQ70.toFixed(3)),
    trendQ30: Number(thresholds.trendQ30.toFixed(3)),
    trendQ70: Number(thresholds.trendQ70.toFixed(3)),
    directionBandRule: "max(3.5, |bullQ65|*0.18, 周波动*sqrt(weeks)*0.28)",
    neutralBandRule: "max(directionBand*1.35, |bullQ65|*0.32, 4.2)",
    crashBearRule: "5-7周且净跌<=bearQ20、回撤<=maxDrawQ10、下跌速度>=3.8、平均周收益<=-4、上涨周占比<=20%",
  };
}

type Research2Tuning = {
  minSegmentWeeks: number;
  latestSegmentMinWeeks: number;
  splitPenalty: number;
  maxSegmentWeeks: number;
};

type Research2IndicatorSettings = {
  emaPeriod: number;
  smaPeriod: number;
  adxPeriod: number;
  adxTrendLevel: number;
  rsiPeriod: number;
  rsiUpper: number;
  rsiLower: number;
  bbPeriod: number;
  bbStdDev: number;
  returnZPeriod: number;
  returnUpper: number;
  returnLower: number;
  bbwPercentileWindow: number;
  bbwHigh: number;
  bbwLow: number;
};

function normalizeResearch2Tuning(input?: Partial<Research2Tuning>): Research2Tuning {
  const minSegmentWeeks = clamp(Math.round(input?.minSegmentWeeks ?? 5), 3, 12);
  return {
    minSegmentWeeks,
    latestSegmentMinWeeks: clamp(Math.round(input?.latestSegmentMinWeeks ?? minSegmentWeeks), 1, 20),
    splitPenalty: Number(clamp(input?.splitPenalty ?? 7.8, 2, 20).toFixed(2)),
    maxSegmentWeeks: clamp(Math.round(input?.maxSegmentWeeks ?? 28), 8, 80),
  };
}

function normalizeResearch2IndicatorSettings(input?: Partial<Research2IndicatorSettings>): Research2IndicatorSettings {
  return {
    emaPeriod: clamp(Math.round(input?.emaPeriod ?? 21), 3, 120),
    smaPeriod: clamp(Math.round(input?.smaPeriod ?? 200), 20, 300),
    adxPeriod: clamp(Math.round(input?.adxPeriod ?? 14), 5, 60),
    adxTrendLevel: clamp(Math.round(input?.adxTrendLevel ?? 25), 10, 60),
    rsiPeriod: clamp(Math.round(input?.rsiPeriod ?? 14), 5, 60),
    rsiUpper: clamp(Math.round(input?.rsiUpper ?? 80), 50, 95),
    rsiLower: clamp(Math.round(input?.rsiLower ?? 20), 5, 50),
    bbPeriod: clamp(Math.round(input?.bbPeriod ?? 20), 5, 120),
    bbStdDev: Number(clamp(input?.bbStdDev ?? 2, 0.5, 4).toFixed(2)),
    returnZPeriod: clamp(Math.round(input?.returnZPeriod ?? 52), 10, 156),
    returnUpper: Number(clamp(input?.returnUpper ?? 2, 0.5, 5).toFixed(2)),
    returnLower: Number(clamp(input?.returnLower ?? -2, -5, -0.5).toFixed(2)),
    bbwPercentileWindow: clamp(Math.round(input?.bbwPercentileWindow ?? 104), 20, 260),
    bbwHigh: clamp(Math.round(input?.bbwHigh ?? 70), 40, 95),
    bbwLow: clamp(Math.round(input?.bbwLow ?? 30), 5, 60),
  };
}

function withResearch2TuningSnapshot(thresholds: ReturnType<typeof buildResearch2Thresholds>, tuning: Research2Tuning) {
  return {
    ...buildResearch2ThresholdSnapshot(thresholds),
    minSegmentWeeks: tuning.minSegmentWeeks,
    latestSegmentMinWeeks: tuning.latestSegmentMinWeeks,
    splitPenalty: tuning.splitPenalty,
    maxSegmentWeeks: tuning.maxSegmentWeeks,
  };
}

function research2DirectionBand(segment: SevenRegimeSegmentDraft, thresholds: ReturnType<typeof buildResearch2Thresholds>) {
  return Math.max(3.5, Math.abs(thresholds.bullQ65) * 0.18, segment.weeklyVolatilityPct * Math.sqrt(segment.weeks) * 0.28);
}

function isResearch2CrashBear(segment: SevenRegimeSegmentDraft, thresholds: ReturnType<typeof buildResearch2Thresholds>) {
  const drawdownSpeed = Math.abs(segment.peakToTroughDrawdownPct) / Math.max(segment.peakToTroughWeeks, 1);
  return (
    segment.weeks >= 5 &&
    segment.weeks <= 7 &&
    segment.cumulativeReturnPct <= thresholds.bearQ20 &&
    segment.maxDrawdownPct <= thresholds.maxDrawQ10 &&
    segment.peakToTroughDrawdownPct <= thresholds.maxDrawQ10 &&
    drawdownSpeed >= 3.8 &&
    segment.avgWeeklyReturnPct <= -4 &&
    segment.positiveReturnSharePct <= 20 &&
    segment.trendScore <= thresholds.trendQ30 * 1.35
  );
}

function labelResearch2Segment(
  segment: SevenRegimeSegmentDraft,
  thresholds: ReturnType<typeof buildResearch2Thresholds>,
  options?: { allowCrashBear?: boolean },
) {
  const directionBand = research2DirectionBand(segment, thresholds);
  const isStrongBull = segment.cumulativeReturnPct >= thresholds.bullQ70 && segment.priceSlope > 0;
  const isStrongBear = segment.cumulativeReturnPct <= thresholds.bearQ30 && segment.priceSlope < 0;
  const madBullScore = (segment.cumulativeReturnPct * 0.35) + (segment.maxAdvancePct * 0.25) + (segment.avgAdx14 * 0.2) + (segment.avgFundingRatePct * 14) + (segment.participationScore * 8);
  const madBearScore = (Math.abs(segment.cumulativeReturnPct) * 0.35) + (Math.abs(segment.maxDrawdownPct) * 0.25) + (segment.avgAdx14 * 0.2) + (Math.abs(segment.peakToEndDrawdownPct) * 0.12) + (Math.abs(segment.leverageScore) * 6);
  const neutralBand = Math.max(directionBand * 1.35, Math.abs(thresholds.bullQ65) * 0.32, 4.2);
  const calmTrend = Math.abs(segment.priceSlope) <= Math.abs(thresholds.trendQ30) * 1.2;
  const calmVolatility = segment.avgAdx14 <= thresholds.adxLowQ35 * 1.08 && segment.avgBbwPercentile104 <= thresholds.bbwLowQ35 * 1.18;
  const secondHalfBiasBull = segment.breakoutScore >= thresholds.maxAdvanceQ80 || (segment.priceSlope > 0 && segment.avgWeeklyReturnPct > 0 && segment.positiveReturnSharePct >= 54);
  const secondHalfBiasBear = segment.riskScore >= Math.abs(thresholds.maxDrawQ20) || (segment.priceSlope < 0 && segment.avgWeeklyReturnPct < 0 && segment.positiveReturnSharePct <= 46);

  if (isStrongBull) {
    if (segment.maxAdvancePct >= thresholds.maxAdvanceQ90 && madBullScore >= (thresholds.bullQ80 * 0.7 + thresholds.maxAdvanceQ90 * 0.3) && segment.weeks >= 8) {
      return "大牛";
    }
    return "小牛";
  }

  if (isStrongBear) {
    const longBear = segment.maxDrawdownPct <= thresholds.maxDrawQ10 && madBearScore >= (Math.abs(thresholds.bearQ20) * 0.7 + Math.abs(thresholds.maxDrawQ10) * 0.3) && segment.weeks >= 8;
    const crashBear = options?.allowCrashBear ? isResearch2CrashBear(segment, thresholds) : false;
    if (longBear || crashBear) {
      return "大熊";
    }
    return "小熊";
  }

  if (
    Math.abs(segment.cumulativeReturnPct) <= neutralBand &&
    calmTrend &&
    calmVolatility &&
    segment.positiveReturnSharePct >= 38 &&
    segment.positiveReturnSharePct <= 62
  ) {
    return "震荡灰";
  }

  if (secondHalfBiasBull && segment.cumulativeReturnPct >= directionBand) return "震荡牛";
  if (secondHalfBiasBear && segment.cumulativeReturnPct <= -directionBand) return "震荡熊";
  return segment.cumulativeReturnPct >= 0 ? "震荡牛" : "震荡熊";
}

function validateResearch2SegmentLabel(segment: SevenRegimeSegmentDraft, thresholds: ReturnType<typeof buildResearch2Thresholds>) {
  let label = segment.label;
  const bullFamily = new Set(["大牛", "小牛", "震荡牛"]);
  const bearFamily = new Set(["大熊", "小熊", "震荡熊"]);
  const strongTrend = segment.avgAdx14 >= thresholds.adxHighQ70 || Math.abs(segment.trendScore) >= Math.max(Math.abs(thresholds.trendQ30), Math.abs(thresholds.trendQ70));
  const directionBand = research2DirectionBand(segment, thresholds);

  if (segment.cumulativeReturnPct >= directionBand && bearFamily.has(label)) {
    label = strongTrend ? "小牛" : "震荡牛";
  }

  if (segment.cumulativeReturnPct <= -directionBand && bullFamily.has(label)) {
    label = strongTrend ? "小熊" : "震荡熊";
  }

  if (label === "大牛" || label === "小牛") {
    if (segment.cumulativeReturnPct < directionBand) {
      label = segment.cumulativeReturnPct <= -directionBand ? (strongTrend ? "小熊" : "震荡熊") : "震荡牛";
    }
  }

  if (label === "大熊" || label === "小熊") {
    if (segment.cumulativeReturnPct > -directionBand) {
      label = segment.cumulativeReturnPct >= directionBand ? (strongTrend ? "小牛" : "震荡牛") : "震荡熊";
    }
  }

  if (label === "震荡灰" && Math.abs(segment.cumulativeReturnPct) > directionBand) {
    label = segment.cumulativeReturnPct > 0 ? "震荡牛" : "震荡熊";
  }

  if (label === "震荡牛" && segment.cumulativeReturnPct < directionBand) {
    label = Math.abs(segment.cumulativeReturnPct) <= directionBand ? "震荡灰" : "震荡熊";
  }

  if (label === "震荡熊" && segment.cumulativeReturnPct > -directionBand) {
    label = Math.abs(segment.cumulativeReturnPct) <= directionBand ? "震荡灰" : "震荡牛";
  }

  if (segment.maxAdvancePct >= thresholds.maxAdvanceQ90 && segment.cumulativeReturnPct >= thresholds.bullQ80 && segment.weeks >= 10 && label === "小牛") {
    label = "大牛";
  }

  if (segment.peakToEndDrawdownPct <= thresholds.peakToEndQ20 && segment.cumulativeReturnPct < 0 && bullFamily.has(label)) {
    label = strongTrend ? "小熊" : "震荡熊";
  }

  if (label === "震荡熊" && segment.breakoutScore >= thresholds.maxAdvanceQ80 && segment.priceSlope > 0 && segment.cumulativeReturnPct >= directionBand) {
    label = strongTrend ? "小牛" : "震荡牛";
  }

  if (label === "震荡牛" && segment.riskScore >= Math.abs(thresholds.maxDrawQ20) && segment.priceSlope < 0 && segment.cumulativeReturnPct <= -directionBand) {
    label = strongTrend ? "小熊" : "震荡熊";
  }

  return label;
}

function mergeResearch2Segments(points: SegmentFeaturePoint[], segments: SevenRegimeSegmentDraft[]) {
  if (!segments.length) return segments;
  const merged: SevenRegimeSegmentDraft[] = [];
  let current = segments[0];

  for (let index = 1; index < segments.length; index += 1) {
    const candidate = segments[index];
    if (candidate.label === current.label) {
      current = {
        ...buildResearch2SegmentDraft(points, current.startIndex, candidate.endIndex),
        label: current.label,
      };
      continue;
    }
    merged.push(current);
    current = candidate;
  }
  merged.push(current);
  return merged;
}

function validateSevenRegimeSegments(segments: SevenRegimeSegmentDraft[], minWeeks = 5, latestSegmentMinWeeks = minWeeks) {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const requiredMinWeeks = index === segments.length - 1 ? latestSegmentMinWeeks : minWeeks;
    if (segment.weeks < requiredMinWeeks) {
      throw new Error(`Seven-regime segment shorter than ${requiredMinWeeks} weeks at ${segment.start}`);
    }
  }
}

function buildBtcSevenRegimeResearch(
  candles: BtcWeeklyCandle[],
  weeklyFunding: Array<{ metric_week: string; weekly_funding_rate: number }>,
  dailyVolumes: Array<{ metric_date: string; usd_volume: number }>,
  options?: {
    tuning?: Partial<Research2Tuning>;
    indicatorSettings?: Partial<Research2IndicatorSettings>;
  },
) {
  const tuning = normalizeResearch2Tuning(options?.tuning);
  const indicatorSettings = normalizeResearch2IndicatorSettings(options?.indicatorSettings);
  const volumeByWeek = new Map<string, number[]>();
  for (const row of dailyVolumes) {
    const key = weekRangeLabel(row.metric_date);
    const bucket = volumeByWeek.get(key) ?? [];
    bucket.push(row.usd_volume);
    volumeByWeek.set(key, bucket);
  }

  const fundingByWeekStart = new Map(
    weeklyFunding.map((row) => {
      const { start } = parseWeekRange(row.metric_week);
      return [start, row.weekly_funding_rate] as const;
    }),
  );

  const scopedCandles = candles.filter((row) => {
    if (!fundingByWeekStart.has(row.weekStart)) return false;
    const metricWeek = `${row.weekStart}/${row.weekEnd}`;
    return (volumeByWeek.get(metricWeek)?.length ?? 0) > 0;
  });
  if (!scopedCandles.length) {
    return {
      points: [] as BtcWeeklyResearch2Point[],
      segments: [] as BtcWeeklyResearch2Segment[],
      summaries: [] as BtcWeeklyResearch2Summary[],
      thresholds: withResearch2TuningSnapshot(buildResearch2Thresholds([]), tuning),
      indicatorSettings,
    };
  }
  const closes = scopedCandles.map((item) => item.closePrice);
  const opens = scopedCandles.map((item) => item.openPrice);
  const ema21Values = ema(closes, indicatorSettings.emaPeriod);
  const sma200Values = rollingMean(closes, indicatorSettings.smaPeriod);
  const adx14Values = computeAdx(scopedCandles, indicatorSettings.adxPeriod);
  const rsiValues = computeRsi(closes, indicatorSettings.rsiPeriod);
  const bbBasisValues = rollingMean(closes, indicatorSettings.bbPeriod);
  const bbStdValues = rollingStd(closes, indicatorSettings.bbPeriod);
  const bbwValues = closes.map((_, index) => {
    const middle = bbBasisValues[index];
    if (!middle) return 0;
    const upper = middle + (bbStdValues[index] * indicatorSettings.bbStdDev);
    const lower = middle - (bbStdValues[index] * indicatorSettings.bbStdDev);
    return Number((((upper - lower) / middle) || 0).toFixed(6));
  });
  const bbwPercentileValues = rollingPercentRank(bbwValues, indicatorSettings.bbwPercentileWindow);
  const rawWeeklyReturns = closes.map((close, index) => (opens[index] ? (close - opens[index]) / opens[index] : 0));
  const returnMeanValues = rollingMean(rawWeeklyReturns, indicatorSettings.returnZPeriod);
  const returnStdValues = rollingStd(rawWeeklyReturns, indicatorSettings.returnZPeriod);
  const returnZValues = rawWeeklyReturns.map((value, index) => {
    const std = returnStdValues[index];
    if (!std) return 0;
    return Number(((value - returnMeanValues[index]) / std).toFixed(3));
  });

  const provisionalPoints: Array<Omit<BtcWeeklyResearch2Point, "confirmedRegime" | "confirmedTone" | "family">> = scopedCandles.map((candle, index) => {
    const metricWeek = `${candle.weekStart}/${candle.weekEnd}`;
    const volumes = volumeByWeek.get(metricWeek) ?? [];
    return {
      weekStart: candle.weekStart,
      weekEnd: candle.weekEnd,
      weekLabel: candle.weekStart.slice(5),
      openPrice: candle.openPrice,
      highPrice: candle.highPrice,
      lowPrice: candle.lowPrice,
      closePrice: Number(candle.closePrice.toFixed(2)),
      fundingRatePct: toPct(fundingByWeekStart.get(candle.weekStart) ?? 0),
      avgVolumeM: toMillion(avgValues(volumes)),
      weeklyReturnPct: index > 0 ? Number((((candle.closePrice / scopedCandles[index - 1].closePrice) - 1) * 100).toFixed(3)) : 0,
      ema21: Number(ema21Values[index].toFixed(2)),
      sma200: Number(sma200Values[index].toFixed(2)),
      bbBasis: Number(bbBasisValues[index].toFixed(2)),
      bbUpper: Number((bbBasisValues[index] + (bbStdValues[index] * indicatorSettings.bbStdDev)).toFixed(2)),
      bbLower: Number((bbBasisValues[index] - (bbStdValues[index] * indicatorSettings.bbStdDev)).toFixed(2)),
      rsi: Number((Number.isFinite(rsiValues[index]) ? rsiValues[index] : 50).toFixed(3)),
      adx14: Number((Number.isFinite(adx14Values[index]) ? adx14Values[index] : 25).toFixed(3)),
      bbw: Number((bbwValues[index] * 100).toFixed(3)),
      bbwPercentile104: bbwPercentileValues[index],
      returnZ52: returnZValues[index],
    };
  });

  const scoredPoints = buildResearch2Scores(provisionalPoints);
  const breakpoints = splitResearch2Segments(
    scoredPoints,
    tuning.minSegmentWeeks,
    tuning.splitPenalty,
    tuning.maxSegmentWeeks,
    tuning.latestSegmentMinWeeks,
  );
  let segmentDrafts = buildResearch2SegmentDrafts(scoredPoints, breakpoints);
  let thresholds = buildResearch2Thresholds(segmentDrafts);
  for (const segment of segmentDrafts) {
    segment.label = labelResearch2Segment(segment, thresholds, { allowCrashBear: false });
    segment.label = validateResearch2SegmentLabel(segment, thresholds);
  }
  segmentDrafts = mergeResearch2Segments(scoredPoints, segmentDrafts);
  thresholds = buildResearch2Thresholds(segmentDrafts);
  for (const segment of segmentDrafts) {
    segment.label = labelResearch2Segment(segment, thresholds, { allowCrashBear: true });
    segment.label = validateResearch2SegmentLabel(segment, thresholds);
  }
  segmentDrafts = mergeResearch2Segments(scoredPoints, segmentDrafts);
  thresholds = buildResearch2Thresholds(segmentDrafts);
  for (const segment of segmentDrafts) {
    segment.label = labelResearch2Segment(segment, thresholds, { allowCrashBear: true });
    segment.label = validateResearch2SegmentLabel(segment, thresholds);
  }
  segmentDrafts = mergeResearch2Segments(scoredPoints, segmentDrafts);
  thresholds = buildResearch2Thresholds(segmentDrafts);
  for (const segment of segmentDrafts) {
    segment.label = labelResearch2Segment(segment, thresholds, { allowCrashBear: true });
    segment.label = validateResearch2SegmentLabel(segment, thresholds);
  }
  segmentDrafts = mergeResearch2Segments(scoredPoints, segmentDrafts);
  thresholds = buildResearch2Thresholds(segmentDrafts);
  validateSevenRegimeSegments(segmentDrafts, tuning.minSegmentWeeks, tuning.latestSegmentMinWeeks);

  const points: BtcWeeklyResearch2Point[] = scoredPoints.map((point, index) => {
    const segment = segmentDrafts.find((item) => index >= item.startIndex && index <= item.endIndex);
    const confirmedRegime = segment?.label ?? "震荡灰";
    return {
      ...point,
      confirmedRegime,
      confirmedTone: SEVEN_REGIME_TONE[confirmedRegime],
      family: SEVEN_REGIME_FAMILY[confirmedRegime],
    };
  });

  const segments: BtcWeeklyResearch2Segment[] = segmentDrafts.map((segment, index) => ({
    index,
    label: segment.label,
    family: SEVEN_REGIME_FAMILY[segment.label],
    tone: SEVEN_REGIME_TONE[segment.label],
    start: segment.start,
    end: segment.end,
    weeks: segment.weeks,
    cumulativeReturnPct: segment.cumulativeReturnPct,
    maxAdvancePct: segment.maxAdvancePct,
    maxDrawdownPct: segment.maxDrawdownPct,
    avgFundingRatePct: segment.avgFundingRatePct,
    avgVolumeM: segment.avgVolumeM,
    avgAdx14: segment.avgAdx14,
    avgBbwPercentile104: segment.avgBbwPercentile104,
    avgWeeklyReturnPct: segment.avgWeeklyReturnPct,
    peakToEndDrawdownPct: segment.peakToEndDrawdownPct,
    positiveReturnSharePct: segment.positiveReturnSharePct,
    priceSlope: segment.priceSlope,
    trendScore: segment.trendScore,
  }));

  const summaries: BtcWeeklyResearch2Summary[] = [...new Set(points.map((point) => point.confirmedRegime))].map((label) => {
    const rows = points.filter((point) => point.confirmedRegime === label);
    return {
      label,
      weeks: rows.length,
      sharePct: Number(((rows.length / points.length) * 100).toFixed(1)),
      avgWeeklyReturnPct: Number(avgValues(rows.map((point) => point.weeklyReturnPct)).toFixed(3)),
      avgFundingRatePct: Number(avgValues(rows.map((point) => point.fundingRatePct)).toFixed(3)),
      avgAdx14: Number(avgValues(rows.map((point) => point.adx14)).toFixed(2)),
      avgBbwPercentile104: Number(avgValues(rows.map((point) => point.bbwPercentile104)).toFixed(1)),
    };
  });

  return { points, segments, summaries, thresholds: withResearch2TuningSnapshot(thresholds, tuning), indicatorSettings };
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
  const overridePayload = loadAutoRegimeOverrides();
  const manualRegimePayload = loadManualResearchRegimes();
  const cacheKey = `${databaseMtimeMs}:${overridePayload.mtimeMs}:${manualRegimePayload.mtimeMs}`;
  if (cachedBtcWeeklyResearchData && cachedBtcWeeklyResearchCacheKey === cacheKey) {
    return cachedBtcWeeklyResearchData;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(databasePath, { open: true, readOnly: true });
    const symbol = "BTC";
    const manualRegimes = buildResearchRegimes(manualRegimePayload.rows, symbol);
    const editableSymbols = [...new Set(manualRegimePayload.rows.map((row) => row.symbol))];
    const weeklyFunding = db
      .prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week")
      .all(`${symbol}USD_PERP`) as Array<{ metric_week: string; weekly_funding_rate: number }>;
    const dailyVolumes = db
      .prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date")
      .all(`${symbol}USD_PERP`) as Array<{ metric_date: string; usd_volume: number }>;

    if (!weeklyFunding.length || !dailyVolumes.length) {
      return {
        symbol,
        timeframe: "week",
        points: [],
        regimes: manualRegimes,
        manualRegimeRows: buildManualResearchRegimeRows(manualRegimePayload.rows),
        lagStats: [],
        regimeStats: [],
        autoRegimePoints: [],
        autoRegimeSegments: [],
        autoRegimeAgreementPct: 0,
        autoOverrideCount: 0,
        editableSymbols,
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
        const regime = findResearchRegime(start, manualRegimes);
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
    const { autoRegimePoints, autoRegimeSegments, autoRegimeAgreementPct, autoOverrideCount } = buildAutoRegimes(points, overridePayload.overrides);

    const regimeStats: ResearchRegimeStat[] = manualRegimes.map((regime) => {
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
        symbol,
        timeframe: "week" as const,
        points,
        regimes: manualRegimes,
        manualRegimeRows: buildManualResearchRegimeRows(manualRegimePayload.rows),
        lagStats,
      regimeStats,
      autoRegimePoints,
      autoRegimeSegments,
      autoRegimeAgreementPct,
      autoOverrideCount,
      editableSymbols,
      sourceLabel: `SQLite 周费率/周成交量 + Binance BTCUSDT 周收盘价 + 手工区间文件(${path.basename(manualRegimePayload.regimesPath)})`,
    };
    cachedBtcWeeklyResearchData = result;
    cachedBtcWeeklyResearchCacheKey = cacheKey;
    return result;
  } catch (error) {
    return {
      symbol: "BTC",
      timeframe: "week",
      points: [],
      regimes: buildResearchRegimes(loadManualResearchRegimes().rows, "BTC"),
      manualRegimeRows: buildManualResearchRegimeRows(loadManualResearchRegimes().rows),
      lagStats: [],
      regimeStats: [],
      autoRegimePoints: [],
      autoRegimeSegments: [],
      autoRegimeAgreementPct: 0,
      autoOverrideCount: 0,
      editableSymbols: [...new Set(loadManualResearchRegimes().rows.map((row) => row.symbol))],
      sourceLabel: "BTC 周线研究数据读取失败",
      loadError: error instanceof Error ? error.message : "unknown error",
    };
  } finally {
    db?.close();
  }
}

export async function getBtcWeeklyResearch2Data(
  options?: {
    tuning?: Partial<Research2Tuning>;
    indicatorSettings?: Partial<Research2IndicatorSettings>;
    range?: {
      startWeek?: string;
      endWeek?: string;
    };
  },
): Promise<BtcWeeklyResearch2Data> {
  const databasePath = path.resolve(process.cwd(), "..", "data", "bian_rate.sqlite3");
  const databaseMtimeMs = fs.statSync(databasePath).mtimeMs;
  const klinePath = path.resolve(process.cwd(), "lib", "btc-weekly-klines.json");
  const klineMtimeMs = fs.statSync(klinePath).mtimeMs;
  const tuning = normalizeResearch2Tuning(options?.tuning);
  const indicatorSettings = normalizeResearch2IndicatorSettings(options?.indicatorSettings);
  const rangeStart = options?.range?.startWeek ?? "";
  const rangeEnd = options?.range?.endWeek ?? "";
  const cacheKey = `${databaseMtimeMs}:${klineMtimeMs}:${rangeStart}:${rangeEnd}:${tuning.minSegmentWeeks}:${tuning.latestSegmentMinWeeks}:${tuning.splitPenalty}:${tuning.maxSegmentWeeks}:${indicatorSettings.emaPeriod}:${indicatorSettings.smaPeriod}:${indicatorSettings.adxPeriod}:${indicatorSettings.adxTrendLevel}:${indicatorSettings.rsiPeriod}:${indicatorSettings.rsiUpper}:${indicatorSettings.rsiLower}:${indicatorSettings.bbPeriod}:${indicatorSettings.bbStdDev}:${indicatorSettings.returnZPeriod}:${indicatorSettings.returnUpper}:${indicatorSettings.returnLower}:${indicatorSettings.bbwPercentileWindow}:${indicatorSettings.bbwHigh}:${indicatorSettings.bbwLow}`;
  if (cachedBtcWeeklyResearch2Data && cachedBtcWeeklyResearch2CacheKey === cacheKey) {
    return cachedBtcWeeklyResearch2Data;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(databasePath, { open: true, readOnly: true });
    const symbol = "BTC";
    const weeklyFunding = db
      .prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week")
      .all(`${symbol}USD_PERP`) as Array<{ metric_week: string; weekly_funding_rate: number }>;
    const dailyVolumes = db
      .prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date")
      .all(`${symbol}USD_PERP`) as Array<{ metric_date: string; usd_volume: number }>;

    if (!weeklyFunding.length || !dailyVolumes.length) {
      return {
        symbol,
        timeframe: "week",
        points: [],
        segments: [],
        summaries: [],
        thresholds: withResearch2TuningSnapshot(buildResearch2Thresholds([]), tuning),
        indicatorSettings,
        latestObservedDate: "-",
        sourceLabel: "SQLite 无 BTC 周线研究页2数据",
        loadError: "BTC 周费率或成交量数据缺失。",
      };
    }

    const candles = loadBtcWeeklyCandles().filter((candle) => {
      if (rangeStart && candle.weekStart < rangeStart) return false;
      if (rangeEnd && candle.weekStart > rangeEnd) return false;
      return true;
    });
    const latestFundingDate = (db.prepare("SELECT MAX(metric_date) AS latest_date FROM daily_funding_metrics WHERE symbol = ?").get(`${symbol}USD_PERP`) as { latest_date: string | null }).latest_date;
    const latestVolumeDate = dailyVolumes.at(-1)?.metric_date ?? null;
    const latestObservedDate = [latestFundingDate, latestVolumeDate].filter((value): value is string => Boolean(value)).sort().at(-1) ?? "-";
    const result = {
      symbol,
      timeframe: "week" as const,
      ...buildBtcSevenRegimeResearch(candles, weeklyFunding, dailyVolumes, { tuning, indicatorSettings }),
      latestObservedDate,
      sourceLabel: "SQLite 周费率/周成交量 + 本地 BTC 周线 OHLC 缓存（按可用历史动态取交集）+ 七态自动体制规则",
    };
    cachedBtcWeeklyResearch2Data = result;
    cachedBtcWeeklyResearch2CacheKey = cacheKey;
    return result;
  } catch (error) {
    return {
      symbol: "BTC",
      timeframe: "week",
      points: [],
      segments: [],
      summaries: [],
      thresholds: withResearch2TuningSnapshot(buildResearch2Thresholds([]), tuning),
      indicatorSettings,
      latestObservedDate: "-",
      sourceLabel: "BTC 周线研究页2数据读取失败",
      loadError: error instanceof Error ? error.message : "unknown error",
    };
  } finally {
    db?.close();
  }
}
