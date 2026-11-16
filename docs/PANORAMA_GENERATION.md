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
Art direction → remove scene-owned camera/horizon directives
  → scene prompt + projection instructions + composition reference + geometry grid
  → candidate request → structured four-sector horizon review
  → rejected candidate + centerline annotation → correction (maximum five candidates)
  → accepted image
  → preserve provider response → normalize → centered 2:1 crop
  → exposure balance + longitude-seam feather
  → extract upward/downward views → masked pole-repair image request
  → color-match and blend repaired poles → stabilize pole convergence
  → final seam feather → 8192 × 4096 delivery image → final visual review
  → deterministic wrap-edge check + horizon review + focused seam review
  → up to three annotated multi-turn corrections when review fails → manifest
```

The request uses a 4K `16:9` canvas. Processing extracts the centered `2:1`
full-sphere panorama; the remaining top and bottom rows are discarded padding,
not directions beyond the poles. It then balances exposure across the wrap and applies
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
For canyon, mesa, plateau, and ridge settings, the prompt keeps raised terrain
local unless the stories require a high-altitude setting, and distinguishes
nearby rims from the distant ground-sky boundary. This preserves open sightlines
without flattening the terrain. Scene-geometry filtering removes whole
punctuation-delimited clauses; comma-separated phrases are kept together to
avoid leaving fragments in the model prompt.

The live CLI and AWS entry points attach one clean reference: a 1440 × 720 copy
of October 19's composition. It guides spacious distribution, a centered
horizon, and coherent terrain; it does not contribute story content. The
generator no longer receives a synthetic grid or red equator, which could
compete with the panorama or be copied into it. Horizon measurements and
annotated correction images are still created dynamically after generation.
Reference provenance is in
[`pipeline/assets/panorama/README.md`](../pipeline/assets/panorama/README.md).

A structured vision assessment examines four longitude sectors in the centered
2:1 crop. Admission requires at least two visible distant-horizon observations
with confidence ≥ 0.8; every visible observation must be within 10 percentage
points of the midpoint (y = 0.40–0.60). Tilt, visible text, and guide marks
remain hard failures. Hidden horizons are recorded as unknown, not guessed. Seam
quality is evaluated independently so a seam flag cannot invalidate a correct
horizon measurement. At least two sectors must provide a confident horizon;
the horizon may be obscured in the remaining sectors.

A rejection produces an annotated copy: a solid red line marks the exact
midpoint, a dashed amber line marks the reviewer's estimated horizon in each
visible sector, and an arrow points from the observed line toward the target.
The correction is a true multi-turn image edit. The first Nano Banana response's
SDK chat history is saved with the candidate; the next Lambda invocation
restores that history, including any thought signatures the model returned,
then sends a focused edit prompt with the annotated image. It does not restart
from a fresh prompt. Conversation state is private candidate data under a
versioned `panorama/quality/horizon-v3-clean-reference/` prefix and is not included
in the published world. Missing or altered state fails closed. Each turn still
produces a distinct candidate that must pass visual review; conversation context
improves continuity but does not guarantee a correct horizon. Stop after five
candidates. Each saved candidate gets up to
three bounded horizon-review requests for transient provider errors or
malformed structured responses. These
reviews reuse the same immutable image, and durable attempt markers let a later
workflow invocation continue with remaining review attempts after a timeout. A
valid assessment that rejects the image advances to a new candidate; an
unresolved review after three attempts still fails closed. Paid image-generation
claims remain one-shot because a timed-out image request may have completed and
charged. No model switching occurs silently: `NANO_BANANA_MODEL` selects the
image provider model; `PANORAMA_REVIEW_MODEL` selects the CLI reviewer (default
`gemini-3.8-flash`). AWS uses its configured landmark vision model for review.

After pole repair and processing, a second visual assessment gates delivery.
If the horizon or seam check fails, the private processing stage may make up to
three paid, annotated correction turns using the saved Nano Banana conversation.
Each corrected source is reprocessed and reviewed; only a passing candidate is
referenced by the panorama manifest. Failed candidates and assessments remain
private and immutable. An operator may explicitly authorize one recovery turn
after an uncertain paid attempt; it skips that candidate and starts a new
immutable one rather than repeating a possibly billed request. Set
`recoverAfterUncertainAttempt` to the uncertain candidate number alongside
`confirmPaidGeneration: true`. Normal workflow runs retain the three-turn cap.
If corrections fail or another paid attempt is uncertain, publication stops.
Existing public worlds remain in place. Completed failed candidates are reused
from saved outputs on resume, avoiding redundant 8K image processing.

Delivery approval now requires two visual decisions. The horizon reviewer
enforces midpoint placement; a focused seam reviewer classifies the wrap as
clear, tolerable, blocking, or uncertain. Localized terrain, horizon, lighting,
and color mismatches are currently tolerable so more editions can publish while
seam handling is improved. Broad smear bands and large unrelated scene panels
remain blocking; uncertain reviews fail closed. The evaluation is versioned
under
`panorama/quality/horizon-v3-clean-reference/delivery-review-v3-seam-tolerant/`
so older decisions cannot silently carry forward under changed rules. Both
decisions are stored in the accepted panorama's delivery-review artifact.
Processing also measures the final wrap-edge pixel difference after feathering
and stops if the two boundary columns are not equal within one RGB level. This
deterministic check verifies the wrap transform; it cannot detect visual seams
by itself. These gates improve rejection of unusable candidates but cannot
guarantee a clean panorama within the configured candidate and correction caps.

Art-direction generation forbids camera/horizon directives. A deterministic
filter removes geometry-bearing clauses from generated proposals and again
from scene prose at the panorama and pole-repair boundaries. Original source
facts and archived inputs are not rewritten. Geometry-only required fields
fail validation. This catches known conflicts such as “high horizon,” “aerial
view,” or “camera tilt” while preserving mountains, elevated terrain, drones,
and camera objects. Story-object placement is explicitly separate from the
fixed horizon rule. Prompt checks reduce conflicting language but cannot prove
that arbitrary natural language has no subtle semantic conflict. Vision
judgments can also be wrong; these checks reduce risk, not guarantee projection
accuracy. Seam processing cannot fix an incorrect geometric horizon.

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

Live CLI and AWS runs use at most five candidate image calls plus one pole-repair
call, and up to six vision assessments (five candidates and final delivery). Fictional fixture runs use
synthetic images and do not contact the provider. Pole repair does not guarantee
correct horizon geometry or perfect generated content; review real outputs.

AWS runs one new candidate per Lambda invocation; Step Functions retries only
`PanoramaCandidateRejected`, at most four retries. Immutable candidate images,
conversation histories, prompts, hashes, assessments, correction images, and
per-call claims live under
`panorama/quality/horizon-v3-clean-reference/`. Resumes restore prior Nano Banana
chat state and reuse completed candidates. Changed inputs, malformed
assessments, and uncertain paid image-generation attempts stop for inspection
instead of silently requesting another image. Horizon-review provider timeouts
can resume against the saved image using the remaining bounded review attempts.
Existing pre-upgrade inputs/receipts may need a new reviewed run because prompt
identity has changed. Preserve attempt records and completed artifacts when
recovering.
See [workflow recovery](AWS_WORKFLOW.md#failures-and-recovery).

An operator may set `panoramaAttemptSet` on a recovery execution to create an
isolated candidate namespace for a historical edition whose five candidates
were already exhausted. The default scheduled value is `primary`, which
preserves ordinary daily paths. Recovery namespaces preserve prior images and
conversation receipts and are carried through delivery correction so the
matching multi-turn context is reused.

If an existing source image itself must be replaced, pair a unique
`panoramaAttemptSet` with `panoramaSourceRevision: true`. The new source and
processing artifacts are written under `panorama/runs/<attempt-set>/`; the
primary source remains immutable. Only a horizon- and seam-approved result is
promoted through the canonical panorama manifest. This flag is for manually
approved recovery runs; scheduled inputs set it to `false`.

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
