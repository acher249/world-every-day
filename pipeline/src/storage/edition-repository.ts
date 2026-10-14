import { z } from "zod";

export const editionStatuses = [
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
  "FAILED",
] as const;

export const editionStatusSchema = z.enum(editionStatuses);
export type EditionStatus = z.infer<typeof editionStatusSchema>;

export const editionStateSchema = z.object({
  editionId: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: editionStatusSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lock: z.object({
    owner: z.string().min(1).max(160),
    expiresAt: z.iso.datetime({ offset: true }),
  }).optional(),
  failure: z.object({
    stage: z.string().min(1).max(100),
    message: z.string().min(1).max(2_000),
  }).optional(),
  publicationManifestKey: z.string().min(1).max(1_024).optional(),
});

export type EditionState = z.infer<typeof editionStateSchema>;

export type CurrentPublication = {
  editionId: string;
  manifestKey: string;
  publishedAt: string;
};

const allowedNextStatuses: Record<EditionStatus, readonly EditionStatus[]> = {
  DRAFT: ["COLLECTED"],
  COLLECTED: ["SELECTED"],
  SELECTED: ["EDITORIAL_APPROVED"],
  EDITORIAL_APPROVED: ["IMAGE_GENERATED"],
  IMAGE_GENERATED: ["IMAGE_APPROVED"],
  IMAGE_APPROVED: ["WORLD_GENERATING"],
  WORLD_GENERATING: ["WORLD_GENERATED"],
  WORLD_GENERATED: ["QA_APPROVED"],
  QA_APPROVED: ["PUBLISHED"],
  PUBLISHED: [],
  FAILED: [],
};

export function assertEditionTransition(
  expected: EditionStatus,
  next: EditionStatus,
): void {
  if (!allowedNextStatuses[expected].includes(next)) {
    throw new Error(`Invalid edition transition: ${expected} -> ${next}`);
  }
}

export interface EditionRepository {
  createDraft(editionId: string, createdAt: Date): Promise<EditionState>;
  get(editionId: string): Promise<EditionState | null>;
  acquireLock(options: {
    editionId: string;
    expiresAt: Date;
    now: Date;
    owner: string;
  }): Promise<EditionState>;
  releaseLock(options: {
    editionId: string;
    now: Date;
    owner: string;
  }): Promise<EditionState>;
  transition(options: {
    editionId: string;
    expected: EditionStatus;
    next: EditionStatus;
    now: Date;
  }): Promise<EditionState>;
  fail(options: {
    editionId: string;
    message: string;
    now: Date;
    owner: string;
    stage: string;
  }): Promise<EditionState>;
  publish(options: {
    editionId: string;
    manifestKey: string;
    now: Date;
  }): Promise<CurrentPublication>;
  getCurrentPublication(): Promise<CurrentPublication | null>;
}

