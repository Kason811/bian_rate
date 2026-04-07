#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");
const POSITION_USD = 1000;
const RR = 1.5;
const WARMUP_WEEKS = 104;
const TUNING = {
  minSegmentWeeks: 8,
  latestSegmentMinWeeks: 4,
  splitPenalty: 7.8,
  maxSegmentWeeks: 40,
};

process.chdir(WEB_DIR);

const { getBtcWeeklyResearch2Data } = await import("../web/lib/sqlite-workbench-data.ts");

const candles = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "lib", "btc-weekly-klines.json"), "utf8")).map((row) => ({
  openTime: row[0],
  openPrice: Number(row[1]),
  highPrice: Number(row[2]),
  lowPrice: Number(row[3]),
  closePrice: Number(row[4]),
  closeTime: row[6],
  weekStart: new Date(row[0]).toISOString().slice(0, 10),
  weekEnd: new Date(row[6]).toISOString().slice(0, 10),
}));

const candleByWeekStart = new Map(candles.map((candle, index) => [candle.weekStart, { ...candle, index }]));

function familyToDirection(family) {
  if (family === "Bull") return 1;
  if (family === "Bear") return -1;
  return 0;
}

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function buildSignals(events) {
  return events
    .filter((event) => event.newFamily === "Bull" || event.newFamily === "Bear")
    .map((event) => ({
      ...event,
      direction: familyToDirection(event.newFamily),
    }))
    .sort((a, b) => a.entryIndex - b.entryIndex);
}

const weekStarts = candles.map((candle) => candle.weekStart);
const dataCache = new Map();

async function getDataByEndWeek(endWeek) {
  if (!dataCache.has(endWeek)) {
    dataCache.set(endWeek, await getBtcWeeklyResearch2Data({ tuning: TUNING, range: { endWeek } }));
  }
  return dataCache.get(endWeek);
}

const rawEvents = [];

for (let index = WARMUP_WEEKS; index < weekStarts.length - 1; index += 1) {
  const endWeek = weekStarts[index];
  const nextWeek = weekStarts[index + 1];
  const current = await getDataByEndWeek(endWeek);
  const next = await getDataByEndWeek(nextWeek);
  if (current.loadError || next.loadError) continue;
  if (current.segments.length < 2 || !current.points.length || !next.segments.length) continue;

  const lastSegment = current.segments.at(-1);
  const prevSegment = current.segments.at(-2);
  const lastPoint = current.points.at(-1);
  if (!lastSegment || !prevSegment || !lastPoint) continue;
  if (lastSegment.weeks !== TUNING.latestSegmentMinWeeks) continue;
  if (lastSegment.family === prevSegment.family) continue;

  const entryCandle = candleByWeekStart.get(nextWeek);
  if (!entryCandle) continue;
  const latestSegmentPoints = current.points.slice(-lastSegment.weeks);
  const segmentLow = Math.min(...latestSegmentPoints.map((point) => point.lowPrice));
  const segmentHigh = Math.max(...latestSegmentPoints.map((point) => point.highPrice));

  rawEvents.push({
    signalWeek: endWeek,
    entryWeek: nextWeek,
    entryIndex: entryCandle.index,
    previousFamily: prevSegment.family,
    newFamily: lastSegment.family,
    transition: `${prevSegment.family}->${lastSegment.family}`,
    signalClose: lastPoint.closePrice,
    signalHigh: lastPoint.highPrice,
    signalLow: lastPoint.lowPrice,
    signalEma21: lastPoint.ema21,
    signalSma200: lastPoint.sma200,
    signalAdx14: lastPoint.adx14,
    signalReturnZ52: lastPoint.returnZ52,
    segmentWeeks: lastSegment.weeks,
    segmentLow,
    segmentHigh,
  });
}

const signals = buildSignals(rawEvents);

const stopCandidates = [
  ...Array.from({ length: 17 }, (_, idx) => {
    const pct = 0.02 + idx * 0.005;
    return {
      name: `fixed_${(pct * 100).toFixed(1)}pct`,
      kind: "fixed_pct",
      pct,
      getStop(signal, entryPrice) {
        return signal.direction === 1 ? entryPrice * (1 - pct) : entryPrice * (1 + pct);
      },
    };
  }),
  {
    name: "signal_week_extreme",
    kind: "signal_extreme",
    getStop(signal) {
      return signal.direction === 1 ? signal.signalLow : signal.signalHigh;
    },
  },
  {
    name: "segment_extreme",
    kind: "segment_extreme",
    getStop(signal) {
      return signal.direction === 1 ? signal.segmentLow : signal.segmentHigh;
    },
  },
  {
    name: "ema21_anchor",
    kind: "ema21_anchor",
    getStop(signal) {
      return signal.signalEma21;
    },
  },
];

function evaluateCandidate(candidate) {
  const trades = [];
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;

  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index];
    const entryCandle = candles[signal.entryIndex];
    if (!entryCandle) continue;
    const entryPrice = entryCandle.openPrice;
    const stopPrice = candidate.getStop(signal, entryPrice);

    if (!Number.isFinite(stopPrice)) continue;
    if (signal.direction === 1 && stopPrice >= entryPrice) continue;
    if (signal.direction === -1 && stopPrice <= entryPrice) continue;

    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    if (!riskPerUnit || !Number.isFinite(riskPerUnit)) continue;

    const targetPrice = signal.direction === 1
      ? entryPrice + (riskPerUnit * RR)
      : entryPrice - (riskPerUnit * RR);

    let exitPrice = candles.at(-1)?.closePrice ?? entryPrice;
    let exitWeek = candles.at(-1)?.weekStart ?? signal.entryWeek;
    let exitReason = "last_close";

    const nextSignalEntryIndex = index + 1 < signals.length ? signals[index + 1].entryIndex : candles.length;

    for (let candleIndex = signal.entryIndex; candleIndex < Math.min(nextSignalEntryIndex, candles.length); candleIndex += 1) {
      const candle = candles[candleIndex];
      const stopHit = signal.direction === 1 ? candle.lowPrice <= stopPrice : candle.highPrice >= stopPrice;
      const targetHit = signal.direction === 1 ? candle.highPrice >= targetPrice : candle.lowPrice <= targetPrice;

      if (stopHit && targetHit) {
        exitPrice = stopPrice;
        exitWeek = candle.weekStart;
        exitReason = "stop_same_bar";
        break;
      }
      if (stopHit) {
        exitPrice = stopPrice;
        exitWeek = candle.weekStart;
        exitReason = "stop";
        break;
      }
      if (targetHit) {
        exitPrice = targetPrice;
        exitWeek = candle.weekStart;
        exitReason = "target";
        break;
      }
    }

    if (exitReason === "last_close" && nextSignalEntryIndex < candles.length) {
      exitPrice = candles[nextSignalEntryIndex].openPrice;
      exitWeek = candles[nextSignalEntryIndex].weekStart;
      exitReason = "next_signal_open";
    }

    const pnlUsd = POSITION_USD * signal.direction * ((exitPrice - entryPrice) / entryPrice);
    equity += pnlUsd;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peakEquity);

    trades.push({
      signalWeek: signal.signalWeek,
      entryWeek: signal.entryWeek,
      exitWeek,
      transition: signal.transition,
      side: signal.direction === 1 ? "LONG" : "SHORT",
      entryPrice: round(entryPrice, 2),
      stopPrice: round(stopPrice, 2),
      targetPrice: round(targetPrice, 2),
      exitPrice: round(exitPrice, 2),
      exitReason,
      pnlUsd: round(pnlUsd, 2),
      pnlPctOnNotional: round((pnlUsd / POSITION_USD) * 100, 3),
    });
  }

  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const losses = trades.filter((trade) => trade.pnlUsd < 0).length;
  const grossProfit = trades.filter((trade) => trade.pnlUsd > 0).reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlUsd < 0).reduce((sum, trade) => sum + trade.pnlUsd, 0));
  const netProfit = grossProfit - grossLoss;

  return {
    candidate: candidate.name,
    tuningKey: tuningKey(TUNING),
    tradeCount: trades.length,
    wins,
    losses,
    winRate: trades.length ? round(wins / trades.length, 4) : 0,
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    netProfit: round(netProfit, 2),
    avgPnlPerTrade: trades.length ? round(netProfit / trades.length, 2) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    maxDrawdownUsd: round(maxDrawdown, 2),
    trades,
  };
}

const evaluated = stopCandidates
  .map(evaluateCandidate)
  .filter((row) => row.tradeCount > 0)
  .sort((a, b) => {
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return a.maxDrawdownUsd - b.maxDrawdownUsd;
  });

const best = evaluated[0] ?? null;

const summary = {
  generatedAt: new Date().toISOString(),
  assumptions: {
    tuning: TUNING,
    positionUsd: POSITION_USD,
    riskReward: `1:${RR}`,
    entryRule: "Directional family signal (Bull/Bear only), enter next week open",
    exitRule: "Exit at stop, target, or next directional signal open",
    intrabarRule: "If stop and target hit in same weekly bar, stop wins",
  },
  directionalSignalCount: signals.length,
  evaluatedStops: evaluated.map((row) => ({
    candidate: row.candidate,
    tradeCount: row.tradeCount,
    winRate: row.winRate,
    netProfit: row.netProfit,
    avgPnlPerTrade: row.avgPnlPerTrade,
    profitFactor: row.profitFactor,
    maxDrawdownUsd: row.maxDrawdownUsd,
  })),
  best,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const jsonPath = path.join(OUTPUT_DIR, "2026-04-07-research2-8-4-directional-rr15-backtest.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const mdLines = [
  "# Research2 8-4 Directional RR1.5 Backtest",
  "",
  `生成时间: ${summary.generatedAt}`,
  "",
  `参数: min=${TUNING.minSegmentWeeks}, latestMin=${TUNING.latestSegmentMinWeeks}, penalty=${TUNING.splitPenalty}, max=${TUNING.maxSegmentWeeks}`,
  `交易方向: 只做 Bull / Bear 新家族信号，忽略 Sideways`,
  `入场: 信号后的下一周开盘`,
  `止盈: 1:1.5`,
  `每笔仓位: ${POSITION_USD}U`,
  `未命中止损止盈时: 下一次方向信号开盘平仓`,
  `同周同时触发止损止盈: 先按止损`,
  "",
  `方向信号数: ${signals.length}`,
  "",
  "## Stop Comparison",
  ...evaluated.map((row) => `- ${row.candidate}: trades=${row.tradeCount}, winRate=${(row.winRate * 100).toFixed(1)}%, net=${row.netProfit.toFixed(2)}U, avg=${row.avgPnlPerTrade.toFixed(2)}U, PF=${row.profitFactor ?? "-"}, maxDD=${row.maxDrawdownUsd.toFixed(2)}U`),
  "",
];

if (best) {
  mdLines.push("## Best Stop");
  mdLines.push(`- candidate: ${best.candidate}`);
  mdLines.push(`- trades: ${best.tradeCount}`);
  mdLines.push(`- winRate: ${(best.winRate * 100).toFixed(1)}%`);
  mdLines.push(`- netProfit: ${best.netProfit.toFixed(2)}U`);
  mdLines.push(`- avgPnlPerTrade: ${best.avgPnlPerTrade.toFixed(2)}U`);
  mdLines.push(`- profitFactor: ${best.profitFactor ?? "-"}`);
  mdLines.push(`- maxDrawdown: ${best.maxDrawdownUsd.toFixed(2)}U`);
  mdLines.push("");
  mdLines.push("## Trades");
  for (const trade of best.trades) {
    mdLines.push(`- ${trade.entryWeek} ${trade.side} ${trade.transition}: entry=${trade.entryPrice}, stop=${trade.stopPrice}, target=${trade.targetPrice}, exit=${trade.exitPrice}, reason=${trade.exitReason}, pnl=${trade.pnlUsd}U`);
  }
}

const mdPath = path.join(OUTPUT_DIR, "2026-04-07-research2-8-4-directional-rr15-backtest.md");
fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));
