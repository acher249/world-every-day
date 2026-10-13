import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSourceConfiguration, type SourceConfiguration } from "../src/sources/config.js";

const fixtureUrl = new URL("../fixtures/source-configuration.v1.json", import.meta.url);

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8"));
}

test("the example source configuration is valid and explicitly allowlisted", async () => {
  const configuration = parseSourceConfiguration(await fixture());

  assert.equal(configuration.sources.length, 1);
  assert.deepEqual(configuration.sources[0].allowedArticleHosts, ["news.example.test"]);
});

test("the initial live source configuration is valid and contains no placeholder hosts", async () => {
  const input = JSON.parse(
    await readFile(
      fileURLToPath(new URL("../config/source-configuration.initial.v1.json", import.meta.url)),
      "utf8",
    ),
  ) as unknown;
  const configuration = parseSourceConfiguration(input);

  assert.equal(configuration.sources.length, 3);
  assert.ok(configuration.sources.every(({ feedUrl }) => !new URL(feedUrl).hostname.endsWith(".test")));
  assert.ok(configuration.sources.every(({ allowedArticleHosts }) => allowedArticleHosts.length > 0));
});

test("source configuration rejects duplicate adapter ids", async () => {
  const configuration = await fixture() as SourceConfiguration;
  configuration.sources.push({ ...configuration.sources[0] });

  assert.throws(() => parseSourceConfiguration(configuration), /Duplicate source id/);
});

