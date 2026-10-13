# Costs and usage

**Status:** Planning guidance, last reviewed October 13, 2026.

A World Every Day is designed to make the cost of a daily edition understandable
before it is automated. The project does not currently reserve spend or enforce
an automatic budget. Paid adapters are optional, tests and dry runs use fixtures,
and live provider calls require deliberate operator action.

## Where spend can occur

| Stage | Expected baseline | Current status |
| --- | ---: | --- |
| Feed discovery and article retrieval | Network and cloud runtime only | Local implementation available |
| Candidate evaluation | One bounded model batch per edition | Live-validated |
| Article analysis | Up to 15 model requests, one per preliminary story | Live-validated |
| Art-direction planning | One bounded model request per edition | Live-validated |
| Nano Banana panorama | One final image generation | Live-validated |
| Landmark analysis | One multimodal analysis of the final panorama | Live-validated |
| World Labs Marble | One world generation | Live-validated with Marble 1.1 |
| AWS orchestration and delivery | Step Functions, Lambda, S3, DynamoDB, CloudFront, and CloudWatch usage | Planned |

These counts are targets for the first complete pipeline, not a description of
an already deployed system. Provider retries should remain limited and visible.
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

## Keeping the baseline small

- Run fixture-backed tests and dry runs without credentials.
- Use free, deterministic filtering and deduplication before model analysis.
- Limit the amount of article text sent for article analysis.
- Prefer a single final panorama and world over generating speculative variants.
- Avoid unbounded automatic retries, especially for image and world generation.
- Recheck official pricing and quotas before the first deployment and whenever a
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

Article analysis used 12 requests for ten final stories because two incorrect
page-container extractions were rejected and reprocessed after the extractor was
fixed. Candidate evaluation also had provider-rejected compatibility attempts
and one locally rejected response before the successful artifact; those attempts
did not return usage metadata and could still affect billing. This is evidence
that attempt counts must be recorded even when validation prevents an artifact
from being written.
