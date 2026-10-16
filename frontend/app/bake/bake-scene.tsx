"use client";

import { useSearchParams } from "next/navigation";

import { SparkWorld } from "@/components/spark-world";

export function BakeScene() {
  const parameters = useSearchParams();
  const splat = parameters.get("splat");
  const sha256 = parameters.get("sha256");
  if (!splat || !/^\/generated\/[a-z0-9][a-z0-9-]*\.spz$/.test(splat) ||
      !sha256 || !/^[a-f0-9]{64}$/.test(sha256)) return null;

  return (
    <main className="world-canvas">
      <SparkWorld
        alt="Interaction baking preview"
        enableBake
        posterSrc="/images/demo-world.png"
        splatSha256={sha256}
        splatUrl={splat}
      />
    </main>
  );
}
