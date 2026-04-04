import MarketWorkbench from "@/components/market-workbench";
import { getBtcWeeklyResearchData, getWorkbenchData } from "@/lib/sqlite-workbench-data";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [data, researchData] = await Promise.all([Promise.resolve(getWorkbenchData()), getBtcWeeklyResearchData()]);
  return <MarketWorkbench data={data} initialView="research" researchData={researchData} />;
}
