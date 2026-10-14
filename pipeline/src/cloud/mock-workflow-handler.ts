import { DynamoDbEditionRepository } from "../storage/dynamodb-edition-repository.js";
import {
  editionStatusSchema,
  type EditionRepository,
  type EditionState,
  type EditionStatus,
} from "../storage/edition-repository.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";

type WorkflowState = {
  continueAfterReview: boolean;
  editionId: string;
  lockOwner: string;
  status: EditionStatus;
};

type MockWorkflowEvent =
  | {
      action: "initialize";
      input?: { continueAfterReview?: unknown; editionId?: unknown };
      lockOwner: string;
    }
  | {
      action: "advance";
      expected: EditionStatus;
      next: EditionStatus;
      state: WorkflowState;
    }
  | { action: "release"; state: WorkflowState }
  | { action: "publish"; state: WorkflowState }
  | {
      action: "fail";
      error?: unknown;
      stage: string;
      state: WorkflowState;
    };

type Dependencies = {
  artifacts: ArtifactStore;
  editions: EditionRepository;
  now: () => Date;
  publicAssets: ArtifactStore;
};

const statusOrder = [
  "DRAFT",
  "COLLECTED",
  "SELECTED",
  "EDITORIAL_APPROVED",
  "IMAGE_GENERATED",
  "IMAGE_APPROVED",
  "WORLD_GENERATING",
  "WORLD_GENERATED",
  "QA_APPROVED",
  "PUBLISHED",
] as const;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function assertWorkflowState(value: unknown): WorkflowState {
  if (!value || typeof value !== "object") throw new Error("Workflow state is required");
  const input = value as Record<string, unknown>;
  if (
    typeof input.editionId !== "string" ||
    typeof input.lockOwner !== "string" ||
    typeof input.continueAfterReview !== "boolean"
  ) throw new Error("Workflow state is invalid");
  return {
    continueAfterReview: input.continueAfterReview,
    editionId: input.editionId,
    lockOwner: input.lockOwner,
    status: editionStatusSchema.parse(input.status),
  };
}

function defaultEditionId(now: Date): string {
  return `edition-${now.toISOString().slice(0, 10)}`;
}

function publicState(state: EditionState, input: Pick<WorkflowState, "continueAfterReview" | "lockOwner">): WorkflowState {
  return {
    continueAfterReview: input.continueAfterReview,
    editionId: state.editionId,
    lockOwner: input.lockOwner,
    status: state.status,
  };
}

async function renewLock(
  editions: EditionRepository,
  state: WorkflowState,
  now: Date,
): Promise<EditionState> {
  return editions.acquireLock({
    editionId: state.editionId,
    owner: state.lockOwner,
    now,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1_000),
  });
}

function hasReached(current: EditionStatus, target: EditionStatus): boolean {
  const currentIndex = statusOrder.indexOf(current as typeof statusOrder[number]);
  const targetIndex = statusOrder.indexOf(target as typeof statusOrder[number]);
  return currentIndex >= 0 && targetIndex >= 0 && currentIndex >= targetIndex;
}

function boundedError(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "Unknown workflow error");
  return text.slice(0, 2_000);
}

export function createMockWorkflowHandler(dependencies: Dependencies) {
  return async (rawEvent: unknown): Promise<WorkflowState> => {
    if (!rawEvent || typeof rawEvent !== "object" || !("action" in rawEvent)) {
      throw new Error("Mock workflow action is required");
    }
    const event = rawEvent as MockWorkflowEvent;
    const now = dependencies.now();

    if (event.action === "initialize") {
      const requestedId = event.input?.editionId;
      const editionId = typeof requestedId === "string"
        ? requestedId
        : defaultEditionId(now);
      const lockOwner = event.lockOwner.slice(0, 160);
      const continueAfterReview = event.input?.continueAfterReview === true;
      let state = await dependencies.editions.get(editionId);
      state ??= await dependencies.editions.createDraft(editionId, now);
      if (state.status !== "PUBLISHED" && state.status !== "FAILED") {
        state = await renewLock(
          dependencies.editions,
          { continueAfterReview, editionId, lockOwner, status: state.status },
          now,
        );
      }
      return publicState(state, { continueAfterReview, lockOwner });
    }

    const workflowState = assertWorkflowState(event.state);

    if (event.action === "release") {
      const state = await dependencies.editions.get(workflowState.editionId);
      if (!state) throw new Error(`Edition does not exist: ${workflowState.editionId}`);
      if (state.lock?.owner !== workflowState.lockOwner) return publicState(state, workflowState);
      return publicState(await dependencies.editions.releaseLock({
        editionId: workflowState.editionId,
        now,
        owner: workflowState.lockOwner,
      }), workflowState);
    }

    if (event.action === "fail") {
      const existing = await dependencies.editions.get(workflowState.editionId);
      if (!existing) throw new Error(`Edition does not exist: ${workflowState.editionId}`);
      if (existing.status === "FAILED") return publicState(existing, workflowState);
      const failed = await dependencies.editions.fail({
        editionId: workflowState.editionId,
        message: boundedError(event.error),
        now,
        owner: workflowState.lockOwner,
        stage: event.stage.slice(0, 100),
      });
      return publicState(failed, workflowState);
    }

    if (event.action === "publish") {
      let state = await dependencies.editions.get(workflowState.editionId);
      if (!state) throw new Error(`Edition does not exist: ${workflowState.editionId}`);
      if (state.status !== "PUBLISHED") {
        if (state.status !== "QA_APPROVED") {
          throw new Error(`Edition ${state.editionId} is not approved for fixture publication`);
        }
        await renewLock(dependencies.editions, workflowState, now);
        const manifestKey = `fixtures/${state.editionId}/cloud-workflow.json`;
        await dependencies.publicAssets.putImmutable({
          key: manifestKey,
          contentType: "application/json",
          bytes: Buffer.from(`${JSON.stringify({
            artifactType: "cloud-workflow-fixture",
            createdAt: state.updatedAt,
            editionId: state.editionId,
            fictional: true,
            notForPublicDisplay: true,
            schemaVersion: "1.0.0",
          }, null, 2)}\n`),
          metadata: { editionId: state.editionId, fictional: "true" },
        });
        await dependencies.editions.publish({ editionId: state.editionId, manifestKey, now });
        state = (await dependencies.editions.get(state.editionId)) ?? state;
      }
      if (state.lock?.owner === workflowState.lockOwner) {
        state = await dependencies.editions.releaseLock({
          editionId: state.editionId,
          now,
          owner: workflowState.lockOwner,
        });
      }
      return publicState(state, workflowState);
    }

    const expected = editionStatusSchema.parse(event.expected);
    const next = editionStatusSchema.parse(event.next);
    let state = await dependencies.editions.get(workflowState.editionId);
    if (!state) throw new Error(`Edition does not exist: ${workflowState.editionId}`);
    if (!hasReached(state.status, next)) {
      if (state.status !== expected) {
        throw new Error(`Edition ${state.editionId} is ${state.status}; expected ${expected}`);
      }
      await renewLock(dependencies.editions, workflowState, now);
      state = await dependencies.editions.transition({
        editionId: state.editionId,
        expected,
        next,
        now,
      });
    }
    await dependencies.artifacts.putImmutable({
      key: `fixtures/${state.editionId}/states/${next.toLowerCase()}.json`,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify({
        artifactType: "cloud-workflow-state-fixture",
        createdAt: state.updatedAt,
        editionId: state.editionId,
        fictional: true,
        schemaVersion: "1.0.0",
        status: next,
      }, null, 2)}\n`),
      metadata: { editionId: state.editionId, fictional: "true", status: next },
    });
    return publicState(state, workflowState);
  };
}

export async function main(event: unknown): Promise<WorkflowState> {
  return createMockWorkflowHandler({
    artifacts: new S3ArtifactStore({ bucket: requiredEnvironment("ARTIFACT_BUCKET") }),
    editions: new DynamoDbEditionRepository({ tableName: requiredEnvironment("EDITION_TABLE") }),
    now: () => new Date(),
    publicAssets: new S3ArtifactStore({ bucket: requiredEnvironment("PUBLIC_ASSET_BUCKET") }),
  })(event);
}

