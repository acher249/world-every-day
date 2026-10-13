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
WORLD_LABS_KEY=
WORLD_LABS_MODEL=marble-1.1
```

`GOOGLE_AI_API_KEY` enables Nano Banana image generation. `WORLD_LABS_KEY`
enables the optional World Labs adapter. Both providers can incur charges, so
the project never calls them during installation, tests, builds, dry runs, or
the mock world workflow. The populated `.env` is ignored by Git and must never
be committed; `.env.example` contains blank placeholders and is safe to commit.
In AWS, inject both secrets from Secrets Manager instead of shipping an env
file.

`marble-1.1` is the current default for new worlds. Set
`WORLD_LABS_MODEL=marble-1.1-plus` when dynamic world sizing is worth the
provider's additional variable cost. The selected identifier is persisted with
each generation artifact rather than inferred later.

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
  --output-dir ./artifacts/example
```

Every output directory must be new. The command refuses to overwrite an existing
run.

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
