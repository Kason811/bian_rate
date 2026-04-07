#!/usr/bin/env node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const DB_PATH = path.resolve(ROOT_DIR, "data", "bian_rate.sqlite3");

process.chdir(WEB_DIR);

const {
  getBtcWeeklyResearch2Data,
  getResearchContractSymbol,
  loadResearchCandles,
  buildBtcSevenRegimeResearch,
  buildResearch2FromDailyMetrics,
} = await import("../web/lib/sqlite-workbench-data.ts");

const TUNINGS = [
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 2, splitPenalty: 7.8, maxSegmentWeeks: 40 },
];
const MARKETS = ["usdtm", "coinm"];
const TIMEFRAMES = ["day", "3day", "week"];
const TRANSITION_ORDER = [
  "Bull->Sideways",
  "Bear->Sideways",
  "Sideways->Bull",
  "Sideways->Bear",
  "Bull->Bear",
  "Bear->Bull",
];

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function familyToChinese(family) {
  if (family === "Bull") return "牛";
  if (family === "Bear") return "熊";
  return "震荡灰";
}

function transitionToChinese(transition) {
  const [from, to] = transition.split("->");
  return `${familyToChinese(from)} -> ${familyToChinese(to)}`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pushMapArray(map, key, value) {
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function summariseTransition(events, transition) {
  const rows = events.filter((event) => event.transition === transition);
  return {
    transition,
    transitionLabel: transitionToChinese(transition),
    count: rows.length,
    continuedRate: rows.length ? round(rows.filter((event) => event.familyContinuedNew).length / rows.length) : 0,
    revertedRate: rows.length ? round(rows.filter((event) => event.familyReverted).length / rows.length) : 0,
    avgTrendScore: round(mean(rows.map((event) => event.trendScore)), 3),
    avgLeverageScore: round(mean(rows.map((event) => event.leverageScore)), 3),
    avgParticipationScore: round(mean(rows.map((event) => event.participationScore)), 3),
  };
}

const datasetSeeds = [];
for (const timeframe of TIMEFRAMES) {
  for (const marketType of MARKETS) {
    const seed = await getBtcWeeklyResearch2Data({
      marketType,
      timeframe,
      symbol: "BTC",
      tuning: TUNINGS[0],
    });
    if (seed.loadError) continue;
    for (const symbol of seed.availableSymbols) {
      datasetSeeds.push({ marketType, timeframe, symbol });
    }
  }
}

const db = new DatabaseSync(DB_PATH, { open: true, readOnly: true });
const fundingStmt = db.prepare("SELECT metric_date, daily_funding_rate FROM daily_funding_metrics WHERE symbol = ? ORDER BY metric_date");
const volumeStmt = db.prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date");
const weeklyFundingStmt = db.prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week");

const sourceCache = new Map();
function getSource(dataset) {
  const key = `${dataset.marketType}:${dataset.timeframe}:${dataset.symbol}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const contractSymbol = getResearchContractSymbol(dataset.symbol, dataset.marketType);
  const source = {
    candles: loadResearchCandles(dataset.symbol, dataset.marketType, dataset.timeframe),
    dailyFunding: fundingStmt.all(contractSymbol),
    dailyVolumes: volumeStmt.all(contractSymbol),
    weeklyFunding: dataset.timeframe === "week" ? weeklyFundingStmt.all(contractSymbol) : [],
  };
  sourceCache.set(key, source);
  return source;
}

function buildPrefixResearch(dataset, source, tuning, endIndex) {
  const prefixCandles = source.candles.slice(0, endIndex + 1);
  const endWeekStart = prefixCandles.at(-1)?.weekStart;
  const endWeekEnd = prefixCandles.at(-1)?.weekEnd;
  if (!endWeekStart || !endWeekEnd) return null;
  const dailyFunding = source.dailyFunding.filter((row) => row.metric_date <= endWeekEnd);
  const dailyVolumes = source.dailyVolumes.filter((row) => row.metric_date <= endWeekEnd);
  if (dataset.timeframe === "week") {
    const weeklyFunding = source.weeklyFunding.filter((row) => row.metric_week.slice(0, 10) <= endWeekStart);
    return buildBtcSevenRegimeResearch(prefixCandles, weeklyFunding, dailyVolumes, { tuning });
  }
  return buildResearch2FromDailyMetrics(prefixCandles, dailyFunding, dailyVolumes, { tuning });
}

const prefixCache = new Map();
function getPrefixResearch(dataset, source, tuning, endIndex) {
  const key = `${dataset.marketType}:${dataset.timeframe}:${dataset.symbol}:${tuningKey(tuning)}:${endIndex}`;
  if (!prefixCache.has(key)) {
    prefixCache.set(key, buildPrefixResearch(dataset, source, tuning, endIndex));
  }
  return prefixCache.get(key);
}

const rows = [];

for (const tuning of TUNINGS) {
  for (const dataset of datasetSeeds) {
    const full = await getBtcWeeklyResearch2Data({
      marketType: dataset.marketType,
      timeframe: dataset.timeframe,
      symbol: dataset.symbol,
      tuning,
    });
    if (full.loadError || full.points.length < tuning.latestSegmentMinWeeks + 1) continue;
    const source = getSource(dataset);
    const pointIndexByStart = new Map(full.points.map((point, index) => [point.weekStart, index]));

    for (let segIndex = 1; segIndex < full.segments.length; segIndex += 1) {
      const previousSegment = full.segments[segIndex - 1];
      const segment = full.segments[segIndex];
      if (segment.family === previousSegment.family) continue;
      const startIndex = pointIndexByStart.get(segment.start);
      if (startIndex === undefined) continue;
      const eventIndex = startIndex + tuning.latestSegmentMinWeeks - 1;
      if (eventIndex + 1 >= full.points.length) continue;

      const current = getPrefixResearch(dataset, source, tuning, eventIndex);
      const next = getPrefixResearch(dataset, source, tuning, eventIndex + 1);
      if (!current || !next || current.segments.length < 2 || next.segments.length < 1) continue;

      const lastSegment = current.segments.at(-1);
      const prevSegment = current.segments.at(-2);
      const nextLastSegment = next.segments.at(-1);
      const lastPoint = current.points.at(-1);
      if (!lastSegment || !prevSegment || !nextLastSegment || !lastPoint) continue;
      if (lastSegment.weeks !== tuning.latestSegmentMinWeeks) continue;
      if (lastSegment.family === prevSegment.family) continue;

      rows.push({
        timeframe: dataset.timeframe,
        marketType: dataset.marketType,
        symbol: dataset.symbol,
        tuningKey: tuningKey(tuning),
        tuning,
        transition: `${prevSegment.family}->${lastSegment.family}`,
        familyContinuedNew: nextLastSegment.family === lastSegment.family,
        familyReverted: nextLastSegment.family === prevSegment.family,
        trendScore: lastPoint.trendScore,
        leverageScore: lastPoint.leverageScore,
        participationScore: lastPoint.participationScore,
      });
    }
  }
}

const summaryRows = [];
for (const timeframe of TIMEFRAMES) {
  for (const tuning of TUNINGS) {
    const tuningRows = rows.filter((row) => row.timeframe === timeframe && row.tuningKey === tuningKey(tuning));
    summaryRows.push({
      timeframe,
      tuning,
      tuningKey: tuningKey(tuning),
      totalEvents: tuningRows.length,
      familyContinuationRate: tuningRows.length ? round(tuningRows.filter((row) => row.familyContinuedNew).length / tuningRows.length) : 0,
      familyReversionRate: tuningRows.length ? round(tuningRows.filter((row) => row.familyReverted).length / tuningRows.length) : 0,
      avgTrendScore: round(mean(tuningRows.map((row) => row.trendScore)), 3),
      avgLeverageScore: round(mean(tuningRows.map((row) => row.leverageScore)), 3),
      avgParticipationScore: round(mean(tuningRows.map((row) => row.participationScore)), 3),
      transitions: TRANSITION_ORDER.map((transition) => summariseTransition(tuningRows, transition))
        .sort((left, right) => right.continuedRate - left.continuedRate || right.count - left.count),
    });
  }
}

const bestByTimeframe = TIMEFRAMES.map((timeframe) => {
  const candidates = summaryRows
    .filter((row) => row.timeframe === timeframe)
    .sort((left, right) => right.familyContinuationRate - left.familyContinuationRate || right.totalEvents - left.totalEvents);
  return { timeframe, best: candidates[0] ?? null, runnerUp: candidates[1] ?? null };
});

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  datasetCount: datasetSeeds.length,
  exactCandidateEvents: rows.length,
  bestByTimeframe,
  rows: summaryRows,
}, null, 2));
