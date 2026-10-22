# Daily X posts

An optional Lambda runs after successful public publication in Step Functions.
It checks the public edition against the published manifest, checks the explorer
and asset URLs, verifies the X account, then posts the edition date, a
“Today’s World” permanent link, one or two story headlines, and a “Learn more”
project link. Complete headlines are selected to fit X's length limit; no
headlines are cut mid-sentence. Preview publications do not trigger it. This first
version is text and link only; screenshots and tour videos are not implemented.

## Configuration

Posting is disabled by default. Before enabling it, verify the intended account
and the app's **Read and write** permissions in the X developer console.
Regenerate user tokens if permissions changed after they were created.
Fund the app's X API credits before testing. A successful account lookup does
not establish write permission or available credits; HTTP 402 means billing
must be resolved before posting can work.

Local credentials belong only in gitignored `pipeline/.env`:

```dotenv
X_CLIENT_ID=
X_CLIENT_SECRET=
X_OAUTH2_ACCESS_TOKEN=
X_REFRESH_TOKEN=
```

For AWS, store those four fields as a JSON object in Secrets Manager at
`world-every-day/<environment>/x`. Use a confidential Web App / Automated App
with `tweet.read`, `tweet.write`, `users.read`, and `offline.access` permissions.
The app-only bearer token is not used. OAuth 1.0a remains supported with the
alternative four fields in `pipeline/.env.example`; never mix token types.

On an expired-token response during account verification, the worker refreshes
once and saves the rotated token pair to Secrets Manager before continuing.
The Lambda has reserved concurrency of one to prevent simultaneous refreshes.
Do not run a local worker against the same secret while the cloud worker is
active. A failed or ambiguous refresh may require reauthorization; never blindly
retry token rotation. Posting itself is never automatically retried.
Set `WORLD_EVERY_DAY_X_ACCOUNT_ID` to the verified numeric user ID in
`infra/aws/.env.local` (or CDK context `xPostingAccountId`) and deploy to enable
the stage. Omit this setting and redeploy to disable it. Deployment enables
posting on subsequent full public runs, including manually triggered runs.
Never put token values in CDK configuration or frontend environment variables.

## Failure handling

A conditional S3 write claims `social/x/<editionId>/attempt.json` before sending.
Concurrent runs and retries cannot send again for that edition. A successful send
records `receipt.json` containing the post ID. These records stay private.

After saving the receipt, the worker updates public `generated/social/latest.json`
with only the edition and post IDs. The marketing page embeds that post below
the project invitation, with attached media visible. Refreshing the page picks
up the latest successful pipeline post without rebuilding the site or polling
the X API. Manual posts outside this pipeline do not update the pointer.

Deploy the marketing build and infrastructure together to enable the uncached
route and narrow write permission. Until the pointer exists, a profile link is
shown instead. X's hosted widget loads only near this section, with `dnt: true`;
X's privacy and embed terms still apply. A direct link remains if the widget is
blocked. If the pointer write fails, repair it from the private receipt rather
than deleting the claim or reposting. Video generation remains a separate,
paused task; the embed displays only media already attached to the post.

For a local preview, put a public post ID in the gitignored
`marketing/public/generated/social/latest.json`:
`{"schemaVersion":"1.0.0","editionId":"your-edition","postId":"123456789"}`.
Use a real, available post ID. This previews an existing post; it does not send
one. Production uses the S3 pointer instead of this local file.

If X times out, or writing the receipt fails, the claim remains: the post may
already exist. Inspect the account and execution before any manual recovery.
Do not delete the claim and blindly retry. This favors avoiding duplicates over
guaranteeing delivery. Publication remains successful even if the social stage
fails; a separate Lambda error alarm reports the failure, with email delivery
when the stack's alarm email is configured.

No extra model call or article access is needed. Only project-authored story
titles and the public link go to X. X is an optional proprietary service governed
by its [developer terms](https://developer.x.com/en/developer-terms/agreement-and-policy)
and [automation rules](https://help.x.com/en/rules-and-policies/x-automation).
API usage is billed separately; check [current pricing](https://docs.x.com/x-api/getting-started/pricing)
before enabling it. URL-bearing posts have a different rate from plain posts.
