# AWS infrastructure

This package defines the first AWS foundation for A World Every Day. It is an
AWS CDK application, not a deployed environment. The default configuration is a
development stack whose daily schedule is disabled.

The current stack synthesizes:

- a private, versioned S3 bucket for immutable pipeline artifacts;
- a separate private S3 bucket served through CloudFront for publishable assets;
- an on-demand DynamoDB table for edition state, locks, and publication pointers;
- references to pre-existing Google AI and World Labs secrets;
- a Step Functions Standard fixture workflow and one bounded Lambda with
  CloudWatch logging;
- a 7:30 AM `America/Los_Angeles` EventBridge Scheduler schedule, disabled by
  default, with two delivery retries and a retained dead-letter queue; and
- workflow and scheduler-failure alarms with optional email delivery; and
- an optional monthly AWS Budget notification.

The fixture workflow validates state transitions, immutable marker artifacts,
locking, failure handling, and the review boundary. It makes no provider calls
and stops at editorial review by default. It is not the live daily pipeline.

The reasoning and unresolved browser-baking boundary are recorded in
[`docs/architecture/0001-aws-foundation.md`](../../docs/architecture/0001-aws-foundation.md).

## Local validation

```bash
cd pipeline
npm i
cd ../infra/aws
npm i
npm run license:check
npm run typecheck
npm test
npm run synth
npm run build
```

`npm run synth` is local and does not create AWS resources. Review the generated
CloudFormation template in `cdk.out/`; that directory is ignored by Git.

## Local configuration

Copy the non-secret example when you want local defaults:

```bash
cp .env.example .env.local
```

`infra/aws/.env.local` is ignored by Git. It contains deployment settings only,
never AWS access keys or provider secrets. CDK context (`-c`) overrides these
environment values.

| Environment variable | CDK context | Default | Purpose |
| --- | --- | --- | --- |
| `WORLD_EVERY_DAY_ENVIRONMENT` | `environmentName` | `development` | `development` or `production` |
| `WORLD_EVERY_DAY_ENABLE_SCHEDULE` | `enableSchedule` | `false` | Enables the daily trigger only when explicitly set to `true` |
| `WORLD_EVERY_DAY_ALARM_EMAIL` | `alarmNotificationEmail` | unset | Email subscriber for workflow and scheduler failure alarms |
| `WORLD_EVERY_DAY_MONTHLY_BUDGET_USD` | `monthlyBudgetUsd` | unset | Positive monthly AWS cost threshold |
| `WORLD_EVERY_DAY_BUDGET_ALERT_EMAIL` | `budgetAlertEmail` | unset | Email for the forecasted 80% budget notification |
| `CDK_DEFAULT_REGION` | n/a | AWS CLI default | Deployment region |

Budget amount and email must be supplied together. Example synthesis:

```bash
npm run synth -- \
  -c environmentName=development \
  -c monthlyBudgetUsd=25 \
  -c budgetAlertEmail=operator@example.com
```

The budget is filtered to the stack's `Project=AWorldEveryDay` tag. That
user-defined cost-allocation tag must be activated in the billing account for
the filter to take effect.

## AWS access and secrets

Use an AWS CLI named profile backed by IAM Identity Center or an assumed role.
The profile and its temporary credentials live in the standard AWS CLI config
outside this repository. Pass the profile explicitly when inspecting a target
account:

```bash
aws sso login --profile world-every-day-dev
npm run diff -- --profile world-every-day-dev
```

Do not put `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, session tokens, or
provider keys in `.env.local`. CI should use workload identity and an assumed
deployment role rather than long-lived credentials.

When an alarm email is configured, AWS sends a subscription confirmation after
deployment. Notifications begin only after the recipient confirms it.

The stack references these secret names without creating or populating them:

```text
world-every-day/<environmentName>/google-ai
world-every-day/<environmentName>/world-labs
```

Secret values must be added directly through an authorized AWS workflow. They
must never appear in CDK context, CloudFormation parameters, source files, or
command history.

## Fixture workflow

The disabled schedule supplies `{ "continueAfterReview": false }`, advances a
fictional edition to `SELECTED`, releases its lock, and stops. After deployment,
an operator can deliberately resume the same edition with
`continueAfterReview: true`; that path writes only clearly marked fixture
artifacts. It still does not call Nano Banana, World Labs, or live sources.

## Deployment boundary

Do not run `cdk bootstrap`, `cdk deploy`, enable the schedule, or create secret
values during ordinary development. Those commands mutate an AWS account and
may incur costs. Before the first deployment, select the account and region,
review `npm run diff`, configure cost alerts, and obtain explicit approval.

