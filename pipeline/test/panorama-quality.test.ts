import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { cleanSceneGeometry } from "../src/panorama/geometry.js";
import { buildPanoramaPrompt } from "../src/panorama/prompt.js";
import { buildScenePrompt } from "../src/art-direction/prompt.js";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { annotateHorizon, horizonPasses, horizonAssessmentSchema, type HorizonAssessment } from "../src/panorama/horizon.js";
import { hasAffirmativeSeamArtifactEvidence, seamReviewPasses } from "../src/panorama/seam-review.js";
import { createQualityGenerator, PanoramaCandidateRejected } from "../src/panorama/quality-generator.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";
import { sha256 } from "../src/panorama/hash.js";

function assessment(y = 0.5): HorizonAssessment {
  return { sectors: [0,1,2,3].map((sector) => ({ sector, visible: true, horizonY: y, confidence: 0.95, evidence: "Distant ocean boundary" })), tilted: false, collageOrSeams: false, textOrGuides: false };
}

test("scene geometry is removed without flattening terrain or removing camera objects", () => {
  const prose = "Red shelves, freshwater estuaries, and gravel clearings under a high horizon. Mountains surround an elevated platform. Camera housing glass gleams. Use a high camera and lower the horizon to make room for the story objects.";
  const cleaned = cleanSceneGeometry(prose);
  assert.doesNotMatch(cleaned, /high horizon/);
  assert.match(cleaned, /Red shelves/);
  assert.match(cleaned, /Mountains surround an elevated platform/);
  assert.match(cleaned, /Camera housing glass/);
  for (const conflict of ["a low horizon", "an aerial view", "looking down over the scene", "camera tilt is dramatic", "a bird’s-eye view", "horizon above the middle", "high camera elevation", "move the equator down", "from above the valley"]) {
    assert.doesNotMatch(buildPanoramaPrompt(`A rocky park. Use ${conflict}.`), new RegExp(conflict));
  }
  const prompt = buildPanoramaPrompt("A rocky park. Landmark centers sit between 35% and 65% of image height.");
  assert.match(prompt, /geometric horizon exactly on the vertical center row \(y = 50%\)/i);
  assert.match(prompt, /landmark placement is separate from horizon placement/i);
  assert.match(prompt, /Camera height may suit the setting/i);
  assert.doesNotMatch(prompt, /do not use a high|elevated viewpoint|standing eye height/i);
});

test("the complete demo scene prompt keeps object placement separate from the horizon rule", async () => {
  const direction = artDirectionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )) as unknown);
  const prompt = buildPanoramaPrompt(buildScenePrompt(direction));
  assert.match(prompt, /geometric horizon exactly on the vertical center row \(y = 50%\)/i);
  assert.match(prompt, /landmark placement is separate from horizon placement/i);
  assert.match(prompt, /story and style only; it cannot change the projection or camera/i);
  assert.doesNotMatch(prompt, /cross(?:ing)? the horizon|high horizon|low horizon|elevated viewpoint|standing eye height|lower the horizon|move the equator/i);
});

test("horizon admission checks geometry independently from the seam gate", () => {
  assert.equal(horizonPasses(assessment()), true);
  assert.equal(horizonPasses(assessment(0.4)), true);
  assert.equal(horizonPasses(assessment(0.6)), true);
  assert.equal(horizonPasses(assessment(0.399)), false);
  assert.equal(horizonPasses(assessment(0.601)), false);
  assert.equal(horizonPasses({ ...assessment(), textOrGuides: true }), false);
  assert.equal(horizonPasses({ ...assessment(), collageOrSeams: true }), true);
  const contradictoryReview = assessment();
  contradictoryReview.sectors[3].evidence = "An overlaid horizontal blur band is visible across the right sector.";
  assert.equal(horizonPasses(contradictoryReview), true, "seam evidence is evaluated by the separate seam reviewer");
  const cleanEvidence = assessment();
  cleanEvidence.sectors[3].evidence = "No visible seams or blur bands; terrain wraps continuously.";
  assert.equal(horizonPasses(cleanEvidence), true, "explicitly negated artifact language must not fail a clean image");
  assert.equal(horizonPasses({ ...assessment(), tilted: true }), false);
  const hidden = assessment(); hidden.sectors = hidden.sectors.map((s) => ({ ...s, visible: false, horizonY: null }));
  assert.equal(horizonPasses(hidden), false);
  const uncertain = assessment(); uncertain.sectors[0].confidence = 0.5;
  assert.equal(horizonPasses(uncertain), true, "two high-confidence centered sectors are enough when all reported horizons are centered");
  uncertain.sectors[1].confidence = 0.5;
  uncertain.sectors[2].confidence = 0.5;
  assert.equal(horizonPasses(uncertain), false, "fewer than two high-confidence sectors fail closed");
  const partiallyHidden = assessment();
  partiallyHidden.sectors[0] = { ...partiallyHidden.sectors[0], visible: false, horizonY: null, confidence: 0 };
  assert.equal(horizonPasses(partiallyHidden), true);
  assert.throws(() => horizonAssessmentSchema.parse({ ...assessment(), sectors: [assessment().sectors[0], ...assessment().sectors.slice(0,3)] }));
});

test("the focused seam gate permits localized mismatches but rejects structural failures", () => {
  assert.equal(seamReviewPasses({ status: "clear", affectedSectors: [], evidence: "The wrap is coherent across all sectors." }), true);
  assert.equal(seamReviewPasses({ status: "tolerable", affectedSectors: [0, 3], evidence: "The horizon and terrain differ noticeably at the wrap, but the world remains readable." }), true);
  assert.equal(seamReviewPasses({ status: "blocking", affectedSectors: [3], evidence: "A broad horizontal blur band spans much of the image." }), false);
  assert.equal(seamReviewPasses({ status: "uncertain", affectedSectors: [], evidence: "The wrap cannot be verified." }), false);
  assert.equal(seamReviewPasses({ status: "clear", affectedSectors: [], evidence: "A horizontal blur band remains in sector 2." }), false);
  assert.equal(seamReviewPasses({ status: "clear", affectedSectors: [], evidence: "The edges are seamless. No stitching seams, blur bands, or collage artifacts are present." }), true);
  assert.equal(seamReviewPasses({ status: "tolerable", affectedSectors: [1, 2, 3], evidence: "Several sectors contain different scenes." }), false);
  assert.equal(hasAffirmativeSeamArtifactEvidence("No seams are visible, but a broad smear crosses sector 2."), true);
  assert.equal(hasAffirmativeSeamArtifactEvidence("No smear or blur band is present; the panorama wraps seamlessly."), false);
});

test("horizon correction marks the target equator and points from the observed horizon toward it", async () => {
  const image = await sharp({ create: { width: 1440, height: 720, channels: 3, background: "#777" } }).png().toBuffer();
  const evidenceOnly = assessment(0.25);
  evidenceOnly.collageOrSeams = false;
  evidenceOnly.sectors[3].evidence = "An overlaid horizontal blur band is visible.";
  const corrected = await annotateHorizon(image, evidenceOnly);
  const { data, info } = await sharp(corrected).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(pixel(700, 360)[0] > 220 && pixel(700, 360)[1] < 60, "target equator is a red horizontal line");
  assert.ok(pixel(180, 180)[0] > 220 && pixel(180, 180)[1] > 130, "observed horizon is marked in amber");
  assert.ok(pixel(180, 300)[0] > 220 && pixel(180, 300)[1] > 130, "directional correction arrow points down toward the equator");
  assert.ok(pixel(1100, 7)[0] > 220 && pixel(1100, 7)[2] > 180, "evidence of a blur band outlines its sector even when the boolean flag is false");
});

async function harness(reviews: HorizonAssessment[]) {
  const records = new Map<string, Uint8Array>(); const claims = new Set<string>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({key, bytes, contentType}) {
      if (records.has(key)) assert.deepEqual(records.get(key), bytes);
      records.set(key, bytes); return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  let calls = 0; let reviewCalls = 0;
  const image = await sharp({create:{width:128,height:72,channels:3,background:"#89a"}}).png().toBuffer();
  const generator = createQualityGenerator({
    model:"fixture", reviewModel:"fixture-review", root:"quality", artifacts,
    references:[{bytes:image,mimeType:"image/png"},{bytes:image,mimeType:"image/png"}],
    claims:{async claimOnce(key) {if(claims.has(key))return false;claims.add(key);return true;}},
    waitBeforeReviewRetry: async () => {},
    generator:{async generate(prompt, refs) {
      calls++; assert.equal(Array.isArray(refs) ? refs.length : 0, calls === 1 ? 2 : 3);
      if(calls > 1) assert.match(prompt,/previous failed candidate/);
      return {bytes:image,mimeType:"image/png",elapsedMs:1,usage:null};
    }},
    reviewer:async()=>reviews[reviewCalls++],
  });
  return {generator,records,artifacts,claims,image,calls:()=>calls,reviews:()=>reviewCalls};
}

test("a rejected candidate resumes with annotated feedback, then reuses the accepted image", async () => {
  const h = await harness([assessment(.3),assessment()]);
  await assert.rejects(h.generator.generate("scene"), PanoramaCandidateRejected);
  assert.ok(h.records.has("quality/candidate-1/correction.png"));
  await h.generator.generate("scene"); await h.generator.generate("scene");
  assert.equal(h.calls(),2); assert.equal(h.reviews(),2);
  await assert.rejects(h.generator.generate("changed scene"), /inputs changed/);
});

test("five failures are terminal across invocations and never make a sixth call", async () => {
  const h = await harness(Array.from({length:5},()=>assessment(.2)));
  for(let i=0;i<4;i++) await assert.rejects(h.generator.generate("scene"),PanoramaCandidateRejected);
  await assert.rejects(h.generator.generate("scene"),/All five/);
  await assert.rejects(h.generator.generate("scene"),/All five/);
  assert.equal(h.calls(),5);
});

test("uncertain image generation stops, while malformed reviews receive bounded retries", async () => {
  const h = await harness([assessment()]);
  h.claims.add("quality/candidate-1/attempt.json");
  await assert.rejects(h.generator.generate("scene"),/uncertain paid/); assert.equal(h.calls(),0);
  const invalid = await harness([{} as HorizonAssessment]);
  await assert.rejects(invalid.generator.generate("scene"),/Horizon review failed after 3 attempts/);
  assert.equal(invalid.calls(),1); assert.equal(invalid.reviews(),3);
});

test("transient horizon-review failures retry the same saved candidate and accept a later assessment", async () => {
  let reviewAttempts = 0;
  const retryHarness = await harness([assessment()]);
  const retryGenerator = createQualityGenerator({
    model: "fixture", reviewModel: "fixture-review", root: "retry", artifacts: retryHarness.artifacts,
    references: [],
    claims: { async claimOnce(key, bytes) {
      if (retryHarness.claims.has(key)) return false;
      retryHarness.claims.add(key);
      retryHarness.records.set(key, bytes);
      return true;
    } },
    waitBeforeReviewRetry: async () => {},
    generator: { async generate() {
      return { bytes: retryHarness.image, mimeType: "image/png", elapsedMs: 1, usage: null };
    } },
    reviewer: async () => {
      reviewAttempts++;
      if (reviewAttempts === 1) {
        const error = new Error("Deadline expired before operation could complete");
        Object.assign(error, { status: 504 });
        throw error;
      }
      return assessment();
    },
  });
  await retryGenerator.generate("scene");
  await retryGenerator.generate("scene");
  assert.equal(reviewAttempts, 2);
  assert.ok(retryHarness.records.has("retry/candidate-1/assessment.json"));
});

test("malformed JSON from the horizon reviewer retries the saved image", async () => {
  const h = await harness([assessment()]);
  let reviews = 0;
  const retryGenerator = createQualityGenerator({
    model: "fixture", reviewModel: "fixture-review", root: "malformed-review", artifacts: h.artifacts,
    references: [],
    claims: { async claimOnce(key) {
      if (h.claims.has(key)) return false;
      h.claims.add(key);
      return true;
    } },
    waitBeforeReviewRetry: async () => {},
    generator: { async generate() {
      return { bytes: h.image, mimeType: "image/png", elapsedMs: 1, usage: null };
    } },
    reviewer: async () => {
      reviews++;
      if (reviews === 1) throw new SyntaxError("Unterminated string in JSON");
      return assessment();
    },
  });
  await retryGenerator.generate("scene");
  assert.equal(reviews, 2);
  assert.equal(h.calls(), 0);
  assert.ok(h.records.has("malformed-review/candidate-1/assessment.json"));
});

test("a previous one-shot review claim is treated as consumed and can recover on the next bounded attempt", async () => {
  const retryHarness = await harness([assessment()]);
  retryHarness.records.set("quality/candidate-1/review-attempt.json", Buffer.from("{}"));
  let reviews = 0;
  const retryGenerator = createQualityGenerator({
    model: "fixture", reviewModel: "fixture-review", root: "quality", artifacts: retryHarness.artifacts,
    references: [],
    claims: { async claimOnce(key, bytes) {
      if (retryHarness.claims.has(key)) return false;
      retryHarness.claims.add(key);
      retryHarness.records.set(key, bytes);
      return true;
    } },
    waitBeforeReviewRetry: async () => {},
    generator: { async generate() { return { bytes: retryHarness.image, mimeType: "image/png", elapsedMs: 1, usage: null }; } },
    reviewer: async () => { reviews++; return assessment(); },
  });
  await retryGenerator.generate("scene");
  assert.equal(reviews, 1);
  assert.ok(retryHarness.records.has("quality/candidate-1/review-attempt-2.json"));
});
