import { z } from "zod";
import { publicationManifestSchema, type PublicationManifest } from "../publication/schema.js";

export function composeDailyPost(manifest: PublicationManifest, origin: string, projectOrigin: string) {
  const clean = (value: string) => value.replace(/https?:\/\/\S+|[@#]/gi, "").replace(/\s+/g, " ").trim();
  // Conservatively count non-ASCII characters as two; X shortens each URL to 23.
  const weight = (value: string) => Array.from(value.replace(/https?:\/\/\S+/g, "x".repeat(23)))
    .reduce((sum, character) => sum + (character.codePointAt(0)! < 128 ? 1 : 2), 0);
  const link = new URL("/", origin);
  link.searchParams.set("edition", manifest.edition.id);
  const header = `${clean(manifest.edition.displayDate)}\n\nToday’s World: ${link.href}\n\n`;
  const footer = `\n\nLearn more: ${new URL("/", projectOrigin).href}`;
  const sentences: string[] = [];
  for (const story of manifest.stories) {
    const sentence = clean(story.title).replace(/[.!?]+$/, "") + ".";
    if (weight(header + [...sentences, sentence].join(" ") + footer) <= 280) sentences.push(sentence);
    if (sentences.length === 2) break;
  }
  const text = header + (sentences.join(" ") || "Explore the discoveries and developments behind this world.") + footer;
  if (weight(text) > 280) throw new Error("Daily X post exceeds the post length limit");
  return text;
}

export type DailyPostDependencies = {
  enabled: boolean;
  origin: string;
  projectOrigin: string;
  expectedAccountId: string;
  verifyPublication: (editionId: string, key: string) => Promise<unknown>;
  accountId: () => Promise<string>;
  claim: (editionId: string, text: string) => Promise<boolean>;
  post: (text: string) => Promise<string>;
  receipt: (editionId: string, postId: string) => Promise<void>;
};

export function createDailyPostHandler(deps: DailyPostDependencies) {
  return async (event: unknown) => {
    const input = z.object({ editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      publication: z.object({ status: z.literal("published"), key: z.string() }) }).parse(event);
    if (!deps.enabled) return { status: "disabled" };
    if (!/^\d+$/.test(deps.expectedAccountId)) throw new Error("X expected account ID is required");
    const manifest = publicationManifestSchema.parse(await deps.verifyPublication(input.editionId, input.publication.key));
    if (manifest.edition.id !== input.editionId || manifest.edition.status !== "published" ||
      manifest.edition.fictional || !manifest.world.splat) throw new Error("A real published world is required");
    if (await deps.accountId() !== deps.expectedAccountId) throw new Error("X account does not match configured account");
    const text = composeDailyPost(manifest, deps.origin, deps.projectOrigin);
    if (!await deps.claim(input.editionId, text)) return { status: "already-attempted" };
    // Never automatically retry after claiming: even a timeout may mean X posted it.
    const postId = await deps.post(text);
    await deps.receipt(input.editionId, postId);
    return { status: "posted", postId };
  };
}
