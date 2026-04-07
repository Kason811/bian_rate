export type Timeframe = "day" | "week" | "month";

export type Point = {
  label: string;
  value: number;
};

export type MarketSymbol = {
  symbol: string;
  isActive?: boolean;
  rateDayPct: number;
  rateWeekFromDailyPct: number;
  rateWeekFromWeeklyPct: number;
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
  audits: AuditRow[];
  sourceLabel: string;
  updatedAtLabel: string;
  loadError?: string;
};

export type ResearchRegime = {
  label: string;
  start: string;
  end: string;
  tone: string;
  stateClass: -1 | 0 | 1;
};

export type ManualResearchRegimeRow = {
  symbol: string;
  label: string;
  start: string;
  end: string;
  tone: string;
  stateClass: -1 | 0 | 1;
};

export type BtcWeeklyResearchPoint = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  fundingRatePct: number;
  avgVolumeM: number;
  closePrice: number;
  weeklyReturnPct: number;
  regimeLabel: string;
  regimeTone: string;
};

export type ResearchLagStat = {
  metric: string;
  bestLagWeeks: number;
  correlation: number;
};

export type ResearchRegimeStat = {
  label: string;
  start: string;
  end: string;
  weeks: number;
  avgFundingRatePct: number;
  avgVolumeM: number;
  cumulativeReturnPct: number;
  maxAdvancePct: number;
  maxDrawdownPct: number;
  positiveFundingWeeks: number;
  positiveReturnWeeks: number;
};

export type ResearchAutoRegimePoint = {
  weekStart: string;
  weekEnd: string;
  closePrice: number;
  heatScore: number;
  heatColor: string;
  segmentIndex: number;
  stateClass: -1 | 0 | 1;
  stateLabel: string;
  source: "auto" | "manual";
  note?: string;
};

export type ResearchAutoRegimeSegment = {
  index: number;
  start: string;
  end: string;
  weeks: number;
  cumulativeReturnPct: number;
  maxAdvancePct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  positiveReturnWeeks: number;
  heatScore: number;
  heatColor: string;
  stateClass: -1 | 0 | 1;
  stateLabel: string;
  source: "auto" | "manual";
  note?: string;
};

export type BtcWeeklyResearchData = {
  symbol: string;
  timeframe: "week";
  points: BtcWeeklyResearchPoint[];
  regimes: ResearchRegime[];
  manualRegimeRows: ManualResearchRegimeRow[];
  lagStats: ResearchLagStat[];
  regimeStats: ResearchRegimeStat[];
  autoRegimePoints: ResearchAutoRegimePoint[];
  autoRegimeSegments: ResearchAutoRegimeSegment[];
  autoRegimeAgreementPct: number;
  autoOverrideCount: number;
  editableSymbols: string[];
  sourceLabel: string;
  loadError?: string;
};

export type BtcWeeklyResearch2Point = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  fundingRatePct: number;
  avgVolumeM: number;
  weeklyReturnPct: number;
  ema21: number;
  sma200: number;
  bbBasis: number;
  bbUpper: number;
  bbLower: number;
  rsi: number;
  adx14: number;
  bbw: number;
  bbwPercentile104: number;
  returnZ52: number;
  confirmedRegime: string;
  confirmedTone: string;
  family: "Bull" | "Sideways" | "Bear";
};

export type BtcWeeklyResearch2Segment = {
  index: number;
  label: string;
  family: "Bull" | "Sideways" | "Bear";
  tone: string;
  start: string;
  end: string;
  weeks: number;
  cumulativeReturnPct: number;
  maxAdvancePct: number;
  maxDrawdownPct: number;
  avgFundingRatePct: number;
  avgVolumeM: number;
  avgAdx14: number;
  avgBbwPercentile104: number;
  avgWeeklyReturnPct: number;
  peakToEndDrawdownPct: number;
  positiveReturnSharePct: number;
  priceSlope: number;
  trendScore: number;
};

export type BtcWeeklyResearch2Summary = {
  label: string;
  weeks: number;
  sharePct: number;
  avgWeeklyReturnPct: number;
  avgFundingRatePct: number;
  avgAdx14: number;
  avgBbwPercentile104: number;
};

export type BtcWeeklyResearch2Thresholds = {
  minSegmentWeeks: number;
  latestSegmentMinWeeks: number;
  splitPenalty: number;
  maxSegmentWeeks: number;
  bullQ65: number;
  bullQ70: number;
  bullQ80: number;
  bullQ90: number;
  bearQ30: number;
  bearQ20: number;
  maxAdvanceQ80: number;
  maxAdvanceQ90: number;
  maxDrawQ20: number;
  maxDrawQ10: number;
  peakToEndQ20: number;
  adxLowQ35: number;
  adxHighQ70: number;
  bbwLowQ35: number;
  bbwHighQ70: number;
  trendQ30: number;
  trendQ70: number;
  directionBandRule: string;
  neutralBandRule: string;
  crashBearRule: string;
};

export type ResearchMarketType = "coinm" | "usdtm";

export type ResearchTimeframe = "week" | "3day" | "day";

export type Research2IndicatorSettings = {
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

export type Research2Data = {
  marketType: ResearchMarketType;
  symbol: string;
  timeframe: ResearchTimeframe;
  availableMarkets: ResearchMarketType[];
  availableSymbols: string[];
  points: BtcWeeklyResearch2Point[];
  segments: BtcWeeklyResearch2Segment[];
  summaries: BtcWeeklyResearch2Summary[];
  thresholds: BtcWeeklyResearch2Thresholds;
  indicatorSettings: Research2IndicatorSettings;
  latestObservedDate: string;
  sourceLabel: string;
  loadError?: string;
};

export type BtcWeeklyResearch2IndicatorSettings = Research2IndicatorSettings;
export type BtcWeeklyResearch2Data = Research2Data;

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

export type AuditRow = {
  symbol: string;
  isActive: boolean;
  fundingStatus: string;
  fundingScore: number;
  fundingGapCount: number;
  fundingZeroEventDays: number;
  fundingNotes: string;
  volumeStatus: string;
  volumeScore: number;
  volumeDayCount: number;
  volumeGapCount: number;
  volumeNotes: string;
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
