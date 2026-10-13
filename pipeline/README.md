# Pipeline

The pipeline package contains server-side stages for producing daily-world
artifacts. Its first implemented stage generates and prepares a full-sphere
equirectangular panorama for world generation.

## Panorama stage

The stage:

1. asks Nano Banana for a 4K `16:9` full-sphere image with polar overscan;
2. saves the exact provider response and a normalized PNG;
3. extracts a centered `2:1` equirectangular master;
4. closes the longitude boundary with a narrow periodic linear-light feather;
5. enlarges the repaired master to an `8192 × 4096` delivery image; and
6. records prompts, hashes, transforms, usage, metrics, and artifact paths in a
   manifest.

The 8K result is a delivery canvas enlarged from the native generated master. It
should not be described as native 8K generated detail.

## Setup

```bash
cd pipeline
npm i
cp .env.example .env
```

The local server-only credential file is `pipeline/.env`. Populate only the
values you intend to use:

```dotenv
GOOGLE_AI_API_KEY=
NANO_BANANA_MODEL=gemini-nano-banana-2.1
LANDMARK_VISION_MODEL=
EDITORIAL_MODEL=
ART_DIRECTION_MODEL=
WORLD_LABS_KEY=
WORLD_LABS_MODEL=marble-1.1
```

`GOOGLE_AI_API_KEY` enables the optional Google adapters for Nano Banana,
landmark detection, editorial analysis, and art direction when their model
settings are configured. `WORLD_LABS_KEY` enables the optional World Labs
adapter. Both providers can incur charges, so the project never calls them during
installation, tests, builds, dry runs, or the mock world workflow. The populated
`.env` is ignored by Git and must never be committed; `.env.example` contains
blank placeholders and is safe to commit. In AWS, inject both secrets from
Secrets Manager instead of shipping an env file.

`marble-1.1` is the current default for new worlds. Set
`WORLD_LABS_MODEL=marble-1.1-plus` when dynamic world sizing is worth the
provider's additional variable cost. The selected identifier is persisted with
each generation artifact rather than inferred later.

## Story-discovery foundation

The source module provides a bounded, provider-neutral foundation for daily
story discovery. It parses allowlisted RSS and Atom feeds into a versioned candidate
set, normalizes tracking URLs, applies the configured publication window, and
deduplicates exact canonical URLs. One failed feed is isolated from the rest.

Full article pages are fetched only after a candidate is shortlisted. The
article reader removes page furniture, reads the permitted article text in
memory, verifies the generated analysis against that temporary text, and then
discards it. Article bodies and verbatim evidence passages are never written to
an artifact. The pipeline retains a checksum, source provenance, and original
project-written analysis only. `GoogleArticleAnalyzer` is an optional paid adapter using
`EDITORIAL_MODEL`; fixture analyzers remain the default for tests. A single
analysis produces a clear headline, original summary, source-grounded claims,
and granular visual details. Missing visual details remain non-fatal.

Enabling a hosted analyzer transmits the ephemeral text to that provider. Review
and accept its current data-use and retention terms before enabling it; a local
or otherwise approved adapter can replace it without changing the artifact
model.

Validate a versioned source configuration and collection window without making
network requests:

```bash
npm run sources:collect -- \
  --config ./fixtures/source-configuration.v1.json \
  --window-start 2026-10-12T14:30:00.000Z \
  --window-end 2026-10-13T14:30:00.000Z \
  --output ./artifacts/sources/candidate-set.json \
  --dry-run
```

The checked-in configuration uses reserved `example.test` hosts and is only a
shape example. Live story discovery requires a reviewed configuration of permitted
sources plus `--confirm-live-fetch`. Candidate output uses exclusive creation
and will not overwrite an existing artifact.

A small reviewed starter allowlist is available at
`./config/source-configuration.initial.v1.json`. It is intended for controlled
local validation, not yet as a complete production news policy. See the
[source policy](../docs/editorial-policy/SOURCES.md) before adding or enabling
sources.

## Cost visibility

The pipeline does not currently reserve spend or enforce an automatic budget.
Paid adapters remain opt-in and require explicit live-run flags. As the daily
workflow is completed, each provider stage should record its model, request
count, usage when reported, attempts, elapsed time, and actual or estimated cost
in the edition artifacts. See the project-wide [cost guide](../docs/COSTS.md)
for the expected call shape and the cost data that should remain visible to
operators and contributors.

## Editorial workflow

Editorial evaluation and selection are separate steps. Evaluation records
inspectable credibility, constructive-significance, relevance, novelty,
recency, and visual-potential scores. Selection is deterministic and local: it
applies a credibility floor, clusters duplicate events, enforces topic,
publisher, and geographic caps, and may return fewer stories rather than weaken
those constraints. Visual potential is retained for later composition but does
not contribute to editorial importance.

Validate the candidate evaluation request without calling a model:

```bash
npm run editorial:evaluate -- \
  --candidate-set ./artifacts/sources/candidate-set.json \
  --edition-id <edition-id> \
  --output ./artifacts/editorial/candidate-evaluations.json \
  --dry-run
```

A live evaluation is one bounded model request and requires
`--confirm-paid-analysis`, `GOOGLE_AI_API_KEY`, and `EDITORIAL_MODEL`. Provider
usage is stored in the evaluation artifact when reported.

Create a shortlist from validated artifacts without a provider call:

```bash
npm run editorial:select -- \
  --candidate-set ./fixtures/candidate-set.v1.json \
  --evaluations ./fixtures/candidate-evaluations.v1.json \
  --configuration ./fixtures/editorial-selection.example.v1.json \
  --output ./artifacts/editorial/shortlist.json
```

The default preliminary shortlist contains at most 15 stories. Article analysis
accepts only IDs in that shortlist and is capped at 15 stories per invocation.
Validate that stage without fetching pages or calling a model:

```bash
npm run articles:extract -- \
  --candidate-set ./artifacts/sources/candidate-set.json \
  --shortlist ./artifacts/editorial/shortlist.json \
  --source-config ./config/sources.json \
  --output-dir ./artifacts/sources/article-evidence \
  --dry-run
```

A live run requires both `--confirm-live-fetch` and
`--confirm-paid-analysis`, plus `GOOGLE_AI_API_KEY` and `EDITORIAL_MODEL`.
Only hosts explicitly listed in that source's `allowedArticleHosts` may be read.

After the evidence artifacts exist, assemble the final edition locally:

```bash
npm run editorial:finalize -- \
  --candidate-set ./artifacts/sources/candidate-set.json \
  --evaluations ./artifacts/editorial/candidate-evaluations.json \
  --shortlist ./artifacts/editorial/shortlist.json \
  --evidence-dir ./artifacts/sources/article-evidence \
  --target-stories 10 \
  --output ./artifacts/editorial/selected-edition.json
```

Finalization makes no provider request. It selects up to ten evidence-bearing
stories in shortlist order, carries their citations and grounded details
forward, and records why a shortlisted story could not be included.

## Art-direction stage

The art-direction stage turns `selected-edition.json` into the structured input
already accepted by the panorama generator. Visual-prominence scores assign two
anchor roles, three supporting roles, and up to five discoverable details
deterministically. The provider designs one coherent environment around those
roles in a single bounded request.

Only project-written story summaries and compact visual details enter the
art-direction request. Source evidence excerpts do not. The output records which
visual details were used and labels invented connective forms as artistic
interpretation.

Validate the role assignment without calling a model:

```bash
npm run art-direction:create -- \
  --selected-edition ./artifacts/editorial/selected-edition.json \
  --output ./artifacts/art-direction/art-direction.json \
  --dry-run
```

A live request requires `--confirm-paid-analysis`, `GOOGLE_AI_API_KEY`, and
`ART_DIRECTION_MODEL`. The resulting artifact can be passed directly to
`npm run panorama -- --art-direction-file <path> --dry-run`.

## Workflow inspection

Pipeline progress is derived from immutable artifacts rather than maintained in
a second local state file. Inspect a run at any time with:

```bash
npm run workflow:inspect -- --run-dir ./artifacts
```

The inspector validates checksums and edition identifiers across collection,
evaluation, shortlisting, article analysis, final selection, and art direction.
It reports the first missing or invalid stage and whether the run is ready for
panorama generation. It is read-only and never invokes a provider. A stale
downstream artifact is reported as invalid rather than silently reused.

Run the complete fictional editorial-to-art-direction example without network
access, credentials, or paid requests:

```bash
npm run workflow:mock -- --run-dir ./artifacts/mock-edition
```

The runner inspects the artifact chain before every stage and writes only
missing outputs. Running the same command again is a no-op. To pause at a stage,
add `--through shortlist` (or another stage reported by `workflow:inspect`),
then rerun without that option to resume. Invalid or stale artifacts stop the
run instead of being overwritten. This fixture demonstrates pipeline mechanics
with one fictional story; daily editions still target up to ten real stories.

## Landmark-detection stage

The landmark module defines a replaceable multimodal detector and a versioned
artifact for locating every story subject in the final `2:1` panorama. Each
detection records a normalized bounding box, a solid-surface target point,
confidence, visibility, source-image checksum, and provider provenance.

`GoogleLandmarkDetector` is the first optional adapter and uses
`LANDMARK_VISION_MODEL`. Calling it is a paid operation and is not part of
tests, builds, or ordinary setup. Its normalized panorama targets are inputs to
a prepublication interaction-baking step. That step raycasts the finished splat
once and writes fixed world-space positions tied to the splat checksum. The
public frontend only projects those baked positions through its live camera; it
does not recompute landmark intersections at runtime.

Validate the prompt and inputs without calling a provider:

```bash
npm run landmarks:detect -- \
  --image ./artifacts/panorama/example/equirectangular-8192x4096.png \
  --art-direction-file ./fixtures/demo-art-direction.v1.json \
  --output ./artifacts/landmarks/example.json \
  --dry-run
```

A live analysis additionally requires `GOOGLE_AI_API_KEY`,
`LANDMARK_VISION_MODEL`, and `--confirm-paid-analysis`. Output creation is
exclusive, so an existing artifact is never overwritten.

Run a no-cost configuration check:

```bash
npm run panorama -- \
  --art-direction-file ./fixtures/demo-art-direction.v1.json \
  --dry-run
```

The structured art-direction artifact is validated and converted into the scene
prompt deterministically. For prompt experiments, the command also accepts a
plain text file through `--scene-prompt-file`; provide exactly one input form.

Generate a panorama:

```bash
npm run panorama -- \
  --art-direction-file ./fixtures/demo-art-direction.v1.json \
  --output-dir ./artifacts/example \
  --confirm-paid-generation
```

Live generation requires deliberate `--confirm-paid-generation` approval. Every
output directory must be new, and the command creates it before calling the
provider so an existing run cannot trigger a duplicate paid request.

## World-generation orchestration

The provider-neutral world layer persists an operation before polling, derives a
stable idempotency key from the request and adapter version, and copies completed
assets into project-owned storage. Provider URLs and credentials do not appear
in its public manifests.

Exercise the full operation lifecycle without an API key or valid 3D asset:

```bash
npm run world:mock -- \
  --edition-id demo-2026-10-12 \
  --source-image ../frontend/public/images/demo-world.png \
  --output-dir ./artifacts/mock-world
```

This produces an explicitly synthetic `.mock` asset for orchestration tests. It
is not a Gaussian splat and must not be supplied to Spark.js.

The optional World Labs adapter implements panorama upload, asynchronous Marble
world generation, polling, and SPZ download behind the same interface. It reads
`WORLD_LABS_KEY` only on the server. Validate a panorama and request locally
without calling the provider:

```bash
npm run world:generate -- \
  --edition-id demo-2026-10-12 \
  --source-image ./artifacts/panorama/example/equirectangular-8192x4096.png \
  --output-dir ./artifacts/world/demo-2026-10-12 \
  --dry-run
```

A live run is billed and additionally requires `--confirm-paid-generation`.
Never add that flag to tests or automated setup commands. Repeating the exact
command resumes a persisted operation instead of intentionally starting a new
one.

## Validation

```bash
npm run license:check
npm run typecheck
npm test
npm run build
```

The deterministic transformation stage is covered with synthetic images. Paid
provider calls are never part of the default test suite.
