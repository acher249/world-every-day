import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { cleanSceneGeometry } from "../src/panorama/geometry.js";
import { buildPanoramaPrompt } from "../src/panorama/prompt.js";
import { horizonPasses, horizonAssessmentSchema, type HorizonAssessment } from "../src/panorama/horizon.js";
import { createQualityGenerator, PanoramaCandidateRejected } from "../src/panorama/quality-generator.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";
import { sha256 } from "../src/panorama/hash.js";

function assessment(y = 0.5): HorizonAssessment {
  return { sectors: [0,1,2,3].map((sector) => ({ sector, visible: true, horizonY: y, confidence: 0.95, evidence: "Distant ocean boundary" })), tilted: false, collageOrSeams: false, textOrGuides: false };
}

test("scene geometry is removed without flattening terrain or removing camera objects", () => {
  const prose = "Red shelves, freshwater estuaries, and gravel clearings under a high horizon. Mountains surround an elevated platform. Camera housing glass gleams.";
  const cleaned = cleanSceneGeometry(prose);
  assert.doesNotMatch(cleaned, /high horizon/);
  assert.match(cleaned, /Red shelves/);
  assert.match(cleaned, /Mountains surround an elevated platform/);
  assert.match(cleaned, /Camera housing glass/);
  for (const conflict of ["a low horizon", "an aerial view", "looking down over the scene", "camera tilt is dramatic", "a bird’s-eye view"]) {
    assert.doesNotMatch(buildPanoramaPrompt(`A rocky park. Use ${conflict}.`), new RegExp(conflict));
  }
});

test("horizon admission requires actual centered evidence and rejects ambiguous or malformed reviews", () => {
  assert.equal(horizonPasses(assessment()), true);
  assert.equal(horizonPasses(assessment(0.35)), false);
  assert.equal(horizonPasses({ ...assessment(), textOrGuides: true }), false);
  assert.equal(horizonPasses({ ...assessment(), collageOrSeams: true }), false);
  assert.equal(horizonPasses({ ...assessment(), tilted: true }), false);
  const hidden = assessment(); hidden.sectors = hidden.sectors.map((s) => ({ ...s, visible: false, horizonY: null }));
  assert.equal(horizonPasses(hidden), false);
  const uncertain = assessment(); uncertain.sectors[0].confidence = 0.5;
  assert.equal(horizonPasses(uncertain), false);
  assert.throws(() => horizonAssessmentSchema.parse({ ...assessment(), sectors: [assessment().sectors[0], ...assessment().sectors.slice(0,3)] }));
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
    generator:{async generate(prompt, refs) {
      calls++; assert.equal(Array.isArray(refs) ? refs.length : 0, calls === 1 ? 2 : 3);
      if(calls > 1) assert.match(prompt,/previous failed candidate/);
      return {bytes:image,mimeType:"image/png",elapsedMs:1,usage:null};
    }},
    reviewer:async()=>reviews[reviewCalls++],
  });
  return {generator,records,claims,calls:()=>calls,reviews:()=>reviewCalls};
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

test("uncertain generation and invalid assessment stop without new paid requests", async () => {
  const h = await harness([assessment()]);
  h.claims.add("quality/candidate-1/attempt.json");
  await assert.rejects(h.generator.generate("scene"),/uncertain paid/); assert.equal(h.calls(),0);
  const invalid = await harness([{} as HorizonAssessment]);
  await assert.rejects(invalid.generator.generate("scene"));
  await assert.rejects(invalid.generator.generate("scene"),/uncertain horizon review/);
  assert.equal(invalid.calls(),1); assert.equal(invalid.reviews(),1);
});
