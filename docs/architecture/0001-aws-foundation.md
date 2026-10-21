# ADR 0001: AWS foundation boundaries

**Status:** Accepted; implementation notes reflect the current reference stack

## Context

The edition pipeline needs durable storage and operational state without
coupling every provider to AWS or enabling paid automation by default.

## Decision

- Define AWS infrastructure in a standalone TypeScript CDK package at
  `infra/aws/`.
- Keep immutable private pipeline artifacts and publishable assets in separate,
  private, versioned S3 buckets.
- Host the static marketing and explorer builds from separate private S3 origins
  behind CloudFront. Keep custom domains optional and import an existing Route 53
  hosted zone rather than coupling domain registration to the project.
- Deliver publishable assets through CloudFront using origin access control;
  do not make the S3 bucket public.
- Store edition state, locks, and the current-publication pointer in one
  on-demand DynamoDB table with conditional writes. Enable point-in-time
  recovery and deletion protection in production, not the default development
  stack.
- Keep artifact and edition repositories behind interfaces in `pipeline/`.
- Reference pre-existing Secrets Manager secrets by name. CDK must never accept
  secret values as context or CloudFormation parameters.
- Use Step Functions Standard for orchestration and EventBridge Scheduler for a
  7:30 AM `America/Los_Angeles` trigger.
- Exercise the cloud boundary first with one bounded Lambda that advances only
  fictional fixture state. Stop at editorial review unless continuation is
  explicitly requested, and grant access only to the fixture prefixes and state
  table it needs.
- Create the schedule disabled by default. Limit target delivery to two retries,
  cap event age at two hours, and retain failed deliveries in an SQS dead-letter
  queue.
- Retain buckets, the table, logs, and the dead-letter queue if the stack is
  deleted. Publication and data deletion require a deliberate separate process.
- Make AWS Budgets opt-in because its amount and notification address are
  deployment decisions. Keep the project cost tag consistent across resources.

## Consequences

The stack can synthesize and be reviewed without AWS credentials, deployment,
provider calls, or publication. A failed edition cannot overwrite immutable
artifacts. Publication updates the edition state and current-world pointer only
after the required assets and review decisions are available.

The fixture workflow remains available without provider calls. A separate live
workflow implements discovery through generation, browser-backed Lambda
interaction baking, and publication. Operators choose manual review or explicit
unattended authorization. Static build uploads remain a separate operation.

The reference development schedule enables the live workflow. Fresh deployments
keep it disabled. Daily reliability, editorial quality, and device performance
still require monitoring and review.

