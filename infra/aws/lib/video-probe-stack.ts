import { CfnOutput, Duration, RemovalPolicy, Size, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as deployment from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { VideoWorkflow } from "./video-workflow.js";

/** Independent manual benchmark. Never instantiated by the daily application. */
export class VideoProbeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { artifactBucketName: string; publicAssetBucketName?: string }) {
    super(scope, id, props);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const pipelineRoot = resolve(root, "pipeline");
    const bucket = new s3.Bucket(this, "ProbeAssets", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ prefix: "probes/", expiration: Duration.days(7) }],
    });
    new deployment.BucketDeployment(this, "CaptureBuild", {
      sources: [deployment.Source.asset(resolve(root, "frontend/out"), { exclude: ["generated/**", "images/**"] })],
      destinationBucket: bucket,
      destinationKeyPrefix: "site",
    });
    const logGroup = new logs.LogGroup(this, "ProbeLogs", { retention: logs.RetentionDays.ONE_WEEK });
    const fn = new nodejs.NodejsFunction(this, "CaptureProbe", {
      entry: resolve(pipelineRoot, "src/video/probe-handler.ts"), handler: "main",
      projectRoot: pipelineRoot, depsLockFilePath: resolve(pipelineRoot, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.X86_64,
      memorySize: 3008, ephemeralStorageSize: Size.gibibytes(4), timeout: Duration.minutes(15),
      // Small accounts may not have enough concurrency quota to reserve a slot.
      // This manual-only probe is invoked sequentially by the operator.
      logGroup,
      environment: { ARTIFACT_BUCKET: props.artifactBucketName, PROBE_BUCKET: bucket.bucketName },
      bundling: {
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        bundleAwsSDK: true, forceDockerBundling: true, format: nodejs.OutputFormat.ESM,
        minify: true, nodeModules: ["@sparticuz/chromium", "puppeteer-core"], target: "node24",
      },
    });
    const artifacts = s3.Bucket.fromBucketName(this, "WorldArtifacts", props.artifactBucketName);
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [
      artifacts.arnForObjects("editions/*/world/generated-world.json"),
      artifacts.arnForObjects("editions/*/world/assets/world.spz"),
      bucket.arnForObjects("site/capture/*"), bucket.arnForObjects("site/_next/static/*"),
    ] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [bucket.arnForObjects("probes/*")] }));
    new CfnOutput(this, "FunctionName", { value: fn.functionName });
    new CfnOutput(this, "ProbeBucket", { value: bucket.bucketName });
    if (props.publicAssetBucketName) {
      const video = new VideoWorkflow(this, "Video", { artifacts,
        publicAssets: s3.Bucket.fromBucketName(this, "PublicAssets", props.publicAssetBucketName) });
      const workflow = new sfn.StateMachine(this, "VideoWorkflow", {
        definitionBody: sfn.DefinitionBody.fromChainable(video.chain), timeout: Duration.hours(3),
      });
      new CfnOutput(this, "VideoStateMachineArn", { value: workflow.stateMachineArn });
      // Historical videos share the same ten render slots. Serialize editions,
      // while each child workflow still renders its ten batches concurrently.
      const backfill = new sfn.Map(this, "HistoricalEditions", {
        itemsPath: "$.editions", maxConcurrency: 1, resultPath: sfn.JsonPath.DISCARD,
      }).itemProcessor(new tasks.StepFunctionsStartExecution(this, "RenderHistoricalVideo", {
        stateMachine: workflow, integrationPattern: sfn.IntegrationPattern.RUN_JOB,
        input: sfn.TaskInput.fromJsonPathAt("$"), resultPath: sfn.JsonPath.DISCARD,
      }));
      const history = new sfn.StateMachine(this, "VideoBackfillWorkflow", {
        definitionBody: sfn.DefinitionBody.fromChainable(backfill), timeout: Duration.hours(12),
      });
      new CfnOutput(this, "VideoBackfillStateMachineArn", { value: history.stateMachineArn });
    }
  }
}
