import MarketWorkbench from "@/components/market-workbench";
import { getWorkbenchData } from "@/lib/sqlite-workbench-data";

export const dynamic = "force-dynamic";

export default function MonthlyPage() {
  return <MarketWorkbench data={getWorkbenchData()} initialView="monthly" />;
}
