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
    packagePattern: /(^|\/)case$/,
    licenses: new Set(["(MIT OR GPL-3.0-or-later)"]),
  },
  {
    packagePattern: /(^|\/)minimatch$/,
    licenses: new Set(["BlueOak-1.0.0"]),
  },
];
const failures = [];
const packages = Object.entries(lockfile.packages ?? {}).filter(([path]) => path !== "");

for (const [path, metadata] of packages) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  const name = index === -1 ? path : path.slice(index + marker.length);
  const license = metadata.license;
  const reviewed = license && reviewedExceptions.some(
    (exception) =>
      exception.packagePattern.test(name) && exception.licenses.has(license),
  );
  if (!license || (!permissiveLicenses.has(license) && !reviewed)) {
    failures.push(`${name}@${metadata.version ?? "unknown"}: ${license ?? "missing license metadata"}`);
  }
}

if (failures.length > 0) {
  console.error("License policy failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`License policy passed for ${packages.length} installed packages.`);

