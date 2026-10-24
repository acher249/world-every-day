# Automated X posting

An optional Lambda announces a world only after public publication is verified.
It posts the edition date, permanent world link, one or two complete story
headlines, and a project link. With video enabled, it waits for the archived
MP4 and attaches it. Preview publications do not trigger delivery.

Dated worlds use clean `/?edition=YYYY-MM-DD` links. Deploy the date-aware
explorer before updating the posting worker. Existing full-ID links remain
supported; no archived assets or previously posted tweets need to be rewritten.

Posting is disabled by default. X is an optional proprietary service with
separate API charges; see [costs](COSTS.md). The deployment and execution sequence
are covered in the [AWS workflow guide](AWS_WORKFLOW.md).

## 1. Configure an X app

Create an app in the X developer console and enable **Read and write** access.
Under **User authentication settings**, choose **Web App, Automated App or Bot**
(a confidential client). Fund the app's API credits before live tests.

Keep the public project address in **Website URL**. Register your authorization
handler's exact address under **Callback URI / Redirect URL**; these are different
fields. A local setup can use `http://127.0.0.1:8787/callback` with a handler
listening there. If you have multiple apps, verify the Client ID belongs to the
app whose callback you configured.

## 2. Authorize the publishing account

Use the [authorization-code flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
and request these scopes explicitly:

```text
tweet.read tweet.write users.read media.write offline.access
```

The portal's token generator may omit `media.write`; regenerating a token there
does not establish media access. An OAuth helper must create a random state and
PKCE verifier, request authorization with an S256 challenge, validate the returned
state, and immediately exchange the code using the same redirect URL and verifier.
See [X's media authorization example](https://github.com/xdevplatform/samples/blob/main/python/media/media_upload_v2.py).
The repository's delivery worker consumes tokens; it does not host an interactive
OAuth callback service.

Approve as the account that will publish. Check the returned grant includes
`media.write` and `offline.access`; the latter supplies the refresh token for
unattended operation. Never paste tokens or callback codes into issues or logs.

## 3. Store credentials

Local credentials belong only in ignored `pipeline/.env`:

```dotenv
X_CLIENT_ID=
X_CLIENT_SECRET=
X_OAUTH2_ACCESS_TOKEN=
X_REFRESH_TOKEN=
```

For AWS, store a JSON object with these four keys and their authorized values in
Secrets Manager at `world-every-day/<environmentName>/x`. Updating a local `.env`
does not update the cloud secret. Do not put values in shell commands, CDK
configuration, frontend variables, or committed files.

OAuth 2.0 is required by this implementation for video upload. OAuth 1.0a remains
an alternative for text-only posting using the fields in
[`pipeline/.env.example`](../pipeline/.env.example). Never mix token types;
the app-only bearer token is not used.

When account verification returns an expired-token response, the worker refreshes
once and persists the rotated pair to Secrets Manager before continuing. An
expiring S3 lock serializes workers. Do not run a local worker against the same
secret concurrently, or overwrite rotated cloud tokens with an older local pair.
Posting itself is never automatically retried.

## 4. Enable delivery

Verify the publishing account with `GET /2/users/me` and use its numeric ID,
not its handle. Set these non-secret values in `infra/aws/.env.local`:

```dotenv
WORLD_EVERY_DAY_X_ACCOUNT_ID=your-numeric-account-id
WORLD_EVERY_DAY_X_VIDEO_ENABLED=true
```

Leave the account ID blank and redeploy to disable posting. Set the video flag
to `false` for text-only delivery. Before deploying video support, build
`frontend/`; CDK packages a private capture build. Follow the
[AWS deployment guide](../infra/aws/README.md) and review the CDK diff.

Activation applies to subsequent full public runs, including manual runs. It
does not backfill older worlds. Scheduling is a separate setting. See
[video generation](VIDEO_GENERATION.md) for rendering, music, and archival.

## 5. Verify a post

The format is:

```text
<edition date>

Today’s World: <permanent edition URL>

<one or two complete story headlines>

Learn more: <project URL>
```

The worker checks public availability and the configured account, validates video
identity and hashes, uploads the MP4 in chunks, waits for X processing, claims the
post, and records its receipt. It never posts an unfinished video. Normal daily
execution supplies the publication and video references automatically.

For a deliberately requested historical video announcement, invoke the deployed
`DailyXPostHandler` Lambda with this input. This **publishes a real post**:

```json
{
  "editionId": "your-edition",
  "announcement": "video",
  "publication": {
    "status": "published",
    "key": "generated/editions/your-edition/publication.json"
  },
  "video": {
    "status": "ready",
    "editionId": "your-edition",
    "jobId": "<64-character job ID from the completed video manifest>"
  }
}
```

Find the completed private manifest at `videos/<editionId>/<jobId>/manifest.json`.
Use the actual publication key; promoted previews can use `publication-public.json`.
This mode creates a new announcement and does not delete the original daily post.
Post historical announcements oldest first so the marketing embed ends on the
newest world. Video delivery must be enabled for this mode.

## Records, retries, and troubleshooting

| Record in the private artifact bucket | Purpose |
| --- | --- |
| `social/x/<editionId>/attempt.json` | Conditional daily-post claim |
| `social/x/<editionId>/receipt.json` | Successful post ID |
| `social/x/<editionId>/announcements/video-<jobId>/` | Separate claim and receipt for an explicitly requested video announcement |
| `social/x/<editionId>/media-<mp4Sha256>.json` | Uploaded media ID and expiry; reused while valid |
| `social/x/worker-lock.json` | Expiring lock for credential refresh and posting |

Upload failure occurs before the post claim. Once a claim exists, an ambiguous
post timeout requires account/receipt inspection. Never delete a claim and
blindly retry: the post may already exist. This favors avoiding duplicates over
guaranteeing delivery. Failed delivery leaves the world published.

| Symptom | Check |
| --- | --- |
| Authorization page rejects access | Client ID, exact callback field, app type, and signed-in account |
| Invalid authorization code | Exchange immediately through the callback handler; codes are short-lived and single-use |
| Account works, media returns 403 | Confirm `media.write` in the issued grant; if present, inspect app/account access with X |
| HTTP 402 | App billing and API credits |
| `already-attempted` | Inspect the claim, receipt, and account before recovery |
| World published but no post | Inspect optional-branch results and CloudWatch alarms, not only overall workflow success |

Configure an alarm email and confirm its SNS subscription for notifications.
Without it, failures are visible in AWS only. See [workflow recovery](AWS_WORKFLOW.md#failures-and-recovery).

## Marketing embed and data boundary

After saving the receipt, the worker updates public `generated/social/latest.json`
with only the edition and post IDs. The marketing site embeds that post, including
media, without a rebuild. Manual posts outside this worker do not update the
pointer. If the pointer write fails, repair it from the receipt rather than reposting.

The X widget loads near the page section with `dnt: true`; a direct link remains
if the widget is blocked. For a local preview, put a real post ID in ignored
`marketing/public/generated/social/latest.json`:

```json
{"schemaVersion":"1.0.0","editionId":"your-edition","postId":"123456789"}
```

This previews an existing post and does not send one. No additional LLM call
or article fetch is needed for posting. Only project-written titles, public
links, and the optional generated video go to X. X's
[developer terms](https://developer.x.com/en/developer-terms/agreement-and-policy),
[automation rules](https://help.x.com/en/rules-and-policies/x-automation), and
[embed terms](https://help.x.com/en/using-x/how-to-embed-a-post) apply.

## Implementation

- [`daily-post.ts`](../pipeline/src/social/daily-post.ts): text composition and delivery order.
- [`x-client.ts`](../pipeline/src/social/x-client.ts): authentication, refresh, upload, and posting.
- [`daily-x-post-handler.ts`](../pipeline/src/cloud/daily-x-post-handler.ts): AWS storage, secrets, checks, and receipts.
- [`world-every-day-stack.ts`](../infra/aws/lib/world-every-day-stack.ts): opt-in configuration, IAM, and failure isolation.

Tests use mock X responses and never publish posts.
