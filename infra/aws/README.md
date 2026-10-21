# AWS infrastructure

This package defines the first AWS foundation for A World Every Day. The
reference development stack is deployed for website and editorial testing. Its
7:30 AM Pacific development schedule now opts into the full live workflow,
including paid generation and public publication. Individual stages retain
explicit gates; fresh deployments keep the schedule disabled by default.
A fresh checkout does not deploy anything until an operator runs CDK.

The current stack synthesizes:

- a private, versioned S3 bucket for immutable pipeline artifacts;
- a separate private S3 bucket served through CloudFront for publishable assets;
- private S3 buckets and CloudFront distributions for the marketing site and
  immersive explorer;
- optional ACM and Route 53 configuration for a root domain and configurable
  explorer subdomain;
- an on-demand DynamoDB table for edition state, locks, and publication pointers;
- references to pre-existing Google AI and World Labs secrets;
- a manual-only World Labs authentication probe that lists worlds without
  returning world data or starting generation;
- a Step Functions Standard fixture workflow and one bounded Lambda with
  CloudWatch logging;
- a separate live feed-collection workflow that writes an
  immutable candidate set and can optionally create a model-assisted editorial
  shortlist, analyze approved articles, finalize an edition, and propose art
  direction behind separate explicit gates;
- a separately gated raw Nano Banana image stage that requires a checksum-bound
  review artifact and never automatically repeats an uncertain paid attempt;
- a private 8K panorama-processing stage that runs only after the approved raw
  image exists;
- separately gated Marble 1.1 world generation, landmark detection, private
  Spark.js interaction baking, staged publication, and direct test previews;
- an opt-in unattended path that records checksum-bound automated decisions at
  the edition, image, and publication gates without claiming human review;
- a 7:30 AM `America/Los_Angeles` EventBridge Scheduler schedule, disabled by
  default in fresh deployments, with two delivery retries and a retained
  dead-letter queue; and
- workflow and scheduler-failure alarms with optional email delivery; plus
- an optional monthly AWS Budget notification.

The fixture workflow validates state transitions, immutable marker artifacts,
locking, failure handling, and the review boundary. It makes no provider calls
and stops at editorial review by default. It is not the live daily pipeline.
The recurring schedule runs the full live path. A failed run leaves the current
published pointer unchanged and needs inspection before retrying.

The original architecture decision and its implementation notes are recorded in
[`docs/architecture/0001-aws-foundation.md`](../../docs/architecture/0001-aws-foundation.md).

## Local validation

```bash
cd pipeline
npm i
cd ../infra/aws
npm i
npm run license:check
npm run typecheck
npm test
npm run synth
npm run build
```

`npm run synth` is local and does not create AWS resources. Review the generated
CloudFormation template in `cdk.out/`; that directory is ignored by Git.
Docker is required to synthesize and test the image-processing Lambda because
Sharp's native binary must be packaged for Linux x64.

## Local configuration

Copy the non-secret example when you want local defaults:

```bash
cp .env.example .env.local
```

`infra/aws/.env.local` is ignored by Git. It contains deployment settings only,
never AWS access keys or provider secrets. CDK context (`-c`) overrides these
environment values.

Before updating an existing stack, restore its domain settings in this file or
pass them through CDK context. Review `npm run diff`: omitting those settings
would remove the live custom-domain resources.

| Environment variable | CDK context | Default | Purpose |
| --- | --- | --- | --- |
| `WORLD_EVERY_DAY_ENVIRONMENT` | `environmentName` | `development` | `development` or `production` |
| `WORLD_EVERY_DAY_ENABLE_SCHEDULE` | `enableSchedule` | `false` | Enables the daily trigger only when explicitly set to `true` |
| `WORLD_EVERY_DAY_EDITORIAL_PROVIDER` | `editorialProvider` | `google-gemini` | Select paid Gemini, optional `aws-bedrock`; no automatic fallback |
| `WORLD_EVERY_DAY_GEMINI_EDITORIAL_MODEL` | `geminiEditorialModel` | `gemini-3.8-flash` | Gemini model for all three editorial text stages |
| `WORLD_EVERY_DAY_EDITORIAL_MODEL` | `editorialModel` | `amazon.nova-lite-v1:0` | Pinned Amazon-operated Bedrock model for candidate metadata evaluation |
| `WORLD_EVERY_DAY_ARTICLE_ANALYSIS_MODEL` | `articleAnalysisModel` | `amazon.nova-lite-v1:0` | Amazon-operated Bedrock model for approved full article text; other IDs are rejected |
| `WORLD_EVERY_DAY_LANDMARK_VISION_MODEL` | `landmarkVisionModel` | `gemini-3.8-flash` | Google model for generated-image landmark detection; it does not receive source pages |
| `WORLD_EVERY_DAY_NANO_BANANA_MODEL` | `nanoBananaModel` | `gemini-nano-banana-2.1` | Model identifier for optional paid raw-image generation |
| `WORLD_EVERY_DAY_WORLD_LABS_MODEL` | `worldLabsModel` | `marble-1.1` | Model identifier for optional paid World Labs generation |
| `WORLD_EVERY_DAY_ALARM_EMAIL` | `alarmNotificationEmail` | unset | Email subscriber for workflow and scheduler failure alarms |
| `WORLD_EVERY_DAY_MONTHLY_BUDGET_USD` | `monthlyBudgetUsd` | unset | Positive monthly AWS cost threshold |
| `WORLD_EVERY_DAY_BUDGET_ALERT_EMAIL` | `budgetAlertEmail` | unset | Email for the forecasted 80% budget notification |
| `CDK_DEFAULT_REGION` | n/a | AWS CLI default | Deployment region |
| `WORLD_EVERY_DAY_SITE_DOMAIN` | `siteDomainName` | unset | Optional root domain for the marketing site |
| `WORLD_EVERY_DAY_HOSTED_ZONE_ID` | `hostedZoneId` | unset | Route 53 hosted-zone ID; required with the root domain |
| `WORLD_EVERY_DAY_EXPLORER_SUBDOMAIN` | `explorerSubdomain` | `explore` | Explorer DNS label beneath the root domain |

Budget amount and email must be supplied together. Example synthesis:

```bash
npm run synth -- \
  -c environmentName=development \
  -c monthlyBudgetUsd=25 \
  -c budgetAlertEmail=operator@example.com
```

The budget is filtered to the stack's `Project=AWorldEveryDay` tag. That
user-defined cost-allocation tag must be activated in the billing account for
the filter to take effect.

Custom-domain settings are optional and contain no credentials. When enabled,
the stack creates one DNS-validated certificate covering the root and explorer
domains, plus IPv4 and IPv6 Route 53 aliases for both distributions. Because
CloudFront requires its certificates in `us-east-1`, deploy this combined stack
in that region. The domain must already have a Route 53 hosted zone in the target
account, or be delegated to one before deployment.

CDK provisions the hosting resources but does not upload a build. Build
`marketing/` and `frontend/` separately, then publish their respective `out/`
directories to the bucket names emitted as `MarketingSiteBucketName` and
`ExplorerSiteBucketName`. Invalidate the matching distribution using the emitted
`MarketingSiteDistributionId` or `ExplorerSiteDistributionId` after an upload.
When syncing `frontend/out/`, exclude `generated/*`: local ignored SPZs and
manifests can be copied into the static export, while edition assets belong in
the separate public-asset bucket and are published by the reviewed workflow.
This explicit boundary prevents an infrastructure synthesis from silently
publishing website content.

Landmark detection includes normalized image bounds. Publication carries them
as `interaction.imageBoundingBox`; the explorer combines their angular extent
with the baked hotspot distance to size the focus shader. Deploy both the
pipeline and explorer when changing that contract. Older manifests without
bounds retain the default focus size. A metadata-only backfill must preserve
asset checksums and baked positions, update the affected current/history pointer
checksums, and invalidate the changed public manifests.

Before the first edition is published, seed the public-asset bucket with the
included unpublished marker so the explorer does not request a missing pointer:

```bash
aws s3api put-object \
  --bucket <PublicAssetBucketName> \
  --key generated/current.json \
  --body infra/aws/assets/unpublished-current.json \
  --content-type application/json \
  --cache-control 'no-store, max-age=0' \
  --if-none-match '*'
```

Run this from the repository root with the chosen AWS profile and region. The
conditional write must not replace an already published current edition. The
publication stage recognizes the marker and atomically replaces it with the
first approved edition pointer.
Before uploading a marketing build, run `npm run verify:public-build` in
`marketing/` with `NEXT_PUBLIC_EXPLORER_URL` set to the intended public HTTPS
URL. This checks the exported page rather than the local development settings.

## AWS access and secrets

Use an AWS CLI named profile backed by IAM Identity Center or an assumed role.
The profile and its temporary credentials live in the standard AWS CLI config
outside this repository. Pass the profile explicitly when inspecting a target
account:

```bash
aws sso login --profile world-every-day-dev
npm run diff -- --profile world-every-day-dev
```

Do not put `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, session tokens, or
provider keys in `.env.local`. CI should use workload identity and an assumed
deployment role rather than long-lived credentials.

When an alarm email is configured, AWS sends a subscription confirmation after
deployment. Notifications begin only after the recipient confirms it.

The stack references these secret names without creating or populating them:

```text
world-every-day/<environmentName>/google-ai
world-every-day/<environmentName>/world-labs
```

Secret values must be added directly through an authorized AWS workflow. They
must never appear in CDK context, CloudFormation parameters, source files, or
command history.

## Fixture workflow

The fixture workflow advances a fictional edition to `SELECTED`, releases its
lock, and stops. After deployment,
an operator can deliberately resume the same edition with
`continueAfterReview: true`; that path writes only clearly marked fixture
artifacts. It still does not call Nano Banana, World Labs, or live sources.

## Live collection

The `LiveCollectionStateMachineArn` stack output identifies the live state
machine. It accepts an edition ID and an explicit collection
window, reads the reviewed feed allowlist bundled with the pipeline, and
writes candidate metadata to
`editions/<editionId>/sources/candidate-set.json` in the private artifact bucket.
It does not retain feed bodies or article text. Repeating the same edition and
window reads the existing immutable artifact instead of refetching sources.

Example input for a deliberately started execution:

```json
{
  "editionId": "collection-2026-10-14-test",
  "windowStart": "2026-10-13T22:30:00.000Z",
  "windowEnd": "2026-10-14T22:30:00.000Z"
}
```

The daily schedule reaches this workflow through a small input-preparation
state machine. It supplies a Pacific-date edition ID and the previous 24-hour
window. The reference development input enables paid analysis, unattended
generation, and publication.

Only when `confirmPaidAnalysis` is explicitly `true` does the same manual
workflow evaluate candidate metadata and create immutable
`candidate-evaluations.json` and `shortlist.json` artifacts. The current code
uses the selected Gemini or Bedrock Nova adapter in batches of at most
ten candidates (at most 20 requests for 100 candidates with one malformed-response
retry per batch); a completed artifact is reused on resume.
The deployed development worker uses the 32-source RSS/Atom allowlist, including
GOV.UK news and European Commission environment news.
Shortlist artifacts apply
the reviewed source-access policy, record its configuration checksum, and
exclude discovery-only stories. If fewer than ten approved stories remain,
review the source mix instead of fetching a restricted article.

Article analysis is a separate manual gate. It requires both
`confirmLiveArticleFetch: true` and `confirmPaidArticleAnalysis: true` in
addition to `confirmPaidAnalysis: true`. A preflight checks the shortlist's
source-policy checksum and every selected source before the bounded Map starts.
At most 15 workers run, with concurrency limited to two; each writes only
original summaries, claims, visual details, usage, and provenance, never source
article text. Completed evidence is reused on resume. Artifacts from an older source policy must pass the current preflight before reuse.

### Source-text privacy preflight

The repository code defaults to paid Gemini API for candidate evaluation,
permitted article analysis, and art direction. It reuses the existing Google
secret, which is read only by the selected Lambda workers at runtime. Google
processes these prompts; for a Gemini API key tied to a project with active
billing, its [Paid Services terms](https://ai.google.dev/gemini-api/terms) say
prompts and responses are not used to improve its products, while limited
abuse-monitoring retention remains possible. Bedrock Nova is an optional managed alternative. See the [data boundary](../../docs/DATA_BOUNDARY.md).

Before changing the provider, source policy, or deployment:

1. Confirm each selected source permits the intended use. For Gemini, verify
   the key's project is marked **Paid** in [Google AI Studio billing](https://ai.google.dev/gemini-api/docs/billing),
   review the [Paid Services terms](https://ai.google.dev/gemini-api/terms),
   and avoid opt-in data-sharing features. Put the key in the existing
   `world-every-day/<environmentName>/google-ai` secret, not CDK context or a
   Lambda environment variable. Confirm the reviewed 32-source allowlist is in the
   deployed bundle before any live collection.
2. If selecting Bedrock, confirm Nova access. With a named role-based profile, inspect the account's retention
   setting and model-invocation logging in that Region (these commands only
   read configuration):

   ```bash
   aws --profile <role-profile> --region <region> bedrock get-account-data-retention
   aws --profile <role-profile> --region <region> bedrock get-model-invocation-logging-configuration
   ```

3. For Bedrock, interpret the returned retention setting using the current AWS documentation,
   including any inherited/default mode and model-specific requirements.
   Confirm that it meets your policy and that text invocation logging will not
   retain source prompts or outputs. Bedrock
   invocation logging can capture complete requests and responses in CloudWatch
   Logs or S3. Do not assume that discarding text in this project disables AWS
   retention or logs. If the configuration cannot be verified, keep the stage
   off. An organization requiring **no hosted processing** needs a separately
   reviewed self-hosted adapter; Bedrock does not meet that requirement.
4. Deploy updated text workers only with explicit approval, verify the chosen
   provider and IAM scope, and separately approve live tests before enabling
   any schedule. The provider never falls back silently.

AWS says third-party Bedrock model providers cannot access the service-managed
deployment accounts or customer prompts and completions. Amazon Nova is an
Amazon-operated model; AWS itself still processes the request. See AWS's
[data-protection documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html),
[data-retention documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html)
and [model-invocation logging documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
for the current service behavior. The development schedule uses Gemini by
default, not this optional Bedrock route.

After all article workers complete, a deterministic finalization step verifies
the source-policy checksum and
editorial input hashes, requires evidence for every shortlisted story, and
writes an immutable `selected-edition.json` with up to ten cited stories. A
separate `confirmPaidArtDirection: true` flag can then request one model-assisted
art-direction proposal, bound to that selected edition and reused on resume.
Without that flag the workflow stops after selection. Art direction alone stops
for operator review and does not trigger image or world generation.

## Reviewed raw image

The optional `confirmPaidPanorama: true` branch is reachable only after
`confirmPaidArtDirection: true`. By default it requires an operator-created, immutable
`editions/<editionId>/review/approval.json` in the private artifact bucket.
The `edition-review` schema binds the approval to the exact selected-edition
and art-direction checksums. In the explicitly opted-in unattended mode, the
workflow creates the same checksum-bound artifact and labels the decision
`automated-unattended-run`; it does not claim a human reviewed the result.
The branch makes at most one
Nano Banana request and stores the original source image privately. The next
stage processes that source into an 8K delivery panorama and stores the result
privately. Neither stage invokes World Labs or publishes anything.

Before the paid call, the stage conditionally writes a generation-attempt marker.
If the call or storage then fails, a resumed execution will stop for manual
inspection rather than automatically making a second paid request. Only an
operator who has resolved the provider outcome should decide how to recover.

## Private world and publication stages

The default workflow next requires an exact
`editions/<editionId>/review/image-approval.json` artifact and
`confirmPaidWorld: true` before submitting one Marble 1.1 world. It records a
submission-attempt marker before calling World Labs, stores the provider
operation ID, and polls with a bounded Step Functions wait. An uncertain
submission never automatically retries the paid request. The SPZ remains in
the private artifact bucket.

`confirmPaidLandmarks: true` allows one multimodal landmark request against a
private, downsampled copy of the approved panorama. After that, the cloud
browser baker raycasts the private SPZ and stages a publication manifest, still
without a public asset. In the default reviewed mode, the operator reviews the
complete staged edition and writes a checksum-bound
`editions/<editionId>/review/publication-approval.json` artifact. Only a
separate run with `confirmPublish: true` can copy the approved poster, SPZ, and
manifest to the public asset bucket and advance `generated/current.json`.
For a technical edition whose ID ends in `-test`, use
`confirmPublishPreview: true` instead. It copies the approved assets and
manifest to a direct `?edition=<editionId>` explorer URL but does **not**
advance `generated/current.json`. The test edition is publicly accessible to
anyone with its URL; do not use this path for private content. The two publish
flags are mutually exclusive, and both still require the checksum-bound
publication review artifact. A review with `approved-for-test-preview` can
authorize the direct link but cannot authorize an update to the current world;
current-world publication requires an `approved-for-publication` decision.
If an unattended `-test` edition already has an `approved-for-publication`
review, it can be promoted without regenerating its image or world. Promotion
preserves the immutable preview at `publication.json`, writes a separate
`publication-public.json`, and advances `generated/current.json` to that public
manifest. A preview-only approval cannot authorize promotion.
To run the whole chain without intervention, set `confirmUnattendedRun: true`
alongside the paid-stage flags and `confirmPublish: true` in one execution input.
The state machine then writes checksum-bound automated decisions before image
generation, world generation, and public publication. This is an explicit
operator choice with real provider costs and public output, not a substitute
for editorial or visual QA. The deployed 7:30 AM development schedule now sets
these flags; fresh stacks remain disabled until explicitly enabled.

## World Labs key check

The standalone `WorldLabsAuthProbe` Lambda is available as the
`WorldLabsAuthProbeFunctionName` stack output. It has no
public endpoint, schedule, or workflow trigger. A maintainer must invoke it
manually with `{ "confirmReadOnlyProbe": true }`. The function reads the
`world-every-day/<environment>/world-labs` secret inside AWS and calls World
Labs' [list-worlds endpoint](https://github.com/worldlabsai/worldlabs-api-examples/blob/main/web-generate-world/index.html).
It returns only `authenticated`, `httpStatus`, and `operation`; it does not
return the key, world list, or provider response body. A successful check
verifies API access, not world-generation permissions, model compatibility,
available credits, or a successful panorama-to-world run. Those require a
separate, explicitly approved generation test.

## Daily collection and publication boundary

The development schedule runs at 7:30 AM `America/Los_Angeles`. EventBridge
passes its scheduled timestamp to an input-preparation state machine, which
starts the live workflow with a stable Pacific-date edition ID and a 24-hour
window. Fresh deployments keep the schedule disabled unless explicitly enabled
with `-c enableSchedule=true`; use that context on later development-stack
deployments too, or CDK will disable it again.

The development daily run now continues from RSS/Atom collection through the paid
stages and public publication, subject to stage checks and provider success.
Each successful publication atomically moves the former current edition into
the public pointer's `pastWorlds` list. The explorer uses that list for its
archive menu; technical previews that were never current stay out of it.
Monitor editorial quality, citations, generated assets, hotspot alignment, public URLs,
and pointer updates; failed runs must leave the previous public world intact.

Remove test editions and assets only by verified edition ID and object key,
after confirming they are not the current publication. Retain the provenance
and audit records required to explain any published world.

## Deployment boundary

Do not run `cdk bootstrap`, `cdk deploy`, enable the schedule, or create secret
values during ordinary development. Those commands mutate an AWS account and
may incur costs. Before the first deployment, select the account and region,
review `npm run diff`, configure cost alerts, and obtain explicit approval.

