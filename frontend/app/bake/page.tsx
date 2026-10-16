import { Suspense } from "react";
import type { Metadata } from "next";

import { BakeScene } from "./bake-scene";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function BakePage() {
  return <Suspense fallback={null}><BakeScene /></Suspense>;
}
