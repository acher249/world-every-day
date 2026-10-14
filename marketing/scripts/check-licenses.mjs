import { readFile } from "node:fs/promises";

const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
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
  {
    packagePattern: /^caniuse-lite$/,
    licenses: new Set(["CC-BY-4.0"]),
  },
];
const deniedTokens = ["AGPL", "BUSL", "Commons-Clause", "GPL-", "SSPL", "UNLICENSED"];

function packageNameFromPath(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index === -1 ? packagePath : packagePath.slice(index + marker.length);
}

function isReviewedException(name, license) {
  return reviewedExceptions.some(
    (exception) => exception.packagePattern.test(name) && exception.licenses.has(license),
  );
}

const failures = [];
const exceptionsUsed = [];
const packages = Object.entries(lockfile.packages ?? {}).filter(([packagePath]) => packagePath !== "");

for (const [packagePath, metadata] of packages) {
  const name = packageNameFromPath(packagePath);
  const license = metadata.license;
  if (!license) {
    failures.push(`${name}@${metadata.version ?? "unknown"}: missing license metadata`);
  } else if (isReviewedException(name, license)) {
    exceptionsUsed.push(`${name}@${metadata.version}: ${license}`);
  } else if (!permissiveLicenses.has(license)) {
    const denied = deniedTokens.some((token) => license.includes(token));
    failures.push(`${name}@${metadata.version ?? "unknown"}: ${license}${denied ? " (denied)" : " (not approved)"}`);
  }
}

if (failures.length > 0) {
  console.error("License policy failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`License policy passed for ${packages.length} installed packages.`);
if (exceptionsUsed.length > 0) {
  console.log("Reviewed transitive exceptions:");
  for (const exception of exceptionsUsed) console.log(`- ${exception}`);
}
