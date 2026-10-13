# A World Every Day — Phased Build Plan

Status: working plan  
Last updated: 2026-10-13

## 1. Outcome

Build an open-source system that publishes one explorable world each day from a
small, cited collection of constructively significant developments.

The first public release is successful when a visitor can:

1. Open today's world on desktop or mobile.
2. Explore it smoothly.
3. Discover ten clearly represented stories.
4. Open an original summary and its sources without leaving the world behind.
5. Browse previous daily worlds.

The system is successful when a maintainer can:

1. Gather and review candidate stories.
2. Approve a structured daily edition.
3. Generate an image and a world without repeating completed work.
4. Preview the finished experience before publication.
5. Publish, retry, or roll back an edition safely.

## 2. Current implementation status

As of 2026-10-13, the repository has a working foundation and two partial ends
of the experience. It does not yet have a complete daily pipeline.

| Area | Status | What exists | What remains |
| --- | --- | --- | --- |
| Open-source foundation | Substantially complete | MIT license, contribution and agent guides, dependency-license checks, CI, secret-safe environment examples | Linting, security policy, code of conduct, automated secret scanning |
| Frontend | Working prototype | Full-viewport Next.js explorer, Motion HUD panels, Spark.js integration, validated publication artifact, responsive fictional ten-story experience, poster fallback, local generated-world loading, fly navigation, and baked 3D hotspots projected through the live camera | Navigation tuning, touch translation controls, automated browser coverage, archive routes |
| Panorama generation | Live baseline | Selected-edition-to-art-direction adapter, deterministic compositional roles and prompt construction, Nano Banana adapter, one approved 4K generation, centered 2:1 crop, seam feathering, 8192 × 4096 enlargement, manifest, spherical viewport QA, tests, dry-run mode | Live-validate automated art direction; evaluate the observed nadir singularity in Marble; add pole repair only if downstream results justify it |
| Edition and editorial data | Foundation started | Versioned candidate-evaluation, preliminary-shortlist, article-evidence, selected-edition, and publication schemas; deterministic selection; optional model adapters; fictional fixtures | Live evaluation, factual sample edition, corroboration, review model |
| Story discovery | Foundation started | Provider-neutral source contract, RSS/Atom discovery, allowlisted bounded retrieval, canonical URL deduplication, source-run provenance, shortlisted article reading, and grounded visual-detail artifacts | Source policy and allowlist, conditional caching, event clustering, live evaluation, and orchestration |
| World generation | Live baseline | Provider-neutral interface, stable idempotency, persisted operation lifecycle, durable local artifact copy, failure/resume tests, mock CLI, optional Marble 1.1 adapter, and an approved Marble 1.1 SPZ generation | Sanitized real response fixture, S3 artifact store |
| Interaction mapping | Prototype only | Provider-neutral landmark schema and detector, optional multimodal adapter, one manually baked image-target-to-SPZ mapping with source checksum, runtime projection of fixed world positions, poster fallbacks, keyboard-accessible story index, and slide-out detail panels | Run and review live landmark detection, automate the prepublication baking stage, assemble its artifact into the publication manifest, add occlusion and collision behavior |
| AWS deployment | Not started | Target services and state model documented | CDK, S3, DynamoDB, Step Functions, CloudFront, alarms, approvals |
| Daily automation | Foundation started | Proposed schedule, read-only artifact-chain inspection, and a resumable mock editorial-to-art-direction runner | Extend local orchestration through generated assets, Step Functions orchestration, review, atomic publication |

The active phase is **Phase 2: one manual vertical slice**. Phase 0 remains
partially open because the editorial and operating policies still need to be
written. Phase 1 is substantially complete. Later phases are designs, not
implemented features.

## 3. Product constraints

- Editorial policy is **constructive significance**, not generic positivity.
- Each edition targets ten selected stories. Editorial standards take precedence
  over filling the quota; publish fewer rather than include weak or poorly
  supported material.
- Every factual story claim must remain connected to one or more sources.
- Generated imagery is human-free by default and designed around physical,
  reconstructable subjects.
- Generation providers are adapters, not assumptions embedded throughout the
  application.
- A failed daily run must never overwrite the most recent published edition.
- No API key, secret, signed asset URL, or private source payload may reach the
  repository or browser bundle.
- Paid generation is always bounded by explicit per-run limits.
- Manual review remains part of the MVP publishing workflow.
- Mobile performance and accessibility are release requirements.

## 4. Technical baseline

This plan begins with the following stack. Each choice should be captured in a
short architecture decision record when implemented.

- TypeScript repository using npm, beginning with the `frontend/` application
- Next.js App Router for the public site and review interface
- Motion for React for interface transitions
- Spark.js for browser rendering of Gaussian splats
- Zod plus generated JSON Schema for versioned artifacts
- Vitest for unit and contract tests
- Playwright for end-to-end and mobile interaction tests
- AWS CDK in TypeScript for infrastructure
- EventBridge Scheduler using `America/Los_Angeles`
- Step Functions Standard for orchestration
- Lambda for short orchestration and transformation tasks
- S3 for immutable edition artifacts
- DynamoDB for operational state, locks, and publication indexes
- CloudFront for generated public assets
- Secrets Manager for deployed credentials
- CloudWatch alarms and structured pipeline logs

The initial generation adapters are:

- Nano Banana 4K generation with a centered 2:1 equirectangular crop and a
  deterministic 8192 × 4096 delivery enlargement
- World Labs Marble image-to-world generation

Model identifiers must be configuration, recorded in every generated artifact,
and never scattered as string literals across the codebase.

## 5. Repository target

```text
frontend/                 Public explorer, archive, and future review UI
pipeline/                 Pipeline entry points and task handlers
packages/
  config/                 Validated project and editorial configuration
  schema/                 Versioned schemas and fixtures
  editorial/              Normalize, deduplicate, score, select, summarize
  sources/                Source interface and source adapters
  image-generators/       Provider-neutral image generation
  world-generators/       Provider-neutral world generation
  interactions/           Screen and world-space anchors
  storage/                Artifact store and edition repository
  ui/                     Shared accessible components
infra/
  aws/                    CDK application and stacks
docs/
  architecture/           Architecture decisions and diagrams
  editorial-policy/       Selection, sourcing, and correction policy
  operations/             Runbooks and cost guidance
examples/                 Complete local configurations
fixtures/                 Licensed or synthetic development inputs
```

Avoid creating every package on day one. Add a boundary when a working phase
needs it and the interface can be tested.

## 6. Canonical artifacts

The pipeline is an artifact-producing state machine. A later stage reads an
immutable artifact from an earlier stage rather than relying on in-memory context.

```text
candidate-set.json
  → candidate-evaluations.json
  → editorial-shortlist.json
  → article-evidence/*.json
  → selected-edition.json
  → art-direction.json
  → source-image.json + source-image.png
  → world-operation.json
  → generated-world.json + project-owned world assets
  → interaction-manifest.json
  → publication-manifest.json
```

Every artifact includes:

- `schemaVersion`
- `editionId`
- `createdAt`
- producing code version
- input artifact checksums
- provider and model identifiers when applicable
- prompt/configuration version when applicable
- status and validation results

Large files live in S3. JSON records contain stable project-owned S3 keys, not
temporary signed provider URLs.

## 7. Pipeline state model

```text
DRAFT
  → COLLECTED
  → SELECTED
  → EDITORIAL_APPROVED
  → IMAGE_GENERATED
  → IMAGE_APPROVED
  → WORLD_GENERATING
  → WORLD_GENERATED
  → QA_APPROVED
  → PUBLISHED
```

Each transition is conditional and idempotent. `FAILED` records the failed stage
without destroying the last valid state. A maintainer can retry from the failed
stage or deliberately invalidate later artifacts after editing an earlier one.

## Phase 0 — Resolve the product contract

Estimated effort: 2–3 focused days

### Work

- Write a one-page product brief from the README thesis.
- Define the initial topic taxonomy and explicit exclusions.
- Define “credible source,” primary-source preference, and minimum corroboration.
- Decide the publication timezone and target time; default to 7:30 AM Pacific.
- Decide whether the edition covers the previous 24 or 36 hours; begin with 36
  hours to accommodate publication times and time zones.
- Define the correction, takedown, and source-link policy.
- Establish the initial art direction and prohibited visual elements.
- Document a target cost range for one edition and one month.
- Record what requires human approval.

### Deliverables

- `docs/PRODUCT.md`
- `docs/editorial-policy/POLICY.md`
- `docs/editorial-policy/SOURCES.md`
- `docs/architecture/0001-mvp-boundaries.md`
- One sample edition written by hand

### Exit criteria

- Two people applying the policy to the same ten stories would reach broadly
  similar selections.
- The sample edition contains ten stories with valid citations and physical
  visual interpretations.
- The MVP exclusions are explicit: no automatic social posting, voiceover,
  semantic 3D segmentation, personalization, or multiple daily worlds.

## Phase 1 — Establish the open-source foundation

Estimated effort: 3–5 days

### Work

- Initialize the TypeScript workspace, formatter, linter, tests, and build.
- Create the Next.js application with an intentionally minimal shell.
- Add strict TypeScript and import-boundary rules.
- Add `.env.example` and typed environment validation.
- Add secret scanning, dependency updates, and CI checks.
- Add license, contributing guide, code of conduct, security policy, and agent
  instructions.
- Add synthetic fixtures and mock generation providers.
- Ensure a contributor can run the repository without paid API credentials.

### Exit criteria

- A clean clone installs, validates, tests, and builds from documented commands.
- CI performs type checking, linting, unit tests, secret scanning, and production
  build validation.
- `.env*` files other than documented examples are ignored.
- Browser code cannot import server-only provider or secret modules.

### Current status

Substantially complete. The repository installs, type-checks, tests, builds, and
audits dependency licenses without provider credentials. The remaining
foundation work should be completed as it becomes necessary for the vertical
slice: add linting, a security policy, a code of conduct, secret scanning, and
broader frontend tests.

## Phase 2 — Build one manual vertical slice

Estimated effort: 5–8 days

This is the first major risk-reduction milestone. Use a hand-authored edition and
manually generated assets. Do not build live news ingestion yet.

### Work

- Define `Edition`, `Story`, `Source`, `ArtDirection`, `GeneratedImage`,
  `WorldOperation`, `GeneratedWorld`, and `InteractionManifest` schemas.
- Connect the existing provider-neutral panorama generator to edition and art
  direction artifacts.
- Validate one live panorama only through an explicit, cost-capped command after
  human approval. Inspect it in multiple spherical viewports, including both
  poles and the longitudinal seam.
- Add an optional repair stage only if repeatable spherical defects justify it.
  Every repair must be recorded as a separate transformation, never hidden in
  the original generation step.
- Probe the configured World Labs account for the available image-to-world API
  capability. Record the selected endpoint, request fields, output formats, and
  a sanitized response fixture before implementing the adapter. Do not hardcode
  an endpoint inferred from examples for a different task or access tier.
- Build a provider-neutral `WorldGenerator` interface and a server-only Marble
  adapter against that verified contract.
- Keep the World Labs credential server-only and translate it to the provider's
  `WLT-Api-Key` header inside the adapter. Never expose it through frontend
  environment variables or public manifests.
- Derive a stable idempotency key from the edition, source-image checksum, and
  adapter version. Persist the returned operation ID before waiting.
- Treat `done` as the only terminal operation signal. Support bounded waiting or
  polling with capped exponential backoff and jitter; model provider errors as
  typed failures.
- Download successful output immediately, verify its checksum and type, and copy
  it into project-owned storage. Never publish a temporary provider URL.
- Persist prompts, model identifiers, operation trace metadata, outputs,
  transformations, checksums, timings, and cost when available.
- Render the generated world with Spark.js from the edition artifacts.
- Locate all ten landmarks in the source panorama through a provider-neutral
  multimodal detector, preserving bounding boxes, target pixels, confidence,
  model provenance, and source-image checksum.
- Convert each normalized equirectangular target into a spherical source-camera
  ray, resolve its nearest Spark.js splat intersection, and project that 3D hit
  through the moving camera. Keep every story available through the story index
  when an anchor cannot be resolved.
- Open story cards with original summaries and external source links.
- Implement fixture-backed mock providers for every paid call, including
  running, successful, failed, timed-out, and duplicate-submission operations.

### Exit criteria

- One command can process the sample edition through image and world generation.
- Completed stages are not repeated on retry.
- An interrupted world request resumes from its stored operation ID and cannot
  silently create a duplicate paid operation.
- Provider failures return typed, actionable errors.
- The generated world asset and manifest remain usable after provider URLs
  expire.
- A visitor can explore the world and open every story on desktop and mobile.
- Source links use a new tab and safe `rel` attributes.
- No provider secret appears in client JavaScript or generated public metadata.

### Decision gate

Review the result as an artwork. If the world is not compelling, pause pipeline
development and iterate on composition before automating anything.

### Current status

In progress. The validated publication schema, fictional ten-story artifact,
panorama utility, provider-neutral landmark and world-operation layers, optional
Marble 1.1 adapter, an approved Marble 1.1 SPZ, manually baked 3D anchors, and
the Spark.js frontend establish the slice. The remaining critical path is a
reviewed live landmark-detection artifact, an automated interaction-baking
stage, a sanitized real response fixture, durable cloud asset storage, and
publication assembly.

## Phase 3 — Create the editorial engine

Estimated effort: 5–8 days

### Work

- Normalize candidate stories into a provider-neutral schema.
- Implement canonical URL cleanup and deterministic deduplication.
- Cluster multiple reports about the same underlying event.
- Calculate separate editorial and visual-prominence scores.
- Require short, inspectable rationales for model-generated scores.
- Produce original summaries with claim-to-source references.
- For each selected story, extract a small set of concrete, visually useful
  details from the permitted source text, such as objects, materials, colors,
  settings, species, or instruments. Keep every detail tied to its evidence.
- Treat missing visual details as non-fatal. Any creative substitute must be
  stored as artistic interpretation rather than presented as a reported fact.
- Generate clear headlines that state the concrete development or result before
  using restrained interpretive or poetic language.
- Add diversity constraints across topic, geography, and organization.
- Reject weakly sourced, duplicative, promotional, unsafe, or visually
  misleading candidates.
- Create a review UI that shows candidates, evidence, scores, and exclusions.
- Store editorial overrides separately from model output.

### Evaluation set

Create a checked-in evaluation set of at least 50 historical or synthetic
candidates containing duplicates, press releases, ambiguous claims, meaningful
constructive stories, and stories that appear positive but lack evidence.

### Exit criteria

- Every selected story has at least one credible source and traceable claims.
- Deduplication performs reliably on the evaluation set.
- The system never invents a URL, date, quotation, or source.
- A human can replace, remove, rescore, or edit any story before approval.
- Prompt and policy changes can be compared against previous evaluation results.

### Current status

Started. Versioned evaluation and shortlist artifacts separate editorial
importance from visual potential. Fixture-tested local selection applies a
credibility floor, deterministic event deduplication, and topic, publisher, and
geographic caps while preserving an exclusion reason for every rejected
candidate. An optional bounded model adapter can evaluate discovery metadata;
shortlisted-article analysis creates evidence-backed headlines, summaries,
claims, and visual details; deterministic finalization produces up to ten cited
stories. Live evaluation, corroboration, the larger evaluation set, human
review, and override storage remain to be implemented.

A read-only workflow inspector now derives progress from validated artifacts,
detects stale checksum relationships, and identifies the next editorial or art
direction stage without introducing a second mutable local state file. It is the
initial state boundary for a resumable local runner and later Step Functions
orchestration.

## Phase 4 — Add bounded story discovery

Estimated effort: 5–10 days

### Work

- Define a `SourceAdapter` contract with rate limits and provenance.
- Start with an allowlist of RSS/Atom feeds and primary institutional sources.
- Use feeds and indexes for discovery, then retrieve the permitted article text
  only for shortlisted stories that need evidence, summarization, and visual
  analysis.
- Add fetch caching, conditional requests, backoff, and per-host concurrency.
- Record fetch time, publication time, canonical URL, publisher, and raw-content
  checksum.
- Retain only content permitted by the source policy.
- Add source health reporting and failure isolation.
- Treat social platforms as discovery signals, never independent verification.

### Exit criteria

- One failed or malformed feed cannot fail the entire collection stage.
- Re-running the same window produces a stable normalized candidate set.
- Every stored excerpt complies with the documented retention policy.
- Sources can be enabled, disabled, and configured without code changes.

### Deferred

- Unbounded retrieval from arbitrary websites
- X ingestion and automatic posting
- Community-submitted sources without moderation
- Personalized source lists

### Current status

Started. The repository has a fixture-tested source contract, RSS and Atom
discovery, allowlisted bounded HTTP fetching, canonical URL cleanup, exact-URL
deduplication, per-feed success and failure records, and a shortlisted-article
reader. Article text is processed in memory into compact, evidence-checked
editorial analysis and is not stored as a republished article. Live source
configuration, conditional caching, event clustering, policy review, and daily
orchestration remain to be built.

## Phase 5 — Develop the image art-direction system

Estimated effort: 5–8 days, then continuous evaluation

### Work

- Convert selected stories into candidate physical subjects and environments.
- Carry source-grounded visual details into those subjects when they strengthen
  the connection between the resulting world and the original story.
- Choose one unifying place rather than a collage of unrelated panels.
- Allocate story prominence through scale, position, and visual distinctiveness.
  Begin with two anchor stories, three supporting subjects, and five discoverable
  environmental details. These are compositional roles, not judgments about a
  story's human importance.
- Generate a structured art-direction artifact before creating prose prompts.
- Version the seed prompt and negative constraints.
- Generate multiple lower-cost candidates before the final panorama when useful.
- Add automated checks for people/faces, embedded text, obvious logos, and severe
  compositional failures; keep human approval authoritative.
- Record prompt, model, settings, output, and reviewer decision.

### Evaluation rubric

Score each candidate for:

- coherence as one place
- story coverage
- subject legibility
- navigable depth
- distinct landmarks
- strong silhouettes
- absence of people and unwanted text
- resistance to visual misinformation
- likely image-to-world performance
- emotional tone: curious, constructive, and quietly cinematic

### Exit criteria

- At least eight of ten test editions produce an approvable image within the
  configured candidate limit.
- Each selected story has a recognizable physical representation.
- All ten stories remain discoverable through the interface even when their
  visual prominence differs.
- The image remains compelling on its own without behaving like an infographic.
- The final prompt is derived from structured art direction, not assembled from
  unreviewed article text.

### Current status

Started. A provider-neutral art-direction stage now assigns compositional roles
from visual-prominence scores and converts a selected edition into the existing
structured panorama input. It sends project-written summaries and compact
visual details rather than source excerpts, validates complete story coverage,
and records source-grounded details separately from artistic interpretation.
The optional Google adapter and dry run are implemented but not live-validated.
Multi-edition evaluation and image-quality iteration remain.

## Phase 6 — Harden world generation and interaction anchors

Estimated effort: 6–10 days

### Work

- Harden asynchronous Marble operation submission beyond the Phase 2 adapter.
- Keep stable idempotency keys and persist operation IDs immediately. Reuse the
  same key and request body when retrying an uncertain submission.
- Choose polling or signed webhooks from measured deployment behavior. If using
  webhooks, verify signatures and still retrieve the operation with an
  authenticated server-side request.
- Record the provider operation trace for reproducibility after completion.
- Add best-effort cancellation with a stable request identifier, while
  continuing to observe the operation until it reaches a terminal state.
- Copy durable outputs into project-owned storage.
- Capture provider metadata, asset formats, thumbnail, and canonical entry view.
- Add a world QA checklist: loadability, movement, visual fidelity, holes,
  disorienting geometry, and story recognizability.
- Implement interaction anchors progressively:
  1. normalized screen regions in the canonical view;
  2. optional depth-aware world points;
  3. later, semantic 3D regions.
- Define graceful behavior when an object does not survive reconstruction.

### Exit criteria

- A timed-out generation can resume without starting a duplicate paid job.
- Temporary provider URLs are never treated as permanent storage.
- The site has a lightweight fallback poster when 3D cannot load.
- Every story is reachable even if its visual hotspot fails.
- Keyboard and touch users can access the same story content as pointer users.

## Phase 7 — Build the public gallery experience

Estimated effort: 7–12 days

### Work

- Design the today view as a gallery with the world occupying most of the screen.
- Add restrained loading choreography and transitions.
- Add story cards, methodology, sources, and edition context.
- Add previous/next navigation and a visual archive.
- Give every edition and story a stable shareable URL.
- Add WebGL capability detection, loading progress, and reduced-motion behavior.
- Optimize asset delivery, renderer settings, and mobile memory usage.
- Add metadata, social preview images, and a useful no-JavaScript shell.

### Exit criteria

- Core flows pass Playwright tests at representative desktop and mobile sizes.
- The experience is usable with keyboard navigation and screen readers.
- Reduced-motion preference is honored.
- A failed world asset does not prevent access to the edition's stories.
- Performance budgets are documented and enforced in CI where practical.

## Phase 8 — Automate the AWS pipeline

Estimated effort: 6–10 days

### Workflow

```text
Schedule
  → acquire edition lock
  → collect candidates
  → normalize and cluster
  → score and propose selection
  → pause for editorial approval
  → create art direction
  → generate image candidates
  → pause for image approval
  → generate world
  → validate and stage preview
  → pause for QA approval
  → publish atomically
  → notify
```

### Work

- Define infrastructure with CDK and separate development/production stages.
- Schedule the state machine at 7:30 AM in `America/Los_Angeles` so daylight
  saving changes do not shift the local publication workflow.
- Add edition locks and deterministic execution names.
- Use Step Functions wait states for external operations; do not hold a Lambda
  invocation open while waiting for world generation.
- Implement approval callbacks with expiring, authenticated actions.
- Add stage-level retries, terminal failures, and a dead-letter path.
- Add cost tags, AWS Budgets, alarms, and per-edition generation counters.
- Publish by atomically updating a small current-edition pointer only after all
  immutable assets are ready.

### Exit criteria

- Three consecutive staged editions complete without manual infrastructure work.
- Retrying any failed state does not duplicate paid operations or publications.
- Production credentials exist only in Secrets Manager and server runtimes.
- Disabling the schedule does not prevent manual runs.
- A failed edition leaves the previous published world fully intact.

## Phase 9 — Editorial operations and provenance

Estimated effort: 4–7 days

### Work

- Add a private review queue for story, image, and final-world approval.
- Add correction and unpublish flows with an audit log.
- Publish a human-readable methodology and sources panel.
- Expose generation provenance without exposing chain-of-thought, credentials, or
  copyrighted source bodies.
- Create daily failure, source health, and cost summaries.
- Add a runbook for provider outages and missed editions.

### Exit criteria

- A maintainer can correct a summary or source link without regenerating the
  image or world.
- A problematic edition can be withdrawn while preserving its audit record.
- Visitors can distinguish reported facts, project-written summaries, and
  artistic interpretation.

## Phase 10 — Open-source release

Estimated effort: 5–8 days

### Work

- Test the setup guide from a fresh account and clean clone.
- Provide a local-only demo using fixtures and mock providers.
- Document credentials, expected costs, quotas, and deletion procedures.
- Provide example editorial configurations without presenting them as neutral.
- Add provider adapter guides and a source adapter template.
- Add issue forms for bugs, sources, adapters, and editorial concerns.
- Add screenshots, a short demo, architecture diagram, and project roadmap.
- Perform dependency, license, secret, accessibility, and infrastructure reviews.

### Exit criteria

- A new contributor can run the demo without an AWS account or paid key.
- A technically capable user can deploy a private instance from the docs.
- Destructive infrastructure commands and potential costs are clearly marked.
- The public repository contains no credentials, private source payloads, or
  assets without known usage rights.

## Phase 11 — Post-launch research tracks

These are independent experiments, not promises in the critical path:

- depth-aware and semantic 3D story regions
- multiple views supplied to world generation
- narrated and guided editions
- optional social posting
- multiple editorial lenses or worlds per day
- reader-created configurations
- additional image and world model adapters
- spatial audio and ambient sound
- public contribution and story-nomination workflow
- comparison of the generated archive across weeks and years

Each experiment should begin with a written hypothesis and success measure before
it changes the production pipeline.

## 8. Testing strategy

### Unit tests

- schema migrations and validation
- scoring math and selection constraints
- URL normalization and deduplication
- prompt construction
- artifact checksums and state transitions

### Contract tests

- recorded, redacted provider responses
- source adapter fixtures
- storage adapter behavior
- generated manifest compatibility with the web application

### End-to-end tests

- fixture edition through mock generation and publication
- editorial override and approval
- failed generation and retry
- desktop, touch, keyboard, reduced-motion, and fallback-poster experiences

### Manual visual QA

- generated image rubric
- world fidelity and navigation
- hotspot placement
- typography and transitions
- representative mobile GPUs

Live paid-provider tests should be opt-in and capped. They should not run on every
pull request.

## 9. Security and cost visibility

- Validate all environment variables at process startup.
- Keep provider clients in server-only packages.
- Redact authorization headers, signed URLs, prompts containing private material,
  and source bodies from logs.
- Validate external URLs and guard server-side fetches against SSRF.
- Escape summaries and treat generated content as untrusted input.
- Use least-privilege IAM roles per pipeline stage.
- Add retention rules for intermediate assets and logs.
- Require explicit limits for candidates, model calls, image variants, retries,
  and world generations per edition.
- Provide `dry-run`, mock-provider, and schedule-disabled defaults.
- Report per-edition usage and alert at monthly cost thresholds.

## 10. Recommended delivery sequence

The practical order is:

1. Product contract
2. Repository foundation
3. Manual end-to-end world
4. Image and world quality iteration
5. Editorial engine
6. Limited story discovery
7. Public gallery polish
8. AWS automation
9. Operational hardening
10. Open-source launch

Phases can overlap, but automation should not get ahead of artistic validation.
For a single experienced developer, a credible private alpha is roughly six to
eight weeks of focused work; a polished public release is more plausibly ten to
fourteen weeks. These are planning ranges, not commitments, and depend heavily on
provider access, asset quality, and the desired review experience.

## 11. Immediate milestone and next steps

The next milestone is **one excellent, navigable, interactive world created from
one hand-authored ten-story edition**. It is the smallest proof that connects
the work already in the repository.

Execute it in this order:

1. Add versioned schemas and a fictional ten-story edition fixture. **Complete.**
2. Make the frontend read that fixture through a typed publication manifest,
   replacing its component-local demo data. **Complete.**
3. Produce the corresponding structured art-direction artifact and panorama
   prompt without making a paid call. **Complete.**
4. Run the first explicitly approved, cost-capped Nano Banana generation. Review
   the seam, poles, horizon, landmark separation, and representative viewports;
   record the result and any transformation in its manifest. **Complete for the
   fictional ten-story fixture. The equatorial views and seam passed review;
   the nadir has a visible pole singularity to evaluate in the first Marble
   experiment.**
5. Run a read-only World Labs capability probe. **Complete:** the test key is
   accepted by the legacy World API and rejected by the separate Marble 2 beta
   API. A sanitized real success fixture is still required.
6. Implement and contract-test the Marble adapter, operation repository, stable
   idempotency key, wait/poll strategy, and fixture-backed mock. **Complete and
   live-validated with Marble 1.1.**
7. Submit the approved panorama once, persist the operation immediately, and
   copy the completed world asset into project-owned storage. **Complete for
   the local artifact store.**
8. Render that asset in Spark.js and calibrate one canonical view. **Complete.**
9. Bake ten world-space anchors from normalized panorama targets, while
   retaining the story index as the always-available interaction path.
   **Complete manually; pipeline automation remains.**
10. Test desktop, touch, keyboard, reduced motion, fallback behavior, retries,
    and a clean-clone mock run. Record quality, elapsed time, provider cost, and
    lessons before starting ingestion or AWS automation.

The milestone is complete only when a fresh local checkout can replay the whole
flow with mocks, and an approved live run can produce an immutable publication
manifest that the frontend renders without hand-editing application code.

That evidence should determine the implementation details of the automated
pipeline—not the other way around.

## 12. Critical path after the milestone

Once the manual slice passes its artistic and technical decision gate:

1. Finish the product, source, correction, and review policies from Phase 0.
2. Build the editorial engine against an evaluation set.
3. Add bounded, allowlisted story discovery.
4. Iterate on art direction and world fidelity with several test editions.
5. Build the archive and public gallery routes.
6. Implement the AWS artifact store and state repository.
7. Move the proven local stages into the Step Functions workflow.
8. Add editorial approvals, atomic publication, monitoring, and cost reporting.
9. Run three staged editions and complete release, accessibility, security, and
   license reviews.

This ordering keeps the unproven artistic translation and provider integration
on the critical path. News ingestion and cloud automation should not grow around
an experience that has not yet worked once from end to end.

## 13. Verified external assumptions

Checked on 2026-10-12:

- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
  supports explicit aspect ratios and 1K, 2K, and 4K output for current Nano
  Banana models. The current panorama stage requests a 4K `16:9` image, extracts
  a native `2:1` master, and enlarges it to an 8192 × 4096 delivery canvas. That
  enlargement is not native 8K generated detail.
- [World Labs' World API](https://www.worldlabs.ai/blog/announcing-the-world-api)
  supports generating explorable worlds from images and other input types.
- [World Labs operations](https://atlas-beta.worldlabs.ai/docs/operations) are
  asynchronous resources. The operation ID must be persisted immediately,
  `done` determines terminal state, and retries should use stable idempotency
  keys. Operations are retained for 30 days, and transient outputs may be purged
  sooner, so completed outputs must be copied promptly into project-owned
  storage.
- [World Labs API reference](https://atlas-beta.worldlabs.ai/docs/api-reference)
  is currently a beta, account-dependent surface. The implementation must probe
  the configured account and capture the actual image-to-world contract rather
  than assuming that another documented generation task has the same request.
- The official [`@worldlabsai/client`](https://www.npmjs.com/package/@worldlabsai/client)
  is Apache-2.0 and suitable for a server adapter if the verified world task is
  exposed through its typed surface. Its current public Atlas task names are not
  by themselves evidence of the required panorama-to-world contract, so it is
  not yet a repository dependency.
- [World Labs webhooks](https://atlas-beta.worldlabs.ai/docs/webhooks) are an
  optional completion signal. A webhook must be signature-verified and followed
  by an authenticated operation fetch; polling remains the simpler first
  implementation.
- [Spark.js](https://sparkjs.dev/) is World Labs' Three.js-based Gaussian-splat
  renderer and supports multiple common splat formats.
- [EventBridge Scheduler](https://docs.aws.amazon.com/step-functions/latest/dg/using-eventbridge-scheduler.html)
  can start a Step Functions workflow using a named timezone.

Provider capabilities, model identifiers, access tiers, pricing, and limits can
change. Implementation must verify them again and keep them configurable.
