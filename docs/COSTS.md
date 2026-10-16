# Costs and usage

**Status:** Planning guidance, last reviewed October 15, 2026.

A World Every Day is designed to make the cost of a daily edition understandable
before it is automated. The project does not currently reserve spend or enforce
an automatic budget. Paid adapters are optional, tests and dry runs use fixtures,
and live provider calls require deliberate operator action.

## Where spend can occur

| Stage | Expected baseline | Current status |
| --- | ---: | --- |
| Feed discovery and article retrieval | Network and cloud runtime only | Both live-tested in a manual AWS execution |
| Candidate evaluation | Up to ten Amazon Bedrock Nova requests, in batches of ten candidates | New adapter is local-only; earlier gated AWS stage used Google |
| Article analysis | Up to 15 Amazon Bedrock Nova requests, one per preliminary story | New adapter is local-only; earlier gated AWS workers analyzed ten live articles with Google |
| Art-direction planning | One Amazon Bedrock Nova request per edition | New adapter is local-only; earlier gated AWS stage used Google |
| Nano Banana panorama | One final image generation, followed by private 8K processing | Live-validated locally; gated AWS image and processing stages deployed, but no edition has run through them |
| Landmark analysis | One multimodal analysis of the final panorama | Live-validated locally; gated cloud stage deployed but not paid-tested |
| World Labs Marble | One world generation | Live-validated locally with Marble 1.1; gated cloud stage deployed and smoke-tested without a paid request |
| Interaction baking | One private headless browser run with Spark.js | Cloud Lambda package deployed; runtime not yet verified with an SPZ in AWS |
| AWS orchestration and delivery | Step Functions, Lambda, S3, DynamoDB, CloudFront, and CloudWatch usage | Development stack and gated live stages deployed; daily schedule disabled and targeting the fixture workflow |
| Public websites | Two private S3 origins, two CloudFront distributions, DNS queries, certificates, storage, and transfer | Marketing site and explorer deployed for testing |

These counts are targets for the first complete pipeline, not a description of
an already deployed system. Provider retries should remain limited and visible.
The Bedrock candidate evaluator records its aggregate request count and usage;
if a batch fails before the immutable artifact is written, a manual retry can
repeat prior batches and incur additional charges. The new text route has not
been deployed or paid-tested. See the [data boundary](DATA_BOUNDARY.md).
The workflow should narrow stories with deterministic local processing before
it reads full articles or calls a model, and it should create one final panorama
and one final world per edition by default.

## What to record

Each paid stage should attach the following information to the edition's
artifacts when the provider makes it available:

- provider, model, operation, and edition identifier;
- request and attempt counts;
- input and output usage units;
- generated asset count and size where relevant;
- elapsed time;
- actual provider-reported cost, or a clearly labeled estimate;
- currency, pricing source, and the date pricing was reviewed.

Per-edition summaries should make unusual retries or changes in usage obvious.
Before an automated AWS deployment, add monthly provider totals, AWS cost tags,
CloudWatch dashboards, and AWS Budgets alerts. These are visibility and alerting
tools; they are not currently pipeline authorization gates.

The development CDK stack creates the daily schedule disabled and only adds an
AWS Budget when both a monthly threshold and notification email are explicitly
provided. Workflow alarms notify an operator only when an optional alarm email
is configured and its AWS subscription is confirmed. The reference development
stack has been deployed without an AWS Budget or alarm email; its daily schedule
remains disabled.

The marketing site and explorer are static exports. Their baseline hosting cost
comes from S3 storage and requests, CloudFront requests and transfer, and Route
53 when custom domains are enabled. They do not require always-on application
servers. CloudFront invalidations and repeated full-asset uploads should remain
deliberate, especially as generated world files grow.

## Keeping the baseline small

- Run fixture-backed tests and dry runs without credentials.
- Use free, deterministic filtering and deduplication before model analysis.
- Limit the amount of article text sent for article analysis.
- Prefer a single final panorama and world over generating speculative variants.
- Avoid unbounded automatic retries, especially for image and world generation.
- Recheck official pricing and quotas before production automation and whenever a
  provider or model changes.

Exact prices are intentionally not hardcoded here. AWS, Google, and World Labs
pricing, access tiers, and billing units can change, and the final model choices
are not yet fixed. A dated price table and measured cost from a manually approved
test edition should be added before the daily pipeline is enabled.

## Observed ten-story run

The approved 2026-10-13 local run recorded the following provider usage:

| Stage | Model | Successful requests | Provider-reported usage |
| --- | --- | ---: | ---: |
| Candidate evaluation | Gemini 3.8 Flash | 1 | 31,131 tokens |
| Article analysis | Gemini 3.8 Flash | 12 | 31,316 tokens |
| Art direction | Gemini 3.8 Flash | 1 | 5,128 tokens |
| Panorama | Gemini Nano Banana 2.1 | 2 | 10,293 and 11,481 total tokens, including image and reasoning units |
| Landmark analysis | Gemini 3.8 Flash | 1 | Usage was not retained by the initial detector artifact |
| World generation | Marble 1.1 | 2 | Provider did not report a billing unit in the operation responses |

On October 14, 2026, the manual AWS shortlist stage evaluated 56 public feed
metadata records with one successful Gemini 3.8 Flash request. The provider
reported 6,828 input, 13,908 output, and 21,009 total tokens; the stage took
82 seconds and produced 15 preliminary selections. At Google's
[standard paid-tier prices](https://ai.google.dev/gemini-api/docs/pricing)
listed that day ($0.75 per million input tokens and $3.75 per million output
tokens), the successful request would cost about **$0.057**. Actual billing
depends on the key's tier and is not yet verified. An earlier attempt timed out
at the former 120-second Lambda limit without a usage artifact and may also
have incurred provider charges. The stage now permits one SDK request attempt
and has a five-minute Lambda timeout; a timeout can still leave unreported
provider usage, so it is not treated as a free failure.

Article analysis used 12 requests for ten final stories because two incorrect
page-container extractions were rejected and reprocessed after the extractor was
fixed. Candidate evaluation also had provider-rejected compatibility attempts
and one locally rejected response before the successful artifact; those attempts
did not return usage metadata and could still affect billing. This is evidence
that attempt counts must be recorded even when validation prevents an artifact
from being written.

On October 15, a separate manual AWS editorial test collected 72 candidate
metadata records, shortlisted ten policy-approved sources, analyzed ten linked
articles, finalized ten stories, and created one art-direction proposal. The
persisted artifacts report:

| Stage | Successful requests | Provider-reported input / output / total tokens |
| --- | ---: | ---: |
| Candidate evaluation | 1 | 8,732 / 17,681 / 26,413 |
| Article analysis | 10 | 15,947 / 5,323 / 23,140 |
| Art direction | 1 | 2,315 / 3,026 / 7,223 |

The provider-reported total is 56,776 tokens across these 12 successful
requests. Output and total tokens need not add up because the provider can count
other units. One article response exceeded the original evidence-size bound and
failed local validation before an artifact was written; it may have incurred an
additional charge not represented in the totals. AWS orchestration, network,
storage, and hosting charges are separate. This test edition was not approved
for image generation or publication after editorial review.

On October 15, the revised AWS shortlist evaluated 52 feed candidates in one
successful request and selected six. The provider reported 6,367 input, 17,530
output, and 23,897 total tokens. Six approved linked articles were then analyzed
and finalized in six successful requests, reporting 8,198 input, 3,423 output,
and 12,573 total tokens. The eight successful editorial requests therefore
reported 36,470 total tokens; this is usage, not a verified billing amount. No
image or World Labs generation was started for this edition; the daily schedule
remained disabled.
