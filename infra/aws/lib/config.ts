import type { Node } from "constructs";

export type DeploymentConfig = {
  articleAnalysisModel: string;
  alarmNotificationEmail?: string;
  budgetAlertEmail?: string;
  editorialModel: string;
  editorialProvider: "aws-bedrock" | "google-gemini";
  geminiEditorialModel: string;
  landmarkVisionModel: string;
  nanoBananaModel: string;
  worldLabsModel: string;
  enableSchedule: boolean;
  xPostingAccountId?: string;
  xVideoEnabled?: boolean;
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
  const xPostingAccountId = setting(node, environment, "xPostingAccountId", "WORLD_EVERY_DAY_X_ACCOUNT_ID") || undefined;
  const xVideoEnabled = setting(node, environment, "xVideoEnabled", "WORLD_EVERY_DAY_X_VIDEO_ENABLED") === "true" || node.tryGetContext("xVideoEnabled") === true;
  if (xVideoEnabled && !xPostingAccountId) throw new Error("X video posting requires WORLD_EVERY_DAY_X_ACCOUNT_ID");
  if (xPostingAccountId !== undefined && !/^\d+$/.test(String(xPostingAccountId))) {
    throw new Error("xPostingAccountId must be a numeric X user ID; omit it to disable posting");
  }
  const editorialProvider = setting(node, environment, "editorialProvider", "WORLD_EVERY_DAY_EDITORIAL_PROVIDER") ?? "google-gemini";
  if (editorialProvider !== "aws-bedrock" && editorialProvider !== "google-gemini") {
    throw new Error("editorialProvider must be aws-bedrock or google-gemini");
  }
  const editorialModel = setting(
    node,
    environment,
    "editorialModel",
    "WORLD_EVERY_DAY_EDITORIAL_MODEL",
  ) ?? "amazon.nova-lite-v1:0";
  if (editorialModel !== "amazon.nova-lite-v1:0") {
    throw new Error("editorialModel must be amazon.nova-lite-v1:0 for source-bearing text stages");
  }
  const articleAnalysisModel = setting(
    node,
    environment,
    "articleAnalysisModel",
    "WORLD_EVERY_DAY_ARTICLE_ANALYSIS_MODEL",
  ) ?? "amazon.nova-lite-v1:0";
  if (articleAnalysisModel !== "amazon.nova-lite-v1:0") {
    throw new Error("articleAnalysisModel must be amazon.nova-lite-v1:0 to keep article text on an Amazon-operated model");
  }
  const geminiEditorialModel = setting(
    node,
    environment,
    "geminiEditorialModel",
    "WORLD_EVERY_DAY_GEMINI_EDITORIAL_MODEL",
  ) ?? "gemini-3.8-flash";
  if (typeof geminiEditorialModel !== "string" || !/^gemini-[a-z0-9.-]+$/.test(geminiEditorialModel)) {
    throw new Error("geminiEditorialModel must be a Gemini model identifier");
  }
  const landmarkVisionModel = setting(
    node,
    environment,
    "landmarkVisionModel",
    "WORLD_EVERY_DAY_LANDMARK_VISION_MODEL",
  ) ?? "gemini-3.8-flash";
  if (typeof landmarkVisionModel !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,159}$/.test(landmarkVisionModel)) {
    throw new Error("landmarkVisionModel must be a valid model identifier");
  }
  const nanoBananaModel = setting(
    node,
    environment,
    "nanoBananaModel",
    "WORLD_EVERY_DAY_NANO_BANANA_MODEL",
  ) ?? "gemini-nano-banana-2.1";
  if (typeof nanoBananaModel !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,159}$/.test(nanoBananaModel)) {
    throw new Error("nanoBananaModel must be a valid model identifier");
  }
  const worldLabsModel = setting(
    node,
    environment,
    "worldLabsModel",
    "WORLD_EVERY_DAY_WORLD_LABS_MODEL",
  ) ?? "marble-1.1";
  if (typeof worldLabsModel !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,159}$/.test(worldLabsModel)) {
    throw new Error("worldLabsModel must be a valid model identifier");
  }
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
    articleAnalysisModel,
    alarmNotificationEmail: alarmNotificationEmail
      ? String(alarmNotificationEmail)
      : undefined,
    budgetAlertEmail: budgetAlertEmail ? String(budgetAlertEmail) : undefined,
    editorialModel,
    editorialProvider,
    geminiEditorialModel,
    landmarkVisionModel,
    enableSchedule,
    xVideoEnabled,
    ...(xPostingAccountId === undefined ? {} : { xPostingAccountId: String(xPostingAccountId) }),
    environmentName,
    monthlyBudgetUsd,
    nanoBananaModel,
    worldLabsModel,
    siteDomain: rootDomain && hostedZoneId ? {
      explorerSubdomain: String(explorerSubdomain).toLowerCase(),
      hostedZoneId: String(hostedZoneId),
      rootDomain: String(rootDomain).toLowerCase(),
    } : undefined,
  };
}

