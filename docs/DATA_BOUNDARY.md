# Source data and model boundary

The AWS pipeline defaults to the **paid Gemini API** for source-bearing text
analysis, using the same server-side Google key as image generation. Amazon
Nova on Bedrock and Claude on Google Cloud Vertex AI remain optional. All are
managed inference: the selected cloud operator processes prompts. For a Gemini
API key tied to a project with active billing, Google's Paid Services terms say
prompts and responses are not used to improve its products. This is not
self-hosting or a promise of zero provider retention.

| Stage | Information sent | Recipient or storage |
| --- | --- | --- |
| RSS/Atom discovery | Public feed entries and metadata | Project collector; bounded candidate metadata is stored privately in S3 |
| Candidate evaluation | Titles, publishers, dates, and source types, not article bodies | Selected Gemini, Bedrock, or Vertex adapter |
| Permitted article analysis | Bounded article text, only after source-policy and shortlist checks | Selected Gemini, Bedrock, or Vertex adapter; raw text is discarded by this project |
| Art direction | Project-written story summaries and compact source-grounded visual details, not article pages or quotations | Selected Gemini, Bedrock, or Vertex adapter |
| Panorama generation | An original visual scene prompt derived from the art direction; it may contain story-derived physical details, but no source pages or evidence excerpts | Google Nano Banana |
| Landmark detection | The generated panorama and art-direction subjects | Google vision adapter |
| World generation | The generated image | World Labs Marble |
| Publication | Project-written summaries, source links, interaction metadata, and licensed generated assets | Public website and archive |

The provider is explicit, with no automatic fallback. Gemini uses an API key
read from AWS Secrets Manager at runtime, never a browser or Lambda environment
variable. Bedrock accepts only the pinned Amazon Nova model; Vertex accepts
only Claude through keyless AWS-to-Google workload identity federation. The
text workers get Google-secret access only when Gemini is selected and Bedrock
inference permission only when Bedrock is selected. Public source links and
original summaries are retained; raw article bodies are not published or
persisted by this project.

"Ephemeral" describes this project's handling of raw article text. It does
**not** establish zero retention by Google or AWS. Google's Paid Services terms
permit limited abuse-monitoring logs; the Gemini editorial adapter does not
enable tools, grounding, or caching. Check Bedrock retention and invocation
logging, or Vertex abuse monitoring and optional request/response logging,
before using those alternatives. An operator who requires no hosted processing
needs a separately reviewed local or self-hosted model. See the
[AWS deployment preflight](../infra/aws/README.md#source-text-privacy-preflight).

This boundary is deployed in the development workers. A manual October 16 AWS
run evaluated feed metadata, analyzed four approved articles, and proposed art
direction without persisting raw article bodies. Earlier artifacts retain their
own provider and source-policy provenance; do not reuse them as evidence of the
current configuration.

Google documentation: [Gemini API Paid Services terms](https://ai.google.dev/gemini-api/terms)
and [data-retention guidance](https://ai.google.dev/gemini-api/docs/zdr).

AWS documentation: [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html),
[security and privacy](https://aws.amazon.com/bedrock/security-privacy-responsible-ai/),
[data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html),
and [model-invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html).
For Vertex, see [Google's managed-model data policy](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention)
and [Anthropic's Vertex terms](https://www-cdn.anthropic.com/471bd07290603ee509a5ea0d5ccf131ea5897232/anthropic-vertex-commercial-terms-march-2024.pdf).
