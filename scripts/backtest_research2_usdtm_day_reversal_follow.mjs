#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");

process.chdir(WEB_DIR);

const {
  getBtcWeeklyResearch2Data,
  getResearchContractSymbol,
  loadResearchCandles,
  buildResearch2FromDailyMetrics,
} = await import(pathToFileURL(path.join(WEB_DIR, "lib/sqlite-workbench-data.ts")).href);

const { DatabaseSync } = await import("node:sqlite");

const DB_PATH = path.resolve(ROOT_DIR, "data", "bian_rate.sqlite3");
const db = new DatabaseSync(DB_PATH, { open: true, readOnly: true });
const fundingStmt = db.prepare("SELECT metric_date, daily_funding_rate FROM daily_funding_metrics WHERE symbol = ? ORDER BY metric_date");
const volumeStmt = db.prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date");

const MARKET = "usdtm";
const TIMEFRAME = "day";
const WINDOW_BARS = 500;
const NOTIONAL_USD = 1000;
const TUNINGS = [
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 2, splitPenalty: 7.8, maxSegmentWeeks: 40 },
];
const ALLOWED_TRANSITIONS = new Set([
  "Sideways->Bull",
  "Sideways->Bear",
  "Bull->Bear",
  "Bear->Bull",
]);

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

const TUNING_FILTER = process.env.TUNING_FILTER?.trim() || "";
const ACTIVE_TUNINGS = TUNING_FILTER
  ? TUNINGS.filter((tuning) => tuningKey(tuning) === TUNING_FILTER)
  : TUNINGS;
const OUTPUT_STEM = process.env.OUTPUT_STEM?.trim() || "2026-04-07-usdtm-day-reversal-follow-trade";

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function getDirectionForFamily(family) {
  return family === "Bull" ? "long" : family === "Bear" ? "short" : null;
}

function calculatePnl(direction, entryPrice, exitPrice, notional = NOTIONAL_USD) {
  const rawReturn = direction === "long"
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  return {
    returnPct: round(rawReturn * 100, 4),
    pnlUsd: round(rawReturn * notional, 4),
  };
}

function summariseTrades(trades) {
  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const losses = trades.filter((trade) => trade.pnlUsd < 0);
  const grossProfitUsd = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLossUsdAbs = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsd, 0));
  const netPnlUsd = grossProfitUsd - grossLossUsdAbs;
  const totalReturnPct = trades.reduce((sum, trade) => sum + trade.returnPct, 0);
  const avgHoldBars = trades.length ? trades.reduce((sum, trade) => sum + trade.holdBars, 0) / trades.length : 0;
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round(wins.length / trades.length) : 0,
    grossProfitUsd: round(grossProfitUsd, 2),
    grossLossUsdAbs: round(grossLossUsdAbs, 2),
    netPnlUsd: round(netPnlUsd, 2),
    avgReturnPct: trades.length ? round(totalReturnPct / trades.length, 4) : 0,
    avgHoldBars: round(avgHoldBars, 2),
    profitFactor: grossLossUsdAbs > 0 ? round(grossProfitUsd / grossLossUsdAbs, 4) : null,
  };
}

function buildMarkdown(result) {
  const lines = [
    "# USDT-M 日线 趋势翻转 实时重构持仓回测",
    "",
    `生成时间: ${result.generatedAt}`,
    "测试口径:",
    "- 开启“实时重构图表”",
    "- 覆盖范围: `USDT-M / day / 22币`",
    "- 实时重构窗口: `500根K线`",
    "- 只做 `震荡灰 -> 牛`、`震荡灰 -> 熊`、`牛 -> 熊`、`熊 -> 牛`",
    "- 新家族是牛则做多，新家族是熊则做空",
    "- 信号确认后于下一根 `日K` 开盘价进场",
    "- 后续每根 `日K` 收盘都按实时重构重算；最新家族不再延续入场时的牛/熊家族即平仓",
    "- 不计手续费、滑点，单笔名义仓位 `1000U`",
    "",
  ];

  for (const item of result.byTuning) {
    lines.push(`## ${item.tuningKey}`);
    lines.push(`- 总机会: ${item.summary.trades}`);
    lines.push(`- 胜率: ${pct(item.summary.winRate)}`);
    lines.push(`- 总盈亏: ${item.summary.netPnlUsd.toFixed(2)}U`);
    lines.push(`- 总盈利: ${item.summary.grossProfitUsd.toFixed(2)}U`);
    lines.push(`- 总亏损: ${item.summary.grossLossUsdAbs.toFixed(2)}U`);
    lines.push(`- 平均单笔收益: ${item.summary.avgReturnPct.toFixed(2)}%`);
    lines.push(`- 平均持仓K数: ${item.summary.avgHoldBars.toFixed(2)}`);
    if (item.summary.profitFactor !== null) {
      lines.push(`- Profit Factor: ${item.summary.profitFactor.toFixed(2)}`);
    }
    lines.push(`- 做多: ${item.longSummary.trades} 笔, 胜率 ${pct(item.longSummary.winRate)}, 净盈亏 ${item.longSummary.netPnlUsd.toFixed(2)}U`);
    lines.push(`- 做空: ${item.shortSummary.trades} 笔, 胜率 ${pct(item.shortSummary.winRate)}, 净盈亏 ${item.shortSummary.netPnlUsd.toFixed(2)}U`);
    lines.push(`- 灰->牛/熊: ${item.sidewaysSummary.trades} 笔, 胜率 ${pct(item.sidewaysSummary.winRate)}, 净盈亏 ${item.sidewaysSummary.netPnlUsd.toFixed(2)}U`);
    lines.push(`- 牛熊互切: ${item.directFlipSummary.trades} 笔, 胜率 ${pct(item.directFlipSummary.winRate)}, 净盈亏 ${item.directFlipSummary.netPnlUsd.toFixed(2)}U`);
    lines.push("");
  }

  lines.push("## 结论");
  if (result.bestByWinRate) {
    lines.push(`- 胜率最佳: ${result.bestByWinRate.tuningKey}, ${pct(result.bestByWinRate.summary.winRate)}, 机会 ${result.bestByWinRate.summary.trades}`);
  }
  if (result.bestByNetPnl) {
    lines.push(`- 净盈亏最佳: ${result.bestByNetPnl.tuningKey}, ${result.bestByNetPnl.summary.netPnlUsd.toFixed(2)}U, 胜率 ${pct(result.bestByNetPnl.summary.winRate)}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

const sourceCache = new Map();
function getSource(symbol) {
  const key = `${symbol}:${MARKET}:${TIMEFRAME}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const contractSymbol = getResearchContractSymbol(symbol, MARKET);
  const source = {
    candles: loadResearchCandles(symbol, MARKET, TIMEFRAME),
    dailyFunding: fundingStmt.all(contractSymbol),
    dailyVolumes: volumeStmt.all(contractSymbol),
  };
  sourceCache.set(key, source);
  return source;
}

function buildRealtimeSlice(source, endIndex) {
  const startIndex = Math.max(0, endIndex - WINDOW_BARS + 1);
  const candles = source.candles.slice(startIndex, endIndex + 1);
  const startWeek = candles[0]?.weekStart;
  const endWeek = candles.at(-1)?.weekEnd;
  if (!startWeek || !endWeek) return null;
  const dailyFunding = source.dailyFunding.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  const dailyVolumes = source.dailyVolumes.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  return { candles, dailyFunding, dailyVolumes };
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const seed = await getBtcWeeklyResearch2Data({
    marketType: MARKET,
    timeframe: TIMEFRAME,
    symbol: "ETH",
    tuning: TUNINGS[0],
  });
  const symbols = [...(seed.availableSymbols ?? [])];
  const byTuning = [];

  for (const tuning of ACTIVE_TUNINGS) {
    const key = tuningKey(tuning);
    const tuningTrades = [];

    for (const symbol of symbols) {
      const source = getSource(symbol);
      if (!source.candles.length || source.candles.length <= tuning.latestSegmentMinWeeks + 1) continue;

      const full = await getBtcWeeklyResearch2Data({
        marketType: MARKET,
        timeframe: TIMEFRAME,
        symbol,
        tuning,
      });
      if (full.loadError || full.segments.length < 2 || !full.points.length) continue;

      const pointIndexByStart = new Map(full.points.map((point, index) => [point.weekStart, index]));
      const candidates = [];
      for (let segmentIndex = 1; segmentIndex < full.segments.length; segmentIndex += 1) {
        const previousSegment = full.segments[segmentIndex - 1];
        const segment = full.segments[segmentIndex];
        const transition = `${previousSegment.family}->${segment.family}`;
        if (!ALLOWED_TRANSITIONS.has(transition)) continue;
        const startIndex = pointIndexByStart.get(segment.start);
        if (startIndex === undefined) continue;
        const signalIndex = startIndex + tuning.latestSegmentMinWeeks - 1;
        if (signalIndex + 1 >= source.candles.length) continue;
        candidates.push({ signalIndex, expectedFamily: segment.family, transition });
      }

      const realtimeCache = new Map();
      const getRealtimeResearch = (endIndex) => {
        const cacheKey = `${symbol}:${key}:${endIndex}`;
        if (realtimeCache.has(cacheKey)) return realtimeCache.get(cacheKey);
        const slice = buildRealtimeSlice(source, endIndex);
        if (!slice) {
          realtimeCache.set(cacheKey, null);
          return null;
        }
        let built = null;
        try {
          built = buildResearch2FromDailyMetrics(slice.candles, slice.dailyFunding, slice.dailyVolumes, { tuning });
        } catch {
          built = null;
        }
        realtimeCache.set(cacheKey, built);
        return built;
      };

      let blockedUntilIndex = -1;
      for (const candidate of candidates) {
        if (candidate.signalIndex <= blockedUntilIndex) continue;

        const current = getRealtimeResearch(candidate.signalIndex);
        if (!current || current.segments.length < 2 || !current.points.length) continue;
        const lastSegment = current.segments.at(-1);
        const prevSegment = current.segments.at(-2);
        const lastPoint = current.points.at(-1);
        const currentCandle = source.candles[candidate.signalIndex];
        if (!lastSegment || !prevSegment || !lastPoint || !currentCandle) continue;

        const transition = `${prevSegment.family}->${lastSegment.family}`;
        const isSignal =
          lastSegment.weeks === tuning.latestSegmentMinWeeks &&
          transition === candidate.transition &&
          lastSegment.family === candidate.expectedFamily &&
          (lastSegment.family === "Bull" || lastSegment.family === "Bear");
        if (!isSignal) continue;

        const entryIndex = candidate.signalIndex + 1;
        if (entryIndex >= source.candles.length || entryIndex <= blockedUntilIndex) continue;

        const entryCandle = source.candles[entryIndex];
        const direction = getDirectionForFamily(lastSegment.family);
        let exitIndex = source.candles.length - 1;
        let exitFamily = lastSegment.family;
        let exitReason = "final_bar";

        for (let endIndex = entryIndex; endIndex < source.candles.length; endIndex += 1) {
          const probe = getRealtimeResearch(endIndex);
          const probeLastSegment = probe?.segments?.at(-1);
          if (!probeLastSegment) continue;
          if (probeLastSegment.family !== lastSegment.family) {
            exitIndex = endIndex;
            exitFamily = probeLastSegment.family;
            exitReason = "family_not_continued";
            break;
          }
        }

        const exitCandle = source.candles[exitIndex];
        if (!entryCandle || !exitCandle) continue;
        const { returnPct, pnlUsd } = calculatePnl(direction, entryCandle.openPrice, exitCandle.closePrice);
        tuningTrades.push({
          symbol,
          tuningKey: key,
          transition,
          direction,
          signalDate: currentCandle.weekEnd,
          entryDate: entryCandle.weekStart,
          exitDate: exitCandle.weekEnd,
          entryPrice: round(entryCandle.openPrice, 6),
          exitPrice: round(exitCandle.closePrice, 6),
          returnPct,
          pnlUsd,
          holdBars: exitIndex - entryIndex + 1,
          exitFamily,
          exitFamilyLabel: familyToChinese(exitFamily),
          exitReason,
          trendScore: lastPoint.trendScore,
          leverageScore: lastPoint.leverageScore,
          participationScore: lastPoint.participationScore,
        });
        blockedUntilIndex = exitIndex;
      }
    }

    const longTrades = tuningTrades.filter((trade) => trade.direction === "long");
    const shortTrades = tuningTrades.filter((trade) => trade.direction === "short");
    const sidewaysTrades = tuningTrades.filter((trade) => trade.transition.startsWith("Sideways->"));
    const directFlipTrades = tuningTrades.filter((trade) => trade.transition === "Bull->Bear" || trade.transition === "Bear->Bull");
    byTuning.push({
      tuning,
      tuningKey: key,
      summary: summariseTrades(tuningTrades),
      longSummary: summariseTrades(longTrades),
      shortSummary: summariseTrades(shortTrades),
      sidewaysSummary: summariseTrades(sidewaysTrades),
      directFlipSummary: summariseTrades(directFlipTrades),
      topWinners: [...tuningTrades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 10),
      topLosers: [...tuningTrades].sort((a, b) => a.pnlUsd - b.pnlUsd).slice(0, 10),
      trades: tuningTrades,
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: "realtime-window-rebuild-day-follow-trade",
    marketType: MARKET,
    timeframe: TIMEFRAME,
    windowBars: WINDOW_BARS,
    symbols,
    notionalUsdPerTrade: NOTIONAL_USD,
    allowedTransitions: [...ALLOWED_TRANSITIONS],
    byTuning,
    bestByWinRate: [...byTuning].sort((a, b) => b.summary.winRate - a.summary.winRate || b.summary.trades - a.summary.trades)[0] ?? null,
    bestByNetPnl: [...byTuning].sort((a, b) => b.summary.netPnlUsd - a.summary.netPnlUsd || b.summary.winRate - a.summary.winRate)[0] ?? null,
  };

  const jsonPath = path.join(OUTPUT_DIR, `${OUTPUT_STEM}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${OUTPUT_STEM}.md`);
  writeJson(jsonPath, payload);
  fs.writeFileSync(mdPath, buildMarkdown(payload), "utf8");
  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    bestByWinRate: payload.bestByWinRate?.tuningKey,
    bestByNetPnl: payload.bestByNetPnl?.tuningKey,
  }, null, 2));
}

await main();
