import type { Metadata } from "next";
import { resolveMarketingSiteConfig } from "@/lib/site-config";
import "./globals.css";

const { siteUrl } = resolveMarketingSiteConfig();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "A World Every Day | Information, as a place",
  description:
    "A living digital installation that turns a curated set of daily stories into an explorable world.",
  openGraph: {
    title: "A World Every Day",
    description: "A living digital installation. A new world, every day.",
    type: "website",
    url: siteUrl,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
