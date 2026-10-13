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
| Candidate evaluation | One bounded model batch per edition | Optional adapter available; not live-validated |
| Article analysis | Up to 15 model requests, one per preliminary story | Optional adapter available; not live-validated |
| Art-direction planning | One bounded model request per edition | Optional adapter available; not live-validated |
| Nano Banana panorama | One final image generation | Optional adapter available |
| Landmark analysis | One multimodal analysis of the final panorama | Optional adapter available |
| World Labs Marble | One world generation | Optional adapter available |
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
