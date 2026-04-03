import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Funding Workbench",
  description: "费率优先、成交量确认的 Binance 币本位资金费率分析面板。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
