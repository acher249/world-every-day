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

Populate `GOOGLE_AI_API_KEY` only when making a paid generation request. Never
commit `.env`.

Run a no-cost configuration check:

```bash
npm run panorama -- --scene-prompt-file ./scene.txt --dry-run
```

Generate a panorama:

```bash
npm run panorama -- \
  --scene-prompt-file ./scene.txt \
  --output-dir ./artifacts/example
```

Every output directory must be new. The command refuses to overwrite an existing
run.

## Validation

```bash
npm run license:check
npm run typecheck
npm test
npm run build
```

The deterministic transformation stage is covered with synthetic images. Paid
provider calls are never part of the default test suite.
