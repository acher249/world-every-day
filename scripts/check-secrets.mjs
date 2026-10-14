import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const forbiddenPaths = [
  /(^|\/)\.env(?:\..+)?$/,
  /(^|\/)(?:credentials|secrets?)\.(?:json|ya?ml)$/i,
  /\.(?:key|p12|pem|pfx)$/i,
];
const allowedPaths = new Set([
  "frontend/.env.example",
  "infra/aws/.env.example",
  "marketing/.env.example",
  "pipeline/.env.example",
]);
const secretPatterns = [
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Google API key", /\bAIza[\w-]{35}\b/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{16,}\b/g],
];

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const repositoryFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).split("\0").filter(Boolean);
const failures = [];

for (const path of repositoryFiles) {
  if (!allowedPaths.has(path) && forbiddenPaths.some((pattern) => pattern.test(path))) {
    failures.push(`${path}: forbidden credential-file path`);
    continue;
  }
  let contents;
  try {
    contents = readFileSync(resolve(repositoryRoot, path));
  } catch (error) {
    failures.push(`${path}: could not read tracked file (${error.message})`);
    continue;
  }
  if (contents.includes(0)) continue;
  const text = contents.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(`${path}: possible ${label}`);
  }
}

if (failures.length > 0) {
  console.error("Secret scan failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${repositoryFiles.length} repository files.`);
