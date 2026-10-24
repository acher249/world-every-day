# Developer documentation

Start with the [credential-free demo](../README.md#quick-start), then choose
the part of the system you want to work on. Live generation, deployment, and
social posting are separate opt-in operations.

| Guide | What it covers |
| --- | --- |
| [Pipeline](../pipeline/README.md) | Local setup, fictional end-to-end run, discovery, editorial analysis, world generation, and baking |
| [360 image generation](PANORAMA_GENERATION.md) | Prompt inputs, projection, image processing, artifacts, and local commands |
| [AWS workflow](AWS_WORKFLOW.md) | State machines, daily schedule, stage flags, publication, and recovery |
| [Video generation](WORLD_VIDEO_PLAN.md) | Batched rendering, music, encoding, S3 archival, and manual testing |
| [Automated X posting](DAILY_X_POSTS.md) | App authorization, credentials, activation, video delivery, and troubleshooting |
| [AWS deployment](../infra/aws/README.md) | Account configuration, infrastructure, domains, secrets, and alarms |
| [Contributing](../CONTRIBUTING.md) | Package checks and contribution expectations |

## Project boundaries

| Directory | Responsibility |
| --- | --- |
| `frontend/` | Interactive explorer; no provider credentials |
| `marketing/` | Static project site and latest-post embed |
| `pipeline/` | Server-side generation and delivery stages |
| `infra/aws/` | Optional AWS CDK deployment and orchestration |

Use [source policy](editorial-policy/SOURCES.md), [data handling](DATA_BOUNDARY.md),
[licensing](LICENSING.md), and [third-party notices](../THIRD_PARTY_NOTICES.md)
when changing inputs or providers. See [art direction](ART_DIRECTION.md) for
visual intent, [costs](COSTS.md) for operating estimates, and the
[build plan](BUILD_PLAN.md) for remaining work.

Local server credentials belong in ignored `pipeline/.env`; non-secret deployment
settings belong in ignored `infra/aws/.env.local`. AWS workers read credentials
from Secrets Manager. Updating a local file does not update a deployed worker.
