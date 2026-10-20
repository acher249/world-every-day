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

  assert.equal(configuration.sources.length, 32);
  assert.equal(configuration.sources.filter(({ type }) => type === "rss").length, 31);
  assert.equal(configuration.sources.filter(({ type }) => type === "atom").length, 1);
  assert.ok(configuration.sources.every(({ feedUrl }) => !new URL(feedUrl).hostname.endsWith(".test")));
  assert.ok(configuration.sources.every(({ allowedArticleHosts }) => allowedArticleHosts.length > 0));
  assert.ok(configuration.sources.every(({ articleAccess }) => articleAccess === "ephemeral-analysis"));
  assert.equal(configuration.sources.find(({ id }) => id === "nasa-news")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "nci-news")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "fda-press-releases")?.upgradeHttpArticleLinksToHttps, true);
  assert.equal(configuration.sources.find(({ id }) => id === "nsf-news")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "noaa-ocean-service-news")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "nist-news")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "noaa-news")?.feedUrl, "https://www.noaa.gov/rss.xml");
  assert.equal(configuration.sources.find(({ id }) => id === "fao-newsroom")?.feedUrl, "https://www.fao.org/feeds/fao-newsroom-rss");
  assert.deepEqual(configuration.sources.find(({ id }) => id === "fao-newsroom")?.allowedArticleHosts, ["www.fao.org"]);
  assert.equal(configuration.sources.find(({ id }) => id === "mit-latest-news")?.feedUrl, "https://news.mit.edu/rss/feed");
  assert.deepEqual(configuration.sources.find(({ id }) => id === "yale-news")?.allowedArticleHosts, ["news.yale.edu"]);
  assert.equal(configuration.sources.find(({ id }) => id === "horizon-magazine")?.articleAccess, "ephemeral-analysis");
  assert.equal(configuration.sources.find(({ id }) => id === "cornell-chronicle-news")?.feedUrl, "https://news.cornell.edu/taxonomy/term/81/feed");
  for (const id of [
    "plos-one", "plos-global-public-health", "plos-medicine", "plos-biology",
    "plos-computational-biology", "plos-climate", "plos-digital-health",
    "plos-neglected-tropical-diseases", "plos-sustainability-and-transformation", "plos-water",
  ]) {
    const source = configuration.sources.find((item) => item.id === id);
    assert.equal(source?.articleAccess, "ephemeral-analysis");
    assert.equal(source?.publisherGroup, "PLOS");
    assert.equal(source?.crawlDelayMs, 30_000);
    assert.deepEqual(source?.allowedArticleHosts, ["journals.plos.org"]);
  }
  assert.equal(configuration.sources.find(({ id }) => id === "nsf-statistics")?.feedUrl, "https://ncses.nsf.gov/rss");
  assert.deepEqual(configuration.sources.find(({ id }) => id === "european-commission-highlights")?.allowedArticleHosts, ["commission.europa.eu"]);
  assert.equal(configuration.sources.find(({ id }) => id === "cdc-emerging-infectious-diseases")?.crawlDelayMs, 20_000);
  assert.equal(configuration.sources.find(({ id }) => id === "govuk-news")?.publishedAtLookup, "govuk-content-api");
  assert.deepEqual(configuration.sources.find(({ id }) => id === "ec-environment-news")?.allowedArticleHosts, ["environment.ec.europa.eu"]);
  for (const id of ["positive-news", "reasons-to-be-cheerful", "next-city", "un-news", "npr-top-stories", "npr-arts-life", "smithsonian-latest", "wikimedia-diff", "esa-earth-observation", "mit-research-news", "cornell-arts-humanities", "cornell-food-agriculture", "cornell-public-engagement", "rhinoceros-media"]) {
    assert.equal(configuration.sources.some((source) => source.id === id), false);
  }
});

test("source configuration rejects duplicate adapter ids", async () => {
  const configuration = await fixture() as SourceConfiguration;
  configuration.sources.push({ ...configuration.sources[0] });

  assert.throws(() => parseSourceConfiguration(configuration), /Duplicate source id/);
});

