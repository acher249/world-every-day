# 360 image generation

This stage turns structured art direction into the equirectangular image used
by Marble and landmark detection. It generates an image, not a 3D world.
See [art direction](ART_DIRECTION.md) for the visual language and the
[pipeline guide](../pipeline/README.md#world-generation-orchestration) for the
subsequent world-generation stage.

## Inputs and processing

The normal input is a versioned `art-direction.json`: one coherent scene,
story landmarks, and grounded visual details. The image provider receives an
original visual prompt, not article bodies. Local experiments can instead use
a plain-text scene prompt.

```text
Art direction → scene prompt + projection instructions → initial image request
  → preserve provider response → normalize → centered 2:1 crop
  → exposure balance + longitude-seam feather
  → extract upward/downward views → masked pole-repair image request
  → color-match and blend repaired poles → stabilize pole convergence
  → final seam feather → 8192 × 4096 delivery image + manifest
```

The request uses a 4K `16:9` canvas with polar overscan. Processing extracts the
centered `2:1` full-sphere panorama, balances exposure across the wrap, and applies
a 64-pixel periodic linear-light seam feather. A second image request repairs
both poles in one masked sheet. The repaired upward and downward views are
color-matched to their surroundings and blended into the panorama, leaving the
equatorial region intact during pole repair. A narrow convergence pass softens
the exact poles before the final seam feather and enlargement. The 8K output is upscaled; it is
not native 8K generated detail.

The prompt starts and ends with a critical instruction to keep the geometric
horizon at the vertical midpoint, with a level camera and no image text.
Mountains and nearby terrain can cross that row: their skyline is not the
geometric horizon. Landmarks should be distributed around the viewer, with
varied topography and clear sightlines.

These are model instructions, not a guarantee. There is no automatic
vision-based horizon rejection, annotated repair loop, or repeated generation
until success. Seam processing cannot correct an incorrectly generated horizon.

## Local use

From the repository root:

```bash
cd pipeline
npm i
npm run panorama -- \
  --art-direction-file ./fixtures/demo-art-direction.v1.json \
  --dry-run
```

The dry run validates the input and reports model/prompt identity without
credentials, network requests, or charges.

For a deliberately paid generation, copy `.env.example` to `.env` if it does
not already exist, set `GOOGLE_AI_API_KEY`, and review `NANO_BANANA_MODEL`.
Then use a new output directory:

```bash
npm run panorama -- \
  --art-direction-file ./fixtures/demo-art-direction.v1.json \
  --output-dir ./artifacts/panorama/my-example \
  --confirm-paid-generation
```

Use exactly one of `--art-direction-file` or `--scene-prompt-file`.
The command refuses an existing output directory before making a paid request.
Inspect the resulting images and manifest before generating a world.

## AWS and artifacts

`CreateApprovedRawPanoramaSource` checks the selected edition and its
checksum-bound approval, writes an attempt marker, and requests the image.
`ProcessPrivatePanorama` performs image processing and one paid pole-repair call,
using the same configured image model and Google secret. The daily workflow
passes explicit paid-generation authorization to this stage too.
Both write to the private artifact bucket under `editions/<editionId>/panorama/`.

`source-image.json` identifies the original provider image. `manifest.json`
records the prompt, model, usage when supplied, processing transforms, hashes,
and image filenames. Downstream stages use the same delivery image checksum
for world generation and landmark detection.

`pole-repair/` retains the masked input, original repair response, and a receipt
with model, prompt/input/output hashes, timing, and usage. Completed repairs are
reused after processing interruptions. A changed input or an uncertain paid
attempt stops rather than silently charging again. The final manifest also
includes normalized repair images and hashes. Wrong-layout responses or visibly
unfilled magenta masks fail processing; they never reach world generation.

Live CLI and AWS runs use two image calls in total. Fictional fixture runs use
synthetic images and do not contact the provider. Pole repair does not guarantee
correct horizon geometry or perfect generated content; review real outputs.

An uncertain paid attempt stops for inspection instead of silently requesting
another image. Preserve attempt records and completed artifacts when recovering.
See [workflow recovery](AWS_WORKFLOW.md#failures-and-recovery).

## Where to change it

| File | Purpose |
| --- | --- |
| [`art-direction/prompt.ts`](../pipeline/src/art-direction/prompt.ts) | Scene composition from structured story subjects |
| [`panorama/prompt.ts`](../pipeline/src/panorama/prompt.ts) | Projection, horizon, and final-check instructions |
| [`panorama/config.ts`](../pipeline/src/panorama/config.ts) | Request dimensions and delivery processing settings |
| [`panorama/run.ts`](../pipeline/src/panorama/run.ts) | Processing and manifest creation |
| [`panorama/poles.ts`](../pipeline/src/panorama/poles.ts) | Pole projection, masking, color matching, and convergence |
| [`panorama/repair-job.ts`](../pipeline/src/panorama/repair-job.ts) | Durable paid-repair checkpoint and retry protection |
| [`panorama/generator.ts`](../pipeline/src/panorama/generator.ts) | Optional image-provider adapter |

Run the [pipeline checks](../CONTRIBUTING.md#development) after code changes.
Tests and dry runs do not call paid services. Keep model costs and generated
asset provenance documented in [costs](COSTS.md) and [licensing](LICENSING.md).
