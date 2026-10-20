# Costs and usage

**Status:** Planning guidance, last reviewed October 19, 2026.

A World Every Day is designed to make the cost of a daily edition understandable
before it is automated. The project does not currently reserve spend or enforce
an automatic budget. The development stack's daily schedule now opts into paid
generation and public publication; tests and dry runs still use fixtures.
The deployed 30-feed configuration includes ten PLOS feeds, increasing paced
Lambda runtime. The 100-candidate admission cap bounds editorial request
volume. Measure actual runtime and provider charges for each daily run.

## Where spend can occur

| Stage | Expected baseline | Current status |
| --- | ---: | --- |
| Feed discovery and article retrieval | Network and cloud runtime only | Both live-tested in a manual AWS execution |
| Candidate evaluation | Up to ten Gemini batches by default, with one malformed-response retry per batch (20 requests maximum for 100 candidates) | Record all attempts in usage; Bedrock Nova and Vertex Claude remain optional |
| Article analysis | Up to 15 Gemini requests by default, one per preliminary story | Deployed Gemini adapter analyzed four approved articles in the October 16 manual test |
| Art-direction planning | One Gemini request by default per edition | Deployed Gemini adapter produced one private proposal; Bedrock Nova and Vertex Claude remain optional |
| Nano Banana panorama | One final image generation, followed by private 8K processing | One gated AWS technical edition completed both stages |
| Landmark analysis | One multimodal analysis of the final panorama | One gated AWS technical edition detected four story landmarks and one echo |
| World Labs Marble | One world generation | One gated AWS technical edition produced a Marble 1.1 SPZ |
| Interaction baking | One private headless browser run with Spark.js | The integrated AWS edition baked four story anchors and one echo |
| AWS orchestration and delivery | Step Functions, Lambda, S3, DynamoDB, CloudFront, and CloudWatch usage | Development daily schedule now invokes the full paid workflow |
| Public websites | Two private S3 origins, two CloudFront distributions, DNS queries, certificates, storage, and transfer | Marketing site and explorer deployed for testing |

These counts are targets, not a fixed daily bill. Provider retries should remain
limited and visible.
The candidate evaluator records its aggregate request count and usage;
if a batch fails before the immutable artifact is written, a manual retry can
repeat prior batches and incur additional charges. The text route was deployed
and paid-tested on October 16. See the [data boundary](DATA_BOUNDARY.md).
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
Monthly provider totals, AWS cost tags, CloudWatch dashboards, and AWS Budgets
alerts remain to be added. These are visibility and alerting tools, not current
pipeline authorization gates.

The development CDK stack defaults the daily schedule to disabled and only adds an
AWS Budget when both a monthly threshold and notification email are explicitly
provided. Workflow alarms notify an operator only when an optional alarm email
is configured and its AWS subscription is confirmed. The reference development
stack has been deployed without an AWS Budget or alarm email; its daily paid
pipeline schedule is enabled. Monitor charges in the AWS, Google, and World Labs
accounts; there is no automatic spending cutoff.

The October 19 catch-up edition published one story after a failed article-
analysis response and a failed art-direction response required bounded paid
retries. Provider charges for that run are not yet reconciled. The automation
is operational, but low editorial yield and retries can make the cost per
published story high.

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
pricing, access tiers, and billing units can change. A dated price table and
reconciled per-edition costs are still missing even though development automation
is enabled.

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

On October 16, the deployed Gemini route evaluated 46 candidates from 17 feeds,
shortlisted and analyzed four approved articles, and created one private art
direction proposal. Its successful immutable artifacts report 5 candidate
requests (28,643 total tokens), 4 article requests (9,484), and 1 art-direction
request (3,976): **42,103 provider-reported total tokens across 10 requests**.
An earlier malformed candidate response failed before an artifact was written;
diagnostic replay calls also incurred usage. Those additional attempts are not
included in the artifact total, which is not a verified billing amount. The
same edition subsequently produced one Nano Banana source, one processed 8K
panorama, one Marble 1.1 SPZ, and one landmark request. It was served as a
direct technical-test preview without advancing `generated/current.json`.
Provider billing for those generation requests has not yet been reconciled;
the daily schedule stayed disabled.
