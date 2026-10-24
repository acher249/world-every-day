import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeploymentConfig } from "../lib/config.js";

function context(values: Record<string, unknown>) {
  return { tryGetContext: (key: string) => values[key] };
}

test("video posting is disabled by default and requires an X account", () => {
  assert.equal(readDeploymentConfig(context({}), {}).xVideoEnabled, false);
  assert.throws(() => readDeploymentConfig(context({}), { WORLD_EVERY_DAY_X_VIDEO_ENABLED: "true" }), /requires/);
  assert.equal(readDeploymentConfig(context({}), { WORLD_EVERY_DAY_X_VIDEO_ENABLED: "true", WORLD_EVERY_DAY_X_ACCOUNT_ID: "123" }).xVideoEnabled, true);
});

test("X posting requires an explicit numeric account ID and permits blank disabled config", () => {
  assert.equal(readDeploymentConfig(context({}), { WORLD_EVERY_DAY_X_ACCOUNT_ID: "" }).xPostingAccountId, undefined);
  assert.equal(readDeploymentConfig(context({}), { WORLD_EVERY_DAY_X_ACCOUNT_ID: "123" }).xPostingAccountId, "123");
  assert.throws(() => readDeploymentConfig(context({}), { WORLD_EVERY_DAY_X_ACCOUNT_ID: "@example" }), /numeric/);
});

test("deployment defaults are development and schedule-disabled", () => {
  assert.deepEqual(readDeploymentConfig(context({}) as never), {
    alarmNotificationEmail: undefined,
    articleAnalysisModel: "amazon.nova-lite-v1:0",
    budgetAlertEmail: undefined,
    editorialModel: "amazon.nova-lite-v1:0",
    editorialProvider: "google-gemini",
    geminiEditorialModel: "gemini-3.8-flash",
    landmarkVisionModel: "gemini-3.8-flash",
    enableSchedule: false,
    xVideoEnabled: false,
    environmentName: "development",
    monthlyBudgetUsd: undefined,
    nanoBananaModel: "gemini-nano-banana-2.1",
    worldLabsModel: "marble-1.1",
    siteDomain: undefined,
  });
});

test("budget and notification settings are validated", () => {
  assert.throws(
    () => readDeploymentConfig(context({ monthlyBudgetUsd: 25 }) as never),
    /configured together/,
  );
  assert.throws(
    () => readDeploymentConfig(context({ alarmNotificationEmail: "not-an-email" }) as never),
    /valid email/,
  );
  assert.throws(
    () => readDeploymentConfig(context({ budgetAlertEmail: "not-an-email", monthlyBudgetUsd: 25 }) as never),
    /valid email/,
  );
});

test("ignored local environment settings are supported but CDK context wins", () => {
  assert.deepEqual(
    readDeploymentConfig(context({}) as never, {
      WORLD_EVERY_DAY_ENVIRONMENT: "production",
      WORLD_EVERY_DAY_ENABLE_SCHEDULE: "true",
      WORLD_EVERY_DAY_ALARM_EMAIL: "operations@example.com",
      WORLD_EVERY_DAY_MONTHLY_BUDGET_USD: "40",
      WORLD_EVERY_DAY_BUDGET_ALERT_EMAIL: "alerts@example.com",
    }),
    {
      alarmNotificationEmail: "operations@example.com",
      articleAnalysisModel: "amazon.nova-lite-v1:0",
      budgetAlertEmail: "alerts@example.com",
      editorialModel: "amazon.nova-lite-v1:0",
      editorialProvider: "google-gemini",
      geminiEditorialModel: "gemini-3.8-flash",
      landmarkVisionModel: "gemini-3.8-flash",
      enableSchedule: true,
      xVideoEnabled: false,
      environmentName: "production",
      monthlyBudgetUsd: 40,
      nanoBananaModel: "gemini-nano-banana-2.1",
      worldLabsModel: "marble-1.1",
      siteDomain: undefined,
    },
  );
  assert.equal(
    readDeploymentConfig(
      context({ environmentName: "development" }) as never,
      { WORLD_EVERY_DAY_ENVIRONMENT: "production" },
    ).environmentName,
    "development",
  );
  assert.throws(
    () => readDeploymentConfig(context({ editorialModel: "gemini-3.8-flash" }) as never),
    /source-bearing text/,
  );
  assert.throws(
    () => readDeploymentConfig(context({ articleAnalysisModel: "anthropic.claude-v1" }) as never),
    /Amazon-operated model/,
  );
  assert.throws(
    () => readDeploymentConfig(context({ geminiEditorialModel: "claude-haiku-4-5" }) as never),
    /Gemini model identifier/,
  );
});

test("unsupported editorial providers fail explicitly", () => {
  assert.throws(() => readDeploymentConfig(context({ editorialProvider: "unsupported" }) as never), /editorialProvider must be/);
});

test("custom domains require a hosted zone and us-east-1", () => {
  assert.throws(
    () => readDeploymentConfig(context({ siteDomainName: "example.com" }) as never),
    /configured together/,
  );
  assert.throws(
    () => readDeploymentConfig(context({
      hostedZoneId: "Z123",
      siteDomainName: "https://example.com",
    }) as never),
    /valid domain name/,
  );
  assert.throws(
    () => readDeploymentConfig(context({
      hostedZoneId: "Z123",
      siteDomainName: "example.com",
    }) as never, { CDK_DEFAULT_REGION: "us-west-2" }),
    /us-east-1/,
  );
  assert.deepEqual(readDeploymentConfig(context({
    explorerSubdomain: "explore",
    hostedZoneId: "Z123",
    siteDomainName: "Example.com",
  }) as never, { CDK_DEFAULT_REGION: "us-east-1" }).siteDomain, {
    explorerSubdomain: "explore",
    hostedZoneId: "Z123",
    rootDomain: "example.com",
  });
});

