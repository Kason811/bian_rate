import MarketWorkbench from "@/components/market-workbench";
import { getWorkbenchData } from "@/lib/sqlite-workbench-data";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  return <MarketWorkbench data={getWorkbenchData()} initialView="audit" />;
}
