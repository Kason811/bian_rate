import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AuditRow,
  type BtcWeeklyResearchData,
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
