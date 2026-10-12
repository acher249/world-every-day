import { readFile } from "node:fs/promises";

const lockfileUrl = new URL("../package-lock.json", import.meta.url);
const lockfile = JSON.parse(await readFile(lockfileUrl, "utf8"));

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
    reason: "Optional Sharp/libvips platform binary installed by Next.js",
  },
  {
    packagePattern: /^caniuse-lite$/,
    licenses: new Set(["CC-BY-4.0"]),
    reason: "Browser compatibility data with attribution in THIRD_PARTY_NOTICES.md",
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
    (exception) =>
      exception.packagePattern.test(name) && exception.licenses.has(license),
  );
}

const failures = [];
const exceptionsUsed = [];
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

  if (isReviewedException(name, license)) {
    exceptionsUsed.push(`${name}@${metadata.version}: ${license}`);
    continue;
  }

  if (permissiveLicenses.has(license)) continue;

  const denied = deniedTokens.some((token) => license.includes(token));
  failures.push(
    `${name}@${metadata.version ?? "unknown"}: ${license}${denied ? " (denied)" : " (not approved)"}`,
  );
}

if (failures.length > 0) {
  console.error("License policy failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nReview docs/LICENSING.md before adding an exception.");
  process.exit(1);
}

console.log(`License policy passed for ${packages.length} installed packages.`);
if (exceptionsUsed.length > 0) {
  console.log("Reviewed transitive exceptions:");
  for (const exception of exceptionsUsed) console.log(`- ${exception}`);
}

