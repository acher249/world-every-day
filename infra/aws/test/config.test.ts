import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeploymentConfig } from "../lib/config.js";

function context(values: Record<string, unknown>) {
  return { tryGetContext: (key: string) => values[key] };
}

test("deployment defaults are development and schedule-disabled", () => {
  assert.deepEqual(readDeploymentConfig(context({}) as never), {
    alarmNotificationEmail: undefined,
    budgetAlertEmail: undefined,
    enableSchedule: false,
    environmentName: "development",
    monthlyBudgetUsd: undefined,
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
      budgetAlertEmail: "alerts@example.com",
      enableSchedule: true,
      environmentName: "production",
      monthlyBudgetUsd: 40,
    },
  );
  assert.equal(
    readDeploymentConfig(
      context({ environmentName: "development" }) as never,
      { WORLD_EVERY_DAY_ENVIRONMENT: "production" },
    ).environmentName,
    "development",
  );
});

