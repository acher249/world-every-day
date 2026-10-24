import { Duration, Size } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Construct } from "constructs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Optional post-publication work; no schedule or generation service credentials. */
export class VideoWorkflow extends Construct {
  readonly chain: sfn.Chain;
  readonly failureAlarm: cloudwatch.Alarm;
  constructor(scope: Construct, id: string, props: {
    artifacts: s3.IBucket; publicAssets: s3.IBucket;
  }) {
    super(scope, id);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../pipeline");
    const capture = new Asset(this, "CaptureAsset", { path: resolve(root, "../frontend/out"), exclude: ["generated/**", "images/**"] });
    new BucketDeployment(this, "CaptureBuild", {
      sources: [Source.bucket(capture.bucket, capture.s3ObjectKey)], destinationBucket: props.artifacts,
      destinationKeyPrefix: `video-builds/${capture.assetHash}`, prune: false, retainOnDelete: true,
    });
    const environment = { ARTIFACT_BUCKET: props.artifacts.bucketName, PUBLIC_ASSET_BUCKET: props.publicAssets.bucketName,
      VIDEO_CAPTURE_BUILD: capture.assetHash };
    const prepare = new nodejs.NodejsFunction(this, "Prepare", {
      entry: resolve(root, "src/video/prepare-handler.ts"), handler: "main", projectRoot: root,
      depsLockFilePath: resolve(root, "package-lock.json"), runtime: lambda.Runtime.NODEJS_24_X,
      bundling: { bundleAwsSDK: true, minify: true }, environment, memorySize: 256, timeout: Duration.minutes(1),
      logGroup: new logs.LogGroup(this, "PrepareLogs", { retention: logs.RetentionDays.ONE_MONTH }),
    });
    const render = new nodejs.NodejsFunction(this, "Render", {
      entry: resolve(root, "src/video/batch-handler.ts"), handler: "main", projectRoot: root,
      depsLockFilePath: resolve(root, "package-lock.json"), runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.X86_64,
      memorySize: 3008, ephemeralStorageSize: Size.gibibytes(4), timeout: Duration.minutes(15),
      environment,
      bundling: { banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        format: nodejs.OutputFormat.ESM, bundleAwsSDK: true, forceDockerBundling: true,
        nodeModules: ["@sparticuz/chromium", "puppeteer-core"], minify: true, target: "node24" },
      logGroup: new logs.LogGroup(this, "RenderLogs", { retention: logs.RetentionDays.ONE_MONTH }),
    });
    const assemble = new lambda.DockerImageFunction(this, "Assemble", {
      code: lambda.DockerImageCode.fromImageAsset(root, { file: "src/video/encoder/Dockerfile", platform: Platform.LINUX_ARM64,
        exclude: ["node_modules", "dist", ".env", ".env.*", "artifacts", "test"] }),
      architecture: lambda.Architecture.ARM_64, memorySize: 3008, ephemeralStorageSize: Size.gibibytes(4),
      timeout: Duration.minutes(15), environment,
      logGroup: new logs.LogGroup(this, "AssembleLogs", { retention: logs.RetentionDays.ONE_MONTH }),
    });
    const permit = (fn: lambda.Function, actions: string[], resources: string[]) => fn.addToRolePolicy(new iam.PolicyStatement({ actions, resources }));
    this.failureAlarm = new cloudwatch.Alarm(this, "VideoFailureAlarm", {
      metric: new cloudwatch.MathExpression({ expression: "prepare + render + assemble", period: Duration.minutes(5),
        usingMetrics: { prepare: prepare.metricErrors(), render: render.metricErrors(), assemble: assemble.metricErrors() } }),
      threshold: 1, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "World remains published, but an optional video stage failed. Inspect batches before retrying.",
    });
    // S3 needs ListBucket permission to distinguish a missing resume marker
    // (404) from denied access (403); object reads/writes remain prefix-scoped.
    for (const fn of [prepare, render, assemble]) permit(fn, ["s3:ListBucket"], [props.artifacts.bucketArn]);
    permit(prepare, ["s3:GetObject"], [props.artifacts.arnForObjects("editions/*/world/generated-world.json"), props.artifacts.arnForObjects("videos/*"), props.publicAssets.arnForObjects("generated/editions/*/publication*.json")]);
    permit(prepare, ["s3:GetObject", "s3:PutObject"], [props.artifacts.arnForObjects("video-work/*")]);
    permit(render, ["s3:GetObject", "s3:PutObject"], [props.artifacts.arnForObjects("video-work/*")]);
    permit(render, ["s3:GetObject"], [props.artifacts.arnForObjects("editions/*/world/assets/world.spz"),
      props.publicAssets.arnForObjects("generated/editions/*/publication*.json"),
      props.artifacts.arnForObjects("video-builds/*/index.html"), props.artifacts.arnForObjects("video-builds/*/_next/static/*"),
      props.artifacts.arnForObjects("video-builds/*/capture/fonts/*")]);
    permit(assemble, ["s3:GetObject"], [props.artifacts.arnForObjects("video-work/*"), props.publicAssets.arnForObjects("generated/editions/*/publication*.json")]);
    permit(assemble, ["s3:GetObject", "s3:PutObject"], [props.artifacts.arnForObjects("videos/*"), props.publicAssets.arnForObjects("generated/editions/*/video/*")]);
    const initialize = new tasks.LambdaInvoke(this, "PrepareVideoJob", { lambdaFunction: prepare, payloadResponseOnly: true, resultPath: "$.videoJob" });
    const batch = new tasks.LambdaInvoke(this, "RenderVideoBatch", { lambdaFunction: render, payloadResponseOnly: true, retryOnServiceExceptions: false });
    batch.addRetry({ errors: ["Lambda.TooManyRequestsException", "Lambda.ServiceException", "Lambda.SdkClientException", "Lambda.AWSLambdaException"], interval: Duration.seconds(10), backoffRate: 2, maxAttempts: 6, jitterStrategy: sfn.JitterType.FULL });
    batch.addRetry({ errors: ["States.TaskFailed"], interval: Duration.seconds(30), maxAttempts: 1 });
    const batches = new sfn.Map(this, "RenderVideoBatches", { itemsPath: "$.videoJob.batches", maxConcurrency: 10, resultPath: sfn.JsonPath.DISCARD }).itemProcessor(batch);
    const finish = new tasks.LambdaInvoke(this, "AssembleWorldVideo", { lambdaFunction: assemble, payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        editionId: sfn.JsonPath.stringAt("$.videoJob.editionId"),
        jobId: sfn.JsonPath.stringAt("$.videoJob.jobId"),
      }), resultPath: "$.video" });
    const ready = new sfn.Choice(this, "VideoAlreadyComplete").when(sfn.Condition.booleanEquals("$.videoJob.complete", true), finish).otherwise(batches.next(finish));
    this.chain = initialize.next(ready.afterwards());
  }
}
