import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createMockWorkflowHandler } from "../src/cloud/mock-workflow-handler.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";
import {
  assertEditionTransition,
  editionStateSchema,
  type CurrentPublication,
  type EditionRepository,
  type EditionState,
  type EditionStatus,
} from "../src/storage/edition-repository.js";

class MemoryEditionRepository implements EditionRepository {
  current: CurrentPublication | null = null;
  readonly states = new Map<string, EditionState>();

  async createDraft(editionId: string, createdAt: Date): Promise<EditionState> {
    if (this.states.has(editionId)) throw new Error("Edition already exists");
    const timestamp = createdAt.toISOString();
    const state = editionStateSchema.parse({
      editionId,
      status: "DRAFT",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.states.set(editionId, state);
    return state;
  }

  async get(editionId: string): Promise<EditionState | null> {
    return this.states.get(editionId) ?? null;
  }

  async acquireLock(options: {
    editionId: string;
    expiresAt: Date;
    now: Date;
    owner: string;
  }): Promise<EditionState> {
    const state = await this.required(options.editionId);
    if (
      state.lock &&
      state.lock.owner !== options.owner &&
      new Date(state.lock.expiresAt).getTime() >= options.now.getTime()
    ) throw new Error("Edition is locked");
    return this.save({
      ...state,
      lock: { owner: options.owner, expiresAt: options.expiresAt.toISOString() },
      revision: state.revision + 1,
      updatedAt: options.now.toISOString(),
    });
  }

  async releaseLock(options: {
    editionId: string;
    now: Date;
    owner: string;
  }): Promise<EditionState> {
    const state = await this.required(options.editionId);
    if (state.lock?.owner !== options.owner) throw new Error("Lock owner changed");
    const { lock: _lock, ...unlocked } = state;
    return this.save({
      ...unlocked,
      revision: state.revision + 1,
      updatedAt: options.now.toISOString(),
    });
  }

  async transition(options: {
    editionId: string;
    expected: EditionStatus;
    next: EditionStatus;
    now: Date;
  }): Promise<EditionState> {
    const state = await this.required(options.editionId);
    if (state.status !== options.expected) throw new Error("Edition state changed");
    assertEditionTransition(options.expected, options.next);
    return this.save({
      ...state,
      status: options.next,
      revision: state.revision + 1,
      updatedAt: options.now.toISOString(),
    });
  }

  async fail(options: {
    editionId: string;
    message: string;
    now: Date;
    owner: string;
    stage: string;
  }): Promise<EditionState> {
    const state = await this.required(options.editionId);
    if (state.lock?.owner !== options.owner) throw new Error("Lock owner changed");
    const { lock: _lock, ...failed } = state;
    return this.save({
      ...failed,
      status: "FAILED",
      failure: { stage: options.stage, message: options.message },
      revision: state.revision + 1,
      updatedAt: options.now.toISOString(),
    });
  }

  async publish(options: {
    editionId: string;
    manifestKey: string;
    now: Date;
  }): Promise<CurrentPublication> {
    const state = await this.required(options.editionId);
    if (state.status !== "QA_APPROVED" && state.status !== "PUBLISHED") {
      throw new Error("Edition is not approved");
    }
    const publishedAt = options.now.toISOString();
    this.current = { editionId: options.editionId, manifestKey: options.manifestKey, publishedAt };
    this.save({
      ...state,
      status: "PUBLISHED",
      publicationManifestKey: options.manifestKey,
      revision: state.revision + 1,
      updatedAt: publishedAt,
    });
    return this.current;
  }

  async getCurrentPublication(): Promise<CurrentPublication | null> {
    return this.current;
  }

  private async required(editionId: string): Promise<EditionState> {
    const state = this.states.get(editionId);
    if (!state) throw new Error("Edition does not exist");
    return state;
  }

  private save(state: EditionState): EditionState {
    const validated = editionStateSchema.parse(state);
    this.states.set(validated.editionId, validated);
    return validated;
  }
}

test("fixture cloud workflow pauses, resumes, and publishes immutable artifacts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-cloud-workflow-"));
  try {
    const editions = new MemoryEditionRepository();
    const now = new Date("2026-10-14T14:30:00.000Z");
    const handler = createMockWorkflowHandler({
      artifacts: new LocalArtifactStore(resolve(directory, "private")),
      editions,
      now: () => now,
      publicAssets: new LocalArtifactStore(resolve(directory, "public")),
    });
    let state = await handler({
      action: "initialize",
      input: { editionId: "edition-2026-10-14" },
      lockOwner: "execution-1",
    });
    for (const [expected, next] of [
      ["DRAFT", "COLLECTED"],
      ["COLLECTED", "SELECTED"],
    ] as const) {
      state = await handler({ action: "advance", expected, next, state });
    }
    state = await handler({ action: "release", state });
    assert.equal(state.status, "SELECTED");
    assert.equal((await editions.get(state.editionId))?.lock, undefined);

    state = await handler({
      action: "initialize",
      input: { editionId: state.editionId, continueAfterReview: true },
      lockOwner: "execution-2",
    });
    for (const [expected, next] of [
      ["SELECTED", "EDITORIAL_APPROVED"],
      ["EDITORIAL_APPROVED", "IMAGE_GENERATED"],
      ["IMAGE_GENERATED", "IMAGE_APPROVED"],
      ["IMAGE_APPROVED", "WORLD_GENERATING"],
      ["WORLD_GENERATING", "WORLD_GENERATED"],
      ["WORLD_GENERATED", "QA_APPROVED"],
    ] as const) {
      state = await handler({ action: "advance", expected, next, state });
    }
    state = await handler({ action: "publish", state });
    assert.equal(state.status, "PUBLISHED");
    assert.equal((await editions.get(state.editionId))?.lock, undefined);
    assert.equal(editions.current?.editionId, state.editionId);
    const fixture = JSON.parse(await readFile(
      resolve(directory, "public", editions.current!.manifestKey),
      "utf8",
    )) as { fictional?: boolean; notForPublicDisplay?: boolean };
    assert.equal(fixture.fictional, true);
    assert.equal(fixture.notForPublicDisplay, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fixture cloud workflow records bounded failures and releases its lock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-cloud-failure-"));
  try {
    const editions = new MemoryEditionRepository();
    const now = new Date("2026-10-14T14:30:00.000Z");
    const handler = createMockWorkflowHandler({
      artifacts: new LocalArtifactStore(resolve(directory, "private")),
      editions,
      now: () => now,
      publicAssets: new LocalArtifactStore(resolve(directory, "public")),
    });
    let state = await handler({
      action: "initialize",
      input: { editionId: "edition-2026-10-14" },
      lockOwner: "execution-1",
    });
    state = await handler({
      action: "fail",
      error: { Error: "SyntheticError", Cause: "x".repeat(3_000) },
      stage: "collection",
      state,
    });
    const failed = await editions.get(state.editionId);
    assert.equal(state.status, "FAILED");
    assert.equal(failed?.failure?.stage, "collection");
    assert.equal(failed?.failure?.message.length, 2_000);
    assert.equal(failed?.lock, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

