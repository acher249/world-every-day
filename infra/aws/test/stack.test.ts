import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { WorldEveryDayStack } from "../lib/world-every-day-stack.js";

function template(options: {
  alarm?: boolean;
  budget?: boolean;
  enableSchedule?: boolean;
  environmentName?: "development" | "production";
  siteDomain?: boolean;
} = {}): Template {
  const app = new App();
  const stack = new WorldEveryDayStack(app, "TestStack", {
    config: {
      alarmNotificationEmail: options.alarm ? "operations@example.com" : undefined,
      budgetAlertEmail: options.budget ? "alerts@example.com" : undefined,
      enableSchedule: options.enableSchedule ?? false,
      environmentName: options.environmentName ?? "development",
      monthlyBudgetUsd: options.budget ? 25 : undefined,
      siteDomain: options.siteDomain ? {
        explorerSubdomain: "explore",
        hostedZoneId: "Z123456789",
        rootDomain: "example.com",
      } : undefined,
    },
  });
  return Template.fromStack(stack);
}

test("foundation keeps artifacts and static sites in separate private buckets", () => {
  const rendered = template();
  rendered.resourceCountIs("AWS::S3::Bucket", 4);
  rendered.allResourcesProperties("AWS::S3::Bucket", {
    BucketEncryption: Match.anyValue(),
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: { Status: "Enabled" },
  });
  rendered.resourceCountIs("AWS::CloudFront::Distribution", 3);
});

test("custom domains are opt-in and cover the marketing and explorer sites", () => {
  const withoutDomains = template();
  withoutDomains.resourceCountIs("AWS::CertificateManager::Certificate", 0);
  withoutDomains.resourceCountIs("AWS::Route53::RecordSet", 0);

  const withDomains = template({ siteDomain: true });
  withDomains.hasResourceProperties("AWS::CertificateManager::Certificate", {
    DomainName: "example.com",
    SubjectAlternativeNames: ["explore.example.com"],
  });
  withDomains.resourceCountIs("AWS::Route53::RecordSet", 4);
  const rendered = JSON.stringify(withDomains.toJSON());
  assert.match(rendered, /example\.com/);
  assert.match(rendered, /explore\.example\.com/);
  assert.match(rendered, /frame-ancestors 'self' https:\/\/example\.com/);
});

test("foundation creates on-demand state, observability, and disabled automation", () => {
  const rendered = template();
  rendered.hasResourceProperties("AWS::DynamoDB::Table", {
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: false,
    },
  });
  rendered.hasResourceProperties("AWS::StepFunctions::StateMachine", {
    StateMachineType: "STANDARD",
  });
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Architectures: ["arm64"],
    ReservedConcurrentExecutions: 1,
    Runtime: "nodejs24.x",
    Timeout: 30,
  });
  rendered.hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(30 7 * * ? *)",
    ScheduleExpressionTimezone: "America/Los_Angeles",
    State: "DISABLED",
    Target: Match.objectLike({
      Input: "{\"continueAfterReview\":false}",
      RetryPolicy: {
        MaximumEventAgeInSeconds: 7_200,
        MaximumRetryAttempts: 2,
      },
    }),
  });
  rendered.resourceCountIs("AWS::SQS::Queue", 1);
  rendered.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  rendered.resourceCountIs("AWS::Budgets::Budget", 0);

  const body = JSON.stringify(rendered.toJSON());
  assert.match(body, /ContinueAfterExplicitReview/);
  assert.match(body, /AwaitingExplicitReview/);
  assert.match(body, /fixtures\/\*/);
  assert.equal(body.includes('MaxAttempts\\":6'), false);
  assert.ok(body.includes('MaxAttempts\\":2'));
  assert.doesNotMatch(body, /GOOGLE_API_KEY|WORLD_LABS_KEY/);
  assert.doesNotMatch(body, /s3:DeleteObject|s3:ListBucket|dynamodb:Scan/);
});

test("production state enables deletion protection and point-in-time recovery", () => {
  const rendered = template({ environmentName: "production" });
  rendered.hasResourceProperties("AWS::DynamoDB::Table", {
    DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: true,
    },
  });
});

test("schedule, notifications, and budget require explicit configuration", () => {
  const rendered = template({ alarm: true, budget: true, enableSchedule: true });
  rendered.hasResourceProperties("AWS::Scheduler::Schedule", { State: "ENABLED" });
  rendered.hasResourceProperties("AWS::Budgets::Budget", {
    Budget: {
      BudgetLimit: { Amount: 25, Unit: "USD" },
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
    },
  });
  rendered.resourceCountIs("AWS::SNS::Topic", 1);
  rendered.hasResourceProperties("AWS::SNS::Subscription", {
    Endpoint: "operations@example.com",
    Protocol: "email",
  });
  rendered.allResourcesProperties("AWS::CloudWatch::Alarm", {
    AlarmActions: Match.anyValue(),
  });
  const outputs = rendered.toJSON().Outputs;
  assert.ok(outputs.ScheduleEnabled);
});

