import MarketWorkbench from "@/components/market-workbench";
import { getBtcWeeklyResearch2Data, getWorkbenchData } from "@/lib/sqlite-workbench-data";

export const dynamic = "force-dynamic";

function parseIntParam(value: string | string[] | undefined, fallback: number) {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(text ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value: string | string[] | undefined, fallback: number) {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseFloat(text ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function Research2Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const tuning = {
    minSegmentWeeks: parseIntParam(params.minWeeks, 5),
    latestSegmentMinWeeks: parseIntParam(params.latestMinWeeks, 5),
    splitPenalty: parseFloatParam(params.splitPenalty, 7.8),
    maxSegmentWeeks: parseIntParam(params.maxWeeks, 28),
  };
  const indicatorSettings = {
    emaPeriod: parseIntParam(params.emaPeriod, 21),
    smaPeriod: parseIntParam(params.smaPeriod, 200),
    adxPeriod: parseIntParam(params.adxPeriod, 14),
    adxTrendLevel: parseIntParam(params.adxTrendLevel, 25),
    rsiPeriod: parseIntParam(params.rsiPeriod, 14),
    rsiUpper: parseIntParam(params.rsiUpper, 80),
    rsiLower: parseIntParam(params.rsiLower, 20),
    bbPeriod: parseIntParam(params.bbPeriod, 20),
    bbStdDev: parseFloatParam(params.bbStdDev, 2),
    returnZPeriod: parseIntParam(params.returnZPeriod, 52),
    returnUpper: parseFloatParam(params.returnUpper, 2),
    returnLower: parseFloatParam(params.returnLower, -2),
    bbwPercentileWindow: parseIntParam(params.bbwWindow, 104),
    bbwHigh: parseIntParam(params.bbwHigh, 70),
    bbwLow: parseIntParam(params.bbwLow, 30),
  };
  const [data, research2Data] = await Promise.all([Promise.resolve(getWorkbenchData()), getBtcWeeklyResearch2Data({ tuning, indicatorSettings })]);
  return <MarketWorkbench data={data} initialView="research2" research2Data={research2Data} />;
}
