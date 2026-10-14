# Instructions for agents

This repository is building **A World Every Day**, an MIT-licensed, open-source,
living digital installation. The first application turns a curated set of daily
stories into a generated image, a navigable, interactive 3D world, and a
historical archive. Visitors can select landmarks to discover what they
represent and open the stories and sources behind them. The underlying pattern
should remain extensible to other kinds of information.

## Start here

Read these documents before making architectural or product changes:

1. [`README.md`](README.md) for the project thesis and public-facing overview.
2. [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for phases and system boundaries.
3. [`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) for the evolving visual
   language.
4. [`docs/LICENSING.md`](docs/LICENSING.md) and
   [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before adding a dependency,
   provider, source, or generated asset.

The current implementation includes a fictional frontend demonstration,
server-side panorama and landmark-detection stages, bounded story-discovery and
editorial-selection foundations, and provider-neutral world generation with an
optional World Labs adapter. One live local ten-story vertical slice now spans
story discovery, hosted editorial analysis, art direction, panorama generation,
Marble 1.1 world generation, landmark detection, Spark.js raycast baking, and
local publication assembly. A fixture-backed runner exercises that full artifact
chain without network access or paid services, and an explicitly gated live
local runner can resume each stage around a required human review. Public
publication, scheduled automation, and the AWS pipeline described in the build
plan are not complete. Do not describe planned features as implemented.

## Repository conventions

- The web frontend lives in `frontend/` and uses npm.
- Server-side generation stages live in `pipeline/` and use npm.
- Keep code simple, typed, modular, and easy for contributors to replace or
  extend.
- Keep providers behind small interfaces. Do not couple the core data model to
  AWS, Gemini, World Labs, or a single news source.
- Keep factual source data, generated interpretation, and interface metadata
  distinguishable from one another.
- Preserve citations and provenance throughout the pipeline.
- Prefer a small, working vertical slice over creating speculative packages.
- Follow any more specific `AGENTS.md` found inside a subdirectory.

## Secrets and external services

- Never commit API keys, credentials, signed URLs, private source content, or a
  populated `.env` file.
- Never expose a secret through `NEXT_PUBLIC_*` or browser-delivered metadata.
- Add documented placeholders to `.env.example` and validate server-side
  configuration with actionable errors.
- Do not call paid generation services, publish content, post to social media,
  deploy infrastructure, or mutate cloud resources without explicit human
  approval.
- Use mock providers and fictional fixtures by default.
- Treat source material as licensed content. Store citations and original
  project-authored summaries rather than republishing articles.

## Open-source and asset policy

- Original project code is MIT-licensed.
- Prefer direct dependencies with permissive licenses such as MIT, Apache-2.0,
  BSD, ISC, or 0BSD.
- Before adding or updating a package, run the license audit and update
  `THIRD_PARTY_NOTICES.md` when required.
- Hosted services may be proprietary, but their adapters must remain optional
  and replaceable.
- Every committed generated or third-party asset needs enough provenance to
  establish its source, applicable terms, redistribution status, and attribution
  requirements.

## Frontend workflow

```bash
cd frontend
npm i
npm start
```

Before handing off a frontend change, run:

```bash
npm run license:check
npm run typecheck
npm test
npm run build
```

The frontend should remain usable without credentials or a 3D asset. Maintain
keyboard and touch access, reduced-motion behavior, and the poster fallback when
the spatial viewer is unavailable.

## Pipeline workflow

```bash
cd pipeline
npm i
npm run license:check
npm run typecheck
npm test
npm run build
```

Use `npm run panorama -- --art-direction-file <path> --dry-run` to validate a
structured prompt and local configuration without making a paid request. Never
run a paid generation during ordinary tests or without explicit human approval.

## Before finishing

- Confirm no secrets or private material were added.
- Run the checks relevant to the changed area.
- Keep documentation consistent with the actual repository layout and current
  implementation status.
- Call out anything that could not be verified, especially visual behavior,
  provider output, licensing, cost, or cloud deployment.
