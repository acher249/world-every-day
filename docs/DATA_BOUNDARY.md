# Source data and model boundary

The reference pipeline uses **AWS-managed inference with Amazon Nova on Amazon
Bedrock** for source-bearing text analysis. It is not self-hosted or an isolated
model running in the operator's account: AWS receives and processes the prompts.
AWS says Bedrock model providers cannot access the Bedrock-managed deployment
accounts, prompts, or completions, and that Bedrock inputs and outputs are not
used to train base models. Choosing an Amazon-operated model also avoids
selecting a separate third-party model provider for these stages. This is an
AWS trust boundary, not a promise that information is never sent to AWS.

| Stage | Information sent | Recipient or storage |
| --- | --- | --- |
| RSS/Atom discovery | Public feed entries and metadata | Project collector; bounded candidate metadata is stored privately in S3 |
| Candidate evaluation | Titles, publishers, dates, and source types, not article bodies | Amazon Nova through Bedrock |
| Permitted article analysis | Bounded article text, only after source-policy and shortlist checks | Amazon Nova through Bedrock; raw text is discarded by this project |
| Art direction | Project-written story summaries and compact source-grounded visual details, not article pages or quotations | Amazon Nova through Bedrock |
| Panorama generation | An original visual scene prompt derived from the art direction; it may contain story-derived physical details, but no source pages or evidence excerpts | Google Nano Banana |
| Landmark detection | The generated panorama and art-direction subjects | Google vision adapter |
| World generation | The generated image | World Labs Marble |
| Publication | Project-written summaries, source links, interaction metadata, and licensed generated assets | Public website and archive |

The source-bearing text adapters accept only the pinned Amazon Nova model. The
AWS text workers have Bedrock model permission and no Google secret access.
These code and IAM restrictions prevent accidentally routing source metadata
or article text to Google through the reference text stages. The provider-neutral
interfaces can be replaced, but a replacement must receive a new source-policy
and privacy review before live use. Public source links and original summaries
are intentionally retained; raw feed and article bodies are not published or
persisted by this project.

"Ephemeral" describes this project's handling of raw article text. It does
**not** establish zero retention by AWS. Bedrock account/Region data-retention
mode, model requirements, and model-invocation logging must be checked before
live use. AWS documents that an unconfigured `inherit` mode falls back to the
model default, while `none` is its zero-durable-retention mode; invocation
logging can separately record complete prompts and outputs. An operator who
requires no hosted processing must use a separately reviewed local or
self-hosted model adapter. See the
[AWS deployment preflight](../infra/aws/README.md#source-text-privacy-preflight).

This is the boundary in the current repository code, **not yet in the deployed
development workers**. Earlier development executions sent source metadata,
permitted article text, and art-direction inputs to Google. Existing immutable
artifacts retain that provenance. Do not invoke those deployed text workers
under the new policy; deploy and verify the updated stack, then start a fresh
edition. The new Bedrock route has not yet passed a paid live test.

AWS documentation: [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html),
[security and privacy](https://aws.amazon.com/bedrock/security-privacy-responsible-ai/),
[data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html),
and [model-invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html).
