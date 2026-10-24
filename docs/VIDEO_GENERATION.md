# World video generation

The optional branch is deployed and enabled in the reference installation.
New deployments leave it disabled by default. Rendering, music, encoding,
archival, and X video delivery have been verified against published worlds.
The reference account is authorized with `media.write`. Video archival does
not depend on X accepting the upload.

## Enable in your deployment

Prerequisites: a published world with baked interactions, a built `frontend/out/`,
Docker for Lambda packaging, and the existing artifact/public-asset buckets.
This stage does not call Gemini or World Labs or require their credentials.

For automatic daily videos, configure the verified X account and credentials
using the [X setup guide](DAILY_X_POSTS.md), then set
`WORLD_EVERY_DAY_X_VIDEO_ENABLED=true` in `infra/aws/.env.local` and deploy the
main stack. New deployments default to disabled. The main video branch is tied
to X delivery; standalone rendering without posting uses the separate test stack
below. Keep the normal [daily schedule](AWS_WORKFLOW.md#schedule-and-authorization)
configuration when redeploying.

Build the capture frontend before deployment. Each job pins that private build,
so a later website deployment cannot change a video already being rendered.
CDK does not upload the public marketing or explorer sites as part of this step.
See the [deployment guide](../infra/aws/README.md) for that separate operation.

## Architecture

```text
Published world
  → checksum-bound video job
  → 30 batches × 10 frames (up to 10 concurrent Lambda workers)
  → S3 frames and batch receipts
  → assembly Lambda: ambient audio + MP4/WebM + validation
  → archived files and completed video manifest
  → X media upload → processing check → post → receipt
```

The world is available immediately after publication. Video and social failures
leave it available. Step Functions waits for each worker result; workers are
concurrent but not fire-and-forget. No fixed 23-minute delay is assumed.

## Browser rendering

The production renderer captures the actual explorer at 1280 × 720, including
hotspots, the story sidebar, focus shader, camera float, and adaptive depth of
field. It verifies the SPZ checksum, uses pixel ratio one, and waits for sorting
before reading each frame. CDK archives the static frontend privately; each job
pins its build hash so deployments cannot change an in-progress video.
Bundled OFL-licensed Noto fonts provide serif and symbol fallbacks on Lambda.
The separate UI-free `/capture/` route remains available for benchmarks.

Render workers use 3,008 MB and software rendering. Batches keep each invocation
within Lambda's 15-minute limit. Available memory and concurrency depend on the
AWS account quotas; see
[AWS limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

## Batched motion

One controlled clock drives all 300 frames at `frame / 30`. The tour starts
looking slightly down and selects four spatially ordered stories at 1, 3, 5,
and 7 seconds. Capture-only moves take 1.5 seconds. Each worker replays the cheap
UI/camera steps from zero, rendering only its assigned frames. Every batch uses the same timeline, including camera and UI state.

Each worker handles ten frames and saves them individually. Retries skip existing
frames; a batch receipt records their hashes and order. A completed video skips
the batch stage. A new world/publication checksum creates a different job.
Only one render execution per edition should be started at a time.

The reference account has ten shared concurrency slots. Competing Lambda work
may throttle workers and increase elapsed time; throttles back off and retry.
See [costs](COSTS.md) for measured runtime and operating estimates.

## Music and encoding

Each new video selects one of five approved ten-second stereo
scores: Sunlit Chimes, Soft Orbit, Glass Garden, Tidal Glow, or Night Bloom.
The choice is pseudorandom from the edition ID and world checksum and is saved
in the job and completed manifest. Retries keep the same score; consecutive
worlds may occasionally choose the same one. Each score has opening/closing
fades and uses original synthesis, with no third-party audio recordings.
New jobs use `tour-v3`, including the frozen capture-build hash; archived
`tour-v1` and `tour-v2` manifests remain readable.

The assembly Lambda produces H.264/AAC MP4 for X, VP9/Opus WebM for the archive,
and a PNG poster. It checks input frame hashes/order, output codecs, 1280 × 720
dimensions, 300 frames, 30 fps, ten-second duration, and audio presence, then
decodes the whole output to catch corruption. Both formats must pass.

The reproducible container builds FFmpeg with GPL and nonfree features disabled.
It uses OpenH264 instead of libx264 and retains source archives and notices.
See [third-party notices](../THIRD_PARTY_NOTICES.md#optional-video-encoder).

## Archive and recovery

Raw jobs, frames, and receipts use private `video-work/<edition>/<job>/` keys.
The main stack expires this working data after seven days, including older object
versions. Completed MP4/WebM/poster files live under
`generated/editions/<edition>/video/<job>/` in the public asset bucket; they are
retained for future archive interfaces. The completed manifest is written last,
with a matching private record under `videos/<edition>/<job>/manifest.json`.

The publication manifest and current-world pointer are not rewritten to add a
video. Retrying a job reuses its immutable results. Changing render behavior
requires a `VIDEO_VERSION` bump so old outputs cannot masquerade as new renders.
Resume failed executions or rerun the same edition; do not delete successful
frames to recover a single failed batch. Concurrent duplicate jobs are not a
supported operational mode.

## X delivery

The optional X worker uploads the MP4 in chunks, polls processing status, and
attaches the completed media to the post. Upload receipts are reused while valid. The worker verifies the
account and published edition; media failures occur before the post claim.
A conditional claim still prevents blindly retrying an ambiguous post request.
An expiring S3 lock serializes credential refreshes. OAuth 2.0 needs `media.write`
in addition to the text-posting scopes; changing portal settings alone does not
add scopes to existing tokens. See [daily X configuration](DAILY_X_POSTS.md).

## Validation

- Run package tests, typechecks, builds, license checks, and the root secret scan.
- Verify a complete live render, inspect video/audio and batch boundaries, and
  record elapsed time and billed compute before declaring it production-ready.
- Verify X media access and a complete video post without duplicating an existing
  historical announcement. An enabled branch cannot deliver until the token has media access.
- Build `frontend/`; CDK packages its private capture build. Then enable both
  `WORLD_EVERY_DAY_X_ACCOUNT_ID` and `WORLD_EVERY_DAY_X_VIDEO_ENABLED=true` in the
  gitignored infrastructure configuration. Never put token values there.
- Confirm the next daily run publishes first, then completes its optional branch.

## Manual testing

### UI tour (shared local and AWS renderer)

The tour records the actual explorer, including hotspots, the right
story panel, focus shader, camera float, and adaptive depth of field. It opens
with a downward tilt, then selects four spatially ordered stories at 1, 3, 5,
and 7 seconds. Capture-only moves take 1.5 seconds, leaving a half-second pause.
The normal viewer's navigation speed is unchanged.

After building `frontend/`, run from `pipeline/` with a downloaded publication
manifest, its matching SPZ, installed Chrome, and a local FFmpeg with H.264/AAC:

```bash
node --import tsx src/video/ui-tour-probe.ts ../frontend/out \
  /tmp/publication.json /tmp/world.spz /tmp/ui-tour \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

This writes 300 PNG frames and `ui-tour.mp4` with procedural ambient music.
It uses a controlled animation clock and a loopback-only capture hook. The local command does not deploy anything or post to X. AWS workers use the
same renderer with ten-frame ranges. The local FFmpeg executable is not bundled
or redistributed.

Five original ambient music options can be auditioned against that tour:

```bash
node --import tsx src/video/music-options-cli.ts /tmp/music-options /tmp/ui-tour/ui-tour.mp4
```

Open `/tmp/music-options/index.html` for 20-second audio samples and ten-second
video comparisons. These locally synthesized tracks use no third-party samples
or paid service. All five are approved for randomized selection in new videos.
Deploy implementation changes before expecting the daily workflow to use them.

### UI-free capture

For one local frame, build `frontend/`, then run from `pipeline/`:

```bash
node --import tsx src/video/frame-probe.ts \
  ../frontend/out /absolute/path/world.spz /tmp/world-frame.png \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Use the installed Chrome path appropriate to your platform. The local runner
serves only the static capture build and the checked world over loopback.

The separate test stack deploys a private capture build and video workflow,
without changing the daily stack or sending posts:

```bash
cd infra/aws
export WORLD_VIDEO_ARTIFACT_BUCKET=your-existing-artifact-bucket
export WORLD_VIDEO_PUBLIC_ASSET_BUCKET=your-existing-public-asset-bucket
npx cdk deploy --app 'node --import tsx bin/video-probe.ts' \
  --output cdk.out-video-probe --profile your-profile
```

Start the output `VideoStateMachineArn` with a real published edition:

```json
{
  "editionId": "your-edition",
  "publication": {
    "status": "published",
    "key": "generated/editions/your-edition/publication.json"
  }
}
```

This test writes real archive video assets and incurs rendering costs, but does
not regenerate a world or post to X. The separate single-frame probe remains
available; use one or three frames rather than a long single-invocation capture.
See [costs](COSTS.md) for estimates and measured limits.

For several missing historical videos, the test stack also outputs
`VideoBackfillStateMachineArn`. Start it with `{"editions": [<the inputs above>]}`.
It processes one edition at a time, preserving the ten-worker limit within each
video. Omit worlds whose completed video you want to reuse. This durable queue
does not post; send approved video announcements through the delivery worker
after rendering and account authorization succeed.

## Implementation map

| File | Responsibility |
| --- | --- |
| [`video-workflow.ts`](../infra/aws/lib/video-workflow.ts) | Shared Lambda stages, IAM, concurrency, and retries |
| [`job.ts`](../pipeline/src/video/job.ts) | Validated job identity, dimensions, and frame batches |
| [`prepare-handler.ts`](../pipeline/src/video/prepare-handler.ts) | Bind publication, world, soundtrack, and capture build |
| [`capture-ui.ts`](../pipeline/src/video/capture-ui.ts) | Private browser and deterministic UI timeline |
| [`batch-handler.ts`](../pipeline/src/video/batch-handler.ts) | Render and save resumable frame batches |
| [`music-options.ts`](../pipeline/src/video/music-options.ts) | Original procedural music and stable random selection |
| [`assemble-handler.ts`](../pipeline/src/video/assemble-handler.ts) | Encode, validate, and archive the completed video |
| [`encoder/`](../pipeline/src/video/encoder/) | Reproducible native codec container and retained license/source files |

Run the pipeline and infrastructure checks described in
[Contributing](../CONTRIBUTING.md#development). Capture changes also require the
frontend checks. Automated tests use fixtures; live rendering is an explicitly
requested operation with AWS costs.
