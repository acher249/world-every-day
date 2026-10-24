import { App } from "aws-cdk-lib";
import { VideoProbeStack } from "../lib/video-probe-stack.js";

const bucket = process.env.WORLD_VIDEO_ARTIFACT_BUCKET;
if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
  throw new Error("Set WORLD_VIDEO_ARTIFACT_BUCKET to the existing world artifact bucket");
}
new VideoProbeStack(new App(), "WorldEveryDay-VideoProbe", {
  artifactBucketName: bucket,
  publicAssetBucketName: process.env.WORLD_VIDEO_PUBLIC_ASSET_BUCKET,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
