"use client";
import { startTransition, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { resetResearch2ServerDefaults, saveManualResearchRegimes, saveResearch2ServerDefaults } from "@/app/research/actions";
import {
  type AuditRow,
  type BtcWeeklyResearchData,
  type BtcWeeklyResearch2Data,
  getRateTrend,
  getRateValue,
  getVolumeTrend,
  getVolumeValue,
  type MarketSymbol,
  type MonthlyRateRow,
  type Timeframe,
  type WorkbenchData,
} from "@/lib/workbench-data";

type ViewKey = "rates" | "monthly" | "audit" | "volume" | "combined" | "heatmap" | "research" | "research2";
type RateWindowKey = "currentMonth" | "previousMonth" | "previous3Months" | "previous6Months" | "previous12Months";
type MonthlySortKey = "symbol" | "lastMonth" | "last3Months" | "total" | "average" | "bestMonth" | "worstMonth" | "volatility" | "positiveMonths";
type RateTableSortKey =
  | "symbol"
  | "prevMonthYearly"
  | "prev3MonthsYearly"
  | "prev6MonthsYearly"
  | "prev12MonthsYearly"
  | "prev24MonthsYearly"
  | "positiveDays30"
  | "positiveDays90"
  | "positiveDays180"
  | "avg30dVolumeM"
  | "avg90dVolumeM"
  | "avg365dVolumeM"
  | "compositeScore";
type RateTableRow = {
  row: MarketSymbol;
  metrics: ReturnType<typeof getAnnualizedMetrics>;
  compositeScore: number;
};

const timeframeItems: { key: Timeframe; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
];

const chartPalette = ["#2563eb", "#0f766e", "#d97706", "#db2777", "#7c3aed", "#0891b2"];
const RESEARCH2_TUNING_DEFAULTS = {
  minWeeks: "5",
  latestMinWeeks: "5",
  splitPenalty: "7.8",
  maxWeeks: "28",
} as const;
const RESEARCH2_INDICATOR_DEFAULTS = {
  emaPeriod: "21",
  smaPeriod: "200",
  adxPeriod: "14",
  adxTrendLevel: "25",
  rsiPeriod: "14",
  rsiUpper: "80",
  rsiLower: "20",
  bbPeriod: "20",
  bbStdDev: "2",
  returnZPeriod: "52",
  returnUpper: "2",
  returnLower: "-2",
  bbwWindow: "104",
  bbwHigh: "70",
  bbwLow: "30",
} as const;
const emptyResearch2Data: BtcWeeklyResearch2Data = {
  marketType: "coinm",
  symbol: "BTC",
  timeframe: "week",
  availableMarkets: ["coinm"],
  availableSymbols: ["BTC"],
  points: [],
  segments: [],
  summaries: [],
  thresholds: {
    minSegmentWeeks: 5,
    latestSegmentMinWeeks: 5,
    splitPenalty: 7.8,
    maxSegmentWeeks: 28,
    bullQ65: 0,
    bullQ70: 0,
    bullQ80: 0,
    bullQ90: 0,
    bearQ30: 0,
    bearQ20: 0,
    maxAdvanceQ80: 0,
    maxAdvanceQ90: 0,
    maxDrawQ20: 0,
    maxDrawQ10: 0,
    peakToEndQ20: 0,
    adxLowQ35: 0,
    adxHighQ70: 0,
    bbwLowQ35: 0,
    bbwHighQ70: 0,
    trendQ30: 0,
    trendQ70: 0,
    directionBandRule: "-",
    neutralBandRule: "-",
    crashBearRule: "-",
  },
  indicatorSettings: {
    emaPeriod: 21,
    smaPeriod: 200,
    adxPeriod: 14,
    adxTrendLevel: 25,
    rsiPeriod: 14,
    rsiUpper: 80,
    rsiLower: 20,
    bbPeriod: 20,
    bbStdDev: 2,
    returnZPeriod: 52,
    returnUpper: 2,
    returnLower: -2,
    bbwPercentileWindow: 104,
    bbwHigh: 70,
    bbwLow: 30,
  },
  latestObservedDate: "-",
  sourceLabel: "-",
};
const viewItems: { key: ViewKey; label: string; href: string }[] = [
  { key: "rates", label: "费率总览", href: "/" },
  { key: "monthly", label: "月费率明细", href: "/monthly" },
  { key: "audit", label: "数据审计", href: "/audit" },
  { key: "combined", label: "联合筛选", href: "/combined" },
  { key: "heatmap", label: "热力图", href: "/heatmap" },
  { key: "research2", label: "七态研究", href: "/research-2" },
];
const rateWindowItems: { key: RateWindowKey; label: string; hint: string }[] = [
  { key: "currentMonth", label: "本月维度", hint: "本月累计费率" },
  { key: "previousMonth", label: "上月维度", hint: "上月总费率" },
  { key: "previous3Months", label: "上3个月维度", hint: "不含本月，近 3 个完整月总费率" },
  { key: "previous6Months", label: "上6个月维度", hint: "不含本月，近 6 个完整月总费率" },
  { key: "previous12Months", label: "上12个月维度", hint: "不含本月，近 12 个完整月总费率" },
];

const manualRegimeLabelOptions = ["牛", "小牛", "震荡牛", "震荡", "震荡熊", "小熊", "熊"] as const;
type ManualRegimeLabel = (typeof manualRegimeLabelOptions)[number];
type EditableResearchRegime = { symbol: string; start: string; end: string; label: ManualRegimeLabel; tone: string; stateClass: -1 | 0 | 1 };

function hasRegimeOverlap(left: Pick<EditableResearchRegime, "start" | "end">, right: Pick<EditableResearchRegime, "start" | "end">) {
  return left.start < right.end && right.start < left.end;
}

function fmtPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function fmtVol(value: number) {
  return `${value.toFixed(1)}M`;
}

function fmtPrice(value: number) {
  if (!Number.isFinite(value)) return "-";
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (absValue >= 1) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (absValue >= 0.1) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
  }
  if (absValue >= 0.01) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 })}`;
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 6 })}`;
}

function fmtPriceAxisTick(value: number) {
  if (!Number.isFinite(value)) return "-";
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  if (absValue >= 1) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (absValue >= 0.1) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  if (absValue >= 0.01) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}

function renderPriceRange(startDate: string, startPrice: number, endDate: string, endPrice: number) {
  return (
    <>
      <span className="text-slate-700">{startDate}</span>{" "}
      <span className="font-medium text-rose-700">{fmtPrice(startPrice)}</span>{" "}
      <span className="text-slate-400">-&gt;</span>{" "}
      <span className="text-slate-700">{endDate}</span>{" "}
      <span className="font-medium text-rose-700">{fmtPrice(endPrice)}</span>
    </>
  );
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

function fmtScore(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function fmtPlainNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

function getResearchMarketLabel(marketType: BtcWeeklyResearch2Data["marketType"]) {
  return marketType === "usdtm" ? "U本位" : "币本位";
}

function getResearchTimeframeLabel(timeframe: BtcWeeklyResearch2Data["timeframe"]) {
  if (timeframe === "day") return "日线";
  if (timeframe === "3day") return "3日线";
  return "周线";
}

const researchMarketOptions: Array<{ key: BtcWeeklyResearch2Data["marketType"]; label: string; enabled: boolean }> = [
  { key: "coinm", label: "币本位 COIN-M", enabled: true },
  { key: "usdtm", label: "U本位 USDT-M", enabled: false },
];

const researchTimeframeOptions: Array<{ key: BtcWeeklyResearch2Data["timeframe"]; label: string; enabled: boolean }> = [
  { key: "week", label: "周线", enabled: true },
  { key: "3day", label: "3日线", enabled: false },
  { key: "day", label: "日线", enabled: false },
];

function parseDateText(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatRangeLabel(start: Date, end: Date) {
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日至${end.getDate()}日`;
    }
    return `${start.getFullYear()}年${start.getMonth() + 1}月至${end.getMonth() + 1}月`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月至${end.getFullYear()}年${end.getMonth() + 1}月`;
}

function diffDaysInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function viewTitle(view: ViewKey) {
  if (view === "rates") return "费率总览";
  if (view === "monthly") return "月费率明细表";
  if (view === "audit") return "数据审计";
  if (view === "volume") return "成交量观察";
  if (view === "combined") return "联合筛选";
  if (view === "research") return "BTC 周线研究";
  if (view === "research2") return "七态研究";
  return "热力图";
}

function buildResearchWindowRange(total: number) {
  if (!total) {
    return { startIndex: 0, endIndex: 0 };
  }
  return { startIndex: 0, endIndex: total - 1 };
}


function formatDateSpan(startText: string, endText: string) {
  const endDate = parseDateText(endText);
  endDate.setDate(endDate.getDate() - 1);
  return formatRangeLabel(parseDateText(startText), endDate);
}

function formatClosedDateSpan(startText: string, endText: string) {
  return formatRangeLabel(parseDateText(startText), parseDateText(endText));
}

function manualRegimeTone(label: ManualRegimeLabel) {
  if (label === "牛") return "#166534";
  if (label === "小牛") return "#22c55e";
  if (label === "震荡牛") return "#bbf7d0";
  if (label === "震荡") return "#e2e8f0";
  if (label === "震荡熊") return "#fecdd3";
  if (label === "小熊") return "#fca5a5";
  return "#b91c1c";
}

function manualRegimeStateClass(label: ManualRegimeLabel): -1 | 0 | 1 {
  if (label === "牛" || label === "小牛" || label === "震荡牛") return 1;
  if (label === "震荡熊" || label === "小熊" || label === "熊") return -1;
  return 0;
}

function toEditableRegime(regime: BtcWeeklyResearchData["manualRegimeRows"][number]): EditableResearchRegime {
  const label = (manualRegimeLabelOptions.includes(regime.label as ManualRegimeLabel) ? regime.label : "震荡") as ManualRegimeLabel;
  return {
    symbol: regime.symbol,
    start: regime.start,
    end: regime.end,
    label,
    tone: regime.tone,
    stateClass: regime.stateClass,
  };
}

function rateText(value: number) {
  return value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-slate-500";
}

function getWindowRateValue(symbol: MarketSymbol, window: RateWindowKey) {
  if (window === "currentMonth") return symbol.rateMonthPct;
  if (window === "previousMonth") return symbol.ratePrevMonthPct;
  if (window === "previous3Months") return symbol.ratePrev3MonthsPct;
  if (window === "previous6Months") return symbol.ratePrev6MonthsPct;
  return symbol.ratePrev12MonthsPct;
}

function getWindowVolumeValue(symbol: MarketSymbol, window: RateWindowKey) {
  if (window === "currentMonth") return symbol.monthAvgDailyVolumeM;
  if (window === "previousMonth") return symbol.prevMonthAvgDailyVolumeM;
  if (window === "previous3Months") return symbol.prev3MonthsAvgDailyVolumeM;
  if (window === "previous6Months") return symbol.prev6MonthsAvgDailyVolumeM;
  return symbol.prev12MonthsAvgDailyVolumeM;
}

function getWindowRangeInfo(window: RateWindowKey, latestDateText: string) {
  const latestDate = parseDateText(latestDateText);
  const currentMonthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  const previousMonthStart = new Date(latestDate.getFullYear(), latestDate.getMonth() - 1, 1);
  const previousMonthEnd = new Date(latestDate.getFullYear(), latestDate.getMonth(), 0);

  if (window === "currentMonth") {
    return {
      label: formatRangeLabel(currentMonthStart, latestDate),
      dayCount: diffDaysInclusive(currentMonthStart, latestDate),
    };
  }

  if (window === "previousMonth") {
    return {
      label: formatMonthLabel(previousMonthStart),
      dayCount: diffDaysInclusive(previousMonthStart, previousMonthEnd),
    };
  }

  const monthSpan = window === "previous3Months" ? 3 : window === "previous6Months" ? 6 : 12;
  const rangeStart = new Date(latestDate.getFullYear(), latestDate.getMonth() - monthSpan, 1);
  return {
    label: formatRangeLabel(rangeStart, previousMonthEnd),
    dayCount: diffDaysInclusive(rangeStart, previousMonthEnd),
  };
}

function getWindowAnnualizedRate(symbol: MarketSymbol, window: RateWindowKey, latestDateText: string) {
  const rawValue = getWindowRateValue(symbol, window);
  const { dayCount } = getWindowRangeInfo(window, latestDateText);
  if (!dayCount) return 0;
  return (rawValue / dayCount) * 365;
}

function volumeMetricLabel(timeframe: Timeframe) {
  if (timeframe === "day") return "最新日成交量";
  if (timeframe === "week") return "近7日平均成交量";
  return "近30日平均成交量";
}

function topRankHighlightClass(score: number) {
  if (score >= 40) return "bg-emerald-200 border border-emerald-300";
  if (score >= 28) return "bg-emerald-100 border border-emerald-200";
  if (score >= 16) return "bg-emerald-50 border border-emerald-100";
  return "bg-white";
}

function negativeTopRankHighlightClass(score: number) {
  if (score >= 40) return "bg-rose-200 border border-rose-300";
  if (score >= 28) return "bg-rose-100 border border-rose-200";
  if (score >= 16) return "bg-rose-50 border border-rose-100";
  return "bg-white";
}

function rateRankHeatClass(rank: number, total: number, value: number) {
  const ratio = total > 1 ? rank / (total - 1) : 0;
  if (value < 0) {
    if (ratio >= 0.75) return "bg-rose-200 text-rose-900";
    if (ratio >= 0.5) return "bg-rose-100 text-rose-800";
    if (ratio >= 0.25) return "bg-rose-50 text-rose-700";
    return "bg-slate-100 text-slate-600";
  }
  if (value === 0) return "bg-slate-100 text-slate-600";
  if (ratio >= 0.75) return "bg-emerald-200 text-emerald-900";
  if (ratio >= 0.5) return "bg-emerald-100 text-emerald-800";
  if (ratio >= 0.25) return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

function volumeRankHeatClass(rank: number, total: number) {
  const ratio = total > 1 ? rank / (total - 1) : 0;
  if (ratio >= 0.75) return "bg-sky-200 text-sky-900";
  if (ratio >= 0.5) return "bg-sky-100 text-sky-800";
  if (ratio >= 0.25) return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

function buildRankMap(values: { symbol: string; value: number }[]) {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  return new Map(sorted.map((entry, index) => [entry.symbol, { rank: index, total: sorted.length, value: entry.value }]));
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

function avgValues(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdDev(values: number[]) {
  if (!values.length) return 0;
  const avg = avgValues(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp01(value: number) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function scoreFromRank(rank: number, total: number) {
  if (total <= 1) return 0.5;
  return rank / (total - 1);
}

function scoreFromLogVolume(value: number, universe: number[]) {
  const transformed = universe.map((item) => Math.log1p(Math.max(item, 0)));
  const low = percentile(transformed, 0.2);
  const high = percentile(transformed, 0.9);
  const current = Math.log1p(Math.max(value, 0));
  if (high <= low) return current > low ? 1 : 0;
  return clamp01((current - low) / (high - low));
}

function rateTableValue(entry: RateTableRow, key: RateTableSortKey) {
  if (key === "symbol") return entry.row.symbol;
  if (key === "prevMonthYearly") return entry.metrics.prevMonthYearly;
  if (key === "prev3MonthsYearly") return entry.metrics.prev3MonthsYearly;
  if (key === "prev6MonthsYearly") return entry.metrics.prev6MonthsYearly;
  if (key === "prev12MonthsYearly") return entry.metrics.prev12MonthsYearly;
  if (key === "prev24MonthsYearly") return entry.metrics.prev24MonthsYearly;
  if (key === "positiveDays30") return entry.row.positiveDays30;
  if (key === "positiveDays90") return entry.row.positiveDays90;
  if (key === "positiveDays180") return entry.row.positiveDays180;
  if (key === "avg30dVolumeM") return entry.row.avg30dVolumeM;
  if (key === "avg90dVolumeM") return entry.row.avg90dVolumeM;
  if (key === "avg365dVolumeM") return entry.row.avg365dVolumeM;
  return entry.compositeScore;
}

function summarizeMonthlyRow(row: MonthlyRateRow, months: string[]) {
  const values = months
    .map((month) => row.months[month])
    .filter((value): value is number => typeof value === "number");

  return {
    total: values.reduce((sum, value) => sum + value, 0),
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    lastMonth: values.at(-1) ?? 0,
    last3Months: values.slice(-3).reduce((sum, value) => sum + value, 0),
    bestMonth: values.length ? Math.max(...values) : 0,
    worstMonth: values.length ? Math.min(...values) : 0,
    volatility: values.length ? stdDev(values) : 0,
    positiveMonths: values.filter((value) => value > 0).length,
    availableMonths: values.length,
  };
}

function monthlySortValue(row: MonthlyRateRow, months: string[], key: MonthlySortKey) {
  const summary = summarizeMonthlyRow(row, months);
  if (key === "symbol") return row.symbol;
  if (key === "lastMonth") return summary.lastMonth;
  if (key === "last3Months") return summary.last3Months;
  if (key === "average") return summary.average;
  if (key === "bestMonth") return summary.bestMonth;
  if (key === "worstMonth") return summary.worstMonth;
  if (key === "volatility") return summary.volatility;
  if (key === "positiveMonths") return summary.positiveMonths;
  return summary.total;
}

function monthlyHeatStyle(value: number | undefined, scale: number) {
  if (typeof value !== "number") {
    return {
      backgroundColor: "#f8fafc",
      color: "#cbd5e1",
    };
  }

  const intensity = 0.12 + clamp01(Math.abs(value) / Math.max(scale, 0.001)) * 0.48;
  if (value > 0) {
    return {
      backgroundColor: `rgba(16, 185, 129, ${intensity.toFixed(3)})`,
      color: "#065f46",
    };
  }
  if (value < 0) {
    return {
      backgroundColor: `rgba(244, 63, 94, ${intensity.toFixed(3)})`,
      color: "#881337",
    };
  }
  return {
    backgroundColor: "#e2e8f0",
    color: "#475569",
  };
}

function auditTone(status: string) {
  if (status === "ok") return "bg-emerald-50 text-emerald-700";
  if (status === "warning") return "bg-amber-50 text-amber-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  if (status === "imported") return "bg-sky-50 text-sky-700";
  if (status === "not_run") return "bg-slate-100 text-slate-600";
  return "bg-slate-100 text-slate-600";
}

function formatAuditNotes(...notes: Array<string | undefined>) {
  const combined = notes.filter(Boolean).join(" | ");
  if (!combined) return "-";
  return combined
    .replaceAll("short_history_or_new_listing", "新币或短历史")
    .replaceAll("usd_volume=contract_volume*contract_size", "成交量口径: 合约张数 x 合约面值")
    .replaceAll("source=futures_coin_klines", "来源: COIN-M 日K")
    .replaceAll("official_kline_fields:v=contract_volume,q=base_asset_volume", "官方字段: v=合约量, q=基础币量")
    .replaceAll("no kline volume rows returned", "没有返回成交量K线")
    .replaceAll("volume fetch failed or no kline rows", "成交量抓取失败或没有K线")
    .replaceAll("ok", "正常");
}

function getAnnualizedMetrics(symbol: MarketSymbol) {
  return {
    prevMonthYearly: symbol.ratePrevMonthPct * 12,
    prev3MonthsYearly: symbol.ratePrev3MonthsPct * 4,
    prev6MonthsYearly: symbol.ratePrev6MonthsPct * 2,
    prev12MonthsYearly: symbol.ratePrev12MonthsPct,
    prev24MonthsYearly: symbol.ratePrev24MonthsPct / 2,
  };
}

function getComparisonWindow(timeframe: Timeframe): RateWindowKey {
  if (timeframe === "day") return "previousMonth";
  if (timeframe === "week") return "previous3Months";
  return "previous12Months";
}

function buildRateTable(symbols: MarketSymbol[], timeframe: Timeframe) {
  return [...symbols].sort((a, b) => getRateValue(b, timeframe) - getRateValue(a, timeframe));
}

function buildWindowRateTable(symbols: MarketSymbol[], window: RateWindowKey) {
  return [...symbols].sort((a, b) => getWindowRateValue(b, window) - getWindowRateValue(a, window));
}

function buildNegativeWindowRateTable(symbols: MarketSymbol[], window: RateWindowKey) {
  return [...symbols].sort((a, b) => getWindowRateValue(a, window) - getWindowRateValue(b, window));
}

function buildVolumeTable(symbols: MarketSymbol[], timeframe: Timeframe) {
  return [...symbols].sort((a, b) => getVolumeValue(b, timeframe) - getVolumeValue(a, timeframe));
}

function buildPriorityTableRows(symbols: MarketSymbol[]) {
  const prevMonthRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prevMonthYearly })));
  const prev3MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev3MonthsYearly })));
  const prev6MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev6MonthsYearly })));
  const prev12MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev12MonthsYearly })));
  const prev24MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev24MonthsYearly })));
  const positive30RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays30 })));
  const positive90RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays90 })));
  const positive180RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays180 })));
  const volume30RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg30dVolumeM })));
  const volume90RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg90dVolumeM })));
  const volume365RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg365dVolumeM })));
  const annualVolumeUniverse = symbols.map((item) => item.avg365dVolumeM);

  const rows = symbols.map((row) => {
    const metrics = getAnnualizedMetrics(row);
    const annualizedScore =
      scoreFromRank(prevMonthRankMap.get(row.symbol)?.rank ?? 0, prevMonthRankMap.get(row.symbol)?.total ?? 1) * 0.1 +
      scoreFromRank(prev3MonthsRankMap.get(row.symbol)?.rank ?? 0, prev3MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.15 +
      scoreFromRank(prev6MonthsRankMap.get(row.symbol)?.rank ?? 0, prev6MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.2 +
      scoreFromRank(prev12MonthsRankMap.get(row.symbol)?.rank ?? 0, prev12MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.3 +
      scoreFromRank(prev24MonthsRankMap.get(row.symbol)?.rank ?? 0, prev24MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.25;
    const positiveScore =
      scoreFromRank(positive30RankMap.get(row.symbol)?.rank ?? 0, positive30RankMap.get(row.symbol)?.total ?? 1) * 0.25 +
      scoreFromRank(positive90RankMap.get(row.symbol)?.rank ?? 0, positive90RankMap.get(row.symbol)?.total ?? 1) * 0.35 +
      scoreFromRank(positive180RankMap.get(row.symbol)?.rank ?? 0, positive180RankMap.get(row.symbol)?.total ?? 1) * 0.4;
    const volumeScore =
      scoreFromLogVolume(row.avg30dVolumeM, annualVolumeUniverse) * 0.2 +
      scoreFromLogVolume(row.avg90dVolumeM, annualVolumeUniverse) * 0.3 +
      scoreFromLogVolume(row.avg365dVolumeM, annualVolumeUniverse) * 0.5;

    return {
      row,
      metrics,
      compositeScore: Math.round((annualizedScore * 0.6 + positiveScore * 0.25 + volumeScore * 0.15) * 100),
    };
  });

  return {
    rows,
    prevMonthRankMap,
    prev3MonthsRankMap,
    prev6MonthsRankMap,
    prev12MonthsRankMap,
    prev24MonthsRankMap,
    positive30RankMap,
    positive90RankMap,
    positive180RankMap,
    volume30RankMap,
    volume90RankMap,
    volume365RankMap,
  };
}

function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      {title || hint ? (
        <div className="mb-4">
          {title ? <h3 className="text-base font-semibold text-slate-900">{title}</h3> : null}
          {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-3 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function WindowMetricCard({
  window,
  leader,
  positiveCount,
  totalCount,
  lowLiquidityCount,
}: {
  window: { key: RateWindowKey; label: string; hint: string };
  leader?: MarketSymbol;
  positiveCount: number;
  totalCount: number;
  lowLiquidityCount: number;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
      <div className="text-sm text-slate-500">{window.label}</div>
      <div className="mt-4 space-y-4">
        <div>
          <div className="text-xs text-slate-500">领先币</div>
          <div className="mt-1 text-xl font-semibold">{leader ? leader.symbol : "-"}</div>
          <div className={`mt-1 text-sm ${leader ? rateText(getWindowRateValue(leader, window.key)) : "text-slate-500"}`}>
            {leader ? fmtPct(getWindowRateValue(leader, window.key)) : "暂无数据"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">正费率数量</div>
          <div className="mt-1 text-xl font-semibold">{positiveCount} / {totalCount}</div>
          <div className="mt-1 text-xs text-slate-500">当前维度下仍保持正费率的币种数量。</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">低流动性数量</div>
          <div className="mt-1 text-xl font-semibold">{lowLiquidityCount}</div>
          <div className="mt-1 text-xs text-slate-500">当前维度月日均成交量低于 5M，默认不进重点池。</div>
        </div>
      </div>
    </div>
  );
}

function WindowTopList({
  window,
  rows,
  heatScores,
  latestDateText,
  titleMode = "positive",
}: {
  window: { key: RateWindowKey; label: string; hint: string };
  rows: MarketSymbol[];
  heatScores: Map<string, number>;
  latestDateText: string;
  titleMode?: "positive" | "negative";
}) {
  const rangeInfo = getWindowRangeInfo(window.key, latestDateText);
  return (
    <div className={`rounded-[22px] border p-4 ${titleMode === "negative" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-sm font-medium text-slate-900">{window.label}</div>
      <div className="mt-1 text-xs text-slate-500">{rangeInfo.label}</div>
      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div
            key={`${window.key}-${row.symbol}`}
            className={`group relative flex items-center justify-between rounded-xl px-3 py-2 ${titleMode === "negative" ? negativeTopRankHighlightClass(heatScores.get(row.symbol) ?? 0) : topRankHighlightClass(heatScores.get(row.symbol) ?? 0)}`}
          >
            <div className="flex items-center gap-3">
              <span className="w-5 text-xs text-slate-400">{index + 1}</span>
              <span className="font-medium text-slate-900">{row.symbol}</span>
            </div>
            <span className={`text-sm font-medium ${rateText(getWindowRateValue(row, window.key))}`}>{fmtPct(getWindowRateValue(row, window.key))}</span>
            <div className="pointer-events-none absolute left-3 top-full z-20 mt-2 hidden w-52 rounded-xl border border-slate-200 bg-white p-3 shadow-lg group-hover:block">
              <div className="text-sm font-semibold text-slate-900">{row.symbol}</div>
              <div className="mt-2 text-xs text-slate-500">{window.label}</div>
              <div className="mt-1 text-xs text-slate-500">{rangeInfo.label}</div>
              <div className="mt-1 text-sm text-slate-700">年化：{fmtPct(getWindowAnnualizedRate(row, window.key, latestDateText))}</div>
              <div className="mt-1 text-sm text-slate-700">日均成交量：{fmtVol(getWindowVolumeValue(row, window.key))}</div>
              <div className="mt-1 text-xs text-slate-500">{titleMode === "positive" ? "上榜热度分" : "负榜热度分"}：{heatScores.get(row.symbol) ?? 0}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapNode(props: { depth?: number; x?: number; y?: number; width?: number; height?: number; name?: string; rate?: number; scale?: number }) {
  if ((props.depth ?? 0) < 1) return <g />;
  const rate = props.rate ?? 0;
  const scale = Math.max(props.scale ?? 0.1, 0.001);
  const intensity = clamp01(Math.abs(rate) / scale);
  let fill = "#e2e8f0";
  if (rate > 0) {
    fill =
      intensity > 0.85 ? "#047857" :
      intensity > 0.65 ? "#059669" :
      intensity > 0.45 ? "#10b981" :
      intensity > 0.25 ? "#6ee7b7" :
      "#d1fae5";
  } else if (rate < 0) {
    fill =
      intensity > 0.85 ? "#b91c1c" :
      intensity > 0.65 ? "#dc2626" :
      intensity > 0.45 ? "#f43f5e" :
      intensity > 0.25 ? "#fb7185" :
      "#fecdd3";
  }
  const showText = (props.width ?? 0) > 42 && (props.height ?? 0) > 34;

  return (
    <g>
      <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} stroke="#fff" strokeWidth={2} />
      {showText ? (
        <>
          <text x={(props.x ?? 0) + (props.width ?? 0) / 2} y={(props.y ?? 0) + (props.height ?? 0) / 2 - 4} fill="#fff" textAnchor="middle" fontSize={14} fontWeight="bold">
            {props.name}
          </text>
          <text x={(props.x ?? 0) + (props.width ?? 0) / 2} y={(props.y ?? 0) + (props.height ?? 0) / 2 + 12} fill="#fff" textAnchor="middle" fontSize={12}>
            {fmtPct(rate)}
          </text>
        </>
      ) : null}
    </g>
  );
}

function InsightTile({ label, value, hint, tone = "slate" }: { label: string; value: string; hint: string; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-slate-50";

  return (
    <div className={`rounded-[22px] border px-5 py-4 ${toneClass}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{hint}</div>
    </div>
  );
}

function CombinedScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { symbol?: string; rawVolume?: number; y?: number; score?: number } }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-slate-900">{point.symbol ?? "-"}</div>
      <div className="mt-2 text-sm text-slate-600">成交量：{fmtVol(Number(point.rawVolume ?? 0))}</div>
      <div className="mt-1 text-sm text-slate-600">费率：{fmtPct(Number(point.y ?? 0))}</div>
      <div className="mt-1 text-sm text-slate-600">分数：{Number(point.score ?? 0).toFixed(0)}</div>
    </div>
  );
}

function AutoRegimeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { weekStart?: string; autoHeatScore?: number; autoSegmentIndex?: number; closePrice?: number; autoStateLabel?: string; autoSource?: string; autoNote?: string } }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-slate-900">{point.weekStart ?? "-"}</div>
      <div className="mt-2 text-sm text-slate-600">自动热度：{fmtScore(Number(point.autoHeatScore ?? 0))}</div>
      <div className="mt-1 text-sm text-slate-600">状态：{point.autoStateLabel ?? "-"}</div>
      <div className="mt-1 text-sm text-slate-600">来源：{point.autoSource === "manual" ? "手动覆盖" : "自动识别"}</div>
      <div className="mt-1 text-sm text-slate-600">区间编号：#{Number(point.autoSegmentIndex ?? 0) + 1}</div>
      <div className="mt-1 text-sm text-slate-600">价格：{fmtPrice(Number(point.closePrice ?? 0))}</div>
      {point.autoNote ? <div className="mt-1 text-sm text-slate-600">备注：{point.autoNote}</div> : null}
    </div>
  );
}

function heatmapMetricValue(symbol: MarketSymbol, metric: "current" | "prevMonth" | "prev3Months" | "prev6Months" | "prev12Months") {
  if (metric === "current") return symbol.rateMonthPct;
  if (metric === "prevMonth") return symbol.ratePrevMonthPct;
  if (metric === "prev3Months") return symbol.ratePrev3MonthsPct;
  if (metric === "prev6Months") return symbol.ratePrev6MonthsPct;
  return symbol.ratePrev12MonthsPct;
}

function heatmapColorScale(values: number[]) {
  const sorted = values
    .map((value) => Math.abs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!sorted.length) return 0.001;

  const percentileIndex = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.9));
  return Math.max(sorted[percentileIndex] ?? sorted[sorted.length - 1] ?? 0.001, 0.001);
}

function volumeAxisCap(values: number[]) {
  const positiveValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!positiveValues.length) return 5;
  return Math.max(percentile(positiveValues, 0.95), 5);
}

function rateAxisCap(values: number[]) {
  const absoluteValues = values
    .map((value) => Math.abs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!absoluteValues.length) return 0.2;
  return Math.max(percentile(absoluteValues, 0.95), 0.2);
}

function WorkbenchShell({
  data,
  initialView,
  children,
}: {
  data: WorkbenchData;
  initialView: ViewKey;
  children: React.ReactNode;
}) {
  const overviewWindows = rateWindowItems.map((window) => {
    const ranked = buildWindowRateTable(data.symbols, window.key);
    return {
      window,
      leader: ranked[0],
      positiveCount: data.symbols.filter((item) => getWindowRateValue(item, window.key) > 0).length,
      lowLiquidityCount: data.symbols.filter((item) => getWindowVolumeValue(item, window.key) < 5).length,
    };
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e0f2fe,_#f8fafc_42%,_#f8fafc)] text-slate-900">
      <div className="mx-auto max-w-[1480px] px-4 py-5 md:px-6">
        <div className="grid gap-5 xl:grid-cols-[150px_minmax(0,1fr)] xl:items-start">
          <aside className="relative z-50 xl:sticky xl:top-5 xl:self-start">
            <div className="rounded-[26px] border border-slate-200 bg-white/92 p-3 shadow-sm backdrop-blur">
              <div className="px-2 pb-2 text-xs font-medium tracking-[0.18em] text-slate-400">PAGES</div>
              <nav className="relative z-30 flex flex-wrap gap-2 xl:flex-col">
                {viewItems.map((item) => {
                  const active = item.key === initialView;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        window.location.href = item.href;
                      }}
                      className={`relative z-30 block cursor-pointer rounded-2xl px-3 py-2 text-sm transition-colors pointer-events-auto ${
                        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="relative z-0 min-w-0 overflow-x-hidden">
            {initialView === "rates" || initialView === "audit" || initialView === "monthly" || initialView === "combined" || initialView === "heatmap" || initialView === "research" || initialView === "research2" ? (
              <header className="mb-6 rounded-[30px] border border-slate-200 bg-white/92 p-6 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <div className="text-sm text-slate-500">Analysis Mode</div>
                      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{viewTitle(initialView)}</h1>
                    </div>
                    <div className="text-xs text-slate-500">
                      Data: {data.sourceLabel}
                      <br />
                      Updated: {data.updatedAtLabel}
                    </div>
                  </div>

                  {initialView === "rates" ? (
                    <div className="grid gap-4 xl:grid-cols-5">
                      {overviewWindows.map((entry) => (
                        <WindowMetricCard
                          key={entry.window.key}
                          window={entry.window}
                          leader={entry.leader}
                          positiveCount={entry.positiveCount}
                          totalCount={data.symbols.length}
                          lowLiquidityCount={entry.lowLiquidityCount}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </header>
            ) : null}

            {data.loadError ? (
              <div className="mb-6 rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                SQLite 数据暂不可用：{data.loadError}
              </div>
            ) : null}

            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function RateOverview({
  symbols,
  timeframe,
  setTimeframe,
  latestDateText,
}: {
  symbols: MarketSymbol[];
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  latestDateText: string;
}) {
  const ranked = useMemo(() => buildRateTable(symbols, timeframe), [symbols, timeframe]);
  const [selected, setSelected] = useState<string[]>([]);
  const [minVolume, setMinVolume] = useState<number>(0);
  const [rankingMinVolume, setRankingMinVolume] = useState<number>(0);
  const [negativeRankingMinVolume, setNegativeRankingMinVolume] = useState<number>(0);
  const [sortKey, setSortKey] = useState<RateTableSortKey>("prev12MonthsYearly");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const filtered = ranked.filter((item) => item.monthAvgDailyVolumeM >= minVolume);
  const comparisonWindow = getComparisonWindow(timeframe);
  const comparisonRanked = buildWindowRateTable(filtered, comparisonWindow);
  const defaultSelectedSymbols = comparisonRanked.slice(0, 5).map((item) => item.symbol);
  const windowLeaders = rateWindowItems.map((window) => ({
    window,
    rows: buildWindowRateTable(
      symbols.filter((item) => getWindowVolumeValue(item, window.key) >= rankingMinVolume),
      window.key,
    ).slice(0, 10),
  }));
  const negativeWindowLeaders = rateWindowItems.map((window) => ({
    window,
    rows: buildNegativeWindowRateTable(
      symbols.filter((item) => getWindowVolumeValue(item, window.key) >= negativeRankingMinVolume),
      window.key,
    ).slice(0, 10),
  }));
  const rankingHeatScores = useMemo(() => {
    const scoreMap = new Map<string, number>();
    for (const { rows } of windowLeaders) {
      rows.forEach((row, index) => {
        const rankScore = 11 - (index + 1);
        const current = scoreMap.get(row.symbol) ?? 0;
        scoreMap.set(row.symbol, current + rankScore);
      });
    }
    return scoreMap;
  }, [windowLeaders]);
  const negativeRankingHeatScores = useMemo(() => {
    const scoreMap = new Map<string, number>();
    for (const { rows } of negativeWindowLeaders) {
      rows.forEach((row, index) => {
        const rankScore = 11 - (index + 1);
        const current = scoreMap.get(row.symbol) ?? 0;
        scoreMap.set(row.symbol, current + rankScore);
      });
    }
    return scoreMap;
  }, [negativeWindowLeaders]);

  useEffect(() => {
    setSelected(defaultSelectedSymbols);
  }, [comparisonWindow, defaultSelectedSymbols, minVolume, symbols]);

  const chartAnchor = comparisonRanked[0] ?? filtered[0];
  const chartRows = (chartAnchor ? getRateTrend(chartAnchor, timeframe) : []).map((point, index) => {
    const row: Record<string, string | number> = { label: point.label };
    selected.forEach((symbol) => {
      const target = filtered.find((item) => item.symbol === symbol) ?? ranked.find((item) => item.symbol === symbol);
      if (target) row[symbol] = getRateTrend(target, timeframe)[index]?.value ?? 0;
    });
    return row;
  });

  const {
    rows: unsortedPriorityRows,
    prevMonthRankMap,
    prev3MonthsRankMap,
    prev6MonthsRankMap,
    prev12MonthsRankMap,
    prev24MonthsRankMap,
    positive30RankMap,
    positive90RankMap,
    positive180RankMap,
    volume30RankMap,
    volume90RankMap,
    volume365RankMap,
  } = useMemo(() => buildPriorityTableRows(symbols), [symbols]);
  const priorityRows = [...unsortedPriorityRows]
    .sort((a, b) => {
      const left = rateTableValue(a, sortKey);
      const right = rateTableValue(b, sortKey);
      const factor = sortDirection === "desc" ? -1 : 1;
      if (typeof left === "string" && typeof right === "string") {
        return left.localeCompare(right) * factor;
      }
      return (((left as number) ?? 0) - ((right as number) ?? 0)) * factor;
    });
  const liquidPriorityRows = priorityRows.filter(({ row }) => row.avg365dVolumeM >= 5);
  const focusPool = liquidPriorityRows.slice(0, 5);
  const reservePool = liquidPriorityRows.slice(5, 10);
  const highVolumeButWeak = priorityRows
    .filter(({ row, metrics }) => row.avg365dVolumeM >= 30 && metrics.prev12MonthsYearly <= 0)
    .slice(0, 3);
  const thinButStrong = priorityRows
    .filter(({ row, compositeScore }) => row.avg365dVolumeM < 5 && compositeScore >= 55)
    .slice(0, 3);

  const toggleSort = (key: RateTableSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "symbol" ? "asc" : "desc");
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <InsightTile
          label="当前主看池"
          value={focusPool.length ? focusPool.map((entry) => entry.row.symbol).join(" / ") : "-"}
          hint={focusPool.length ? `按综合分排序，当前第一名 ${focusPool[0].row.symbol} ${focusPool[0].compositeScore} 分。` : "当前没有满足流动性门槛的候选。"}
          tone="emerald"
        />
        <InsightTile
          label="第二观察池"
          value={reservePool.length ? reservePool.map((entry) => entry.row.symbol).join(" / ") : "-"}
          hint="这组不是放弃，只是综合分略低于主看池，通常作为补充观察。"
          tone="slate"
        />
        <InsightTile
          label="高量但别急"
          value={highVolumeButWeak.length ? highVolumeButWeak.map((entry) => entry.row.symbol).join(" / ") : "-"}
          hint={highVolumeButWeak.length ? "量大但上12个月年化仍弱，容量够不代表应该优先做。" : "当前高量币里没有明显的长期弱费率压制。"}
          tone="amber"
        />
        <InsightTile
          label="分高但偏薄"
          value={thinButStrong.length ? thinButStrong.map((entry) => entry.row.symbol).join(" / ") : "-"}
          hint={thinButStrong.length ? "费率表现不错，但年日均成交量还偏薄，先放观察名单。" : "当前没有同时满足高分和低流动性的边缘候选。"}
          tone="rose"
        />
      </div>

      <Card title="费率长期对比" hint="日维度默认按上月排名取前 3，周维度默认按上 3 个月排名取前 3，月维度默认按上 12 个月排名取前 3。">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {timeframeItems.map((item) => (
              <button key={item.key} type="button" onClick={() => setTimeframe(item.key)} className={`rounded-full px-4 py-2 text-sm ${timeframe === item.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                {item.label}维度
              </button>
            ))}
          </div>
          <label className="text-sm text-slate-600">
            最低月均成交量
            <select value={String(minVolume)} onChange={(event) => setMinVolume(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="0">不限</option>
              <option value="1">1M+</option>
              <option value="2">2M+</option>
              <option value="3">3M+</option>
              <option value="5">5M+</option>
              <option value="10">10M+</option>
              <option value="30">30M+</option>
            </select>
          </label>
          <div className="text-sm text-slate-500">
            当前排序基准：
            {comparisonWindow === "previousMonth" ? "上月维度" : comparisonWindow === "previous3Months" ? "上3个月维度" : "上12个月维度"}
          </div>
          <button
            type="button"
            onClick={() => setSelected(defaultSelectedSymbols)}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            恢复默认前5
          </button>
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
              <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(3)}%`} />
              <ReferenceLine y={0} stroke="#64748b" strokeDasharray="6 4" />
              <Tooltip formatter={(value) => `${Number(value).toFixed(3)}%`} />
              {selected.map((symbol, index) => (
                <Line key={symbol} type="monotone" dataKey={symbol} stroke={chartPalette[index % chartPalette.length]} dot={false} strokeWidth={2.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {comparisonRanked.slice(0, 12).map((item) => {
            const active = selected.includes(item.symbol);
            const activeIndex = selected.findIndex((symbol) => symbol === item.symbol);
            const color = active ? chartPalette[activeIndex % chartPalette.length] : "#cbd5e1";
            return (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(item.symbol) ? current.filter((entry) => entry !== item.symbol) : [...current, item.symbol],
                    )
                  }
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${active ? "border-slate-300 bg-slate-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}
                >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                {item.symbol}
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-6">
            <h3 className="text-base font-semibold text-slate-900">费率排名 Top 10</h3>
            <label className="text-sm text-slate-600">
              最低日均成交量
              <select value={String(rankingMinVolume)} onChange={(event) => setRankingMinVolume(Number(event.target.value))} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <option value="0">不限</option>
                <option value="1">1M+</option>
                <option value="2">2M+</option>
                <option value="3">3M+</option>
                <option value="5">5M+</option>
                <option value="10">10M+</option>
                <option value="30">30M+</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
              {windowLeaders.map(({ window, rows }) => (
                <WindowTopList key={window.key} window={window} rows={rows} heatScores={rankingHeatScores} latestDateText={latestDateText} />
              ))}
          </div>
        </Card>
      </div>

      <div>
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-6">
            <h3 className="text-base font-semibold text-slate-900">负费率排名 Top 10</h3>
            <label className="text-sm text-slate-600">
              最低日均成交量
              <select value={String(negativeRankingMinVolume)} onChange={(event) => setNegativeRankingMinVolume(Number(event.target.value))} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <option value="0">不限</option>
                <option value="1">1M+</option>
                <option value="2">2M+</option>
                <option value="3">3M+</option>
                <option value="5">5M+</option>
                <option value="10">10M+</option>
                <option value="30">30M+</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
              {negativeWindowLeaders.map(({ window, rows }) => (
                <WindowTopList key={`negative-${window.key}`} window={window} rows={rows} heatScores={negativeRankingHeatScores} latestDateText={latestDateText} titleMode="negative" />
              ))}
          </div>
        </Card>
      </div>

      <Card title="费率优先表" hint="默认按上12个月年化排序，点击列头可切换升降序。">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-center text-[13px] leading-5">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="w-[84px] py-2.5">
                  <button type="button" onClick={() => toggleSort("symbol")} className="font-medium">
                    币种 {sortKey === "symbol" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[88px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prevMonthYearly")} className="font-medium">
                    上月年化 {sortKey === "prevMonthYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev3MonthsYearly")} className="font-medium">
                    上3个月年化 {sortKey === "prev3MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev6MonthsYearly")} className="font-medium">
                    上6个月年化 {sortKey === "prev6MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev12MonthsYearly")} className="font-medium">
                    上12个月年化 {sortKey === "prev12MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev24MonthsYearly")} className="font-medium">
                    上24个月年化 {sortKey === "prev24MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays30")} className="font-medium">
                    30日正费天数 {sortKey === "positiveDays30" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays90")} className="font-medium">
                    90日正费天数 {sortKey === "positiveDays90" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[100px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays180")} className="font-medium">
                    180日正费天数 {sortKey === "positiveDays180" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg30dVolumeM")} className="font-medium">
                    30日均成交量 {sortKey === "avg30dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg90dVolumeM")} className="font-medium">
                    90日均成交量 {sortKey === "avg90dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg365dVolumeM")} className="font-medium">
                    年日均成交量 {sortKey === "avg365dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[74px] py-2.5">
                  <button type="button" onClick={() => toggleSort("compositeScore")} className="font-medium">
                    分数 {sortKey === "compositeScore" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map(({ row, metrics, compositeScore }) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-2.5 font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prevMonthRankMap.get(row.symbol)?.rank ?? 0, prevMonthRankMap.get(row.symbol)?.total ?? 1, metrics.prevMonthYearly)}`}>
                      {fmtPct(metrics.prevMonthYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev3MonthsRankMap.get(row.symbol)?.rank ?? 0, prev3MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev3MonthsYearly)}`}>
                      {fmtPct(metrics.prev3MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev6MonthsRankMap.get(row.symbol)?.rank ?? 0, prev6MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev6MonthsYearly)}`}>
                      {fmtPct(metrics.prev6MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev12MonthsRankMap.get(row.symbol)?.rank ?? 0, prev12MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev12MonthsYearly)}`}>
                      {fmtPct(metrics.prev12MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev24MonthsRankMap.get(row.symbol)?.rank ?? 0, prev24MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev24MonthsYearly)}`}>
                      {fmtPct(metrics.prev24MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive30RankMap.get(row.symbol)?.rank ?? 0, positive30RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays30}/30
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive90RankMap.get(row.symbol)?.rank ?? 0, positive90RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays90}/90
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[82px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive180RankMap.get(row.symbol)?.rank ?? 0, positive180RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays180}/180
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume30RankMap.get(row.symbol)?.rank ?? 0, volume30RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg30dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume90RankMap.get(row.symbol)?.rank ?? 0, volume90RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg90dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume365RankMap.get(row.symbol)?.rank ?? 0, volume365RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg365dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[54px] justify-center rounded-full px-2 py-1 text-xs font-semibold ${compositeScore >= 75 ? "bg-slate-900 text-white" : compositeScore >= 55 ? "bg-slate-700 text-white" : compositeScore >= 35 ? "bg-slate-200 text-slate-900" : "bg-slate-100 text-slate-600"}`}>
                      {compositeScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function MonthlyMatrixView({ rows, months }: { rows: MonthlyRateRow[]; months: string[] }) {
  const [rangeKey, setRangeKey] = useState<"12" | "24" | "all">("12");
  const [sortKey, setSortKey] = useState<MonthlySortKey>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filterMode, setFilterMode] = useState<"all" | "positive" | "negative" | "volatile">("all");
  const [coverageMonths, setCoverageMonths] = useState<0 | 12 | 24>(12);
  const [searchText, setSearchText] = useState("");

  const completedMonths = months.slice(0, -1);
  const visibleMonths = rangeKey === "12" ? completedMonths.slice(-12) : rangeKey === "24" ? completedMonths.slice(-24) : months;
  const rowSummaries = useMemo(
    () =>
      rows.map((row) => ({
        row,
        summary: summarizeMonthlyRow(row, visibleMonths),
      })),
    [rows, visibleMonths],
  );
  const volatilityThreshold = percentile(
    rowSummaries.map((entry) => entry.summary.volatility).filter((value) => value > 0),
    0.7,
  );

  const visibleSymbols = useMemo(() => {
    const keyword = searchText.trim().toUpperCase();
    return rowSummaries
      .filter(({ row, summary }) => {
        if (keyword && !row.symbol.includes(keyword)) return false;
        if (coverageMonths && summary.availableMonths < coverageMonths) return false;
        if (filterMode === "positive" && summary.total <= 0) return false;
        if (filterMode === "negative" && summary.total >= 0) return false;
        if (filterMode === "volatile" && summary.volatility < volatilityThreshold) return false;
        return true;
      })
      .sort((left, right) => {
        const leftValue = monthlySortValue(left.row, visibleMonths, sortKey);
        const rightValue = monthlySortValue(right.row, visibleMonths, sortKey);
        const factor = sortDirection === "desc" ? -1 : 1;
        if (typeof leftValue === "string" && typeof rightValue === "string") {
          return leftValue.localeCompare(rightValue) * factor;
        }
        return (((leftValue as number) ?? 0) - ((rightValue as number) ?? 0)) * factor;
      });
  }, [coverageMonths, filterMode, rowSummaries, searchText, sortDirection, sortKey, visibleMonths, volatilityThreshold]);

  const cellScale = percentile(
    visibleMonths.flatMap((month) => visibleSymbols.map(({ row }) => Math.abs(row.months[month] ?? 0))).filter((value) => value > 0),
    0.9,
  );
  const topPositive = [...visibleSymbols].sort((a, b) => b.summary.total - a.summary.total)[0];
  const topNegative = [...visibleSymbols].sort((a, b) => a.summary.total - b.summary.total)[0];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">
            月份范围
            <select value={rangeKey} onChange={(event) => setRangeKey(event.target.value as "12" | "24" | "all")} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="12">上12个月</option>
              <option value="24">上24个月</option>
              <option value="all">全部月份</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            列排序
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as MonthlySortKey)} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="total">区间累计</option>
              <option value="lastMonth">最近1月</option>
              <option value="last3Months">最近3月</option>
              <option value="average">月均费率</option>
              <option value="volatility">月费率波动</option>
              <option value="bestMonth">最强单月</option>
              <option value="worstMonth">最弱单月</option>
              <option value="positiveMonths">正费月数</option>
              <option value="symbol">币种名称</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            方向
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            筛选
            <select value={filterMode} onChange={(event) => setFilterMode(event.target.value as "all" | "positive" | "negative" | "volatile")} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="all">全部币种</option>
              <option value="positive">区间累计为正</option>
              <option value="negative">区间累计为负</option>
              <option value="volatile">高波动币种</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            最少月数
            <select value={String(coverageMonths)} onChange={(event) => setCoverageMonths(Number(event.target.value) as 0 | 12 | 24)} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="0">不限</option>
              <option value="12">至少12月</option>
              <option value="24">至少24月</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            搜索币种
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value.toUpperCase())}
              placeholder="如 UNI"
              className="ml-3 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Kpi label="展示月份" value={`${visibleMonths.length}`} hint="当前矩阵纵向月份数。" />
        <Kpi label="展示币种" value={`${visibleSymbols.length}`} hint="当前筛选和排序后的横向币种数。" />
        <Kpi
          label="最强累计"
          value={topPositive ? `${topPositive.row.symbol} ${fmtPct(topPositive.summary.total)}` : "-"}
          hint="当前区间累计费率最高的币种。"
        />
        <Kpi
          label="最弱累计"
          value={topNegative ? `${topNegative.row.symbol} ${fmtPct(topNegative.summary.total)}` : "-"}
          hint={`热力标尺约为 ±${cellScale.toFixed(3)}%`}
        />
      </div>

      <Card title="月度热力矩阵" hint="点击上方筛选后，矩阵会按你选择的区间和排序方式重排币种列。">
        <div className="overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-center text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-[92px] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-left font-semibold text-slate-700">
                  月份
                </th>
                {visibleSymbols.map(({ row }) => (
                  <th key={row.symbol} className="sticky top-0 z-20 min-w-[82px] border-b border-slate-200 bg-white px-2 py-3 font-semibold text-slate-700">
                    {row.symbol}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMonths.map((month) => (
                <tr key={month}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-left font-medium text-slate-600">
                    {month}
                  </td>
                  {visibleSymbols.map(({ row }) => {
                    const value = row.months[month];
                    return (
                      <td
                        key={`${month}-${row.symbol}`}
                        className="border-b border-slate-100 px-2 py-2 font-medium"
                        style={monthlyHeatStyle(value, cellScale)}
                        title={typeof value === "number" ? `${month} ${row.symbol} ${fmtPct(value)}` : `${month} ${row.symbol} 无数据`}
                      >
                        {typeof value === "number" ? value.toFixed(3) : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r border-t border-slate-200 bg-slate-100 px-3 py-3 text-left font-semibold text-slate-700">
                  区间累计
                </td>
                {visibleSymbols.map(({ row, summary }) => (
                  <td key={`total-${row.symbol}`} className="border-t border-slate-200 px-2 py-3 font-semibold" style={monthlyHeatStyle(summary.total, Math.max(cellScale * 3, 0.001))}>
                    {summary.total.toFixed(3)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AuditView({ audits }: { audits: AuditRow[] }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "warning" | "failed" | "inactive">("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [searchText, setSearchText] = useState("");

  const filteredAudits = audits.filter((row) => {
    const keyword = searchText.trim().toUpperCase();
    if (keyword && !row.symbol.includes(keyword)) return false;
    if (statusFilter === "warning" && !["warning", "failed"].includes(row.fundingStatus) && !["warning", "failed"].includes(row.volumeStatus)) return false;
    if (statusFilter === "failed" && row.volumeStatus !== "failed" && row.fundingStatus !== "failed") return false;
    if (statusFilter === "inactive" && row.isActive) return false;
    if (onlyIssues && !["warning", "failed"].includes(row.fundingStatus) && !["warning", "failed"].includes(row.volumeStatus) && row.isActive) return false;
    return true;
  });
  const activeRows = audits.filter((row) => row.isActive);
  const fundingWarnings = audits.filter((row) => ["warning", "failed"].includes(row.fundingStatus));
  const volumeWarnings = audits.filter((row) => ["warning", "failed"].includes(row.volumeStatus));
  const inactiveRows = audits.filter((row) => !row.isActive);
  const volumeFailedRows = audits.filter((row) => row.volumeStatus === "failed");
  const fundingNotRunRows = audits.filter((row) => row.fundingStatus === "not_run");
  const shortHistoryRows = audits.filter((row) => row.volumeNotes?.includes("short_history_or_new_listing"));
  const fundingWarningSymbols = fundingWarnings.map((row) => row.symbol).join(" / ");
  const volumeWarningSymbols = volumeWarnings.map((row) => row.symbol).join(" / ");
  const inactiveSymbols = inactiveRows.map((row) => row.symbol).join(" / ");
  const shortHistorySymbols = shortHistoryRows.map((row) => row.symbol).join(" / ");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="当前活跃币种" value={`${activeRows.length}`} hint="目前数据库里仍在交易状态的币种数量。" />
        <Kpi label="Funding 异常币种" value={`${fundingWarnings.length}`} hint={fundingWarnings.length ? fundingWarningSymbols : "当前 funding 审计没有异常。"} />
        <Kpi label="Volume 异常币种" value={`${volumeWarnings.length}`} hint={volumeWarnings.length ? volumeWarningSymbols : "当前 volume 审计没有异常。"} />
        <Kpi label="短历史新币" value={`${shortHistoryRows.length}`} hint={shortHistoryRows.length ? shortHistorySymbols : "当前没有需要单独标记的新币短历史。"} />
        <Kpi label="当前需处理" value={`${inactiveRows.length + volumeFailedRows.length}`} hint={inactiveRows.length ? `非活跃: ${inactiveSymbols}` : volumeFailedRows.length ? `Volume 失败: ${volumeWarningSymbols}` : "当前没有需要处理的币种。"} />
      </div>

      <Card title="先看结论" hint="这块只回答四个问题：有没有下架币、funding 是否完整、volume 是否异常、新币是不是只是短历史。">
        <div className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4">
            <div className="text-sm text-slate-500">当前活跃状态</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {inactiveRows.length ? `有 ${inactiveRows.length} 个非活跃币` : "全部 22 个币都活跃"}
            </div>
            <div className="mt-2 text-sm text-slate-500">{inactiveRows.length ? inactiveSymbols : "当前没有下架后仍保留历史的数据币种。"}</div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4">
            <div className="text-sm text-slate-500">Funding 审计</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {fundingNotRunRows.length ? "Funding 审计尚未运行" : fundingWarnings.length ? `${fundingWarnings.length} 个币有异常` : "22 个币当前都正常"}
            </div>
            <div className="mt-2 text-sm text-slate-500">{fundingNotRunRows.length ? "当前数据库里还没有 funding_quality_audits 结果。" : fundingWarnings.length ? fundingWarningSymbols : "当前 funding 侧没有 gap 或 0 事件天异常。"}</div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4">
            <div className="text-sm text-slate-500">Volume 审计</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {volumeWarnings.length ? `${volumeWarnings.length} 个币存在异常` : "当前 volume 侧全部正常"}
            </div>
            <div className="mt-2 text-sm text-slate-500">{volumeWarnings.length ? volumeWarningSymbols : "当前 volume 侧没有缺口或失败币种。"}</div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4">
            <div className="text-sm text-slate-500">新币短历史</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {shortHistoryRows.length ? `${shortHistoryRows.length} 个币属于正常短历史` : "当前没有短历史新币"}
            </div>
            <div className="mt-2 text-sm text-slate-500">{shortHistoryRows.length ? shortHistorySymbols : "所有币种当前都已接近完整历史长度。"}</div>
          </div>
        </div>
      </Card>

      <Card title="数据审计明细" hint="如果上面的结论有异常，再往下看这一张表定位具体原因。">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">
            状态筛选
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "warning" | "failed" | "inactive")} className="ml-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="all">全部</option>
              <option value="warning">只看异常</option>
              <option value="failed">只看 failed</option>
              <option value="inactive">只看 inactive</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />
            只保留有问题的币
          </label>
          <label className="text-sm text-slate-600">
            搜索币种
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value.toUpperCase())}
              placeholder="如 WIF"
              className="ml-3 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </label>
          <div className="text-sm text-slate-500">当前显示 {filteredAudits.length} / {audits.length}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 text-left">币种</th>
                <th className="py-3">是否活跃</th>
                <th className="py-3">Funding 状态</th>
                <th className="py-3">Funding 分数</th>
                <th className="py-3">Funding 缺口数</th>
                <th className="py-3">0事件天数</th>
                <th className="py-3">Volume 状态</th>
                <th className="py-3">Volume 分数</th>
                <th className="py-3">Volume 覆盖天数</th>
                <th className="py-3">Volume 缺口数</th>
                <th className="py-3 text-left">备注</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudits.map((row) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-3 text-left font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {row.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${auditTone(row.fundingStatus)}`}>{row.fundingStatus}</span>
                  </td>
                  <td className="py-3 font-medium text-slate-900">{row.fundingScore.toFixed(1)}</td>
                  <td className="py-3 text-slate-600">{row.fundingGapCount}</td>
                  <td className="py-3 text-slate-600">{row.fundingZeroEventDays}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${auditTone(row.volumeStatus)}`}>{row.volumeStatus}</span>
                  </td>
                  <td className="py-3 font-medium text-slate-900">{row.volumeScore.toFixed(1)}</td>
                  <td className="py-3 text-slate-600">{row.volumeDayCount}</td>
                  <td className="py-3 text-slate-600">{row.volumeGapCount}</td>
                  <td className="py-3 text-left text-xs text-slate-500">
                    {formatAuditNotes(row.fundingNotes, row.volumeNotes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function VolumeView({ symbols, timeframe }: { symbols: MarketSymbol[]; timeframe: Timeframe }) {
  const ranked = useMemo(() => buildVolumeTable(symbols, timeframe), [symbols, timeframe]);
  const [selectedSymbol, setSelectedSymbol] = useState(ranked[0]?.symbol ?? "");
  const focus = ranked.find((item) => item.symbol === selectedSymbol) ?? ranked[0];
  const trendRows = focus ? getVolumeTrend(focus, timeframe) : [];
  const topRows = ranked.slice(0, 12).map((row) => ({
    symbol: row.symbol,
    volume: getVolumeValue(row, timeframe),
    rate: getRateValue(row, timeframe),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="最高成交量" value={ranked[0] ? `${ranked[0].symbol} ${fmtVol(getVolumeValue(ranked[0], timeframe))}` : "-"} hint="成交量只负责确认容量，不代表费率优先。" />
        <Kpi label="高量但负费率" value={ranked.find((item) => getRateValue(item, timeframe) < 0) ? `${ranked.find((item) => getRateValue(item, timeframe) < 0)?.symbol} ${fmtPct(getRateValue(ranked.find((item) => getRateValue(item, timeframe) < 0)!, timeframe))}` : "-"} hint="像 BTC/ETH 这种情况需要单独识别，不自动优先。" />
        <Kpi label="低量排除线" value="5M" hint="超低流动性币种默认不进入重点观察。" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card title="成交量排名" hint="当前时间维度下的成交量排序，颜色仍用费率方向辅助判断。">
          <div className="h-[360px] w-full">
            <ResponsiveContainer>
              <BarChart data={topRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="symbol" tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${value}M`} />
                <Tooltip />
                <Bar dataKey="volume" radius={[6, 6, 0, 0]}>
                  {topRows.map((row) => (
                    <Cell key={row.symbol} fill={row.rate > 0 ? "#0f766e" : "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="单币成交量走势" hint="先看容量曲线，再回到费率页判断值不值得做。">
          <div className="mb-4 flex flex-wrap gap-2">
            {ranked.slice(0, 12).map((item) => (
              <button key={item.symbol} type="button" onClick={() => setSelectedSymbol(item.symbol)} className={`rounded-full border px-3 py-1 text-sm ${focus?.symbol === item.symbol ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                {item.symbol}
              </button>
            ))}
          </div>
          <div className="h-[360px] w-full">
            <ResponsiveContainer>
              <LineChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${value}M`} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="流动性分层" hint="这页不判断值不值得做，只判断容量够不够。">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">超高流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 100).length}</div>
            <div className="mt-1 text-sm text-slate-500">100M 以上。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">高流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 30 && getVolumeValue(row, timeframe) < 100).length}</div>
            <div className="mt-1 text-sm text-slate-500">30M 到 100M。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">中等流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 5 && getVolumeValue(row, timeframe) < 30).length}</div>
            <div className="mt-1 text-sm text-slate-500">5M 到 30M。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">低流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) < 5).length}</div>
            <div className="mt-1 text-sm text-slate-500">低于 5M。</div>
          </div>
        </div>
      </Card>

      <Card title="成交量观察表" hint="这页只判断容量，不替代费率判断。">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">币种</th>
                <th className="py-3 text-right">{volumeMetricLabel(timeframe)}</th>
                <th className="py-3 text-right">当前费率</th>
                <th className="py-3 text-right">30日均费率</th>
                <th className="py-3 text-right">30日正费天数</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-3 text-right text-slate-600">{fmtVol(getVolumeValue(row, timeframe))}</td>
                  <td className={`py-3 text-right ${rateText(getRateValue(row, timeframe))}`}>{fmtPct(getRateValue(row, timeframe))}</td>
                  <td className="py-3 text-right text-slate-600">{fmtPct(row.avg30dRatePct)}</td>
                  <td className="py-3 text-right text-slate-600">{row.positiveDays30}/30</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CombinedView({ symbols }: { symbols: MarketSymbol[] }) {
  const scoredRows = useMemo(
    () => [...buildPriorityTableRows(symbols).rows].sort((a, b) => b.compositeScore - a.compositeScore),
    [symbols],
  );
  const combinedSections: { key: RateWindowKey; title: string; hint: string }[] = [
    { key: "currentMonth", title: "当前费率 + 成交量", hint: "X 轴看当前费率，Y 轴看本月日均成交量，点大小看费率优先分。" },
    { key: "previousMonth", title: "上月费率 + 成交量", hint: "X 轴看上月累计费率，Y 轴看上月日均成交量，点大小看费率优先分。" },
    { key: "previous3Months", title: "上3个月费率 + 成交量", hint: "X 轴看上3个月累计费率，Y 轴看上3个月日均成交量，点大小看费率优先分。" },
    { key: "previous6Months", title: "上6个月费率 + 成交量", hint: "X 轴看上6个月累计费率，Y 轴看上6个月日均成交量，点大小看费率优先分。" },
    { key: "previous12Months", title: "上12个月费率 + 成交量", hint: "X 轴看上12个月累计费率，Y 轴看上12个月日均成交量，点大小看费率优先分。" },
  ];
  const highScorePositive = [...scoredRows]
    .filter((entry) => entry.row.rateMonthPct > 0)
    .sort((a, b) => b.compositeScore - a.compositeScore)[0];
  const volumeLeader = [...scoredRows].sort((a, b) => b.row.avg30dVolumeM - a.row.avg30dVolumeM)[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="分数来源" value="费率优先表" hint="点大小直接复用费率总览里费率优先表的综合分数。" />
        <Kpi label="当前高分正费率" value={highScorePositive ? `${highScorePositive.row.symbol} ${highScorePositive.compositeScore}` : "-"} hint="同时满足正费率和高优先分的币，更适合优先看。" />
        <Kpi label="当前高量币" value={volumeLeader ? `${volumeLeader.row.symbol} ${fmtVol(volumeLeader.row.avg30dVolumeM)}` : "-"} hint="高量不代表优先，只代表容量够大。" />
      </div>

      <div className="grid gap-6">
        {combinedSections.map((section) => {
          const sectionVolumeCap = volumeAxisCap(scoredRows.map((entry) => getWindowVolumeValue(entry.row, section.key)));
          const sectionRateCap = rateAxisCap(scoredRows.map((entry) => getWindowRateValue(entry.row, section.key)));
          const scatterRows = scoredRows.map((entry) => ({
            symbol: entry.row.symbol,
            x: Math.min(Math.max(getWindowVolumeValue(entry.row, section.key), 0.1), sectionVolumeCap),
            y: Math.max(Math.min(getWindowRateValue(entry.row, section.key), sectionRateCap), -sectionRateCap),
            rawRate: getWindowRateValue(entry.row, section.key),
            rawVolume: getWindowVolumeValue(entry.row, section.key),
            z: Math.max(entry.compositeScore, 10),
            score: entry.compositeScore,
          }));
          const strongestRate = [...scatterRows].sort((a, b) => b.rawRate - a.rawRate)[0];
          const highestVolume = [...scatterRows].sort((a, b) => b.rawVolume - a.rawVolume)[0];

          return (
            <Card key={section.key} title={section.title} hint={`${section.hint} 成交量轴做对数压缩，费率轴按对称 P95 封顶，避免极端值挤压主体分布。`}>
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">最高费率</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {strongestRate ? `${strongestRate.symbol} ${fmtPct(strongestRate.x)}` : "-"}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">最高成交量</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {highestVolume ? `${highestVolume.symbol} ${fmtVol(highestVolume.y)}` : "-"}
                  </div>
                </div>
              </div>
              <div className="h-[420px] w-full">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" dataKey="x" name="volume" scale="log" domain={[0.1, sectionVolumeCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(0)}M`} />
                    <YAxis type="number" dataKey="y" name="rate" domain={[-sectionRateCap, sectionRateCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(2)}%`} />
                    <ZAxis type="number" dataKey="z" range={[90, 500]} />
                    <ReferenceLine x={Math.min(5, sectionVolumeCap)} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={<CombinedScatterTooltip />}
                    />
                    <Scatter data={scatterRows}>
                      {scatterRows.map((row) => (
                        <Cell key={`${section.key}-${row.symbol}`} fill={row.rawRate >= 0 ? "#059669" : "#dc2626"} fillOpacity={0.78} stroke="#ffffff" strokeWidth={1.5} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function HeatmapView({ symbols }: { symbols: MarketSymbol[] }) {
  const heatmapSections: { key: "current" | "prevMonth" | "prev3Months" | "prev6Months" | "prev12Months"; title: string; hint: string }[] = [
    { key: "current", title: "当前费率热力图", hint: "当前月累计费率。" },
    { key: "prevMonth", title: "上月费率热力图", hint: "上一个完整月的累计费率。" },
    { key: "prev3Months", title: "上3个月热力图", hint: "不含本月，近 3 个完整月累计费率。" },
    { key: "prev6Months", title: "上6个月热力图", hint: "不含本月，近 6 个完整月累计费率。" },
    { key: "prev12Months", title: "上12个月热力图", hint: "不含本月，近 12 个完整月累计费率。" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="面积含义" value="费率强弱" hint="面积越大，代表该维度费率绝对值越大。" />
        <Kpi label="颜色含义" value="费率方向" hint="绿色偏正费率，红色偏负费率，颜色深浅仍看费率强弱。" />
        <Kpi label="用途" value="多周期扫盘" hint="同一页快速对比当前、上月、上6个月、上12个月的费率结构。" />
      </div>

      <div className="grid gap-6">
        {heatmapSections.map((section) => {
          const sectionValues = symbols.map((item) => heatmapMetricValue(item, section.key));
          const sectionScale = heatmapColorScale(sectionValues);
          const ranked = [...symbols].sort((a, b) => heatmapMetricValue(b, section.key) - heatmapMetricValue(a, section.key));
          const biggest = [...symbols].sort((a, b) => Math.abs(heatmapMetricValue(b, section.key)) - Math.abs(heatmapMetricValue(a, section.key)))[0];
          const heatmapData = [
            {
              name: section.title,
              children: symbols.map((item) => ({
                name: item.symbol,
                size: Math.max(Math.abs(heatmapMetricValue(item, section.key)), 0.001),
                rate: heatmapMetricValue(item, section.key),
                scale: sectionScale,
              })),
            },
          ];

          return (
            <Card
              key={section.key}
              title={section.title}
              hint={`${section.hint} 面积看费率绝对值，颜色看费率方向，并对极端值做封顶避免整图失真。`}
            >
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">最强正费率</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {ranked[0] ? `${ranked[0].symbol} ${fmtPct(heatmapMetricValue(ranked[0], section.key))}` : "-"}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">最大面积</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {biggest ? `${biggest.symbol} ${fmtPct(heatmapMetricValue(biggest, section.key))}` : "-"}
                  </div>
                </div>
              </div>
              <div className="h-[420px] w-full">
                <ResponsiveContainer>
                  <Treemap data={heatmapData} dataKey="size" aspectRatio={4 / 3} stroke="#fff" content={<HeatmapNode />}>
                    <Tooltip formatter={(value) => fmtPct(Number(value))} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ResearchManualRegimeEditor({
  symbol,
  points,
  manualRegimeRows,
  editableSymbols,
}: {
  symbol: string;
  points: BtcWeeklyResearchData["points"];
  manualRegimeRows: BtcWeeklyResearchData["manualRegimeRows"];
  editableSymbols: BtcWeeklyResearchData["editableSymbols"];
}) {
  const normalizedSymbols = useMemo(() => {
    const values = [...new Set([symbol, ...editableSymbols].map((item) => item.trim().toUpperCase()).filter(Boolean))];
    return values.sort((left, right) => (left === symbol ? -1 : right === symbol ? 1 : left.localeCompare(right)));
  }, [editableSymbols, symbol]);
  const [targetSymbol, setTargetSymbol] = useState(symbol);
  const [draftRegimes, setDraftRegimes] = useState<EditableResearchRegime[]>([]);
  const [selectedStartIndex, setSelectedStartIndex] = useState<number | null>(points[0] ? 0 : null);
  const [selectedEndIndex, setSelectedEndIndex] = useState<number | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<ManualRegimeLabel>("震荡");
  const [manualStart, setManualStart] = useState(points[0]?.weekStart ?? "");
  const [manualEnd, setManualEnd] = useState(points.at(-1)?.weekEnd ?? "");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [replaceOverlaps, setReplaceOverlaps] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextRows = manualRegimeRows.filter((row) => row.symbol === targetSymbol).map(toEditableRegime);
    setDraftRegimes(nextRows);
    setEditingIndex(null);
  }, [manualRegimeRows, targetSymbol]);

  const usesBrushSelection = targetSymbol === symbol;
  const effectiveStartIndex = selectedStartIndex == null ? null : selectedEndIndex == null ? selectedStartIndex : Math.min(selectedStartIndex, selectedEndIndex);
  const effectiveEndIndex = selectedStartIndex == null ? null : selectedEndIndex == null ? selectedStartIndex : Math.max(selectedStartIndex, selectedEndIndex);
  const selectionStart = effectiveStartIndex == null ? null : points[effectiveStartIndex];
  const selectionEnd = effectiveEndIndex == null ? null : points[effectiveEndIndex];
  const previewStart = selectionStart?.weekStart ?? "";
  const previewEnd = selectionEnd?.weekEnd ?? "";

  useEffect(() => {
    if (!usesBrushSelection) return;
    setManualStart(previewStart);
    setManualEnd(previewEnd);
  }, [previewEnd, previewStart, usesBrushSelection]);

  const btcDraftRanges = useMemo(
    () =>
      draftRegimes
        .filter((row) => row.symbol === symbol)
        .map((regime) => {
          const rangePoints = points.filter((point) => point.weekStart >= regime.start && point.weekStart < regime.end);
          if (!rangePoints.length) return null;
          return {
            ...regime,
            x1: rangePoints[0].weekStart,
            x2: rangePoints.at(-1)?.weekStart ?? rangePoints[0].weekStart,
          };
        })
        .filter((item): item is EditableResearchRegime & { x1: string; x2: string } => item !== null),
    [draftRegimes, points, symbol],
  );

  const selectionMetrics = useMemo(() => {
    if (!selectionStart || !selectionEnd) return null;
    const selectedPoints = points.filter((point) => point.weekStart >= selectionStart.weekStart && point.weekStart < selectionEnd.weekEnd);
    if (!selectedPoints.length) return null;
    const firstClose = selectedPoints[0].closePrice;
    const lastClose = selectedPoints.at(-1)?.closePrice ?? firstClose;
    const pathReturns = firstClose ? selectedPoints.map((point) => ((point.closePrice / firstClose) - 1) * 100) : [];
    const weeklyReturns = selectedPoints.length >= 2
      ? selectedPoints.slice(1).map((point, index) => ((point.closePrice / selectedPoints[index].closePrice) - 1) * 100)
      : [];
    return {
      weeks: selectedPoints.length,
      cumulativeReturnPct: firstClose && lastClose ? Number((((lastClose / firstClose) - 1) * 100).toFixed(2)) : 0,
      avgFundingRatePct: Number(avgValues(selectedPoints.map((point) => point.fundingRatePct)).toFixed(3)),
      avgVolumeM: Number(avgValues(selectedPoints.map((point) => point.avgVolumeM)).toFixed(1)),
      maxAdvancePct: pathReturns.length ? Number(Math.max(...pathReturns).toFixed(2)) : 0,
      maxDrawdownPct: pathReturns.length ? Number(Math.min(...pathReturns).toFixed(2)) : 0,
      volatilityPct: Number(stdDev(weeklyReturns).toFixed(3)),
      positiveFundingWeeks: selectedPoints.filter((point) => point.fundingRatePct > 0).length,
      positiveReturnWeeks: selectedPoints.filter((point) => point.weeklyReturnPct > 0).length,
    };
  }, [points, selectionEnd, selectionStart]);

  const pendingSelection = useMemo(() => {
    const start = usesBrushSelection ? selectionStart?.weekStart ?? "" : manualStart;
    const end = usesBrushSelection ? selectionEnd?.weekEnd ?? "" : manualEnd;
    if (!targetSymbol || !start || !end || start >= end) return null;
    return {
      symbol: targetSymbol,
      start,
      end,
      label: selectedLabel,
      tone: manualRegimeTone(selectedLabel),
      stateClass: manualRegimeStateClass(selectedLabel),
    } satisfies EditableResearchRegime;
  }, [manualEnd, manualStart, selectedLabel, selectionEnd, selectionStart, targetSymbol, usesBrushSelection]);

  const overlappingDraftRows = useMemo(() => {
    if (!pendingSelection) return [];
    return draftRegimes.filter((row, index) => index !== editingIndex && row.symbol === pendingSelection.symbol && hasRegimeOverlap(row, pendingSelection));
  }, [draftRegimes, editingIndex, pendingSelection]);

  const findDraftRowIndex = (targetRow: EditableResearchRegime) =>
    draftRegimes.findIndex(
      (row) => row.symbol === targetRow.symbol && row.start === targetRow.start && row.end === targetRow.end && row.label === targetRow.label,
    );

  const handleChartClick = (state?: { activePayload?: Array<{ payload?: BtcWeeklyResearchData["points"][number] }> }) => {
    if (!usesBrushSelection) return;
    const clickedPoint = state?.activePayload?.[0]?.payload;
    if (!clickedPoint) return;
    const clickedIndex = points.findIndex((point) => point.weekStart === clickedPoint.weekStart);
    if (clickedIndex < 0) return;
    if (selectedStartIndex == null || selectedEndIndex != null) {
      setSelectedStartIndex(clickedIndex);
      setSelectedEndIndex(null);
      setSaveError("");
      setSaveMessage("已选起点，再点一次终点即可。");
      return;
    }
    setSelectedEndIndex(clickedIndex);
    setSaveError("");
    setSaveMessage("区间已选好，可以直接看参数并保存。");
  };

  const applyCurrentSelection = () => {
    if (!pendingSelection) {
      setSaveError("请先给出有效的币种和时间范围，结束时间必须晚于开始时间。");
      setSaveMessage("");
      return;
    }
    let nextRegimes = [...draftRegimes];
    if (replaceOverlaps) {
      nextRegimes = nextRegimes.filter((row, index) => index === editingIndex || row.symbol !== pendingSelection.symbol || !hasRegimeOverlap(row, pendingSelection));
    } else if (overlappingDraftRows.length) {
      setSaveError(`新区间会和 ${overlappingDraftRows.length} 段已有区间重叠，请先处理，或勾选“用当前新区间覆盖全部重叠区间”。`);
      setSaveMessage("");
      return;
    }
    if (editingIndex == null) {
      nextRegimes.push(pendingSelection);
    } else {
      nextRegimes[editingIndex] = pendingSelection;
    }
    nextRegimes.sort((left, right) => left.start.localeCompare(right.start));
    setDraftRegimes(nextRegimes);
    setEditingIndex(null);
    setSaveError("");
    setSaveMessage(
      replaceOverlaps && overlappingDraftRows.length
        ? `新区间已加入待保存列表，并覆盖了 ${overlappingDraftRows.length} 段重叠区间。`
        : editingIndex == null
          ? "新区间已加入待保存列表。"
          : "区间修改已加入待保存列表。",
    );
  };

  const loadRowIntoBrush = (row: EditableResearchRegime, index: number) => {
    setTargetSymbol(row.symbol);
    if (row.symbol === symbol) {
      const startIndex = Math.max(points.findIndex((point) => point.weekStart === row.start), 0);
      const endIndex = Math.max(points.findIndex((point) => point.weekEnd === row.end), startIndex);
      setSelectedStartIndex(startIndex);
      setSelectedEndIndex(endIndex);
    }
    setManualStart(row.start);
    setManualEnd(row.end);
    setSelectedLabel(row.label);
    setEditingIndex(index);
    setSaveError("");
    setSaveMessage("");
  };

  const removeRow = (index: number) => {
    setDraftRegimes(draftRegimes.filter((_, rowIndex) => rowIndex !== index));
    setEditingIndex((current) => (current === index ? null : current));
    setSaveMessage("区间已从待保存列表移除。");
    setSaveError("");
  };

  const saveRegimes = async () => {
    setSaveError("");
    setSaveMessage("");
    setSaving(true);
    startTransition(async () => {
      try {
        await saveManualResearchRegimes(
          targetSymbol,
          draftRegimes.map((row) => ({
            symbol: targetSymbol,
            start: row.start,
            end: row.end,
            label: row.label,
          })),
          { replaceOverlaps },
        );
        setSaveMessage("区间已保存，正在刷新研究页。");
        window.location.reload();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "保存失败");
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <Card title="手动区间编辑器" hint="BTC 改成图上点起点、点终点。选完后先看周数、涨跌、波动，再决定标签。保存后，研究页底色会按标签显示成热力带。">
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-xs text-slate-500">
              {usesBrushSelection ? `当前正在用 ${symbol} 周线图点选区间。第一次点起点，第二次点终点，第三次会重新开始。` : `当前目标币种是 ${targetSymbol}，请直接用右侧日期框录入区间。`}
            </div>
            <div className="h-[180px] w-full">
              <ResponsiveContainer>
                <LineChart data={points} onClick={handleChartClick}>
                  {btcDraftRanges.map((regime) => (
                    <ReferenceArea key={`draft-range-${regime.symbol}-${regime.start}`} x1={regime.x1} x2={regime.x2} fill={regime.tone} fillOpacity={0.34} strokeOpacity={0} />
                  ))}
                  {selectionStart && selectionEnd ? (
                    <ReferenceArea x1={selectionStart.weekStart} x2={selectionEnd.weekStart} fill={manualRegimeTone(selectedLabel)} fillOpacity={0.44} strokeOpacity={0} />
                  ) : null}
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="weekStart" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={26} tickFormatter={(value) => value.slice(2, 10)} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip content={() => null} />
                  <Line type="monotone" dataKey="closePrice" stroke="#2563eb" dot={false} strokeWidth={2.2} />
                  {selectionStart ? <ReferenceLine x={selectionStart.weekStart} stroke="#0f172a" strokeDasharray="4 4" /> : null}
                  {selectionEnd ? <ReferenceLine x={selectionEnd.weekStart} stroke="#0f172a" strokeDasharray="4 4" /> : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-600">
                目标币种
                <input
                  list="research-manual-symbols"
                  value={targetSymbol}
                  onChange={(event) => setTargetSymbol(event.target.value.trim().toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  placeholder="BTC / SOL"
                />
                <datalist id="research-manual-symbols">
                  {normalizedSymbols.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">录入方式</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{usesBrushSelection ? "图表点选" : "手动日期"}</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">选中开始</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{previewStart || "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">选中结束</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{previewEnd || "-"}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-600">
                区间开始
                <input
                  type="date"
                  value={manualStart}
                  onChange={(event) => setManualStart(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-sm text-slate-600">
                区间结束
                <input
                  type="date"
                  value={manualEnd}
                  onChange={(event) => setManualEnd(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                />
              </label>
            </div>
            <div className="mt-4">
              <label className="text-sm text-slate-600">
                区间标签
                <select value={selectedLabel} onChange={(event) => setSelectedLabel(event.target.value as ManualRegimeLabel)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                  {manualRegimeLabelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">周数</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectionMetrics ? `${selectionMetrics.weeks} 周` : "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">区间涨跌</div>
                <div className={`mt-1 text-sm font-medium ${rateText(selectionMetrics?.cumulativeReturnPct ?? 0)}`}>{selectionMetrics ? fmtPct(selectionMetrics.cumulativeReturnPct) : "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">波动</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectionMetrics ? fmtPct(selectionMetrics.volatilityPct) : "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">最大上冲</div>
                <div className={`mt-1 text-sm font-medium ${rateText(selectionMetrics?.maxAdvancePct ?? 0)}`}>{selectionMetrics ? fmtPct(selectionMetrics.maxAdvancePct) : "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">最大回撤</div>
                <div className={`mt-1 text-sm font-medium ${rateText(selectionMetrics?.maxDrawdownPct ?? 0)}`}>{selectionMetrics ? fmtPct(selectionMetrics.maxDrawdownPct) : "-"}</div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">平均周费率 / 日均成交量</div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  {selectionMetrics ? `${fmtPct(selectionMetrics.avgFundingRatePct)} / ${fmtVol(selectionMetrics.avgVolumeM)}` : "-"}
                </div>
              </div>
            </div>
            {overlappingDraftRows.length ? (
              <div className="mt-4 rounded-[16px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-medium">新区间会和以下区间重叠</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {overlappingDraftRows.map((row) => (
                    <button
                      key={`${row.symbol}-${row.start}-${row.end}`}
                      type="button"
                      onClick={() => {
                        const rowIndex = findDraftRowIndex(row);
                        if (rowIndex >= 0) loadRowIntoBrush(row, rowIndex);
                      }}
                      className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
                    >
                      {row.symbol} {row.label} {row.start} ~ {row.end}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={replaceOverlaps} onChange={(event) => setReplaceOverlaps(event.target.checked)} />
              用当前新区间覆盖全部重叠区间，以最新这段为准
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={applyCurrentSelection} className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white">
                {editingIndex == null ? "加入待保存列表" : "更新当前区间"}
              </button>
              {usesBrushSelection ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStartIndex(points[0] ? 0 : null);
                    setSelectedEndIndex(null);
                    setManualStart(points[0]?.weekStart ?? "");
                    setManualEnd(points[0]?.weekEnd ?? "");
                    setSaveError("");
                    setSaveMessage("已清空当前点选区间。");
                  }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
                >
                  重新点选
                </button>
              ) : null}
              {editingIndex != null ? (
                <button type="button" onClick={() => setEditingIndex(null)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
                  取消编辑
                </button>
              ) : null}
              <button type="button" onClick={saveRegimes} disabled={saving} className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 disabled:opacity-60">
                {saving ? "保存中..." : "保存到本地文件"}
              </button>
            </div>
            {saveMessage ? <div className="mt-3 text-sm text-emerald-700">{saveMessage}</div> : null}
            {saveError ? <div className="mt-3 text-sm text-rose-600">{saveError}</div> : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">区间</th>
                <th className="py-3">币种</th>
                <th className="py-3">时间范围</th>
                <th className="py-3">标签</th>
                <th className="py-3 text-right">周数</th>
                <th className="py-3 text-right">涨跌</th>
                <th className="py-3 text-right">波动</th>
                <th className="py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {draftRegimes.map((row, index) => {
                const rowPoints = row.symbol === symbol ? points.filter((point) => point.weekStart >= row.start && point.weekStart < row.end) : [];
                const firstClose = rowPoints[0]?.closePrice ?? 0;
                const lastClose = rowPoints.at(-1)?.closePrice ?? firstClose;
                const weeklyReturns = rowPoints.length >= 2
                  ? rowPoints.slice(1).map((point, rowIndex) => ((point.closePrice / rowPoints[rowIndex].closePrice) - 1) * 100)
                  : [];
                const cumulativeReturnPct = firstClose && lastClose ? Number((((lastClose / firstClose) - 1) * 100).toFixed(2)) : 0;
                const volatilityPct = rowPoints.length >= 2 ? Number(stdDev(weeklyReturns).toFixed(3)) : 0;
                return (
                  <tr key={`${row.start}-${row.end}-${index}`} className="border-b border-slate-100">
                    <td className="py-3 font-medium text-slate-900">#{index + 1}</td>
                    <td className="py-3 text-slate-600">{row.symbol}</td>
                    <td className="py-3 text-slate-600">{formatDateSpan(row.start, row.end)}</td>
                    <td className="py-3">
                      <span className="inline-flex rounded-full px-3 py-1 text-xs font-medium text-slate-900" style={{ backgroundColor: row.tone }}>
                        {row.label}
                      </span>
                    </td>
                    <td className="py-3 text-right text-slate-600">{rowPoints.length || "-"}</td>
                    <td className={`py-3 text-right ${rowPoints.length ? rateText(cumulativeReturnPct) : "text-slate-400"}`}>{rowPoints.length ? fmtPct(cumulativeReturnPct) : "-"}</td>
                    <td className="py-3 text-right text-slate-600">{rowPoints.length ? fmtPct(volatilityPct) : "-"}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => loadRowIntoBrush(row, index)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                          载入编辑
                        </button>
                        <button type="button" onClick={() => removeRow(index)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function ResearchView({ researchData }: { researchData?: BtcWeeklyResearchData }) {
  const points = researchData?.points ?? [];
  const latestPoint = researchData?.points.at(-1) ?? null;
  const [hoverPoint, setHoverPoint] = useState<BtcWeeklyResearchData["points"][number] | null>(latestPoint);

  useEffect(() => {
    setHoverPoint(latestPoint);
  }, [latestPoint]);

  if (!researchData || researchData.loadError) {
    return (
      <Card title="BTC 周线研究" hint="固定先看 BTC 周线，把价格、费率、成交量和市场阶段放到同一时间轴。">
        <div className="rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          {researchData?.loadError ?? "研究数据暂不可用。"}
        </div>
      </Card>
    );
  }

  const regimeRanges = researchData.regimes
    .map((regime) => {
      const rangePoints = points.filter((point) => point.weekStart >= regime.start && point.weekStart < regime.end);
      if (!rangePoints.length) return null;
      return {
        ...regime,
        x1: rangePoints[0].weekStart,
        x2: rangePoints[rangePoints.length - 1].weekStart,
      };
    })
    .filter((item): item is (typeof researchData.regimes)[number] & { x1: string; x2: string } => item !== null);
  const handleResearchHover = (state?: { activePayload?: Array<{ payload?: BtcWeeklyResearchData["points"][number] }> }) => {
    const point = state?.activePayload?.[0]?.payload;
    if (point) setHoverPoint(point);
  };
  const activeRegime = hoverPoint ? researchData.regimes.find((regime) => hoverPoint.weekStart >= regime.start && hoverPoint.weekStart < regime.end) : null;
  const activeRegimePoints = activeRegime
    ? points.filter((point) => point.weekStart >= activeRegime.start && point.weekStart < activeRegime.end)
    : [];
  const activeRegimeStat = activeRegime
    ? researchData.regimeStats.find((row) => row.start === activeRegime.start && row.end === activeRegime.end)
    : null;
  const activeRegimeWeeks = activeRegimePoints.length;
  const activeRegimeWeekIndex = hoverPoint ? activeRegimePoints.findIndex((point) => point.weekStart === hoverPoint.weekStart) + 1 : 0;
  const activeRegimeReturn =
    activeRegimePoints.length >= 2
      ? Number((((activeRegimePoints[activeRegimePoints.length - 1].closePrice / activeRegimePoints[0].closePrice) - 1) * 100).toFixed(3))
      : 0;
  const priceValues = points.map((point) => point.closePrice);
  const fundingValues = points.map((point) => point.fundingRatePct);
  const volumeValues = points.map((point) => point.avgVolumeM).filter((value) => value > 0);
  const priceMin = priceValues.length ? Math.min(...priceValues) : 0;
  const priceMax = priceValues.length ? Math.max(...priceValues) : 0;
  const pricePadding = priceMax > priceMin ? (priceMax - priceMin) * 0.08 : priceMax * 0.05;
  const fundingCap = rateAxisCap(fundingValues);
  const volumeFloor = volumeValues.length ? Math.max(Math.min(...volumeValues) * 0.85, 1) : 1;
  const volumeCap = Math.max(volumeAxisCap(volumeValues), volumeFloor * 1.1);
  const autoRegimePointMap = new Map(researchData.autoRegimePoints.map((point) => [point.weekStart, point]));
  const autoComparisonRows = points.map((point) => {
    const autoPoint = autoRegimePointMap.get(point.weekStart);
    return {
      ...point,
      autoHeatScore: autoPoint?.heatScore ?? 0,
      autoHeatColor: autoPoint?.heatColor ?? "#cbd5e1",
      autoSegmentIndex: autoPoint?.segmentIndex ?? 0,
      autoStateLabel: autoPoint?.stateLabel ?? "震荡",
      autoSource: autoPoint?.source ?? "auto",
      autoNote: autoPoint?.note,
    };
  });
  const autoRegimeRanges = researchData.autoRegimeSegments
    .map((segment) => {
      const segmentPoints = researchData.autoRegimePoints.filter((point) => point.segmentIndex === segment.index);
      if (!segmentPoints.length) return null;
      return {
        ...segment,
        x1: segmentPoints[0].weekStart,
        x2: segmentPoints.at(-1)?.weekStart ?? segmentPoints[0].weekStart,
      };
    })
    .filter((segment): segment is (typeof researchData.autoRegimeSegments)[number] & { x1: string; x2: string } => segment !== null);
  const autoAverageWeeks = researchData.autoRegimeSegments.length
    ? Number((researchData.autoRegimeSegments.reduce((sum, segment) => sum + segment.weeks, 0) / researchData.autoRegimeSegments.length).toFixed(1))
    : 0;
  const strongestAutoSegment = [...researchData.autoRegimeSegments].sort((left, right) => right.heatScore - left.heatScore)[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {researchData.lagStats.map((stat) => (
          <Kpi
            key={stat.metric}
            label={stat.metric}
            value={`领先 ${stat.bestLagWeeks} 周`}
            hint={`相关系数 ${stat.correlation >= 0 ? "+" : ""}${stat.correlation.toFixed(3)}，用于先粗看谁更早启动。`}
          />
        ))}
        <Kpi label="数据源" value={`${researchData.symbol} 周线`} hint={researchData.sourceLabel} />
      </div>

      <ResearchManualRegimeEditor
        symbol={researchData.symbol}
        points={points}
        manualRegimeRows={researchData.manualRegimeRows}
        editableSymbols={researchData.editableSymbols}
      />

      <Card title={`${researchData.symbol} 周线联动图`} hint="上到下依次看价格、周费率、周成交量和你定义的市场区间，同一时间轴同步联动。价格轴做轻微压缩，费率和成交量轴做封顶，避免少数极值把主体信息洗平。">
        <div className="mb-4 flex flex-wrap gap-2">
          {researchData.regimes.map((regime) => (
            <span key={`${regime.label}-${regime.start}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: regime.tone }} />
              {regime.label} {regime.start.slice(5)} ~ {regime.end.slice(5)}
            </span>
          ))}
        </div>

        <div className="mb-4 rounded-[18px] border border-slate-200 bg-white/75 px-4 py-3 shadow-sm backdrop-blur">
          {hoverPoint ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
              <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">时间</div>
                  <div className="mt-1 font-medium text-slate-900">{hoverPoint.weekStart}</div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">区间</div>
                  <div className="mt-1 font-medium text-slate-900">{hoverPoint.regimeLabel}</div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">区间进度</div>
                  <div className="mt-1 font-medium text-slate-900">
                    第 {fmtCount(activeRegimeWeekIndex)} / {fmtCount(activeRegimeWeeks)} 周
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">价格</div>
                  <div className="mt-1 font-medium text-slate-900">{fmtPrice(hoverPoint.closePrice)}</div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">周费率</div>
                  <div className={`mt-1 font-medium ${rateText(hoverPoint.fundingRatePct)}`}>{fmtPct(hoverPoint.fundingRatePct)}</div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs text-slate-500">周日均成交量</div>
                  <div className="mt-1 font-medium text-slate-900">{fmtVol(hoverPoint.avgVolumeM)}</div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3 sm:col-span-2 xl:col-span-1">
                  <div className="text-xs text-slate-500">周涨跌</div>
                  <div className={`mt-1 font-medium ${rateText(hoverPoint.weeklyReturnPct)}`}>{fmtPct(hoverPoint.weeklyReturnPct)}</div>
                </div>
              </div>

              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">当前区间摘要</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">{hoverPoint.regimeLabel}</div>
                    <div className="mt-1 text-xs text-slate-500">{activeRegime ? formatDateSpan(activeRegime.start, activeRegime.end) : "-"}</div>
                  </div>
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    {fmtCount(activeRegimeWeeks)} 周
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-slate-500">区间总涨跌</div>
                    <div className={`mt-1 text-base font-semibold ${rateText(activeRegimeReturn)}`}>{fmtPct(activeRegimeReturn)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">区间内最大上冲</div>
                    <div className={`mt-1 text-base font-semibold ${rateText(activeRegimeStat?.maxAdvancePct ?? 0)}`}>{fmtPct(activeRegimeStat?.maxAdvancePct ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">区间内最大回撤</div>
                    <div className={`mt-1 text-base font-semibold ${rateText(activeRegimeStat?.maxDrawdownPct ?? 0)}`}>{fmtPct(activeRegimeStat?.maxDrawdownPct ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">正费率 / 上涨周</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {fmtCount(activeRegimeStat?.positiveFundingWeeks ?? 0)} / {fmtCount(activeRegimeStat?.positiveReturnWeeks ?? 0)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">移动到任意一层图表上查看当前周数据。</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="h-[220px] w-full">
            <ResponsiveContainer>
              <LineChart data={points} syncId="btc-weekly-research" onMouseMove={handleResearchHover}>
                {regimeRanges.map((regime) => (
                  <ReferenceArea key={`price-${regime.label}-${regime.x1}`} x1={regime.x1} x2={regime.x2} fill={regime.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[Math.max(priceMin - pricePadding, 0), priceMax + pricePadding]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <Tooltip content={() => null} />
                <Line type="monotone" dataKey="closePrice" stroke="#2563eb" dot={false} strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[180px] w-full">
            <ResponsiveContainer>
              <BarChart data={points} syncId="btc-weekly-research" onMouseMove={handleResearchHover}>
                {regimeRanges.map((regime) => (
                  <ReferenceArea key={`funding-${regime.label}-${regime.x1}`} x1={regime.x1} x2={regime.x2} fill={regime.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[-fundingCap, fundingCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Tooltip content={() => null} />
                <Bar dataKey="fundingRatePct" radius={[4, 4, 0, 0]}>
                  {points.map((point) => (
                    <Cell key={`funding-bar-${point.weekStart}`} fill={point.fundingRatePct >= 0 ? "#059669" : "#dc2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[180px] w-full">
            <ResponsiveContainer>
              <BarChart data={points} syncId="btc-weekly-research" onMouseMove={handleResearchHover}>
                {regimeRanges.map((regime) => (
                  <ReferenceArea key={`volume-${regime.label}-${regime.x1}`} x1={regime.x1} x2={regime.x2} fill={regime.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis scale="log" domain={[volumeFloor, volumeCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value))}M`} />
                <Tooltip content={() => null} />
                <Bar dataKey="avgVolumeM" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[90px] w-full">
            <ResponsiveContainer>
              <BarChart data={points} syncId="btc-weekly-research" onMouseMove={handleResearchHover}>
                <XAxis dataKey="weekStart" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={28} tickFormatter={(value) => value.slice(2, 10)} />
                <YAxis hide domain={[0, 1]} />
                <Tooltip content={() => null} />
                <Bar dataKey={() => 1} isAnimationActive={false}>
                  {points.map((point) => (
                    <Cell key={`regime-band-${point.weekStart}`} fill={point.regimeTone} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      <Card title="自动区间热力图" hint="自动段仍先找价格结构变点，但现在会对长周期、低净涨跌、低振幅的区间强制偏向震荡；如果你后面要手修，可直接改 web/lib/btc-weekly-auto-regime-overrides.json。">
        <div className="mb-4 grid gap-4 md:grid-cols-5">
          <Kpi label="自动区间数" value={`${researchData.autoRegimeSegments.length}`} hint="每段长度可长可短，边界由价格结构变化自动决定。" />
          <Kpi label="平均区间长度" value={`${autoAverageWeeks} 周`} hint="这个数越大，说明自动分段更偏稳；越小，说明切换更敏感。" />
          <Kpi label="手工三态一致率" value={`${researchData.autoRegimeAgreementPct}%`} hint="把自动热度粗分成上行 / 震荡 / 下行后，与上方手工区间逐周比对。" />
          <Kpi label="手动覆盖周数" value={`${researchData.autoOverrideCount}`} hint="命中覆盖文件中的周数。0 代表当前完全使用自动识别。" />
          <Kpi
            label="最强自动段"
            value={strongestAutoSegment ? `${fmtScore(strongestAutoSegment.heatScore)} / ${fmtPct(strongestAutoSegment.cumulativeReturnPct)}` : "-"}
            hint={strongestAutoSegment ? formatClosedDateSpan(strongestAutoSegment.start, strongestAutoSegment.end) : "暂无可展示区间。"}
          />
        </div>

        <div className="space-y-4">
          <div className="h-[220px] w-full">
            <ResponsiveContainer>
              <LineChart data={autoComparisonRows} syncId="btc-auto-regime" onMouseMove={handleResearchHover}>
                {autoRegimeRanges.map((segment) => (
                  <ReferenceArea key={`auto-price-${segment.index}-${segment.x1}`} x1={segment.x1} x2={segment.x2} fill={segment.heatColor} fillOpacity={0.28} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[Math.max(priceMin - pricePadding, 0), priceMax + pricePadding]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <Tooltip content={() => null} />
                <Line type="monotone" dataKey="closePrice" stroke="#0f172a" dot={false} strokeWidth={2.3} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[110px] w-full">
            <ResponsiveContainer>
              <BarChart data={autoComparisonRows} syncId="btc-auto-regime" onMouseMove={handleResearchHover}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={28} tickFormatter={(value) => value.slice(2, 10)} />
                <YAxis domain={[-1, 1]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => fmtScore(Number(value))} />
                <Tooltip content={<AutoRegimeTooltip />} />
                <Bar dataKey="autoHeatScore" radius={[4, 4, 0, 0]}>
                  {autoComparisonRows.map((point) => (
                    <Cell key={`auto-heat-${point.weekStart}`} fill={point.autoHeatColor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">区间</th>
                <th className="py-3">时间范围</th>
                <th className="py-3">状态</th>
                <th className="py-3">来源</th>
                <th className="py-3 text-right">周数</th>
                <th className="py-3 text-right">热度分</th>
                <th className="py-3 text-right">累计涨跌</th>
                <th className="py-3 text-right">最大上冲</th>
                <th className="py-3 text-right">最大回撤</th>
                <th className="py-3 text-right">波动</th>
                <th className="py-3 text-right">上涨周数</th>
              </tr>
            </thead>
            <tbody>
              {researchData.autoRegimeSegments.map((segment) => (
                <tr key={`auto-segment-${segment.index}`} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-900">#{segment.index + 1}</td>
                  <td className="py-3 text-slate-500">{formatClosedDateSpan(segment.start, segment.end)}</td>
                  <td className="py-3 text-slate-700">{segment.stateLabel}</td>
                  <td className="py-3 text-slate-500">{segment.source === "manual" ? "手动覆盖" : "自动识别"}</td>
                  <td className="py-3 text-right text-slate-600">{segment.weeks}</td>
                  <td className="py-3 text-right">
                    <span className="inline-flex min-w-[64px] justify-center rounded-full px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: segment.heatColor }}>
                      {fmtScore(segment.heatScore)}
                    </span>
                  </td>
                  <td className={`py-3 text-right ${rateText(segment.cumulativeReturnPct)}`}>{fmtPct(segment.cumulativeReturnPct)}</td>
                  <td className={`py-3 text-right ${rateText(segment.maxAdvancePct)}`}>{fmtPct(segment.maxAdvancePct)}</td>
                  <td className={`py-3 text-right ${rateText(segment.maxDrawdownPct)}`}>{fmtPct(segment.maxDrawdownPct)}</td>
                  <td className="py-3 text-right text-slate-600">{fmtPct(segment.volatilityPct)}</td>
                  <td className="py-3 text-right text-slate-600">{segment.positiveReturnWeeks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="区间统计" hint="先用这张表比较不同市场区间里费率、成交量和价格表现，再决定下一步要不要扩展到更多币种。">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">区间</th>
                <th className="py-3">时间范围</th>
                <th className="py-3 text-right">周数</th>
                <th className="py-3 text-right">平均周费率</th>
                <th className="py-3 text-right">平均周日均成交量</th>
                <th className="py-3 text-right">累计涨跌</th>
                <th className="py-3 text-right">区间上冲</th>
                <th className="py-3 text-right">区间回撤</th>
                <th className="py-3 text-right">正费率周数</th>
                <th className="py-3 text-right">上涨周数</th>
              </tr>
            </thead>
            <tbody>
              {researchData.regimeStats.map((row, index) => (
                <tr key={`${row.label}-${index}`} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{row.label}</td>
                  <td className="py-3 text-slate-500">{formatDateSpan(row.start, row.end)}</td>
                  <td className="py-3 text-right text-slate-600">{row.weeks}</td>
                  <td className={`py-3 text-right ${rateText(row.avgFundingRatePct)}`}>{fmtPct(row.avgFundingRatePct)}</td>
                  <td className="py-3 text-right text-slate-600">{fmtVol(row.avgVolumeM)}</td>
                  <td className={`py-3 text-right ${rateText(row.cumulativeReturnPct)}`}>{fmtPct(row.cumulativeReturnPct)}</td>
                  <td className={`py-3 text-right ${rateText(row.maxAdvancePct)}`}>{fmtPct(row.maxAdvancePct)}</td>
                  <td className={`py-3 text-right ${rateText(row.maxDrawdownPct)}`}>{fmtPct(row.maxDrawdownPct)}</td>
                  <td className="py-3 text-right text-slate-600">{row.positiveFundingWeeks}</td>
                  <td className="py-3 text-right text-slate-600">{row.positiveReturnWeeks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Research2View({ research2Data }: { research2Data?: BtcWeeklyResearch2Data }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const research2SummaryOrder = ["大牛", "小牛", "震荡牛", "震荡灰", "震荡熊", "小熊", "大熊"];
  const baseResearch2Data = research2Data ?? emptyResearch2Data;
  const points = useMemo(() => baseResearch2Data.points, [baseResearch2Data.points]);
  const latestPoint = points.at(-1) ?? null;
  const [hoverPoint, setHoverPoint] = useState<BtcWeeklyResearch2Data["points"][number] | null>(latestPoint);
  const [visibleRange, setVisibleRange] = useState(() => buildResearchWindowRange(points.length));
  const [realtimeRebuild, setRealtimeRebuild] = useState(false);
  const [previewData, setPreviewData] = useState<BtcWeeklyResearch2Data | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [indicatorVisibility, setIndicatorVisibility] = useState({
    rsi: true,
    bollinger: true,
    ema: true,
    sma: true,
    adx: true,
    bbw: true,
    returnZ: true,
  });
  const [minSegmentWeeksInput, setMinSegmentWeeksInput] = useState(String(research2Data?.thresholds.minSegmentWeeks ?? 5));
  const [latestSegmentMinWeeksInput, setLatestSegmentMinWeeksInput] = useState(String(research2Data?.thresholds.latestSegmentMinWeeks ?? 5));
  const [splitPenaltyInput, setSplitPenaltyInput] = useState(String(research2Data?.thresholds.splitPenalty ?? 7.8));
  const [maxSegmentWeeksInput, setMaxSegmentWeeksInput] = useState(String(research2Data?.thresholds.maxSegmentWeeks ?? 28));
  const [emaPeriodInput, setEmaPeriodInput] = useState(String(research2Data?.indicatorSettings.emaPeriod ?? 21));
  const [smaPeriodInput, setSmaPeriodInput] = useState(String(research2Data?.indicatorSettings.smaPeriod ?? 200));
  const [adxPeriodInput, setAdxPeriodInput] = useState(String(research2Data?.indicatorSettings.adxPeriod ?? 14));
  const [adxTrendLevelInput, setAdxTrendLevelInput] = useState(String(research2Data?.indicatorSettings.adxTrendLevel ?? 25));
  const [rsiPeriodInput, setRsiPeriodInput] = useState(String(research2Data?.indicatorSettings.rsiPeriod ?? 14));
  const [rsiUpperInput, setRsiUpperInput] = useState(String(research2Data?.indicatorSettings.rsiUpper ?? 80));
  const [rsiLowerInput, setRsiLowerInput] = useState(String(research2Data?.indicatorSettings.rsiLower ?? 20));
  const [bbPeriodInput, setBbPeriodInput] = useState(String(research2Data?.indicatorSettings.bbPeriod ?? 20));
  const [bbStdDevInput, setBbStdDevInput] = useState(String(research2Data?.indicatorSettings.bbStdDev ?? 2));
  const [returnZPeriodInput, setReturnZPeriodInput] = useState(String(research2Data?.indicatorSettings.returnZPeriod ?? 52));
  const [returnUpperInput, setReturnUpperInput] = useState(String(research2Data?.indicatorSettings.returnUpper ?? 2));
  const [returnLowerInput, setReturnLowerInput] = useState(String(research2Data?.indicatorSettings.returnLower ?? -2));
  const [bbwWindowInput, setBbwWindowInput] = useState(String(research2Data?.indicatorSettings.bbwPercentileWindow ?? 104));
  const [bbwHighInput, setBbwHighInput] = useState(String(research2Data?.indicatorSettings.bbwHigh ?? 70));
  const [bbwLowInput, setBbwLowInput] = useState(String(research2Data?.indicatorSettings.bbwLow ?? 30));

  useEffect(() => {
    setHoverPoint(latestPoint);
  }, [latestPoint]);

  useEffect(() => {
    setVisibleRange(buildResearchWindowRange(points.length));
  }, [points.length]);

  useEffect(() => {
    setMinSegmentWeeksInput(String(research2Data?.thresholds.minSegmentWeeks ?? 5));
    setLatestSegmentMinWeeksInput(String(research2Data?.thresholds.latestSegmentMinWeeks ?? 5));
    setSplitPenaltyInput(String(research2Data?.thresholds.splitPenalty ?? 7.8));
    setMaxSegmentWeeksInput(String(research2Data?.thresholds.maxSegmentWeeks ?? 28));
  }, [research2Data?.thresholds.latestSegmentMinWeeks, research2Data?.thresholds.maxSegmentWeeks, research2Data?.thresholds.minSegmentWeeks, research2Data?.thresholds.splitPenalty]);
  useEffect(() => {
    setEmaPeriodInput(String(research2Data?.indicatorSettings.emaPeriod ?? 21));
    setSmaPeriodInput(String(research2Data?.indicatorSettings.smaPeriod ?? 200));
    setAdxPeriodInput(String(research2Data?.indicatorSettings.adxPeriod ?? 14));
    setAdxTrendLevelInput(String(research2Data?.indicatorSettings.adxTrendLevel ?? 25));
    setRsiPeriodInput(String(research2Data?.indicatorSettings.rsiPeriod ?? 14));
    setRsiUpperInput(String(research2Data?.indicatorSettings.rsiUpper ?? 80));
    setRsiLowerInput(String(research2Data?.indicatorSettings.rsiLower ?? 20));
    setBbPeriodInput(String(research2Data?.indicatorSettings.bbPeriod ?? 20));
    setBbStdDevInput(String(research2Data?.indicatorSettings.bbStdDev ?? 2));
    setReturnZPeriodInput(String(research2Data?.indicatorSettings.returnZPeriod ?? 52));
    setReturnUpperInput(String(research2Data?.indicatorSettings.returnUpper ?? 2));
    setReturnLowerInput(String(research2Data?.indicatorSettings.returnLower ?? -2));
    setBbwWindowInput(String(research2Data?.indicatorSettings.bbwPercentileWindow ?? 104));
    setBbwHighInput(String(research2Data?.indicatorSettings.bbwHigh ?? 70));
    setBbwLowInput(String(research2Data?.indicatorSettings.bbwLow ?? 30));
  }, [research2Data?.indicatorSettings]);

  const normalizedRange = {
    startIndex: Math.max(0, Math.min(visibleRange.startIndex, Math.max(points.length - 1, 0))),
    endIndex: Math.max(0, Math.min(visibleRange.endIndex, Math.max(points.length - 1, 0))),
  };
  if (normalizedRange.startIndex > normalizedRange.endIndex) {
    normalizedRange.startIndex = normalizedRange.endIndex;
  }
  const selectedPoints = useMemo(
    () => points.slice(normalizedRange.startIndex, normalizedRange.endIndex + 1),
    [normalizedRange.endIndex, normalizedRange.startIndex, points],
  );
  const visibleStartWeek = selectedPoints[0]?.weekStart ?? points[0]?.weekStart ?? "";
  const visibleEndWeek = selectedPoints.at(-1)?.weekStart ?? points.at(-1)?.weekStart ?? "";
  const selectedStartWeek = selectedPoints[0]?.weekStart ?? "";
  const selectedEndWeek = selectedPoints.at(-1)?.weekStart ?? "";
  const searchParamString = searchParams.toString();

  useEffect(() => {
    if (!realtimeRebuild || !selectedPoints.length) {
      setPreviewData(null);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    const requestUrl = new URL(`${window.location.origin}/api/research-2-preview`);
    for (const [key, value] of searchParams.entries()) {
      requestUrl.searchParams.set(key, value);
    }
    requestUrl.searchParams.set("minWeeks", String(baseResearch2Data.thresholds.minSegmentWeeks));
    requestUrl.searchParams.set("latestMinWeeks", String(baseResearch2Data.thresholds.latestSegmentMinWeeks));
    requestUrl.searchParams.set("splitPenalty", String(baseResearch2Data.thresholds.splitPenalty));
    requestUrl.searchParams.set("maxWeeks", String(baseResearch2Data.thresholds.maxSegmentWeeks));
    requestUrl.searchParams.set("emaPeriod", String(baseResearch2Data.indicatorSettings.emaPeriod));
    requestUrl.searchParams.set("smaPeriod", String(baseResearch2Data.indicatorSettings.smaPeriod));
    requestUrl.searchParams.set("adxPeriod", String(baseResearch2Data.indicatorSettings.adxPeriod));
    requestUrl.searchParams.set("adxTrendLevel", String(baseResearch2Data.indicatorSettings.adxTrendLevel));
    requestUrl.searchParams.set("rsiPeriod", String(baseResearch2Data.indicatorSettings.rsiPeriod));
    requestUrl.searchParams.set("rsiUpper", String(baseResearch2Data.indicatorSettings.rsiUpper));
    requestUrl.searchParams.set("rsiLower", String(baseResearch2Data.indicatorSettings.rsiLower));
    requestUrl.searchParams.set("bbPeriod", String(baseResearch2Data.indicatorSettings.bbPeriod));
    requestUrl.searchParams.set("bbStdDev", String(baseResearch2Data.indicatorSettings.bbStdDev));
    requestUrl.searchParams.set("returnZPeriod", String(baseResearch2Data.indicatorSettings.returnZPeriod));
    requestUrl.searchParams.set("returnUpper", String(baseResearch2Data.indicatorSettings.returnUpper));
    requestUrl.searchParams.set("returnLower", String(baseResearch2Data.indicatorSettings.returnLower));
    requestUrl.searchParams.set("bbwWindow", String(baseResearch2Data.indicatorSettings.bbwPercentileWindow));
    requestUrl.searchParams.set("bbwHigh", String(baseResearch2Data.indicatorSettings.bbwHigh));
    requestUrl.searchParams.set("bbwLow", String(baseResearch2Data.indicatorSettings.bbwLow));
    requestUrl.searchParams.set("startWeek", selectedStartWeek);
    requestUrl.searchParams.set("endWeek", selectedEndWeek);
    setPreviewLoading(true);
    fetch(requestUrl.toString(), { signal: controller.signal })
      .then((response) => response.json())
      .then((data: BtcWeeklyResearch2Data) => {
        setPreviewData(data);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("research-2 preview fetch failed", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      });
    return () => controller.abort();
  }, [
    baseResearch2Data.indicatorSettings.adxPeriod,
    baseResearch2Data.indicatorSettings.adxTrendLevel,
    baseResearch2Data.indicatorSettings.bbPeriod,
    baseResearch2Data.indicatorSettings.bbStdDev,
    baseResearch2Data.indicatorSettings.bbwHigh,
    baseResearch2Data.indicatorSettings.bbwLow,
    baseResearch2Data.indicatorSettings.bbwPercentileWindow,
    baseResearch2Data.indicatorSettings.emaPeriod,
    baseResearch2Data.indicatorSettings.returnLower,
    baseResearch2Data.indicatorSettings.returnUpper,
    baseResearch2Data.indicatorSettings.returnZPeriod,
    baseResearch2Data.indicatorSettings.rsiLower,
    baseResearch2Data.indicatorSettings.rsiPeriod,
    baseResearch2Data.indicatorSettings.rsiUpper,
    baseResearch2Data.indicatorSettings.smaPeriod,
    baseResearch2Data.thresholds.latestSegmentMinWeeks,
    baseResearch2Data.thresholds.maxSegmentWeeks,
    baseResearch2Data.thresholds.minSegmentWeeks,
    baseResearch2Data.thresholds.splitPenalty,
    realtimeRebuild,
    searchParamString,
    searchParams,
    selectedEndWeek,
    selectedStartWeek,
    selectedPoints.length,
  ]);

  const displayData: BtcWeeklyResearch2Data = realtimeRebuild ? (previewData ?? research2Data ?? emptyResearch2Data) : (research2Data ?? emptyResearch2Data);
  const visiblePoints = displayData.points;
  const displayLatestPoint = visiblePoints.at(-1) ?? null;

  useEffect(() => {
    setHoverPoint(displayLatestPoint);
  }, [displayLatestPoint]);

  const regimeRanges = displayData.segments.map((segment) => ({
    ...segment,
    x1: segment.start,
    x2: visiblePoints.find((point) => point.weekEnd === segment.end)?.weekStart ?? segment.start,
  }));
  const visibleRegimeRanges = regimeRanges
    .filter((segment) => !visibleStartWeek || !visibleEndWeek || (segment.x2 >= visibleStartWeek && segment.x1 <= visibleEndWeek))
    .map((segment) => ({
      ...segment,
      x1: segment.x1 < visibleStartWeek ? visibleStartWeek : segment.x1,
      x2: segment.x2 > visibleEndWeek ? visibleEndWeek : segment.x2,
    }));
  const handleHover = (state?: { activePayload?: Array<{ payload?: BtcWeeklyResearch2Data["points"][number] }> }) => {
    const point = state?.activePayload?.[0]?.payload;
    if (point) setHoverPoint(point);
  };
  const activeSegment = hoverPoint
    ? displayData.segments.find((segment) => hoverPoint.weekStart >= segment.start && hoverPoint.weekEnd <= segment.end)
    : null;
  const priceValues = visiblePoints.map((point) => point.closePrice);
  const fundingValues = visiblePoints.map((point) => point.fundingRatePct);
  const volumeValues = visiblePoints.map((point) => point.avgVolumeM).filter((value) => value > 0);
  const priceMin = priceValues.length ? Math.min(...priceValues) : 0;
  const priceMax = priceValues.length ? Math.max(...priceValues) : 0;
  const pricePadding = priceMax > priceMin ? (priceMax - priceMin) * 0.08 : priceMax * 0.05;
  const fundingCap = rateAxisCap(fundingValues);
  const volumeFloor = volumeValues.length ? Math.max(Math.min(...volumeValues) * 0.85, 1) : 1;
  const volumeCap = Math.max(volumeAxisCap(volumeValues), volumeFloor * 1.1);
  const averageSegmentWeeks = displayData.segments.length
    ? Number((displayData.segments.reduce((sum, segment) => sum + segment.weeks, 0) / displayData.segments.length).toFixed(1))
    : 0;
  const klineCount = displayData.points.length;
  const orderedSummaries = [...displayData.summaries].sort((left, right) => {
    const leftIndex = research2SummaryOrder.indexOf(left.label);
    const rightIndex = research2SummaryOrder.indexOf(right.label);
    const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight;
  });
  const bullSharePct = orderedSummaries
    .filter((summary) => ["大牛", "小牛", "震荡牛"].includes(summary.label))
    .reduce((sum, summary) => sum + summary.sharePct, 0);
  const bearSharePct = orderedSummaries
    .filter((summary) => ["大熊", "小熊", "震荡熊"].includes(summary.label))
    .reduce((sum, summary) => sum + summary.sharePct, 0);
  const updateResearch2Context = (next: Partial<Pick<BtcWeeklyResearch2Data, "marketType" | "symbol" | "timeframe">>) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next.marketType) {
      nextParams.set("market", next.marketType);
    }
    if (next.symbol) {
      nextParams.set("symbol", next.symbol);
    }
    if (next.timeframe) {
      nextParams.set("timeframe", next.timeframe);
    }
    startTransition(() => {
      router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
    });
  };
  const applyResearch2Tuning = () => {
    const tuningDefaults = {
      minWeeks: Number.parseInt(minSegmentWeeksInput.trim() || String(baseResearch2Data.thresholds.minSegmentWeeks), 10),
      latestMinWeeks: Number.parseInt(latestSegmentMinWeeksInput.trim() || String(baseResearch2Data.thresholds.latestSegmentMinWeeks), 10),
      splitPenalty: Number.parseFloat(splitPenaltyInput.trim() || String(baseResearch2Data.thresholds.splitPenalty)),
      maxWeeks: Number.parseInt(maxSegmentWeeksInput.trim() || String(baseResearch2Data.thresholds.maxSegmentWeeks), 10),
    };
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("minWeeks", String(tuningDefaults.minWeeks));
    nextParams.set("latestMinWeeks", String(tuningDefaults.latestMinWeeks));
    nextParams.set("splitPenalty", String(tuningDefaults.splitPenalty));
    nextParams.set("maxWeeks", String(tuningDefaults.maxWeeks));
    startTransition(async () => {
      await saveResearch2ServerDefaults({ tuning: tuningDefaults });
      router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
    });
  };
  const resetResearch2Tuning = () => {
    setMinSegmentWeeksInput(RESEARCH2_TUNING_DEFAULTS.minWeeks);
    setLatestSegmentMinWeeksInput(RESEARCH2_TUNING_DEFAULTS.latestMinWeeks);
    setSplitPenaltyInput(RESEARCH2_TUNING_DEFAULTS.splitPenalty);
    setMaxSegmentWeeksInput(RESEARCH2_TUNING_DEFAULTS.maxWeeks);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("minWeeks");
    nextParams.delete("latestMinWeeks");
    nextParams.delete("splitPenalty");
    nextParams.delete("maxWeeks");
    startTransition(async () => {
      await resetResearch2ServerDefaults("tuning");
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };
  const toggleIndicatorVisibility = (key: keyof typeof indicatorVisibility) => {
    setIndicatorVisibility((current) => ({ ...current, [key]: !current[key] }));
  };
  const stepVisibleRange = (delta: -1 | 1) => {
    setVisibleRange((current) => {
      const nextEndIndex = Math.max(current.startIndex, Math.min(points.length - 1, current.endIndex + delta));
      return {
        startIndex: current.startIndex,
        endIndex: nextEndIndex,
      };
    });
  };
  const renderTimeRangeControls = () => (
    <div className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">时间截断控制</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepVisibleRange(-1)}
            disabled={normalizedRange.endIndex <= normalizedRange.startIndex}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => stepVisibleRange(1)}
            disabled={normalizedRange.endIndex >= points.length - 1}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            +
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={30}>
        <LineChart data={points}>
          <XAxis dataKey="weekStart" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Brush
            dataKey="weekStart"
            height={22}
            stroke="#2563eb"
            startIndex={normalizedRange.startIndex}
            endIndex={normalizedRange.endIndex}
            travellerWidth={12}
            tickFormatter={(value) => value.slice(2, 10)}
            onChange={(range) => {
              const startIndex = typeof range?.startIndex === "number" ? range.startIndex : normalizedRange.startIndex;
              const endIndex = typeof range?.endIndex === "number" ? range.endIndex : normalizedRange.endIndex;
              setVisibleRange({ startIndex, endIndex });
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
  const applyIndicatorSettings = () => {
    const indicatorDefaults = {
      emaPeriod: Number.parseInt(emaPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.emaPeriod), 10),
      smaPeriod: Number.parseInt(smaPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.smaPeriod), 10),
      adxPeriod: Number.parseInt(adxPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.adxPeriod), 10),
      adxTrendLevel: Number.parseInt(adxTrendLevelInput.trim() || String(baseResearch2Data.indicatorSettings.adxTrendLevel), 10),
      rsiPeriod: Number.parseInt(rsiPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.rsiPeriod), 10),
      rsiUpper: Number.parseInt(rsiUpperInput.trim() || String(baseResearch2Data.indicatorSettings.rsiUpper), 10),
      rsiLower: Number.parseInt(rsiLowerInput.trim() || String(baseResearch2Data.indicatorSettings.rsiLower), 10),
      bbPeriod: Number.parseInt(bbPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.bbPeriod), 10),
      bbStdDev: Number.parseFloat(bbStdDevInput.trim() || String(baseResearch2Data.indicatorSettings.bbStdDev)),
      returnZPeriod: Number.parseInt(returnZPeriodInput.trim() || String(baseResearch2Data.indicatorSettings.returnZPeriod), 10),
      returnUpper: Number.parseFloat(returnUpperInput.trim() || String(baseResearch2Data.indicatorSettings.returnUpper)),
      returnLower: Number.parseFloat(returnLowerInput.trim() || String(baseResearch2Data.indicatorSettings.returnLower)),
      bbwWindow: Number.parseInt(bbwWindowInput.trim() || String(baseResearch2Data.indicatorSettings.bbwPercentileWindow), 10),
      bbwHigh: Number.parseInt(bbwHighInput.trim() || String(baseResearch2Data.indicatorSettings.bbwHigh), 10),
      bbwLow: Number.parseInt(bbwLowInput.trim() || String(baseResearch2Data.indicatorSettings.bbwLow), 10),
    };
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("emaPeriod", String(indicatorDefaults.emaPeriod));
    nextParams.set("smaPeriod", String(indicatorDefaults.smaPeriod));
    nextParams.set("adxPeriod", String(indicatorDefaults.adxPeriod));
    nextParams.set("adxTrendLevel", String(indicatorDefaults.adxTrendLevel));
    nextParams.set("rsiPeriod", String(indicatorDefaults.rsiPeriod));
    nextParams.set("rsiUpper", String(indicatorDefaults.rsiUpper));
    nextParams.set("rsiLower", String(indicatorDefaults.rsiLower));
    nextParams.set("bbPeriod", String(indicatorDefaults.bbPeriod));
    nextParams.set("bbStdDev", String(indicatorDefaults.bbStdDev));
    nextParams.set("returnZPeriod", String(indicatorDefaults.returnZPeriod));
    nextParams.set("returnUpper", String(indicatorDefaults.returnUpper));
    nextParams.set("returnLower", String(indicatorDefaults.returnLower));
    nextParams.set("bbwWindow", String(indicatorDefaults.bbwWindow));
    nextParams.set("bbwHigh", String(indicatorDefaults.bbwHigh));
    nextParams.set("bbwLow", String(indicatorDefaults.bbwLow));
    startTransition(async () => {
      await saveResearch2ServerDefaults({ indicator: indicatorDefaults });
      router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
    });
  };
  const resetIndicatorSettings = () => {
    setEmaPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.emaPeriod);
    setSmaPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.smaPeriod);
    setAdxPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.adxPeriod);
    setAdxTrendLevelInput(RESEARCH2_INDICATOR_DEFAULTS.adxTrendLevel);
    setRsiPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.rsiPeriod);
    setRsiUpperInput(RESEARCH2_INDICATOR_DEFAULTS.rsiUpper);
    setRsiLowerInput(RESEARCH2_INDICATOR_DEFAULTS.rsiLower);
    setBbPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.bbPeriod);
    setBbStdDevInput(RESEARCH2_INDICATOR_DEFAULTS.bbStdDev);
    setReturnZPeriodInput(RESEARCH2_INDICATOR_DEFAULTS.returnZPeriod);
    setReturnUpperInput(RESEARCH2_INDICATOR_DEFAULTS.returnUpper);
    setReturnLowerInput(RESEARCH2_INDICATOR_DEFAULTS.returnLower);
    setBbwWindowInput(RESEARCH2_INDICATOR_DEFAULTS.bbwWindow);
    setBbwHighInput(RESEARCH2_INDICATOR_DEFAULTS.bbwHigh);
    setBbwLowInput(RESEARCH2_INDICATOR_DEFAULTS.bbwLow);
    const nextParams = new URLSearchParams(searchParams.toString());
    for (const key of ["emaPeriod", "smaPeriod", "adxPeriod", "adxTrendLevel", "rsiPeriod", "rsiUpper", "rsiLower", "bbPeriod", "bbStdDev", "returnZPeriod", "returnUpper", "returnLower", "bbwWindow", "bbwHigh", "bbwLow"]) {
      nextParams.delete(key);
    }
    startTransition(async () => {
      await resetResearch2ServerDefaults("indicator");
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  if (!research2Data || research2Data.loadError) {
    return (
      <Card
        title={`${getResearchMarketLabel(baseResearch2Data.marketType)} ${baseResearch2Data.symbol} ${getResearchTimeframeLabel(baseResearch2Data.timeframe)}研究`}
        hint="当前先保留七态自动体制逻辑，后续再扩成多市场、多币种、多周期统一框架。"
      >
        <div className="rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          {research2Data?.loadError ?? "七态研究数据暂不可用。"}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="研究上下文" hint="先把市场、周期、币种三层骨架接好。当前真实数据只开放 币本位 BTC 周线，其他入口先占位。">
        <div className="space-y-4">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            当前选择: <span className="font-semibold text-slate-900">{getResearchMarketLabel(displayData.marketType)} / {getResearchTimeframeLabel(displayData.timeframe)} / {displayData.symbol}</span>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">市场</div>
            <div className="flex flex-wrap gap-2">
              {researchMarketOptions.map((option) => {
                const enabled = displayData.availableMarkets.includes(option.key);
                const active = displayData.marketType === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={!enabled}
                    onClick={() => updateResearch2Context({ marketType: option.key })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : enabled
                          ? "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                          : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    {option.label}
                    {!enabled ? " · 即将开放" : ""}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">周期</div>
            <div className="flex flex-wrap gap-2">
              {researchTimeframeOptions.map((option) => {
                const active = displayData.timeframe === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={!option.enabled}
                    onClick={() => updateResearch2Context({ timeframe: option.key })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : option.enabled
                          ? "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                          : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    {option.label}
                    {!option.enabled ? " · 规划中" : ""}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">币种</div>
            <div className="flex flex-wrap gap-2">
              {displayData.availableSymbols.map((symbol) => {
                const active = displayData.symbol === symbol;
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => updateResearch2Context({ symbol })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}
                  >
                    {symbol}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="K线总数" value={`${klineCount}`} hint="当前市场、币种、周期下已接入研究页的总 K 线数量。" />
        <Kpi label="自动区间数" value={`${displayData.segments.length}`} hint="当前先用连续特征做结构分段，再做段级命名，每段天然至少 5 周。" />
        <Kpi label="平均区间长度" value={`${averageSegmentWeeks} 周`} hint="这里越大，说明切换越稳；越小，说明对周线状态变化更敏感。" />
        <Kpi label="当前状态" value={displayLatestPoint?.confirmedRegime ?? "-"} hint={displayLatestPoint ? `最近已完成周 ${displayLatestPoint.weekStart} ~ ${displayLatestPoint.weekEnd}，家族 ${displayLatestPoint.family}` : "暂无已完成周线。"} />
        <Kpi label="最新数据日期" value={research2Data.latestObservedDate ?? "-"} hint={displayLatestPoint ? `当前研究分段最新完成周 ${displayLatestPoint.weekStart} ~ ${displayLatestPoint.weekEnd}` : "暂无最新观测数据。"} />
        <Kpi label="数据源" value={`${getResearchMarketLabel(research2Data.marketType)} ${research2Data.symbol} ${getResearchTimeframeLabel(research2Data.timeframe)}`} hint={research2Data.sourceLabel} />
      </div>

      <Card
        title={`${getResearchMarketLabel(research2Data.marketType)} ${research2Data.symbol} ${getResearchTimeframeLabel(research2Data.timeframe)}七态自动分区图`}
        hint="上下两处时间截断控制会同步，默认先展示全时间段。区间涨跌按首周开盘价到末周收盘价计算，避免切段后一周被统计真空。"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {orderedSummaries.map((summary) => (
            <span key={summary.label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: points.find((point) => point.confirmedRegime === summary.label)?.confirmedTone ?? "#cbd5e1" }} />
              {summary.label} {summary.sharePct}%
            </span>
          ))}
          <span className="inline-flex items-center px-1 text-slate-300">|</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            牛总 {bullSharePct.toFixed(1)}%
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            熊总 {bearSharePct.toFixed(1)}%
          </span>
        </div>

        <div className="mb-4 rounded-[18px] border border-slate-200 bg-white/75 px-4 py-3 shadow-sm backdrop-blur">
          {hoverPoint ? (
            <div className="space-y-3">
              <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-6 xl:grid-cols-12">
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-2 xl:col-span-2 whitespace-nowrap">时间: <span className="font-medium text-slate-900">{hoverPoint.weekStart}</span></div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-1 xl:col-span-2 whitespace-nowrap">周涨跌: <span className={`font-medium ${rateText(hoverPoint.weeklyReturnPct)}`}>{fmtPct(hoverPoint.weeklyReturnPct)}</span></div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-1 xl:col-span-2 whitespace-nowrap">价格: <span className="font-medium text-slate-900">{fmtPrice(hoverPoint.closePrice)}</span></div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-1 xl:col-span-2 whitespace-nowrap">周费率: <span className={`font-medium ${rateText(hoverPoint.fundingRatePct)}`}>{fmtPct(hoverPoint.fundingRatePct)}</span></div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-1 xl:col-span-2 whitespace-nowrap">日均成交量: <span className="font-medium text-slate-900">{fmtVol(hoverPoint.avgVolumeM)}</span></div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 md:col-span-6 xl:col-span-2 whitespace-nowrap">ADX / BBW: <span className="font-medium text-slate-900">{hoverPoint.adx14.toFixed(1)} / {hoverPoint.bbwPercentile104.toFixed(1)}</span></div>
              </div>

              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="grid gap-x-4 gap-y-2 text-sm text-slate-600">
                  <div className="grid gap-x-4 gap-y-2 md:grid-cols-4">
                    <div>区间: <span className="font-semibold text-slate-900">{activeSegment?.label ?? hoverPoint.confirmedRegime}</span></div>
                    <div>当前区块: <span className="font-medium text-slate-900">#{activeSegment ? activeSegment.index + 1 : "-"}</span></div>
                    <div>时间范围: <span className="font-medium text-slate-900">{activeSegment ? formatClosedDateSpan(activeSegment.start, activeSegment.end) : "-"}</span></div>
                    <div>周数: <span className="font-medium text-slate-900">{activeSegment ? `${activeSegment.weeks} 周` : hoverPoint.family}</span></div>
                  </div>
                  <div className="grid gap-x-4 gap-y-2 md:grid-cols-4">
                    <div>区间累计涨跌: <span className={`font-medium ${rateText(activeSegment?.cumulativeReturnPct ?? 0)}`}>{fmtPct(activeSegment?.cumulativeReturnPct ?? 0)}</span></div>
                    <div>平均周收益: <span className={`font-medium ${rateText(activeSegment?.avgWeeklyReturnPct ?? 0)}`}>{fmtPct(activeSegment?.avgWeeklyReturnPct ?? 0)}</span></div>
                    <div>区间内最大上冲: <span className={`font-medium ${rateText(activeSegment?.maxAdvancePct ?? 0)}`}>{fmtPct(activeSegment?.maxAdvancePct ?? 0)}</span></div>
                    <div>区间内最大回撤: <span className={`font-medium ${rateText(activeSegment?.maxDrawdownPct ?? 0)}`}>{fmtPct(activeSegment?.maxDrawdownPct ?? 0)}</span></div>
                  </div>
                  <div className="grid gap-x-4 gap-y-2 md:grid-cols-4">
                    <div className="rounded-[12px] border border-transparent px-0 py-0">
                      峰值到段末回撤: <span className={`font-medium ${rateText(activeSegment?.peakToEndDrawdownPct ?? 0)}`}>{fmtPct(activeSegment?.peakToEndDrawdownPct ?? 0)}</span>
                    </div>
                    <div className="rounded-[12px] border border-transparent px-0 py-0">
                      趋势分: <span className="font-medium text-slate-900">{(activeSegment?.trendScore ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="min-w-0 rounded-[12px] border border-transparent px-0 py-0 md:col-span-2">
                      区间统计口径: <span className="font-medium">{activeSegment ? renderPriceRange(activeSegment.startCloseDate, activeSegment.startClosePrice, activeSegment.endCloseDate, activeSegment.endClosePrice) : "-"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">移动到图表上查看当前周的七态判定和指标。</div>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div>当前展示窗: <span className="font-medium text-slate-900">{visiblePoints[0]?.weekStart ?? "-"} ~ {visiblePoints.at(-1)?.weekEnd ?? "-"}</span></div>
          <div>展示周数: <span className="font-medium text-slate-900">{visiblePoints.length}</span></div>
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <span>实时重构图表</span>
            <button
              type="button"
              role="switch"
              aria-checked={realtimeRebuild}
              onClick={() => setRealtimeRebuild((current) => !current)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${realtimeRebuild ? "bg-slate-900" : "bg-slate-300"}`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white transition ${realtimeRebuild ? "translate-x-5" : "translate-x-1"}`} />
            </button>
          </label>
          {realtimeRebuild ? (
            <div className="text-xs text-slate-500">{previewLoading ? "按当前可见窗口重构中..." : "当前按可见 K 线实时重构区间"}</div>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowIndicatorSettings((current) => !current)}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              指标设置
            </button>
          </div>
        </div>

        <div className="mb-4">
          {renderTimeRangeControls()}
        </div>

        {showIndicatorSettings ? (
          <div className="mb-4 rounded-[18px] border border-slate-200 bg-white px-4 py-4">
            <div className="mb-1 text-sm font-semibold text-slate-900">指标参数设置</div>
            <div className="mb-3 text-xs text-slate-500">点击“应用指标参数”后会保存为服务端全局默认值；点击“恢复默认指标”会清除服务端保存并恢复系统默认。</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">EMA</div>
                <div className="mt-2 text-xs text-slate-500">周期</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={emaPeriodInput} onChange={(event) => setEmaPeriodInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">SMA</div>
                <div className="mt-2 text-xs text-slate-500">周期</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={smaPeriodInput} onChange={(event) => setSmaPeriodInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">ADX</div>
                <div className="mt-2 text-xs text-slate-500">周期</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={adxPeriodInput} onChange={(event) => setAdxPeriodInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">趋势阈值</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={adxTrendLevelInput} onChange={(event) => setAdxTrendLevelInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">RSI</div>
                <div className="mt-2 text-xs text-slate-500">周期</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={rsiPeriodInput} onChange={(event) => setRsiPeriodInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">上边界</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={rsiUpperInput} onChange={(event) => setRsiUpperInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">下边界</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={rsiLowerInput} onChange={(event) => setRsiLowerInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">布林线</div>
                <div className="mt-2 text-xs text-slate-500">周期</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={bbPeriodInput} onChange={(event) => setBbPeriodInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">标准差倍数</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={bbStdDevInput} onChange={(event) => setBbStdDevInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">BBW 分位</div>
                <div className="mt-2 text-xs text-slate-500">分位窗口</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={bbwWindowInput} onChange={(event) => setBbwWindowInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">高波动线</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={bbwHighInput} onChange={(event) => setBbwHighInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">低波动线</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={bbwLowInput} onChange={(event) => setBbwLowInput(event.target.value)} />
              </label>
              <label className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs text-slate-500">Return Z</div>
                <div className="mt-2 text-xs text-slate-500">Z 分数窗口</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={returnZPeriodInput} onChange={(event) => setReturnZPeriodInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">上边界</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={returnUpperInput} onChange={(event) => setReturnUpperInput(event.target.value)} />
                <div className="mt-2 text-xs text-slate-500">下边界</div>
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500" value={returnLowerInput} onChange={(event) => setReturnLowerInput(event.target.value)} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={applyIndicatorSettings} className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700">应用指标参数</button>
              <button type="button" onClick={resetIndicatorSettings} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">恢复默认指标</button>
            </div>
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="h-[220px] w-full">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <button type="button" onClick={() => toggleIndicatorVisibility("bollinger")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.bollinger ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-black" />布林线 {hoverPoint ? `${fmtPrice(hoverPoint.bbUpper)} / ${fmtPrice(hoverPoint.bbBasis)} / ${fmtPrice(hoverPoint.bbLower)}` : "-"}</button>
              <button type="button" onClick={() => toggleIndicatorVisibility("ema")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.ema ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" />EMA {hoverPoint ? fmtPrice(hoverPoint.ema21) : "-"}</button>
              <button type="button" onClick={() => toggleIndicatorVisibility("sma")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.sma ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#7c3aed]" />SMA {hoverPoint ? fmtPrice(hoverPoint.sma200) : "-"}</button>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1"><span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />收盘价 {hoverPoint ? fmtPrice(hoverPoint.closePrice) : "-"}</span>
            </div>
            <ResponsiveContainer>
              <LineChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                {visibleRegimeRanges.map((segment) => (
                  <ReferenceArea key={`research2-price-${segment.index}`} x1={segment.x1} x2={segment.x2} fill={segment.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[Math.max(priceMin - pricePadding, 0), priceMax + pricePadding]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => fmtPriceAxisTick(Number(value))} />
                <Tooltip content={() => null} />
                <Line type="monotone" dataKey="closePrice" stroke="#2563eb" dot={false} strokeWidth={2.4} />
                {indicatorVisibility.bollinger ? <Line type="monotone" dataKey="bbUpper" stroke="#000000" dot={false} strokeWidth={1.1} strokeDasharray="5 4" /> : null}
                {indicatorVisibility.bollinger ? <Line type="monotone" dataKey="bbBasis" stroke="#000000" dot={false} strokeWidth={1.1} /> : null}
                {indicatorVisibility.bollinger ? <Line type="monotone" dataKey="bbLower" stroke="#000000" dot={false} strokeWidth={1.1} strokeDasharray="5 4" /> : null}
                {indicatorVisibility.ema ? <Line type="monotone" dataKey="ema21" stroke="#0f766e" dot={false} strokeWidth={1.5} /> : null}
                {indicatorVisibility.sma ? <Line type="monotone" dataKey="sma200" stroke="#7c3aed" dot={false} strokeWidth={1.2} /> : null}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[170px] w-full">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#059669]" />周费率柱 {hoverPoint ? fmtPct(hoverPoint.fundingRatePct) : "-"}</span>
            </div>
            <ResponsiveContainer>
              <BarChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                {visibleRegimeRanges.map((segment) => (
                  <ReferenceArea key={`research2-funding-${segment.index}`} x1={segment.x1} x2={segment.x2} fill={segment.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[-fundingCap, fundingCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Tooltip content={() => null} />
                <Bar dataKey="fundingRatePct" radius={[4, 4, 0, 0]}>
                  {visiblePoints.map((point) => (
                    <Cell key={`research2-funding-bar-${point.weekStart}`} fill={point.fundingRatePct >= 0 ? "#059669" : "#dc2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[170px] w-full">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <button type="button" onClick={() => toggleIndicatorVisibility("rsi")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.rsi ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />RSI {hoverPoint ? hoverPoint.rsi.toFixed(1) : "-"}</button>
            </div>
            <ResponsiveContainer>
              <LineChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                {visibleRegimeRanges.map((segment) => (
                  <ReferenceArea key={`research2-rsi-${segment.index}`} x1={segment.x1} x2={segment.x2} fill={segment.tone} fillOpacity={0.2} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 12 }} />
                <ReferenceLine y={displayData.indicatorSettings.rsiUpper} stroke="#f97316" strokeDasharray="4 4" />
                <ReferenceLine y={displayData.indicatorSettings.rsiLower} stroke="#f97316" strokeDasharray="4 4" />
                <Tooltip content={() => null} />
                {indicatorVisibility.rsi ? <Line type="monotone" dataKey="rsi" stroke="#ef4444" dot={false} strokeWidth={1.8} /> : null}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[170px] w-full">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <button type="button" onClick={() => toggleIndicatorVisibility("adx")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.adx ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#0f172a]" />ADX {hoverPoint ? hoverPoint.adx14.toFixed(1) : "-"}</button>
              <button type="button" onClick={() => toggleIndicatorVisibility("bbw")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.bbw ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#d97706]" />BBW {hoverPoint ? hoverPoint.bbwPercentile104.toFixed(1) : "-"}</button>
              <button type="button" onClick={() => toggleIndicatorVisibility("returnZ")} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${indicatorVisibility.returnZ ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}><span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />Return {hoverPoint ? hoverPoint.returnZ52.toFixed(2) : "-"}</button>
            </div>
            <ResponsiveContainer>
              <LineChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                {visibleRegimeRanges.map((segment) => (
                  <ReferenceArea key={`research2-indicator-${segment.index}`} x1={segment.x1} x2={segment.x2} fill={segment.tone} fillOpacity={0.25} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" domain={[-4, 4]} tick={{ fill: "#64748b", fontSize: 12 }} />
                <ReferenceLine yAxisId="left" y={displayData.indicatorSettings.adxTrendLevel} stroke="#334155" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="left" y={displayData.indicatorSettings.bbwHigh} stroke="#f59e0b" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="left" y={displayData.indicatorSettings.bbwLow} stroke="#f59e0b" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={displayData.indicatorSettings.returnUpper} stroke="#2563eb" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={displayData.indicatorSettings.returnLower} stroke="#2563eb" strokeDasharray="4 4" />
                <Tooltip content={() => null} />
                {indicatorVisibility.adx ? <Line yAxisId="left" type="monotone" dataKey="adx14" stroke="#0f172a" dot={false} strokeWidth={1.8} /> : null}
                {indicatorVisibility.bbw ? <Line yAxisId="left" type="monotone" dataKey="bbwPercentile104" stroke="#d97706" dot={false} strokeWidth={1.6} /> : null}
                {indicatorVisibility.returnZ ? <Line yAxisId="right" type="monotone" dataKey="returnZ52" stroke="#2563eb" dot={false} strokeWidth={1.6} /> : null}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[170px] w-full">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#7c3aed]" />日均成交量 {hoverPoint ? fmtVol(hoverPoint.avgVolumeM) : "-"}</span>
            </div>
            <ResponsiveContainer>
              <BarChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                {visibleRegimeRanges.map((segment) => (
                  <ReferenceArea key={`research2-volume-${segment.index}`} x1={segment.x1} x2={segment.x2} fill={segment.tone} fillOpacity={0.35} strokeOpacity={0} />
                ))}
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="weekStart" hide />
                <YAxis scale="log" domain={[volumeFloor, volumeCap]} tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value))}M`} />
                <Tooltip content={() => null} />
                <Bar dataKey="avgVolumeM" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[90px] w-full">
            <ResponsiveContainer>
              <BarChart data={visiblePoints} syncId="btc-weekly-research-2" onMouseMove={handleHover}>
                <XAxis dataKey="weekStart" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={28} tickFormatter={(value) => value.slice(2, 10)} />
                <YAxis hide domain={[0, 1]} />
                <Tooltip content={() => null} />
                <Bar dataKey={() => 1} isAnimationActive={false}>
                  {visiblePoints.map((point) => (
                    <Cell key={`research2-band-${point.weekStart}`} fill={point.confirmedTone} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {renderTimeRangeControls()}
        </div>
      </Card>

      <div className="space-y-6">
        <Card title="七态区间统计" hint="这里展示的是段级输出，不再等于周级标签多数表决。">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-3">区间</th>
                  <th className="py-3">状态</th>
                  <th className="py-3">时间范围</th>
                  <th className="py-3 text-right">周数</th>
                  <th className="py-3 text-right">累计涨跌</th>
                  <th className="py-3 text-right">平均周收益</th>
                  <th className="py-3 text-right">平均周费率</th>
                  <th className="py-3 text-right">平均 ADX</th>
                  <th className="py-3 text-right">平均 BBW分位</th>
                  <th className="py-3 text-right">峰值到段末回撤</th>
                  <th className="py-3 text-right">上涨周占比</th>
                </tr>
              </thead>
              <tbody>
                {displayData.segments.map((segment) => (
                  <tr key={`research2-segment-${segment.index}`} className="border-b border-slate-100">
                    <td className="py-3 font-medium text-slate-900">#{segment.index + 1}</td>
                    <td className="py-3">
                      <span className="inline-flex rounded-full px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: segment.tone }}>
                        {segment.label}
                      </span>
                    </td>
                    <td className="py-3 text-slate-500">{renderPriceRange(segment.startCloseDate, segment.startClosePrice, segment.endCloseDate, segment.endClosePrice)}</td>
                    <td className="py-3 text-right text-slate-600">{segment.weeks}</td>
                    <td className={`py-3 text-right ${rateText(segment.cumulativeReturnPct)}`}>{fmtPct(segment.cumulativeReturnPct)}</td>
                    <td className={`py-3 text-right ${rateText(segment.avgWeeklyReturnPct)}`}>{fmtPct(segment.avgWeeklyReturnPct)}</td>
                    <td className={`py-3 text-right ${rateText(segment.avgFundingRatePct)}`}>{fmtPct(segment.avgFundingRatePct)}</td>
                    <td className="py-3 text-right text-slate-600">{segment.avgAdx14.toFixed(1)}</td>
                    <td className="py-3 text-right text-slate-600">{segment.avgBbwPercentile104.toFixed(1)}</td>
                    <td className={`py-3 text-right ${rateText(segment.peakToEndDrawdownPct)}`}>{fmtPct(segment.peakToEndDrawdownPct)}</td>
                    <td className="py-3 text-right text-slate-600">{segment.positiveReturnSharePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="七态均值画像" hint="这里把所有周按最终状态汇总，方便对比每一类状态的平均收益、费率和趋势强度。">
          <div className="space-y-3">
            {orderedSummaries.map((summary) => (
              <div key={`research2-summary-${summary.label}`} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">{summary.label}</div>
                  <div className="text-xs text-slate-500">{summary.weeks} 周 / {summary.sharePct}%</div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                  <div>平均周收益：<span className={rateText(summary.avgWeeklyReturnPct)}>{fmtPct(summary.avgWeeklyReturnPct)}</span></div>
                  <div>平均周费率：<span className={rateText(summary.avgFundingRatePct)}>{fmtPct(summary.avgFundingRatePct)}</span></div>
                  <div>平均 ADX：<span className="text-slate-900">{summary.avgAdx14.toFixed(1)}</span></div>
                  <div>平均 BBW分位：<span className="text-slate-900">{summary.avgBbwPercentile104.toFixed(1)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="七态边界参数" hint="这里展示当前这次分段实际用到的动态阈值和固定规则，所有分位数都来自当前样本段分布。">
          <div className="space-y-4 text-sm text-slate-600">
            <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">参数编辑</div>
            <div className="mb-3 text-xs text-slate-500">点击“应用参数”后会保存为服务端全局默认值；点击“恢复默认参数”会清除服务端保存并恢复系统默认。</div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]">
                <label className="space-y-1">
                  <div className="text-xs text-slate-500">最短区间</div>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={minSegmentWeeksInput}
                    onChange={(event) => setMinSegmentWeeksInput(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-slate-500">最新区块最短区间</div>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={latestSegmentMinWeeksInput}
                    onChange={(event) => setLatestSegmentMinWeeksInput(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-slate-500">分段惩罚</div>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={splitPenaltyInput}
                    onChange={(event) => setSplitPenaltyInput(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-slate-500">最长区间</div>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    value={maxSegmentWeeksInput}
                    onChange={(event) => setMaxSegmentWeeksInput(event.target.value)}
                  />
                </label>
                <div className="flex items-end">
                  <div className="flex w-full gap-2 xl:w-[272px]">
                    <button
                      type="button"
                      onClick={applyResearch2Tuning}
                      className="inline-flex h-10 flex-1 whitespace-nowrap items-center justify-center rounded-xl bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-700"
                    >
                      应用参数
                    </button>
                    <button
                      type="button"
                      onClick={resetResearch2Tuning}
                      className="inline-flex h-10 flex-1 whitespace-nowrap items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                    >
                      恢复默认值
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">点击“应用参数”后，页面会按新参数重新分段并自动更新图表、区间统计和七态画像。</div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">这 3 个参数是什么意思</div>
                <div className="mt-2 space-y-2">
                  <div><span className="font-medium text-slate-900">最短区间</span>：允许切出来的最短段长。越小越容易切碎，越大越稳。</div>
                  <div><span className="font-medium text-slate-900">分段惩罚</span>：切一刀要付出的成本。越大越不容易新增区间，越小越敏感。</div>
                  <div><span className="font-medium text-slate-900">最长区间</span>：单段允许拖多长。越小越容易把长趋势拆开，越大越容易出现超长段。</div>
                </div>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">动态阈值怎么看</div>
                <div className="mt-2 space-y-2">
                  <div><span className="font-medium text-slate-900">bull / bear</span>：按当前区间样本的累计涨跌分布算出来，决定牛熊起始边界。</div>
                  <div><span className="font-medium text-slate-900">maxAdvance / maxDraw</span>：看段内推进和回撤强度，决定大牛、大熊和风险纠偏。</div>
                  <div><span className="font-medium text-slate-900">adx / bbw / trend</span>：看趋势强弱、波动宽窄和斜率，决定震荡灰、震荡牛、震荡熊的边界。</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">分段约束</div>
                <div className="mt-2 space-y-1">
                  <div>最短区间: <span className="font-medium text-slate-900">{displayData.thresholds.minSegmentWeeks} 周</span></div>
                  <div>最新区块最短区间: <span className="font-medium text-slate-900">{displayData.thresholds.latestSegmentMinWeeks} 周</span></div>
                  <div>分段惩罚: <span className="font-medium text-slate-900">{fmtPlainNumber(displayData.thresholds.splitPenalty)}</span></div>
                  <div>最长区间: <span className="font-medium text-slate-900">{displayData.thresholds.maxSegmentWeeks} 周</span></div>
                </div>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">方向带规则</div>
                <div className="mt-2 space-y-1">
                  <div>directionBand: <span className="font-medium text-slate-900">{displayData.thresholds.directionBandRule}</span></div>
                  <div>neutralBand: <span className="font-medium text-slate-900">{displayData.thresholds.neutralBandRule}</span></div>
                </div>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">极端空头规则</div>
                <div className="mt-2">
                  <div>{displayData.thresholds.crashBearRule}</div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-3">参数</th>
                    <th className="py-3 text-right">当前值</th>
                    <th className="py-3">用途</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["bullQ65", displayData.thresholds.bullQ65, "多头方向带基准"],
                    ["bullQ70", displayData.thresholds.bullQ70, "小牛起始净涨幅阈值"],
                    ["bullQ80", displayData.thresholds.bullQ80, "大牛升级净涨幅参考"],
                    ["bullQ90", displayData.thresholds.bullQ90, "极端多头参考"],
                    ["bearQ30", displayData.thresholds.bearQ30, "小熊起始净跌幅阈值"],
                    ["bearQ20", displayData.thresholds.bearQ20, "大熊/急杀熊净跌幅参考"],
                    ["maxAdvanceQ80", displayData.thresholds.maxAdvanceQ80, "上冲强度参考"],
                    ["maxAdvanceQ90", displayData.thresholds.maxAdvanceQ90, "大牛推进参考"],
                    ["maxDrawQ20", displayData.thresholds.maxDrawQ20, "风险强度参考"],
                    ["maxDrawQ10", displayData.thresholds.maxDrawQ10, "大熊/急杀熊回撤参考"],
                    ["peakToEndQ20", displayData.thresholds.peakToEndQ20, "高位回落纠偏参考"],
                    ["adxLowQ35", displayData.thresholds.adxLowQ35, "平缓震荡低趋势阈值"],
                    ["adxHighQ70", displayData.thresholds.adxHighQ70, "强趋势阈值"],
                    ["bbwLowQ35", displayData.thresholds.bbwLowQ35, "窄波动阈值"],
                    ["bbwHighQ70", displayData.thresholds.bbwHighQ70, "宽波动阈值"],
                    ["trendQ30", displayData.thresholds.trendQ30, "低趋势斜率阈值"],
                    ["trendQ70", displayData.thresholds.trendQ70, "高趋势斜率阈值"],
                  ].map(([name, value, note]) => (
                    <tr key={`threshold-${name}`} className="border-b border-slate-100">
                      <td className="py-3 font-medium text-slate-900">{name}</td>
                      <td className="py-3 text-right text-slate-600">{fmtPlainNumber(Number(value))}</td>
                      <td className="py-3 text-slate-600">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function MarketWorkbench({
  data,
  initialView,
  researchData,
  research2Data,
}: {
  data: WorkbenchData;
  initialView: ViewKey;
  researchData?: BtcWeeklyResearchData;
  research2Data?: BtcWeeklyResearch2Data;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("month");

  return (
    <WorkbenchShell data={data} initialView={initialView}>
      {initialView === "rates" ? <RateOverview symbols={data.symbols} timeframe={timeframe} setTimeframe={setTimeframe} latestDateText={data.updatedAtLabel} /> : null}
      {initialView === "monthly" ? <MonthlyMatrixView rows={data.monthlyRateRows} months={data.monthlyRateMonths} /> : null}
      {initialView === "audit" ? <AuditView audits={data.audits} /> : null}
      {initialView === "volume" ? <VolumeView symbols={data.symbols} timeframe={timeframe} /> : null}
      {initialView === "combined" ? <CombinedView symbols={data.symbols} /> : null}
      {initialView === "heatmap" ? <HeatmapView symbols={data.symbols} /> : null}
      {initialView === "research" ? <ResearchView researchData={researchData} /> : null}
      {initialView === "research2" ? <Research2View research2Data={research2Data} /> : null}
    </WorkbenchShell>
  );
}
