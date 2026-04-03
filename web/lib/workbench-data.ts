export type Timeframe = "day" | "week" | "month";

export type Point = {
  label: string;
  value: number;
};

export type MarketSymbol = {
  symbol: string;
  rateDayPct: number;
  rateWeekPct: number;
  rateMonthPct: number;
  ratePrevMonthPct: number;
  ratePrev3MonthsPct: number;
  ratePrev6MonthsPct: number;
  ratePrev12MonthsPct: number;
  ratePrev24MonthsPct: number;
  volumeDayM: number;
  volumeWeekM: number;
  volumeMonthM: number;
  avg30dVolumeM: number;
  avg90dVolumeM: number;
  avg365dVolumeM: number;
  monthAvgDailyVolumeM: number;
  prevMonthAvgDailyVolumeM: number;
  prev3MonthsAvgDailyVolumeM: number;
  prev6MonthsAvgDailyVolumeM: number;
  prev12MonthsAvgDailyVolumeM: number;
  avg30dRatePct: number;
  avg90dRatePct: number;
  avg180dRatePct: number;
  avg365dRatePct: number;
  rateVolatility30Pct: number;
  rateVolatility365Pct: number;
  positiveDays30: number;
  positiveDays90: number;
  positiveDays180: number;
  rateDailyTrend: Point[];
  rateWeeklyTrend: Point[];
  rateMonthlyTrend: Point[];
  volumeDailyTrend: Point[];
  volumeWeeklyTrend: Point[];
  volumeMonthlyTrend: Point[];
};

export type WorkbenchData = {
  symbols: MarketSymbol[];
  monthlyRateMonths: string[];
  monthlyRateRows: MonthlyRateRow[];
  sourceLabel: string;
  updatedAtLabel: string;
  loadError?: string;
};

export type MonthlyRateRow = {
  symbol: string;
  months: Record<string, number>;
  totalRatePct: number;
  avgRatePct: number;
  lastMonthRatePct: number;
  last3MonthsRatePct: number;
  last12MonthsRatePct: number;
  bestMonthRatePct: number;
  worstMonthRatePct: number;
  volatilityPct: number;
  positiveMonths: number;
  negativeMonths: number;
  availableMonths: number;
};

export function getRateValue(symbol: MarketSymbol, timeframe: Timeframe) {
  return timeframe === "day" ? symbol.rateDayPct : timeframe === "week" ? symbol.rateWeekPct : symbol.rateMonthPct;
}

export function getVolumeValue(symbol: MarketSymbol, timeframe: Timeframe) {
  return timeframe === "day" ? symbol.volumeDayM : timeframe === "week" ? symbol.volumeWeekM : symbol.volumeMonthM;
}

export function getRateTrend(symbol: MarketSymbol, timeframe: Timeframe) {
  return timeframe === "day" ? symbol.rateDailyTrend : timeframe === "week" ? symbol.rateWeeklyTrend : symbol.rateMonthlyTrend;
}

export function getVolumeTrend(symbol: MarketSymbol, timeframe: Timeframe) {
  return timeframe === "day" ? symbol.volumeDailyTrend : timeframe === "week" ? symbol.volumeWeeklyTrend : symbol.volumeMonthlyTrend;
}
