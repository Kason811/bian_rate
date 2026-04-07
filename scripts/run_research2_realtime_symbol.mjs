#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs", "research2-realtime-batches");
const DB_PATH = path.resolve(ROOT_DIR, "data", "bian_rate.sqlite3");

process.chdir(WEB_DIR);

const {
  getBtcWeeklyResearch2Data,
  getResearchContractSymbol,
  loadResearchCandles,
  buildBtcSevenRegimeResearch,
  buildResearch2FromDailyMetrics,
} = await import("../web/lib/sqlite-workbench-data.ts");

const symbol = process.argv[2];
if (!symbol) {
  console.error("Usage: node scripts/run_research2_realtime_symbol.mjs <SYMBOL>");
  process.exit(1);
}

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
const WINDOW_BARS = {
  day: 365,
  "3day": 365,
  week: Number.POSITIVE_INFINITY,
};

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function summariseTransition(events, transition) {
  const rows = events.filter((event) => event.transition === transition);
  const continued = rows.filter((event) => event.familyContinuedNew).length;
  const reverted = rows.filter((event) => event.familyReverted).length;
  return {
    transition,
    transitionLabel: transitionToChinese(transition),
    count: rows.length,
    continuedRate: rows.length ? round(continued / rows.length) : 0,
    revertedRate: rows.length ? round(reverted / rows.length) : 0,
    avgTrendScore: round(mean(rows.map((event) => event.trendScore)), 3),
    avgLeverageScore: round(mean(rows.map((event) => event.leverageScore)), 3),
    avgParticipationScore: round(mean(rows.map((event) => event.participationScore)), 3),
  };
}

function aggregateRows(rows) {
  const summaryRows = [];
  for (const timeframe of TIMEFRAMES) {
    for (const tuning of TUNINGS) {
      const scoped = rows.filter((row) => row.timeframe === timeframe && row.tuningKey === tuningKey(tuning));
      summaryRows.push({
        timeframe,
        tuning,
        tuningKey: tuningKey(tuning),
        totalEvents: scoped.length,
        familyContinuationRate: scoped.length ? round(scoped.filter((row) => row.familyContinuedNew).length / scoped.length) : 0,
        familyReversionRate: scoped.length ? round(scoped.filter((row) => row.familyReverted).length / scoped.length) : 0,
        avgTrendScore: round(mean(scoped.map((row) => row.trendScore)), 3),
        avgLeverageScore: round(mean(scoped.map((row) => row.leverageScore)), 3),
        avgParticipationScore: round(mean(scoped.map((row) => row.participationScore)), 3),
        transitions: TRANSITION_ORDER.map((transition) => summariseTransition(scoped, transition))
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
  const bestOverall = [...summaryRows].sort((left, right) => {
    if (right.familyContinuationRate !== left.familyContinuationRate) return right.familyContinuationRate - left.familyContinuationRate;
    return right.totalEvents - left.totalEvents;
  })[0] ?? null;
  return { summaryRows, bestByTimeframe, bestOverall };
}

function buildAggregateMarkdown(summary, title) {
  const lines = [
    `# ${title}`,
    "",
    `生成时间: ${summary.generatedAt}`,
    `模式: ${summary.mode}`,
    `总事件数: ${summary.totalEvents}`,
    "",
  ];
  if (summary.bestOverall) {
    lines.push(`- 全部组合最佳: ${summary.bestOverall.timeframe} / ${summary.bestOverall.tuningKey}, 机会=${summary.bestOverall.totalEvents}, 延续率=${pct(summary.bestOverall.familyContinuationRate)}, 打回率=${pct(summary.bestOverall.familyReversionRate)}`);
    lines.push("");
  }
  for (const item of summary.bestByTimeframe) {
    if (!item.best) continue;
    lines.push(`## ${item.timeframe}`);
    lines.push(`- 最优: ${item.best.tuningKey}, 机会=${item.best.totalEvents}, 延续率=${pct(item.best.familyContinuationRate)}, 打回率=${pct(item.best.familyReversionRate)}`);
    if (item.runnerUp) {
      lines.push(`- 次优: ${item.runnerUp.tuningKey}, 机会=${item.runnerUp.totalEvents}, 延续率=${pct(item.runnerUp.familyContinuationRate)}, 打回率=${pct(item.runnerUp.familyReversionRate)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const db = new DatabaseSync(DB_PATH, { open: true, readOnly: true });
const fundingStmt = db.prepare("SELECT metric_date, daily_funding_rate FROM daily_funding_metrics WHERE symbol = ? ORDER BY metric_date");
const volumeStmt = db.prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date");
const weeklyFundingStmt = db.prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week");

const sourceCache = new Map();
function getSource(currentSymbol, marketType, timeframe) {
  const key = `${currentSymbol}:${marketType}:${timeframe}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const contractSymbol = getResearchContractSymbol(currentSymbol, marketType);
  const source = {
    candles: loadResearchCandles(currentSymbol, marketType, timeframe),
    dailyFunding: fundingStmt.all(contractSymbol),
    dailyVolumes: volumeStmt.all(contractSymbol),
    weeklyFunding: timeframe === "week" ? weeklyFundingStmt.all(contractSymbol) : [],
  };
  sourceCache.set(key, source);
  return source;
}

function buildRealtimeSlice(source, timeframe, endIndex) {
  const bars = WINDOW_BARS[timeframe];
  const startIndex = Number.isFinite(bars) ? Math.max(0, endIndex - bars + 1) : 0;
  const candles = source.candles.slice(startIndex, endIndex + 1);
  const startWeek = candles[0]?.weekStart;
  const endWeek = candles.at(-1)?.weekEnd;
  if (!startWeek || !endWeek) return null;
  const dailyFunding = source.dailyFunding.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  const dailyVolumes = source.dailyVolumes.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  const weeklyFunding = timeframe === "week"
    ? source.weeklyFunding.filter((row) => row.metric_week.slice(0, 10) >= startWeek && row.metric_week.slice(0, 10) <= candles.at(-1).weekStart)
    : [];
  return { candles, dailyFunding, dailyVolumes, weeklyFunding };
}

const realtimeCache = new Map();
function getRealtimeResearch(currentSymbol, marketType, timeframe, tuning, endIndex) {
  const key = `${currentSymbol}:${marketType}:${timeframe}:${tuningKey(tuning)}:${endIndex}`;
  if (realtimeCache.has(key)) return realtimeCache.get(key);
  const source = getSource(currentSymbol, marketType, timeframe);
  const slice = buildRealtimeSlice(source, timeframe, endIndex);
  if (!slice) {
    realtimeCache.set(key, null);
    return null;
  }
  const built = timeframe === "week"
    ? buildBtcSevenRegimeResearch(slice.candles, slice.weeklyFunding, slice.dailyVolumes, { tuning })
    : buildResearch2FromDailyMetrics(slice.candles, slice.dailyFunding, slice.dailyVolumes, { tuning });
  realtimeCache.set(key, built);
  return built;
}

const seed = await getBtcWeeklyResearch2Data({
  marketType: "usdtm",
  timeframe: "week",
  symbol,
  tuning: TUNINGS[0],
});
if (seed.loadError && !seed.availableSymbols?.includes?.(symbol)) {
  console.error(`[skip] ${symbol} unavailable: ${seed.loadError}`);
  process.exit(2);
}

ensureDir(OUTPUT_DIR);

const symbolRows = [];
for (const timeframe of TIMEFRAMES) {
  for (const marketType of MARKETS) {
    const fullSeed = await getBtcWeeklyResearch2Data({
      marketType,
      timeframe,
      symbol,
      tuning: TUNINGS[0],
    });
    if (fullSeed.loadError) continue;

    const pointIndexByStartSeed = new Map(fullSeed.points.map((point, index) => [point.weekStart, index]));
    for (const tuning of TUNINGS) {
      const full = tuning === TUNINGS[0]
        ? fullSeed
        : await getBtcWeeklyResearch2Data({ marketType, timeframe, symbol, tuning });
      if (full.loadError || full.points.length < tuning.latestSegmentMinWeeks + 1) continue;
      const pointIndexByStart = tuning === TUNINGS[0] ? pointIndexByStartSeed : new Map(full.points.map((point, index) => [point.weekStart, index]));

      for (let segmentIndex = 1; segmentIndex < full.segments.length; segmentIndex += 1) {
        const previousSegment = full.segments[segmentIndex - 1];
        const segment = full.segments[segmentIndex];
        if (segment.family === previousSegment.family) continue;
        const startIndex = pointIndexByStart.get(segment.start);
        if (startIndex === undefined) continue;
        const eventIndex = startIndex + tuning.latestSegmentMinWeeks - 1;
        if (eventIndex + 1 >= full.points.length) continue;

        const current = getRealtimeResearch(symbol, marketType, timeframe, tuning, eventIndex);
        const next = getRealtimeResearch(symbol, marketType, timeframe, tuning, eventIndex + 1);
        if (!current || !next || current.segments.length < 2 || !current.points.length || !next.segments.length) continue;

        const lastSegment = current.segments.at(-1);
        const prevSegment = current.segments.at(-2);
        const nextLastSegment = next.segments.at(-1);
        const lastPoint = current.points.at(-1);
        if (!lastSegment || !prevSegment || !nextLastSegment || !lastPoint) continue;
        if (lastSegment.weeks !== tuning.latestSegmentMinWeeks) continue;
        if (lastSegment.family === prevSegment.family) continue;

        symbolRows.push({
          symbol,
          timeframe,
          marketType,
          tuningKey: tuningKey(tuning),
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
}

const symbolAggregate = aggregateRows(symbolRows);
const symbolPayload = {
  generatedAt: new Date().toISOString(),
  mode: "realtime-window-rebuild-candidates-batched",
  symbol,
  totalEvents: symbolRows.length,
  ...symbolAggregate,
  rows: symbolRows,
};

writeJson(path.join(OUTPUT_DIR, `${symbol}.json`), symbolPayload);
fs.writeFileSync(path.join(OUTPUT_DIR, `${symbol}.md`), buildAggregateMarkdown(symbolPayload, `Research2 Realtime Batches ${symbol}`), "utf8");
console.log(JSON.stringify({ symbol, events: symbolRows.length }, null, 2));
