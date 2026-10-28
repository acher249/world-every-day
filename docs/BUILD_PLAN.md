# Build plan

This is the current roadmap for A World Every Day, not a deployment log.

## What works

- Optional post-publication X Lambda with public availability checks, account
  verification, and duplicate-send protection. Disabled by default; operators
  verify their account and write permissions before activation. See [setup](DAILY_X_POSTS.md).

- A full-viewport desktop and mobile explorer with story landmarks, source
  links, past worlds, audio, and bounded camera navigation.
- A separate static marketing site and a credential-free fictional demo.
- RSS/Atom discovery from 32 reviewed feeds, bounded editorial selection,
  ephemeral article analysis, and original summaries with source links.
- Paid Gemini editorial analysis, with Amazon Bedrock Nova as an optional
  adapter. Neither route is self-hosted; see the [data boundary](DATA_BOUNDARY.md).
- Nano Banana panorama generation, masked pole repair, and 8K delivery enlargement, followed by
  Marble 1.1 world generation.
- Gemini landmark detection, image-space bounding boxes, checksum-bound
  Spark.js raycast baking, and bounds-driven viewer focus effects. Unlocated
  stories are omitted from the public story list; the world can publish with
  any positive number of validated story anchors.
- An opt-in AWS workflow through public publication, with manual review or
  recorded automated decisions, immutable artifacts, and resumable stages.
- A 7:30 AM Pacific schedule in the reference development deployment. Fresh
  deployments leave the schedule disabled. Failed runs preserve the last world.
- Fixture tests, license checks, secret scanning, and CI across all packages.

These are implemented capabilities, not guarantees of daily story yield,
editorial quality, provider availability, or performance on every device.

## Repository boundaries

| Directory | Responsibility |
| --- | --- |
| `frontend/` | Interactive world explorer |
| `marketing/` | Static project site |
| `pipeline/` | Discovery, editorial, generation, baking, and publication stages |
| `infra/aws/` | Reference AWS infrastructure and deployment configuration |
| `docs/` | Product direction, source policy, architecture, and operations |

Keep providers behind small interfaces and add abstractions only when a working
feature needs them. Avoid speculative packages or duplicate configuration.

## Pipeline

```text
Discover → Select → Analyze → Compose → Generate image → Generate world
         → Detect landmarks → Bake interactions → Validate → Publish
```

Artifacts retain edition IDs, schema versions, input checksums, provider/model
identifiers, and source provenance. Large assets live in object storage; raw
article bodies are processed in memory and discarded. Model-provider handling
is separate from this project's storage policy.

Paid stages and public publication require explicit operator authorization.
Unattended mode records automated decisions; it must never claim human approval.
Resume completed stages rather than repeating paid requests, and never promote
incomplete assets to the current-world pointer.

## Next phases

The optional [World Guide phase plan](WORLD_GUIDE.md) covers natural-language
voice navigation, ephemeral research, privacy configuration, and a disabled
public UI. It is planned work, separate from daily generation and publication.

### 1. Establish reliable daily editions

- Monitor scheduled runs, feed failures, story yield, retries, and provider cost.
- Review composition, citations, landmark placement, and source diversity.
- Target ten substantive stories without filling the quota with weak items.
- Verify several consecutive editions before describing the system as reliable.

### 2. Harden the public experience

- Exercise desktop, touch, keyboard, reduced motion, and fallback states.
- Add repeatable browser interaction tests, including panel framing and mobile
  navigation, alongside existing unit tests.
- Measure load time, frame-time variance, and memory on representative phones.
- Extract focused camera/effect utilities without changing the viewer's behavior.

### 3. Improve editorial operations

- Add documented correction and withdrawal workflows with an audit trail.
- Track source health and re-review access and reuse terms periodically.
- Improve event deduplication and corroboration where daily review shows gaps.
- Reconcile recorded usage with actual invoices and keep estimates transparent.

### 4. Make independent deployment repeatable

- Validate setup from a clean clone and a fresh AWS account.
- Verify least-privilege permissions, alarms, recovery, and schedule opt-in.
- Test optional Bedrock configuration independently from the Gemini default.
- Document safe teardown and preservation of published assets.

## Release criteria

- A contributor can run the fictional demo without credentials or paid services.
- Repeated daily runs publish navigable worlds with correct citations and anchors.
- Failed runs and retries do not replace a valid world or duplicate paid work.
- Keyboard and touch visitors can reach the same stories and source links.
- Credentials and private source text do not appear in Git or public artifacts.
- Dependency and asset provenance is documented; source inclusion is not
  represented as blanket legal clearance.
- Setup, costs, limitations, and recovery instructions match the implementation.

## Optional research directions

The optional video workflow renders ten-second world tours in concurrent Lambda
batches, adds ambient audio, archives validated MP4/WebM videos in S3, and can
attach the MP4 to an X announcement after publication. Batching keeps individual
render calls within Lambda's invocation timeout.
See the [video workflow](VIDEO_GENERATION.md). This branch is opt-in and disabled
for new deployments. X video delivery also requires a user grant with `media.write`.

Additional world models, narrated tours, multiple editorial lenses, linked worlds,
personal information collections, and richer semantic 3D regions remain future
experiments, not dependencies of the daily workflow.

See [art direction](ART_DIRECTION.md), [source policy](editorial-policy/SOURCES.md),
[costs](COSTS.md), the [pipeline guide](../pipeline/README.md), and the
[AWS guide](../infra/aws/README.md) for their respective contracts.
