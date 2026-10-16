import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
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
    explorerSite.distribution.addBehavior(
      "generated/current.json",
      origins.S3BucketOrigin.withOriginAccessControl(publicAssets),
      {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );
    explorerSite.distribution.addBehavior(
      "generated/*",
      origins.S3BucketOrigin.withOriginAccessControl(publicAssets),
      {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );

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
    const worldLabsAuthProbe = new lambdaNodejs.NodejsFunction(this, "WorldLabsAuthProbe", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/world-labs-auth-probe.ts"),
      environment: { WORLD_LABS_SECRET_NAME: worldLabsSecret.secretName },
      handler: "main",
      logGroup: new logs.LogGroup(this, "WorldLabsAuthProbeLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      memorySize: 128,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(15),
    });
    worldLabsSecret.grantRead(worldLabsAuthProbe);
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

    const collectCandidatesHandler = new lambdaNodejs.NodejsFunction(this, "CollectCandidatesHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        bundleAwsSDK: true,
        minify: true,
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/collect-candidates-handler.ts"),
      environment: { ARTIFACT_BUCKET: artifacts.bucketName },
      handler: "main",
      memorySize: 512,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(90),
    });
    collectCandidatesHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    collectCandidatesHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    const collectCandidates = new tasks.LambdaInvoke(this, "CollectLiveCandidates", {
      lambdaFunction: collectCandidatesHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        "windowStart.$": "$.windowStart",
        "windowEnd.$": "$.windowEnd",
      }),
      payloadResponseOnly: true,
      resultPath: "$.collection",
      retryOnServiceExceptions: false,
    });
    collectCandidates.addRetry({
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
    const editorialShortlistHandler = new lambdaNodejs.NodejsFunction(this, "EditorialShortlistHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        bundleAwsSDK: true,
        minify: true,
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/editorial-shortlist-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        EDITORIAL_MODEL: config.editorialModel,
      },
      handler: "main",
      memorySize: 512,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(300),
    });
    editorialShortlistHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    editorialShortlistHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    editorialShortlistHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${config.editorialModel}`],
    }));
    const createShortlist = new tasks.LambdaInvoke(this, "CreateLiveEditorialShortlist", {
      lambdaFunction: editorialShortlistHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.editorial",
      retryOnServiceExceptions: false,
    });
    const prepareArticleAnalysisHandler = new lambdaNodejs.NodejsFunction(this, "PrepareArticleAnalysisHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/article-analysis-handler.ts"),
      environment: { ARTIFACT_BUCKET: artifacts.bucketName },
      handler: "prepare",
      memorySize: 256,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(30),
    });
    prepareArticleAnalysisHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    prepareArticleAnalysisHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    const articleAnalysisHandler = new lambdaNodejs.NodejsFunction(this, "ArticleAnalysisHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/article-analysis-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        ARTICLE_ANALYSIS_MODEL: config.articleAnalysisModel,
      },
      handler: "analyze",
      memorySize: 512,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(300),
    });
    articleAnalysisHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    articleAnalysisHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    articleAnalysisHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${config.articleAnalysisModel}`],
    }));
    const prepareArticleAnalysis = new tasks.LambdaInvoke(this, "PrepareLiveArticleAnalysis", {
      lambdaFunction: prepareArticleAnalysisHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.articlePreparation",
      retryOnServiceExceptions: false,
    });
    const analyzeArticleTask = new tasks.LambdaInvoke(this, "AnalyzeLiveArticle", {
      lambdaFunction: articleAnalysisHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        "storyId.$": "$.storyId",
      }),
      payloadResponseOnly: true,
      retryOnServiceExceptions: false,
    });
    const analyzeArticles = new stepfunctions.Map(this, "AnalyzeLiveArticles", {
      itemsPath: stepfunctions.JsonPath.stringAt("$.articlePreparation.tasks"),
      maxConcurrency: 2,
      resultPath: "$.articleResults",
    });
    analyzeArticles.itemProcessor(analyzeArticleTask);
    const finalizeEditionHandler = new lambdaNodejs.NodejsFunction(this, "FinalizeEditionHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/finalize-edition-handler.ts"),
      environment: { ARTIFACT_BUCKET: artifacts.bucketName },
      handler: "main",
      memorySize: 256,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(30),
    });
    finalizeEditionHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    finalizeEditionHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    const finalizeEdition = new tasks.LambdaInvoke(this, "FinalizeLiveEdition", {
      lambdaFunction: finalizeEditionHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.finalEdition",
      retryOnServiceExceptions: false,
    });
    const artDirectionHandler = new lambdaNodejs.NodejsFunction(this, "ArtDirectionHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/art-direction-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        ART_DIRECTION_MODEL: config.editorialModel,
      },
      handler: "main",
      memorySize: 512,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(300),
    });
    artDirectionHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    artDirectionHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    artDirectionHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${config.editorialModel}`],
    }));
    const createArtDirection = new tasks.LambdaInvoke(this, "CreateLiveArtDirection", {
      lambdaFunction: artDirectionHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.artDirection",
      retryOnServiceExceptions: false,
    });
    const rawPanoramaHandler = new lambdaNodejs.NodejsFunction(this, "RawPanoramaHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/raw-panorama-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        GOOGLE_SECRET_NAME: googleSecret.secretName,
        NANO_BANANA_MODEL: config.nanoBananaModel,
      },
      handler: "main",
      memorySize: 1024,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(10),
    });
    rawPanoramaHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    rawPanoramaHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    googleSecret.grantRead(rawPanoramaHandler);
    const generateRawPanorama = new tasks.LambdaInvoke(this, "CreateApprovedRawPanoramaSource", {
      lambdaFunction: rawPanoramaHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        confirmPaidGeneration: true,
      }),
      payloadResponseOnly: true,
      resultPath: "$.rawPanorama",
      retryOnServiceExceptions: false,
    });
    const panoramaProcessingHandler = new lambdaNodejs.NodejsFunction(this, "PanoramaProcessingHandler", {
      architecture: lambda.Architecture.X86_64,
      bundling: {
        bundleAwsSDK: true,
        forceDockerBundling: true,
        minify: true,
        nodeModules: ["sharp"],
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/panorama-processing-handler.ts"),
      environment: { ARTIFACT_BUCKET: artifacts.bucketName },
      ephemeralStorageSize: Size.gibibytes(4),
      handler: "main",
      memorySize: 3008,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(15),
    });
    panoramaProcessingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    panoramaProcessingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    const processPanorama = new tasks.LambdaInvoke(this, "ProcessPrivatePanorama", {
      lambdaFunction: panoramaProcessingHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.panorama",
      retryOnServiceExceptions: false,
    });
    const worldGenerationHandler = new lambdaNodejs.NodejsFunction(this, "WorldGenerationHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/world-generation-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        WORLD_LABS_MODEL: config.worldLabsModel,
        WORLD_LABS_SECRET_NAME: worldLabsSecret.secretName,
      },
      ephemeralStorageSize: Size.gibibytes(4),
      handler: "main",
      memorySize: 3008,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(15),
    });
    worldGenerationHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    worldGenerationHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    worldLabsSecret.grantRead(worldGenerationHandler);
    const startWorld = new tasks.LambdaInvoke(this, "StartApprovedWorldGeneration", {
      lambdaFunction: worldGenerationHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        mode: "start",
        confirmPaidWorld: true,
      }),
      payloadResponseOnly: true,
      resultPath: "$.worldGeneration",
      retryOnServiceExceptions: false,
    });
    const pollWorld = new tasks.LambdaInvoke(this, "PollWorldGeneration", {
      lambdaFunction: worldGenerationHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        "pollCount.$": "$.worldGeneration.pollCount",
        mode: "poll",
        confirmPaidWorld: true,
      }),
      payloadResponseOnly: true,
      resultPath: "$.worldGeneration",
      retryOnServiceExceptions: false,
    });
    const waitForWorld = new stepfunctions.Wait(this, "WaitForWorldGeneration", {
      time: stepfunctions.WaitTime.duration(Duration.minutes(1)),
    });
    const landmarkHandler = new lambdaNodejs.NodejsFunction(this, "LandmarkDetectionHandler", {
      architecture: lambda.Architecture.X86_64,
      bundling: {
        bundleAwsSDK: true,
        forceDockerBundling: true,
        minify: true,
        nodeModules: ["sharp"],
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/landmark-detection-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        GOOGLE_SECRET_NAME: googleSecret.secretName,
        LANDMARK_VISION_MODEL: config.landmarkVisionModel,
      },
      ephemeralStorageSize: Size.gibibytes(2),
      handler: "main",
      memorySize: 3008,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(7),
    });
    landmarkHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    landmarkHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    googleSecret.grantRead(landmarkHandler);
    const detectLandmarks = new tasks.LambdaInvoke(this, "DetectPrivateLandmarks", {
      lambdaFunction: landmarkHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        confirmPaidLandmarks: true,
      }),
      payloadResponseOnly: true,
      resultPath: "$.landmarks",
      retryOnServiceExceptions: false,
    });
    const interactionBakingHandler = new lambdaNodejs.NodejsFunction(this, "InteractionBakingHandler", {
      architecture: lambda.Architecture.X86_64,
      bundling: {
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        bundleAwsSDK: true,
        forceDockerBundling: true,
        format: lambdaNodejs.OutputFormat.ESM,
        minify: true,
        nodeModules: ["@sparticuz/chromium", "puppeteer-core"],
        sourceMap: true,
        target: "node24",
      },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/interaction-baking-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        EXPLORER_SITE_BUCKET: explorerSite.bucket.bucketName,
      },
      ephemeralStorageSize: Size.gibibytes(4),
      handler: "main",
      memorySize: 3008,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(15),
    });
    interactionBakingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    interactionBakingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    interactionBakingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [
        explorerSite.bucket.arnForObjects("bake/*"),
        explorerSite.bucket.arnForObjects("_next/static/*"),
        explorerSite.bucket.arnForObjects("images/*"),
      ],
    }));
    const bakeInteractions = new tasks.LambdaInvoke(this, "BakePrivateInteractions", {
      lambdaFunction: interactionBakingHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId" }),
      payloadResponseOnly: true,
      resultPath: "$.interactions",
      retryOnServiceExceptions: false,
    });
    const publicationStageHandler = new lambdaNodejs.NodejsFunction(this, "PublicationStageHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/publication-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        PUBLIC_ASSET_BUCKET: publicAssets.bucketName,
      },
      handler: "main",
      memorySize: 1024,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(3),
    });
    publicationStageHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    publicationStageHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    const publishHandler = new lambdaNodejs.NodejsFunction(this, "PublicPublicationHandler", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: true, target: "node24" },
      depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      entry: resolve(pipelineRoot, "src/cloud/publication-handler.ts"),
      environment: {
        ARTIFACT_BUCKET: artifacts.bucketName,
        PUBLIC_ASSET_BUCKET: publicAssets.bucketName,
      },
      handler: "main",
      memorySize: 3008,
      projectRoot: pipelineRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(15),
    });
    publishHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [artifacts.arnForObjects("editions/*")],
    }));
    publishHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "editions/*" } },
      resources: [artifacts.bucketArn],
    }));
    publishHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [publicAssets.arnForObjects("generated/*")],
    }));
    publishHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      conditions: { StringLike: { "s3:prefix": "generated/*" } },
      resources: [publicAssets.bucketArn],
    }));
    const stagePublication = new tasks.LambdaInvoke(this, "StagePrivatePublication", {
      lambdaFunction: publicationStageHandler,
      payload: stepfunctions.TaskInput.fromObject({ "editionId.$": "$.editionId", mode: "stage" }),
      payloadResponseOnly: true,
      resultPath: "$.publication",
      retryOnServiceExceptions: false,
    });
    const publishEdition = new tasks.LambdaInvoke(this, "PublishApprovedEdition", {
      lambdaFunction: publishHandler,
      payload: stepfunctions.TaskInput.fromObject({
        "editionId.$": "$.editionId",
        mode: "publish",
        confirmPublish: true,
      }),
      payloadResponseOnly: true,
      resultPath: "$.publication",
      retryOnServiceExceptions: false,
    });
    const candidatesReady = new stepfunctions.Succeed(this, "LiveCandidatesCollected");
    const shortlistReady = new stepfunctions.Succeed(this, "LiveEditorialShortlistReady");
    const articlesReady = new stepfunctions.Succeed(this, "LiveEditionReadyForReview");
    const artDirectionReady = new stepfunctions.Succeed(this, "LiveArtDirectionReadyForReview");
    const panoramaReady = new stepfunctions.Succeed(this, "LivePrivatePanoramaReadyForReview");
    const worldReady = new stepfunctions.Succeed(this, "LivePrivateWorldReadyForReview");
    const previewReady = new stepfunctions.Succeed(this, "LivePrivatePreviewReadyForReview");
    const published = new stepfunctions.Succeed(this, "LiveEditionPublished");
    const publicationGate = new stepfunctions.Choice(this, "ConfirmPublicPublication")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPublish"),
          stepfunctions.Condition.booleanEquals("$.confirmPublish", true),
        ),
        publishEdition.next(published),
      )
      .otherwise(previewReady);
    const landmarkGate = new stepfunctions.Choice(this, "ConfirmPaidLandmarkDetection")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPaidLandmarks"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidLandmarks", true),
        ),
        detectLandmarks.next(bakeInteractions).next(stagePublication).next(publicationGate),
      )
      .otherwise(worldReady);
    const worldFailed = new stepfunctions.Fail(this, "LiveWorldGenerationFailed");
    const worldTimedOut = new stepfunctions.Fail(this, "LiveWorldGenerationTimedOut");
    const worldStatus = new stepfunctions.Choice(this, "CheckWorldGenerationStatus")
      .when(stepfunctions.Condition.stringEquals("$.worldGeneration.status", "completed"), landmarkGate)
      .when(stepfunctions.Condition.stringEquals("$.worldGeneration.status", "failed"), worldFailed)
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.stringEquals("$.worldGeneration.status", "running"),
          stepfunctions.Condition.numberLessThan("$.worldGeneration.pollCount", 90),
        ),
        waitForWorld,
      )
      .otherwise(worldTimedOut);
    waitForWorld.next(pollWorld).next(worldStatus);
    const worldGate = new stepfunctions.Choice(this, "ConfirmPaidWorldGeneration")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPaidWorld"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidWorld", true),
        ),
        startWorld.next(worldStatus),
      )
      .otherwise(panoramaReady);
    const panoramaGate = new stepfunctions.Choice(this, "ConfirmPaidPanorama")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPaidPanorama"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidPanorama", true),
        ),
        generateRawPanorama.next(processPanorama).next(worldGate),
      )
      .otherwise(artDirectionReady);
    const artDirectionGate = new stepfunctions.Choice(this, "ConfirmPaidArtDirection")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPaidArtDirection"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidArtDirection", true),
        ),
        createArtDirection.next(panoramaGate),
      )
      .otherwise(articlesReady);
    const articleAnalysisGate = new stepfunctions.Choice(this, "ConfirmPaidArticleAnalysis")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmLiveArticleFetch"),
          stepfunctions.Condition.booleanEquals("$.confirmLiveArticleFetch", true),
          stepfunctions.Condition.isPresent("$.confirmPaidArticleAnalysis"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidArticleAnalysis", true),
        ),
        prepareArticleAnalysis.next(analyzeArticles).next(finalizeEdition).next(artDirectionGate),
      )
      .otherwise(shortlistReady);
    const paidAnalysisGate = new stepfunctions.Choice(this, "ConfirmPaidEditorialAnalysis")
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.isPresent("$.confirmPaidAnalysis"),
          stepfunctions.Condition.booleanEquals("$.confirmPaidAnalysis", true),
        ),
        createShortlist.next(articleAnalysisGate),
      )
      .otherwise(candidatesReady);
    const liveCollectionStateMachine = new stepfunctions.StateMachine(this, "LiveCollectionStateMachine", {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(
        collectCandidates.next(paidAnalysisGate),
      ),
      logs: {
        destination: workflowLogs,
        includeExecutionData: false,
        level: stepfunctions.LogLevel.ALL,
      },
      stateMachineType: stepfunctions.StateMachineType.STANDARD,
      tracingEnabled: true,
    });

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
    new CfnOutput(this, "LiveCollectionStateMachineArn", {
      value: liveCollectionStateMachine.stateMachineArn,
    });
    new CfnOutput(this, "GoogleSecretName", { value: googleSecret.secretName });
    new CfnOutput(this, "WorldLabsSecretName", { value: worldLabsSecret.secretName });
    new CfnOutput(this, "WorldLabsAuthProbeFunctionName", {
      value: worldLabsAuthProbe.functionName,
    });
    new CfnOutput(this, "ScheduleEnabled", { value: String(config.enableSchedule) });
  }
}

