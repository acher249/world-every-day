import { Suspense } from "react";
import type { Metadata } from "next";
import { CaptureScene } from "./capture-scene";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CapturePage() {
  return <Suspense fallback={null}><CaptureScene /></Suspense>;
}
