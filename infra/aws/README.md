# AWS infrastructure

This package defines the first AWS foundation for A World Every Day. The
reference development stack is deployed for website and editorial testing, but
its daily schedule is disabled and still targets the fixture workflow. A fresh
checkout does not deploy anything until an operator runs CDK.

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
- a separate manual-only live feed-collection workflow that writes an
  immutable candidate set and can optionally create a model-assisted editorial
  shortlist, analyze approved articles, finalize an edition, and propose art
  direction behind separate explicit gates;
- a separately gated raw Nano Banana image stage that requires a checksum-bound
  review artifact and never automatically repeats an uncertain paid attempt;
- a private 8K panorama-processing stage that runs only after the approved raw
  image exists;
- separately gated Marble 1.1 world generation, landmark detection, private
  Spark.js interaction baking, and staged/public publication (deployed but not
  yet validated end to end in AWS);
- a 7:30 AM `America/Los_Angeles` EventBridge Scheduler schedule, disabled by
  default, with two delivery retries and a retained dead-letter queue; and
- workflow and scheduler-failure alarms with optional email delivery; plus
- an optional monthly AWS Budget notification.

The fixture workflow validates state transitions, immutable marker artifacts,
locking, failure handling, and the review boundary. It makes no provider calls
and stops at editorial review by default. It is not the live daily pipeline.
The manual collection workflow is the first real cloud path. It has collected
live feed metadata, analyzed approved articles, and finalized a ten-story test
edition and a ten-subject art-direction proposal. This was a technical test,
not a publication candidate: editorial quality needs review. The separate
World Labs probe authenticated read access. The raw-image stage has not been
invoked; image processing is wired to follow it, and its Lambda startup was
smoke-tested, but no edition has run through either stage in AWS. World
generation, interaction baking, and publication are now deployed in the manual
workflow and pass fixture tests, but have not been tested with a live AWS
edition. A poll-only world Lambda smoke test confirmed package, secret, and S3
access without a paid provider call. This workflow is not scheduled.

The reasoning and unresolved browser-baking boundary are recorded in
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
This explicit boundary prevents an infrastructure synthesis from silently
publishing website content.
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

The disabled schedule supplies `{ "continueAfterReview": false }`, advances a
fictional edition to `SELECTED`, releases its lock, and stops. After deployment,
an operator can deliberately resume the same edition with
`continueAfterReview: true`; that path writes only clearly marked fixture
artifacts. It still does not call Nano Banana, World Labs, or live sources.

## Manual live collection

The `LiveCollectionStateMachineArn` stack output identifies a separate,
unscheduled state machine. It accepts an edition ID and an explicit collection
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

The first development-account run on October 14, 2026 found 56 candidates with
no failed feeds. A repeat execution returned the same artifact without creating
a new S3 object version. The daily schedule remains disabled and does not target
this partial workflow.

Only when `confirmPaidAnalysis` is explicitly `true` does the same manual
workflow evaluate candidate metadata and create immutable
`candidate-evaluations.json` and `shortlist.json` artifacts. The current code
uses Amazon Nova through Bedrock in batches of at most ten candidates (at most
ten requests for 100 candidates); a completed artifact is reused on resume.
The **deployed development worker still uses Google** and must not be invoked
under the new source-text policy. An earlier manually approved Google shortlist
run evaluated 56 candidates and shortlisted 15. The daily schedule remains
disabled and does not call a model.

That first immutable test shortlist contains eight discovery-only sources and
must not be treated as an article-analysis queue. New shortlist artifacts apply
the reviewed source-access policy, record its configuration checksum, and
exclude discovery-only stories. If fewer than ten approved stories remain,
review the source mix instead of fetching a restricted article.

Article analysis is a separate manual gate. It requires both
`confirmLiveArticleFetch: true` and `confirmPaidArticleAnalysis: true` in
addition to `confirmPaidAnalysis: true`. A preflight checks the shortlist's
source-policy checksum and every selected source before the bounded Map starts.
At most 15 workers run, with concurrency limited to two; each writes only
original summaries, claims, visual details, usage, and provenance, never source
article text. Completed evidence is reused on resume. One manual test edition
analyzed ten approved articles and reused all ten records on a later run without
repeating model calls. An older test edition predates source-policy checks and
intentionally fails this preflight.

### Source-text privacy preflight

The current repository code routes candidate metadata evaluation, permitted
article analysis, and art direction through Amazon Nova on AWS-managed Bedrock.
Those three workers have no Google secret access, and IAM permits only the pinned
Amazon model. This is **not** self-hosted inference: AWS receives the prompts.
The generated visual prompt still goes to Google, and the image goes to World
Labs. See the [full data boundary](../../docs/DATA_BOUNDARY.md).

**The deployed development workers have not been updated.** Earlier AWS
editorial executions used Google, and the existing text workers must not be
invoked under the new policy. Immutable artifacts from those executions should
not be mistaken for Bedrock-processed artifacts. Deploy the code and start a
fresh edition after review. No paid Bedrock call has validated the new workers.

Before deploying or invoking the new worker:

1. Confirm that each selected source permits the intended analysis and that
   Amazon Nova is available in the deployment account and Region. Review the
   current AWS model terms.
2. With a named role-based profile, inspect the account's Bedrock retention
   setting and model-invocation logging in that Region (these commands only
   read configuration):

   ```bash
   aws --profile <role-profile> --region <region> bedrock get-account-data-retention
   aws --profile <role-profile> --region <region> bedrock get-model-invocation-logging-configuration
   ```

3. Interpret the returned retention setting using the current AWS documentation,
   including any inherited/default mode and model-specific requirements.
   Confirm that it meets your policy and that text invocation logging will not
   retain source prompts or outputs. Bedrock
   invocation logging can capture complete requests and responses in CloudWatch
   Logs or S3. Do not assume that discarding text in this project disables AWS
   retention or logs. If the configuration cannot be verified, keep the stage
   off. An organization requiring **no hosted processing** needs a separately
   reviewed self-hosted adapter; Bedrock does not meet that requirement.
4. Deploy the updated text workers only with explicit approval, then verify
   their model IDs, IAM scope, absence of Google secret access, and a separately
   approved live test before enabling any schedule. Confirm the older Google
   text workers cannot be invoked and do not reuse their immutable artifacts.

AWS says third-party Bedrock model providers cannot access the service-managed
deployment accounts or customer prompts and completions. Amazon Nova is an
Amazon-operated model; AWS itself still processes the request. See AWS's
[data-protection documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html),
[data-retention documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html)
and [model-invocation logging documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
for the current service behavior. The daily schedule remains disabled.

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
`confirmPaidArtDirection: true`. It requires an operator-created, immutable
`editions/<editionId>/review/approval.json` in the private artifact bucket.
The `edition-review` schema binds the approval to the exact selected-edition
and art-direction checksums. Do not create this artifact until the stories,
citations, and visual proposal have been reviewed. The branch makes at most one
Nano Banana request and stores the original source image privately. The next
stage processes that source into an 8K delivery panorama and stores the result
privately. Neither stage invokes World Labs or publishes anything.

Before the paid call, the stage conditionally writes a generation-attempt marker.
If the call or storage then fails, a resumed execution will stop for manual
inspection rather than automatically making a second paid request. Only an
operator who has resolved the provider outcome should decide how to recover.

## Private world and publication stages

The deployed manual workflow next requires an exact
`editions/<editionId>/review/image-approval.json` artifact and
`confirmPaidWorld: true` before submitting one Marble 1.1 world. It records a
submission-attempt marker before calling World Labs, stores the provider
operation ID, and polls with a bounded Step Functions wait. An uncertain
submission never automatically retries the paid request. The SPZ remains in
the private artifact bucket.

`confirmPaidLandmarks: true` allows one multimodal landmark request against a
private, downsampled copy of the approved panorama. After that, the cloud
browser baker raycasts the private SPZ and stages a publication manifest, still
without a public asset. The operator must review the complete staged edition
and write a checksum-bound
`editions/<editionId>/review/publication-approval.json` artifact. Only a
separate run with `confirmPublish: true` can copy the approved poster, SPZ, and
manifest to the public asset bucket and advance `generated/current.json`.
These gates are code-level safeguards, not evidence that the full path has run
successfully in AWS. Keep the schedule disabled until it has.

An October 2026 private SPZ fixture test validated the Lambda-hosted Spark.js
browser baker. It loaded a real 30 MB SPZ and wrote 12 raycast anchors (nine
story landmarks and three context markers) in about nine seconds. This was a
stage-level test, not a paid end-to-end edition or public publication.

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
The development-account read-only probe returned HTTP 200 on October 15, 2026.

## Live-pipeline cutover

Do not enable or retime the daily schedule while it targets the fixture
workflow. A successful fixture execution proves the AWS wiring, not daily world
generation or publication. Before enabling live automation:

1. Deploy and validate the real story-discovery, generation, interaction-baking,
   and publication stages. Keep provider credentials in Secrets Manager and
   record bounded per-edition usage and costs.
2. Complete one manually started, reviewed live edition. Verify its citations,
   generated assets, hotspot alignment, public URLs, and atomic current-edition
   pointer. Confirm that a failed run leaves the previous public world intact.
3. Test EventBridge delivery with a separate one-time schedule targeting that
   validated workflow. Inspect the execution and publication result; do not
   repurpose the daily recurrence as a test trigger.
4. Only then enable the daily 7:30 AM `America/Los_Angeles` schedule. Monitor its
   first run and retain a rollback path.

Remove test editions and assets only by verified edition ID and object key,
after confirming they are not the current publication. Retain the provenance
and audit records required to explain any published world.

## Deployment boundary

Do not run `cdk bootstrap`, `cdk deploy`, enable the schedule, or create secret
values during ordinary development. Those commands mutate an AWS account and
may incur costs. Before the first deployment, select the account and region,
review `npm run diff`, configure cost alerts, and obtain explicit approval.

