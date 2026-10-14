#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { config as loadEnvironment } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeploymentConfig } from "../lib/config.js";
import { WorldEveryDayStack } from "../lib/world-every-day-stack.js";

loadEnvironment({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local"),
  quiet: true,
});

const app = new App();
const config = readDeploymentConfig(app.node, process.env);

new WorldEveryDayStack(app, `WorldEveryDay-${config.environmentName}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

