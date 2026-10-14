import { notFound } from "next/navigation";

import { SparkWorld } from "@/components/spark-world";

type BakePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function value(input: string | string[] | undefined): string | undefined {
  return Array.isArray(input) ? input[0] : input;
}

export default async function BakePage({ searchParams }: BakePageProps) {
  if (process.env.NODE_ENV !== "development") notFound();
  const parameters = await searchParams;
  const splat = value(parameters.splat);
  const sha256 = value(parameters.sha256);
  if (
    !splat ||
    !/^\/generated\/[a-z0-9][a-z0-9-]*\.spz$/.test(splat) ||
    !sha256 ||
    !/^[a-f0-9]{64}$/.test(sha256)
  ) notFound();

  return (
    <main className="world-canvas">
      <SparkWorld
        alt="Interaction baking preview"
        posterSrc="/images/demo-world.png"
        splatSha256={sha256}
        splatUrl={splat}
      />
    </main>
  );
}
