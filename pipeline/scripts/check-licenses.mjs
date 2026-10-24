import { readFile } from "node:fs/promises";

const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);

const permissiveLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
]);

const reviewedExceptions = [
  {
    packagePattern: /^@img\/sharp-(libvips-.+|wasm32|win32-.+)$/,
    licenses: new Set([
      "LGPL-3.0-or-later",
      "Apache-2.0 AND LGPL-3.0-or-later",
      "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
    ]),
  },
];

function packageNameFromPath(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index === -1 ? packagePath : packagePath.slice(index + marker.length);
}

const failures = [];
const packages = Object.entries(lockfile.packages ?? {}).filter(
  ([packagePath]) => packagePath !== "",
);

for (const [packagePath, metadata] of packages) {
  const name = packageNameFromPath(packagePath);
  const license = metadata.license;
  if (!license) {
    failures.push(`${name}@${metadata.version ?? "unknown"}: missing license metadata`);
    continue;
  }
  if (permissiveLicenses.has(license)) continue;
  const reviewed = reviewedExceptions.some(
    (exception) =>
      exception.packagePattern.test(name) && exception.licenses.has(license),
  );
  if (!reviewed) {
    failures.push(`${name}@${metadata.version ?? "unknown"}: ${license}`);
  }
}

if (failures.length > 0) {
  console.error("License policy failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`License policy passed for ${packages.length} installed packages.`);

// Reviewed native exception: isolated, dynamically linked LGPL FFmpeg encoder.
const encoder = await readFile(new URL("../src/video/encoder/build-codecs.sh", import.meta.url), "utf8");
if (!encoder.includes("--disable-gpl --disable-nonfree") || !encoder.includes("--enable-shared --disable-static") ||
    /--enable-gpl|--enable-nonfree|--enable-libx264/.test(encoder) || !encoder.includes("sha256sum -c")) {
  throw new Error("Native encoder must preserve the reviewed LGPL-only, checksum-pinned build policy");
}
console.log("Native encoder policy passed: GPL/nonfree disabled; sources and notices retained.");
