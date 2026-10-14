import type { Node } from "constructs";

export type DeploymentConfig = {
  alarmNotificationEmail?: string;
  budgetAlertEmail?: string;
  enableSchedule: boolean;
  environmentName: "development" | "production";
  monthlyBudgetUsd?: number;
  siteDomain?: {
    explorerSubdomain: string;
    hostedZoneId: string;
    rootDomain: string;
  };
};

type Environment = Record<string, string | undefined>;

function optionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return number;
}

function setting(
  node: Pick<Node, "tryGetContext">,
  environment: Environment,
  contextName: string,
  environmentName: string,
): unknown {
  return node.tryGetContext(contextName) ?? environment[environmentName];
}

export function readDeploymentConfig(
  node: Pick<Node, "tryGetContext">,
  environment: Environment = process.env,
): DeploymentConfig {
  const alarmNotificationEmail = setting(
    node,
    environment,
    "alarmNotificationEmail",
    "WORLD_EVERY_DAY_ALARM_EMAIL",
  );
  const environmentName = setting(
    node,
    environment,
    "environmentName",
    "WORLD_EVERY_DAY_ENVIRONMENT",
  ) ?? "development";
  if (environmentName !== "development" && environmentName !== "production") {
    throw new Error("environmentName must be development or production");
  }
  const rawEnableSchedule = setting(
    node,
    environment,
    "enableSchedule",
    "WORLD_EVERY_DAY_ENABLE_SCHEDULE",
  );
  const enableSchedule = rawEnableSchedule === true || rawEnableSchedule === "true";
  const budgetAlertEmail = setting(
    node,
    environment,
    "budgetAlertEmail",
    "WORLD_EVERY_DAY_BUDGET_ALERT_EMAIL",
  );
  const monthlyBudgetUsd = optionalPositiveNumber(
    setting(
      node,
      environment,
      "monthlyBudgetUsd",
      "WORLD_EVERY_DAY_MONTHLY_BUDGET_USD",
    ),
    "monthlyBudgetUsd",
  );
  if ((budgetAlertEmail && !monthlyBudgetUsd) || (!budgetAlertEmail && monthlyBudgetUsd)) {
    throw new Error("budgetAlertEmail and monthlyBudgetUsd must be configured together");
  }
  if (budgetAlertEmail && !/^\S+@\S+\.\S+$/.test(String(budgetAlertEmail))) {
    throw new Error("budgetAlertEmail must be a valid email address");
  }
  if (
    alarmNotificationEmail &&
    !/^\S+@\S+\.\S+$/.test(String(alarmNotificationEmail))
  ) throw new Error("alarmNotificationEmail must be a valid email address");
  const rootDomain = setting(
    node,
    environment,
    "siteDomainName",
    "WORLD_EVERY_DAY_SITE_DOMAIN",
  );
  const hostedZoneId = setting(
    node,
    environment,
    "hostedZoneId",
    "WORLD_EVERY_DAY_HOSTED_ZONE_ID",
  );
  const explorerSubdomain = setting(
    node,
    environment,
    "explorerSubdomain",
    "WORLD_EVERY_DAY_EXPLORER_SUBDOMAIN",
  ) ?? "explore";
  if ((rootDomain && !hostedZoneId) || (!rootDomain && hostedZoneId)) {
    throw new Error("siteDomainName and hostedZoneId must be configured together");
  }
  if (
    rootDomain &&
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(rootDomain))
  ) throw new Error("siteDomainName must be a valid domain name without a protocol or path");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(explorerSubdomain))) {
    throw new Error("explorerSubdomain must be a valid DNS label");
  }
  if (rootDomain && environment.CDK_DEFAULT_REGION && environment.CDK_DEFAULT_REGION !== "us-east-1") {
    throw new Error("Custom CloudFront domains must be deployed from this stack in us-east-1");
  }
  return {
    alarmNotificationEmail: alarmNotificationEmail
      ? String(alarmNotificationEmail)
      : undefined,
    budgetAlertEmail: budgetAlertEmail ? String(budgetAlertEmail) : undefined,
    enableSchedule,
    environmentName,
    monthlyBudgetUsd,
    siteDomain: rootDomain && hostedZoneId ? {
      explorerSubdomain: String(explorerSubdomain).toLowerCase(),
      hostedZoneId: String(hostedZoneId),
      rootDomain: String(rootDomain).toLowerCase(),
    } : undefined,
  };
}

