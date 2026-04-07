#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");

process.chdir(WEB_DIR);

const { loadResearchCandles } = await import(pathToFileURL(path.join(WEB_DIR, "lib/sqlite-workbench-data.ts")).href);

const INPUT_FILES = [
  "2026-04-07-usdtm-day-reversal-follow-trade-7-4-7.8-40.json",
  "2026-04-07-usdtm-day-reversal-follow-trade-6-3-7.8-40.json",
  "2026-04-07-usdtm-day-reversal-follow-trade-6-2-7.8-40.json",
];

const FILTERS = [
  {
    key: "baseline",
    label: "不过滤",
    test: () => true,
  },
  {
    key: "trend_align",
    label: "趋势复合同向",
    test: (trade) => (trade.direction === "long" ? trade.trendScore > 0 : trade.trendScore < 0),
  },
  {
    key: "leverage_align",
    label: "杠杆复合同向",
    test: (trade) => (trade.direction === "long" ? trade.leverageScore > 0 : trade.leverageScore < 0),
  },
  {
    key: "participation_align",
    label: "参与复合同向",
    test: (trade) => (trade.direction === "long" ? trade.participationScore > 0 : trade.participationScore < 0),
  },
  {
    key: "two_of_three_align",
    label: "三复合至少两项同向",
    test: (trade) => {
      const signs = [
        trade.direction === "long" ? trade.trendScore > 0 : trade.trendScore < 0,
        trade.direction === "long" ? trade.leverageScore > 0 : trade.leverageScore < 0,
        trade.direction === "long" ? trade.participationScore > 0 : trade.participationScore < 0,
      ];
      return signs.filter(Boolean).length >= 2;
    },
  },
  {
    key: "all_three_align",
    label: "三复合全部同向",
    test: (trade) => {
      const signs = [
        trade.direction === "long" ? trade.trendScore > 0 : trade.trendScore < 0,
        trade.direction === "long" ? trade.leverageScore > 0 : trade.leverageScore < 0,
        trade.direction === "long" ? trade.participationScore > 0 : trade.participationScore < 0,
      ];
      return signs.every(Boolean);
    },
  },
  {
    key: "sum3_align",
    label: "三复合合计同向",
    test: (trade) => {
      const total = trade.trendScore + trade.leverageScore + trade.participationScore;
      return trade.direction === "long" ? total > 0 : total < 0;
    },
  },
  {
    key: "sum3_strong",
    label: "三复合合计强同向(|sum|>=1)",
    test: (trade) => {
      const total = trade.trendScore + trade.leverageScore + trade.participationScore;
      return trade.direction === "long" ? total >= 1 : total <= -1;
    },
  },
];

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

const candleCache = new Map();
function getCandles(symbol) {
  if (candleCache.has(symbol)) return candleCache.get(symbol);
  const candles = loadResearchCandles(symbol, "usdtm", "day");
  candleCache.set(symbol, candles);
  return candles;
}

function enrichTrade(trade) {
  const candles = getCandles(trade.symbol);
  const entryIndex = candles.findIndex((candle) => candle.weekStart === trade.entryDate);
  const exitIndex = candles.findIndex((candle) => candle.weekEnd === trade.exitDate);
  if (entryIndex === -1 || exitIndex === -1 || exitIndex < entryIndex) {
    return { ...trade, maePct: null, mfePct: null };
  }
  const span = candles.slice(entryIndex, exitIndex + 1);
  const minLow = Math.min(...span.map((candle) => candle.lowPrice));
  const maxHigh = Math.max(...span.map((candle) => candle.highPrice));
  let maePct = 0;
  let mfePct = 0;
  if (trade.direction === "long") {
    maePct = Math.max(0, ((trade.entryPrice - minLow) / trade.entryPrice) * 100);
    mfePct = Math.max(0, ((maxHigh - trade.entryPrice) / trade.entryPrice) * 100);
  } else {
    maePct = Math.max(0, ((maxHigh - trade.entryPrice) / trade.entryPrice) * 100);
    mfePct = Math.max(0, ((trade.entryPrice - minLow) / trade.entryPrice) * 100);
  }
  return {
    ...trade,
    maePct: round(maePct, 4),
    mfePct: round(mfePct, 4),
  };
}

function calcMaxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const ordered = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.symbol.localeCompare(b.symbol));
  for (const trade of ordered) {
    equity += trade.pnlUsd;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return round(maxDrawdown, 2);
}

function summarise(trades) {
  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const losses = trades.filter((trade) => trade.pnlUsd < 0);
  const grossProfitUsd = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLossUsdAbs = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsd, 0));
  return {
    trades: trades.length,
    winRate: trades.length ? round(wins.length / trades.length) : 0,
    netPnlUsd: round(grossProfitUsd - grossLossUsdAbs, 2),
    grossProfitUsd: round(grossProfitUsd, 2),
    grossLossUsdAbs: round(grossLossUsdAbs, 2),
    avgReturnPct: trades.length ? round(mean(trades.map((trade) => trade.returnPct)), 4) : 0,
    avgMaePct: trades.length ? round(mean(trades.map((trade) => trade.maePct ?? 0)), 4) : 0,
    maxMaePct: trades.length ? round(Math.max(...trades.map((trade) => trade.maePct ?? 0)), 4) : 0,
    avgMfePct: trades.length ? round(mean(trades.map((trade) => trade.mfePct ?? 0)), 4) : 0,
    maxDrawdownUsd: calcMaxDrawdown(trades),
    risk10xCount: trades.filter((trade) => (trade.maePct ?? 0) >= 10).length,
    risk5xCount: trades.filter((trade) => (trade.maePct ?? 0) >= 20).length,
    risk3xCount: trades.filter((trade) => (trade.maePct ?? 0) >= 33.33).length,
  };
}

function buildMarkdown(results) {
  const lines = [
    "# USDT-M 日线 复合过滤与持仓风险分析",
    "",
    "说明:",
    "- 基于已完成的 `USDT-M / day / 500根窗口 / 实时重构` 回测结果做二次分析",
    "- `MAE` = 持仓期间最大不利波动，`MFE` = 持仓期间最大有利波动",
    "- `10x / 5x / 3x 风险笔数` 只是按价格逆向波动粗略估算，不代表真实强平价",
    "",
  ];

  for (const item of results) {
    lines.push(`## ${item.tuningKey}`);
    lines.push(`- 基线: ${item.baseline.trades} 笔, 胜率 ${pct(item.baseline.winRate)}, 净盈亏 ${item.baseline.netPnlUsd.toFixed(2)}U, 最大回撤 ${item.baseline.maxDrawdownUsd.toFixed(2)}U`);
    lines.push(`- 持仓最大不利波动: 平均 ${item.baseline.avgMaePct.toFixed(2)}%, 最差 ${item.baseline.maxMaePct.toFixed(2)}%`);
    lines.push(`- 近似杠杆风险: 10x=${item.baseline.risk10xCount} 笔, 5x=${item.baseline.risk5xCount} 笔, 3x=${item.baseline.risk3xCount} 笔`);
    lines.push("");
    lines.push("### 过滤对比");
    for (const filter of item.filters) {
      lines.push(`- ${filter.label}: ${filter.summary.trades} 笔, 胜率 ${pct(filter.summary.winRate)}, 净盈亏 ${filter.summary.netPnlUsd.toFixed(2)}U, 最大回撤 ${filter.summary.maxDrawdownUsd.toFixed(2)}U, 平均MAE ${filter.summary.avgMaePct.toFixed(2)}%, 5x风险 ${filter.summary.risk5xCount} 笔`);
    }
    lines.push("");
    if (item.bestWinRate) {
      lines.push(`- 胜率最佳过滤: ${item.bestWinRate.label}`);
      lines.push(`  结果: ${item.bestWinRate.summary.trades} 笔, 胜率 ${pct(item.bestWinRate.summary.winRate)}, 净盈亏 ${item.bestWinRate.summary.netPnlUsd.toFixed(2)}U`);
    }
    if (item.bestNetPnl) {
      lines.push(`- 盈亏最佳过滤: ${item.bestNetPnl.label}`);
      lines.push(`  结果: ${item.bestNetPnl.summary.trades} 笔, 胜率 ${pct(item.bestNetPnl.summary.winRate)}, 净盈亏 ${item.bestNetPnl.summary.netPnlUsd.toFixed(2)}U`);
    }
    lines.push("");
    lines.push("### 最危险交易");
    for (const trade of item.worstMaeTrades) {
      lines.push(`- ${trade.entryDate} ${trade.symbol} ${transitionToChinese(trade.transition)} ${trade.direction === "long" ? "做多" : "做空"} | 收益 ${trade.returnPct.toFixed(2)}% | MAE ${trade.maePct.toFixed(2)}% | MFE ${trade.mfePct.toFixed(2)}%`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const results = [];
for (const fileName of INPUT_FILES) {
  const payload = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, fileName), "utf8"));
  const base = payload.byTuning[0];
  const enrichedTrades = base.trades.map(enrichTrade);
  const baseline = summarise(enrichedTrades);
  const filters = FILTERS.map((filter) => {
    const filteredTrades = enrichedTrades.filter(filter.test);
    return {
      key: filter.key,
      label: filter.label,
      summary: summarise(filteredTrades),
    };
  });
  const comparable = filters.filter((item) => item.summary.trades >= 15);
  const bestWinRate = [...comparable].sort((a, b) => b.summary.winRate - a.summary.winRate || b.summary.trades - a.summary.trades)[0] ?? null;
  const bestNetPnl = [...comparable].sort((a, b) => b.summary.netPnlUsd - a.summary.netPnlUsd || b.summary.winRate - a.summary.winRate)[0] ?? null;
  results.push({
    tuningKey: base.tuningKey,
    baseline,
    filters,
    bestWinRate,
    bestNetPnl,
    worstMaeTrades: [...enrichedTrades].sort((a, b) => (b.maePct ?? 0) - (a.maePct ?? 0)).slice(0, 8),
  });
}

const outputPath = path.join(OUTPUT_DIR, "2026-04-07-usdtm-day-reversal-filter-analysis.md");
fs.writeFileSync(outputPath, buildMarkdown(results), "utf8");
console.log(outputPath);
