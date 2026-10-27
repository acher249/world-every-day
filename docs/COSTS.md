# Costs

Pricing checked October 23, 2026. USD; estimates exclude taxes.

The baseline estimates below predate the two-call panorama workflow. Pole repair
adds one 4K image request, image-input tokens, and Lambda processing per world;
add those charges to the totals below. The 8K enlargement itself is still local.
Repair receipts record usage so this increment can be reconciled after a live run.

**With the optional video and X post enabled, budget about $2.40–$3.10 per
day ($72–$93 per 30 days).** With prepaid World Labs credits, the corresponding
additional spend is about **$1.20–$1.90 per day ($36–$57 per 30 days)**.
This is a planning budget, not a spending cap or an invoice total; media-upload
charges still need reconciliation in the X console.

## World generation

One successful daily world is estimated to cost **$1.50–$1.90 in services**, or
**$45–$57 over 30 days**, at October 2026 prices. This assumes one image, one
Marble 1.1 world, no paid retries, and modest traffic. It is an estimate, not a
reconciled bill.

If World Labs credits are already prepaid, the **additional cash spend is
roughly $0.30–$0.70 per day** ($9–$21 over 30 days). Each world still uses
1,500 credits; prepaid credits are a real cost, not a free service.

| Daily component | Estimate | What it covers |
| --- | ---: | --- |
| Editorial analysis | $0.10–$0.30 | Story selection, article analysis, and art direction with Gemini |
| Image and landmark analysis | $0.13–$0.25 | One Nano Banana image and one landmark-detection request |
| Marble 1.1 | $1.20 | One world, using 1,500 World Labs credits |
| AWS | $0.04–$0.10 | Workflow, storage, secrets, DNS, and low-traffic hosting |

These are planning ranges based on [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing),
[World Labs pricing](https://docs.worldlabs.ai/api/pricing), and AWS pricing for
[Lambda](https://aws.amazon.com/lambda/pricing/),
[Step Functions](https://aws.amazon.com/step-functions/pricing/),
[Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), and
[Route 53](https://aws.amazon.com/route53/pricing/). The image's 8K enlargement
is local processing, not a second generation request. Browser audio costs no
per-play fee. For the configured `gemini-3.8-flash`, standard input is $0.75 per million
tokens and output (including thinking) is $3.75 per million. The editorial
range is an allowance, not a measured daily token total. Nano Banana 2.1
4K image output is approximately $0.113, plus input and text/thinking tokens;
landmark analysis is a separate text-model request. Marble pano input uses
1,500 credits at 1,250 credits per dollar, or $1.20. These are standard API
rates, not batch discounts or consumer subscriptions. Gemini text-model rates are scheduled to change on January 1,
2027, so revisit this estimate then.

## What can increase the bill

- **Optional world videos:** Not included above. A ten-second, 720p, 30 fps
  tour uses 30 batches of ten frames, with up to ten Lambda workers at once.
  At the initial measured rate of 47 seconds per frame and 3,008 MB per worker,
  budget roughly **$0.70–$0.90 per video** before retries and transfer. Concurrency
  reduces waiting time, not total compute cost. The estimate includes room for
  startup and encoding; actual cost depends on scene complexity.
  A complete UI tour used about **$0.57 in render compute** and finished in
  approximately 23 minutes; encoding costs under $0.01. This is measured usage priced at published rates,
  not an invoice reconciliation. At 3,008 MB, render compute is
  `billed seconds × (3008 / 1024) × $0.0000166667` in us-east-1.
  For comparison, 300 frames × 47 seconds is about $0.69 before startup.
  Four GiB of temporary disk adds about $0.0015 at that duration (the first
  512 MiB is free); requests and encoding add little. AWS free-tier credits
  are not deducted here because they are shared with other account workloads. Temporary
  frames expire after seven days; final videos remain in the archive.
  See the [video guide](VIDEO_GENERATION.md) and
  [Lambda pricing](https://aws.amazon.com/lambda/pricing/).

- **Optional X posts:** Not included above. URL-bearing posts are currently
  listed at $0.20 each (about $6 for 30 posts), plus account lookup, media operations, and small
  AWS secret/Lambda costs. Allow **$0.20–$0.30 per post** for planning. The
  public table does not separately price every chunked-upload and polling
  operation used here, so this allowance is not a verified all-in media tariff.
  Check actual credit deductions in the X console; do not assume uploads are free. Check [X pricing](https://docs.x.com/x-api/getting-started/pricing)
  before enabling [daily posting](DAILY_X_POSTS.md). No extra model call is used.

- **Retries and extra worlds:** A failed run can still incur model charges.
  Each additional Marble world uses another 1,500 credits, about $1.20 at the
  cited rate.
- **Visitors:** The current 3D asset is about 29 MiB per full load. At 1,000
  full loads per day, that is roughly 0.9 TB of transfer per month before other
  page assets. CloudFront's [pay-as-you-go plan](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
  includes 1 TB of monthly transfer and 10 million requests; charges apply
  beyond the account-wide allowance; other projects can consume it too. The larger panorama poster is loaded only as a fallback.
- **AWS usage:** Logs, S3 storage and versions, container images in ECR,
  DynamoDB, alarms, requests, and transfer vary with retention, traffic, and
  retries. The $0.04–$0.10 base AWS allowance is approximate and can grow as
  the archive grows. It is not a line-item bill reconciliation. Domain
  registration and development/backfill runs are excluded. The sites are
  static and do not need always-on servers. See [S3](https://aws.amazon.com/s3/pricing/),
  [ECR](https://aws.amazon.com/ecr/pricing/), and
  [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) pricing.

The deployed development schedule currently permits paid generation and public
publication. **There is no automatic spending cutoff.** The reference stack has
no AWS Budget or alarm email configured; operators should watch AWS, Google,
and World Labs billing. Budget alerts can be configured but do not stop a run.

The cloud World Labs stage can make up to four paid submissions (three retries) for an edition
after explicit transient generation failures. The normal daily estimate assumes
one submission; failed-attempt charges or refunds depend on provider billing.
See [retry behavior](AWS_WORKFLOW.md#failures-and-recovery).

The pipeline records request and usage data where providers return it, but
per-edition charges have not yet been reconciled against invoices. Fixture
tests and dry runs do not call paid services. Prices and free allowances may
change; check the linked provider pages before relying on these estimates.
