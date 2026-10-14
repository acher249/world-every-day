import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  TimeZone,
  aws_budgets as budgets,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_route53 as route53,
  aws_s3 as s3,
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_sqs as sqs,
  aws_stepfunctions as stepfunctions,
  aws_stepfunctions_tasks as tasks,
  type StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeploymentConfig } from "./config.js";
import { StaticSite } from "./static-site.js";

export type WorldEveryDayStackProps = StackProps & {
  config: DeploymentConfig;
};

export class WorldEveryDayStack extends Stack {
  constructor(scope: Construct, id: string, props: WorldEveryDayStackProps) {
    super(scope, id, props);

    const { config } = props;
    Tags.of(this).add("Project", "AWorldEveryDay");
    Tags.of(this).add("Environment", config.environmentName);
    Tags.of(this).add("ManagedBy", "AWS-CDK");

    const artifacts = new s3.Bucket(this, "ArtifactBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{
        abortIncompleteMultipartUploadAfter: Duration.days(7),
        expiration: Duration.days(30),
        prefix: "staging/",
      }],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const publicAssets = new s3.Bucket(this, "PublicAssetBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{
        allowedHeaders: ["*"],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedOrigins: ["*"],
        maxAge: 3_600,
      }],
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const distribution = new cloudfront.Distribution(this, "AssetDistribution", {
      comment: `A World Every Day ${config.environmentName} public assets`,
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        origin: origins.S3BucketOrigin.withOriginAccessControl(publicAssets),
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const hostedZone = config.siteDomain
      ? route53.HostedZone.fromHostedZoneAttributes(this, "SiteHostedZone", {
          hostedZoneId: config.siteDomain.hostedZoneId,
          zoneName: config.siteDomain.rootDomain,
        })
      : undefined;
    const explorerDomain = config.siteDomain
      ? `${config.siteDomain.explorerSubdomain}.${config.siteDomain.rootDomain}`
      : undefined;
    const siteCertificate = config.siteDomain && hostedZone
      ? new acm.Certificate(this, "SiteCertificate", {
          domainName: config.siteDomain.rootDomain,
          subjectAlternativeNames: [explorerDomain!],
          validation: acm.CertificateValidation.fromDns(hostedZone),
        })
      : undefined;
    const marketingSite = new StaticSite(this, "MarketingSite", {
      certificate: siteCertificate,
      domainName: config.siteDomain?.rootDomain,
      hostedZone,
    });
    const explorerSite = new StaticSite(this, "ExplorerSite", {
      certificate: siteCertificate,
      domainName: explorerDomain,
      frameAncestor: config.siteDomain
        ? `https://${config.siteDomain.rootDomain}`
        : `https://${marketingSite.distribution.domainName}`,
      hostedZone,
    });

    const editions = new dynamodb.Table(this, "EditionTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: config.environmentName === "production",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.environmentName === "production",
      },
      removalPolicy: RemovalPolicy.RETAIN,
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
    });

    const workflowLogs = new logs.LogGroup(this, "WorkflowLogs", {
      removalPolicy: RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const handlerLogs = new logs.LogGroup(this, "MockWorkflowHandlerLogs", {
      removalPolicy: RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const pipelineRoot = resolve(repositoryRoot, "pipeline");
    const mockWorkflowHandler = new lambdaNodejs.NodejsFunction(this, "MockWorkflowHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        bundleAwsSDK: true,
        minify: true,
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/mock-workflow-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        EDITION_TABLE: editions.tableName,
        PUBLIC_ASSET_BUCKET: publicAssets.bucketName,
      },
      handler: "main",
      logGroup: handlerLogs,
      memorySize: 256,
      projectRoot: pipelineRoot,
      reservedConcurrentExecutions: 1,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(30),
    });
    mockWorkflowHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [
        artifacts.arnForObjects("fixtures/*"),
        publicAssets.arnForObjects("fixtures/*"),
      ],
    }));
    mockWorkflowHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:TransactWriteItems",
        "dynamodb:UpdateItem",
      ],
      resources: [editions.tableArn],
    }));

    const invoke = (
      id: string,
      payload: Record<string, unknown>,
    ): tasks.LambdaInvoke => {
      const task = new tasks.LambdaInvoke(this, id, {
        lambdaFunction: mockWorkflowHandler,
        payload: stepfunctions.TaskInput.fromObject(payload),
        payloadResponseOnly: true,
        retryOnServiceExceptions: false,
      });
      task.addRetry({
        backoffRate: 2,
        errors: [
          "Lambda.ServiceException",
          "Lambda.AWSLambdaException",
          "Lambda.ClientExecutionTimeoutException",
          "Lambda.SdkClientException",
        ],
        interval: Duration.seconds(2),
        maxAttempts: 2,
      });
      return task;
    };

    const initialize = invoke("InitializeEdition", {
      action: "initialize",
      "input.$": "$",
      "lockOwner.$": "$$.Execution.Id",
    });
    const collected = invoke("MarkCollected", {
      action: "advance",
      expected: "DRAFT",
      next: "COLLECTED",
      "state.$": "$",
    });
    const selected = invoke("MarkSelected", {
      action: "advance",
      expected: "COLLECTED",
      next: "SELECTED",
      "state.$": "$",
    });
    const editorialApproved = invoke("MarkEditorialApproved", {
      action: "advance",
      expected: "SELECTED",
      next: "EDITORIAL_APPROVED",
      "state.$": "$",
    });
    const imageGenerated = invoke("MarkImageGenerated", {
      action: "advance",
      expected: "EDITORIAL_APPROVED",
      next: "IMAGE_GENERATED",
      "state.$": "$",
    });
    const imageApproved = invoke("MarkImageApproved", {
      action: "advance",
      expected: "IMAGE_GENERATED",
      next: "IMAGE_APPROVED",
      "state.$": "$",
    });
    const worldGenerating = invoke("MarkWorldGenerating", {
      action: "advance",
      expected: "IMAGE_APPROVED",
      next: "WORLD_GENERATING",
      "state.$": "$",
    });
    const worldGenerated = invoke("MarkWorldGenerated", {
      action: "advance",
      expected: "WORLD_GENERATING",
      next: "WORLD_GENERATED",
      "state.$": "$",
    });
    const qaApproved = invoke("MarkQaApproved", {
      action: "advance",
      expected: "WORLD_GENERATED",
      next: "QA_APPROVED",
      "state.$": "$",
    });
    const publishFixture = invoke("PublishFixture", {
      action: "publish",
      "state.$": "$",
    });
    const releaseForReview = invoke("ReleaseForReview", {
      action: "release",
      "state.$": "$",
    });
    const recordFailure = invoke("RecordFailure", {
      action: "fail",
      "error.$": "$.error",
      stage: "fixture-cloud-workflow",
      "state.$": "$",
    });
    const failed = new stepfunctions.Fail(this, "FixtureWorkflowFailed", {
      cause: "A fixture workflow stage failed; details were recorded in DynamoDB.",
    });
    recordFailure.next(failed);
    const initializeFailed = new stepfunctions.Fail(this, "FixtureInitializationFailed", {
      cause: "The fixture workflow could not initialize its edition lock.",
    });
    initialize.addCatch(initializeFailed, { resultPath: "$.error" });
    for (const task of [
      collected,
      selected,
      editorialApproved,
      imageGenerated,
      imageApproved,
      worldGenerating,
      worldGenerated,
      qaApproved,
      publishFixture,
      releaseForReview,
    ]) task.addCatch(recordFailure, { resultPath: "$.error" });

    const awaitingReview = new stepfunctions.Succeed(this, "AwaitingExplicitReview", {
      comment: "Rerun with continueAfterReview=true after reviewing fixture state.",
    });
    const fixturePublished = new stepfunctions.Succeed(this, "FixturePublished");
    const approvedChain = editorialApproved
      .next(imageGenerated)
      .next(imageApproved)
      .next(worldGenerating)
      .next(worldGenerated)
      .next(qaApproved)
      .next(publishFixture)
      .next(fixturePublished);
    const reviewChoice = new stepfunctions.Choice(this, "ContinueAfterExplicitReview")
      .when(
        stepfunctions.Condition.booleanEquals("$.continueAfterReview", true),
        approvedChain,
      )
      .otherwise(releaseForReview.next(awaitingReview));
    const definition = initialize.next(collected).next(selected).next(reviewChoice);
    const stateMachine = new stepfunctions.StateMachine(this, "EditionStateMachine", {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      logs: {
        destination: workflowLogs,
        includeExecutionData: false,
        level: stepfunctions.LogLevel.ALL,
      },
      stateMachineType: stepfunctions.StateMachineType.STANDARD,
      tracingEnabled: true,
    });

    const scheduleDeadLetterQueue = new sqs.Queue(this, "ScheduleDeadLetterQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      retentionPeriod: Duration.days(14),
    });

    new scheduler.Schedule(this, "DailySchedule", {
      description: "Starts the daily edition workflow at 7:30 AM Pacific.",
      enabled: config.enableSchedule,
      schedule: scheduler.ScheduleExpression.cron({
        hour: "7",
        minute: "30",
        timeZone: TimeZone.AMERICA_LOS_ANGELES,
      }),
      target: new schedulerTargets.StepFunctionsStartExecution(stateMachine, {
        deadLetterQueue: scheduleDeadLetterQueue,
        input: scheduler.ScheduleTargetInput.fromObject({
          continueAfterReview: false,
        }),
        maxEventAge: Duration.hours(2),
        retryAttempts: 2,
      }),
    });

    const workflowFailureAlarm = new cloudwatch.Alarm(this, "WorkflowFailureAlarm", {
      alarmDescription: "A World Every Day workflow executions failed.",
      evaluationPeriods: 1,
      metric: stateMachine.metricFailed({ period: Duration.minutes(5) }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const scheduleDeadLetterAlarm = new cloudwatch.Alarm(this, "ScheduleDeadLetterAlarm", {
      alarmDescription: "The daily schedule could not start the edition workflow.",
      evaluationPeriods: 1,
      metric: scheduleDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (config.alarmNotificationEmail) {
      const alarmTopic = new sns.Topic(this, "AlarmTopic", {
        displayName: `A World Every Day ${config.environmentName} alarms`,
      });
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(
        config.alarmNotificationEmail,
      ));
      const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);
      workflowFailureAlarm.addAlarmAction(alarmAction);
      scheduleDeadLetterAlarm.addAlarmAction(alarmAction);
    }

    if (config.budgetAlertEmail && config.monthlyBudgetUsd) {
      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetLimit: { amount: config.monthlyBudgetUsd, unit: "USD" },
          budgetName: `world-every-day-${config.environmentName}`,
          budgetType: "COST",
          costFilters: {
            TagKeyValue: [`user:Project$AWorldEveryDay`],
          },
          timeUnit: "MONTHLY",
        },
        notificationsWithSubscribers: [{
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "FORECASTED",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{
            address: config.budgetAlertEmail,
            subscriptionType: "EMAIL",
          }],
        }],
      });
    }

    const googleSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleApiSecret",
      `world-every-day/${config.environmentName}/google-ai`,
    );
    const worldLabsSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "WorldLabsApiSecret",
      `world-every-day/${config.environmentName}/world-labs`,
    );

    new CfnOutput(this, "ArtifactBucketName", { value: artifacts.bucketName });
    new CfnOutput(this, "PublicAssetBucketName", { value: publicAssets.bucketName });
    new CfnOutput(this, "PublicAssetDomain", { value: distribution.domainName });
    new CfnOutput(this, "MarketingSiteBucketName", { value: marketingSite.bucket.bucketName });
    new CfnOutput(this, "MarketingSiteDomain", {
      value: config.siteDomain?.rootDomain ?? marketingSite.distribution.domainName,
    });
    new CfnOutput(this, "MarketingSiteDistributionId", {
      value: marketingSite.distribution.distributionId,
    });
    new CfnOutput(this, "ExplorerSiteBucketName", { value: explorerSite.bucket.bucketName });
    new CfnOutput(this, "ExplorerSiteDomain", {
      value: explorerDomain ?? explorerSite.distribution.domainName,
    });
    new CfnOutput(this, "ExplorerSiteDistributionId", {
      value: explorerSite.distribution.distributionId,
    });
    new CfnOutput(this, "EditionTableName", { value: editions.tableName });
    new CfnOutput(this, "StateMachineArn", { value: stateMachine.stateMachineArn });
    new CfnOutput(this, "GoogleSecretName", { value: googleSecret.secretName });
    new CfnOutput(this, "WorldLabsSecretName", { value: worldLabsSecret.secretName });
    new CfnOutput(this, "ScheduleEnabled", { value: String(config.enableSchedule) });
  }
}

