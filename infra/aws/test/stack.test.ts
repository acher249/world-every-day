import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { CachePolicy } from "aws-cdk-lib/aws-cloudfront";
import { Match, Template } from "aws-cdk-lib/assertions";
import { WorldEveryDayStack } from "../lib/world-every-day-stack.js";

function template(options: {
  alarm?: boolean;
  budget?: boolean;
  enableSchedule?: boolean;
  editorialProvider?: "aws-bedrock" | "google-gemini";
  environmentName?: "development" | "production";
  siteDomain?: boolean;
  xPostingAccountId?: string;
} = {}): Template {
  const app = new App();
  const stack = new WorldEveryDayStack(app, "TestStack", {
    config: {
      alarmNotificationEmail: options.alarm ? "operations@example.com" : undefined,
      articleAnalysisModel: "amazon.nova-lite-v1:0",
      budgetAlertEmail: options.budget ? "alerts@example.com" : undefined,
      editorialModel: "amazon.nova-lite-v1:0",
      editorialProvider: options.editorialProvider ?? "aws-bedrock",
      geminiEditorialModel: "gemini-3.8-flash",
      landmarkVisionModel: "gemini-3.8-flash",
      enableSchedule: options.enableSchedule ?? false,
      xPostingAccountId: options.xPostingAccountId,
      environmentName: options.environmentName ?? "development",
      monthlyBudgetUsd: options.budget ? 25 : undefined,
      nanoBananaModel: "gemini-nano-banana-2.1",
      worldLabsModel: "marble-1.1",
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

test("X posting is opt-in and follows publication with an isolated failure path", () => {
  assert.doesNotMatch(JSON.stringify(template().toJSON()), /PostPublishedWorldToX/);
  const rendered = template({ xPostingAccountId: "123", alarm: true });
  const json = JSON.stringify(rendered.toJSON());
  assert.match(json, /PostPublishedWorldToX/);
  assert.match(json, /WorldPublishedSocialPostFailed/);
  assert.match(json, /social\/x\//);
  rendered.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({ CacheBehaviors: Match.arrayWith([
      Match.objectLike({ PathPattern: "generated/social/latest.json", CachePolicyId: CachePolicy.CACHING_DISABLED.cachePolicyId }),
    ]) }),
  });
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Environment: { Variables: Match.objectLike({ X_EXPECTED_ACCOUNT_ID: "123", X_POSTING_ENABLED: "true" }) },
    Timeout: 180,
  });
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
  rendered.resourceCountIs("AWS::StepFunctions::StateMachine", 3);
  rendered.resourceCountIs("AWS::Lambda::Function", 17);
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Architectures: ["arm64"],
    ReservedConcurrentExecutions: Match.absent(),
    Runtime: "nodejs24.x",
    Timeout: 30,
  });
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Architectures: ["arm64"],
    ReservedConcurrentExecutions: Match.absent(),
    Runtime: "nodejs24.x",
    Timeout: 300,
  });
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "nodejs24.x",
    Timeout: 420,
  });
  rendered.hasResourceProperties("AWS::Lambda::Function", {
    Architectures: ["x86_64"],
    EphemeralStorage: { Size: 4096 },
    MemorySize: 3008,
    Runtime: "nodejs24.x",
    Timeout: 900,
  });
  rendered.hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(30 7 * * ? *)",
    ScheduleExpressionTimezone: "America/Los_Angeles",
    State: "DISABLED",
    Target: Match.objectLike({
      Input: "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}",
      RetryPolicy: {
        MaximumEventAgeInSeconds: 7_200,
        MaximumRetryAttempts: 2,
      },
    }),
  });
  rendered.resourceCountIs("AWS::SQS::Queue", 1);
  rendered.resourceCountIs("AWS::CloudWatch::Alarm", 4);
  rendered.resourceCountIs("AWS::Budgets::Budget", 0);

  const body = JSON.stringify(rendered.toJSON());
  const articleWorker = Object.entries(rendered.findResources("AWS::Lambda::Function"))
    .find(([id]) => id.startsWith("ArticleAnalysisHandler"))?.[1] as {
      Properties?: { Environment?: { Variables?: Record<string, string> } };
    } | undefined;
  assert.equal(articleWorker?.Properties?.Environment?.Variables?.ARTICLE_ANALYSIS_MODEL, "amazon.nova-lite-v1:0");
  assert.equal(articleWorker?.Properties?.Environment?.Variables?.GOOGLE_SECRET_NAME, undefined);
  for (const prefix of ["EditorialShortlistHandler", "ArtDirectionHandler"]) {
    const worker = Object.entries(rendered.findResources("AWS::Lambda::Function"))
      .find(([id]) => id.startsWith(prefix))?.[1] as {
        Properties?: { Environment?: { Variables?: Record<string, string> } };
      } | undefined;
    assert.equal(worker?.Properties?.Environment?.Variables?.GOOGLE_SECRET_NAME, undefined);
    assert.equal(
      worker?.Properties?.Environment?.Variables?.[prefix === "EditorialShortlistHandler" ? "EDITORIAL_MODEL" : "ART_DIRECTION_MODEL"],
      "amazon.nova-lite-v1:0",
    );
  }
  assert.match(body, /foundation-model\/amazon\.nova-lite-v1:0/);
  assert.match(body, /ContinueAfterExplicitReview/);
  assert.match(body, /AwaitingExplicitReview/);
  assert.match(body, /CollectLiveCandidates/);
  assert.match(body, /ConfirmPaidEditorialAnalysis/);
  assert.match(body, /CreateLiveEditorialShortlist/);
  assert.match(body, /ConfirmPaidArticleAnalysis/);
  assert.match(body, /PrepareLiveArticleAnalysis/);
  assert.match(body, /AnalyzeLiveArticles/);
  assert.match(body, /FinalizeLiveEdition/);
  assert.match(body, /ConfirmPaidArtDirection/);
  assert.match(body, /CreateLiveArtDirection/);
  assert.match(body, /ConfirmPaidPanorama/);
  assert.match(body, /UseUnattendedEditionApproval/);
  assert.match(body, /ApproveUnattendedEdition/);
  assert.match(body, /UseUnattendedImageApproval/);
  assert.match(body, /ApproveUnattendedImage/);
  assert.match(body, /UseUnattendedPublicationApproval/);
  assert.match(body, /ApproveUnattendedPublication/);
  assert.match(body, /confirmUnattendedRun/);
  assert.match(body, /CreateApprovedRawPanoramaSource/);
  assert.match(body, /ProcessPrivatePanorama/);
  assert.match(body, /ConfirmPaidWorldGeneration/);
  assert.match(body, /StartApprovedWorldGeneration/);
  assert.match(body, /PollWorldGeneration/);
  assert.match(body, /LivePrivateWorldReadyForReview/);
  assert.match(body, /ConfirmPaidLandmarkDetection/);
  assert.match(body, /DetectPrivateLandmarks/);
  assert.match(body, /BakePrivateInteractions/);
  assert.match(body, /StagePrivatePublication/);
  assert.match(body, /ConfirmPublicPublication/);
  assert.match(body, /PublishApprovedEdition/);
  assert.match(body, /PublishApprovedTestPreview/);
  assert.match(body, /LiveTestPreviewPublished/);
  assert.match(body, /confirmPublishPreview/);
  assert.match(body, /WorldLabsAuthProbe/);
  assert.match(body, /LiveEditionReadyForReview/);
  assert.match(body, /LiveArtDirectionReadyForReview/);
  assert.match(body, /confirmLiveArticleFetch/);
  assert.match(body, /confirmPaidArticleAnalysis/);
  assert.match(body, /confirmPaidArtDirection/);
  assert.match(body, /confirmPaidPanorama/);
  assert.match(body, /MaxConcurrency\\?":2/);
  assert.match(body, /IsPresent/);
  assert.match(body, /fixtures\/\*/);
  assert.match(body, /editions\/\*/);
  assert.equal(body.includes('MaxAttempts\\":6'), false);
  assert.ok(body.includes('MaxAttempts\\":2'));
  assert.doesNotMatch(body, /GOOGLE_API_KEY|WORLD_LABS_KEY/);
  assert.match(body, /s3:ListBucket/);
  assert.match(body, /s3:prefix/);
  assert.doesNotMatch(body, /s3:DeleteObject|dynamodb:Scan/);
  assert.ok(rendered.toJSON().Outputs?.LiveCollectionStateMachineArn);
  assert.ok(rendered.toJSON().Outputs?.WorldLabsAuthProbeFunctionName);
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

test("Gemini text workers use only the existing Google secret, with no Bedrock grant", () => {
  const rendered = template({ editorialProvider: "google-gemini" });
  const resources = rendered.findResources("AWS::Lambda::Function");
  for (const prefix of ["EditorialShortlistHandler", "ArticleAnalysisHandler", "ArtDirectionHandler"]) {
    const worker = Object.entries(resources).find(([id]) => id.startsWith(prefix))?.[1] as {
      Properties?: { Environment?: { Variables?: Record<string, string> } };
    } | undefined;
    assert.equal(worker?.Properties?.Environment?.Variables?.EDITORIAL_PROVIDER, "google-gemini");
    assert.equal(worker?.Properties?.Environment?.Variables?.GEMINI_EDITORIAL_MODEL, "gemini-3.8-flash");
    assert.ok(worker?.Properties?.Environment?.Variables?.GOOGLE_SECRET_NAME);
  }
  const body = JSON.stringify(rendered.toJSON());
  assert.doesNotMatch(body, /bedrock:InvokeModel|foundation-model\/amazon\.nova-lite/);
  assert.doesNotMatch(body, /GOOGLE_AI_API_KEY/);
});

test("schedule, notifications, and budget require explicit configuration", () => {
  const rendered = template({ alarm: true, budget: true, enableSchedule: true });
  const schedules = rendered.findResources("AWS::Scheduler::Schedule");
  const daily = Object.entries(schedules).find(([id]) => id.startsWith("DailySchedule"))?.[1];
  assert.ok(daily);
  assert.equal(daily.Properties.State, "ENABLED");
  assert.equal(daily.Properties.ScheduleExpression, "cron(30 7 * * ? *)");
  assert.equal(daily.Properties.ScheduleExpressionTimezone, "America/Los_Angeles");
  assert.equal(
    JSON.parse(daily.Properties.Target.Input).scheduledTime,
    "<aws.scheduler.scheduled-time>",
  );
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

