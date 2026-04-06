import MarketWorkbench from "@/components/market-workbench";
import { getBtcWeeklyResearch2Data, getWorkbenchData } from "@/lib/sqlite-workbench-data";

export const dynamic = "force-dynamic";

export default async function Research2Page() {
  const [data, research2Data] = await Promise.all([Promise.resolve(getWorkbenchData()), getBtcWeeklyResearch2Data()]);
  return <MarketWorkbench data={data} initialView="research2" research2Data={research2Data} />;
}
