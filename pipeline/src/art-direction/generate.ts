import { z } from "zod";
import { selectedEditionSchema, type SelectedEdition } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import type { ProviderUsage } from "../provider-usage.js";
import {
  artDirectionSchema,
  artDirectionSubjectSchema,
  artDirectionWorldSchema,
  type ArtDirection,
} from "./schema.js";

export const ART_DIRECTION_GENERATION_PROMPT_VERSION = "art-direction-generation-v1";

export const defaultArtDirectionConstraints = {
  required: [
    "one continuous environment with coherent terrain and lighting",
    "every story subject visually distinct and spatially separated",
    "strong silhouettes and readable physical materials",
    "open navigable paths and layered spatial depth",
  ],
  prohibited: [
    "people, faces, portraits, crowds, or humanoid figures",
    "written text, labels, logos, flags, interfaces, borders, or watermarks",
    "split panels, floating collage fragments, or duplicated landmarks",
    "graphic violence, catastrophe spectacle, advertising, or clickbait imagery",
  ],
} as const;

export type CompositionRole = "anchor" | "supporting" | "detail";

export type ArtDirectionStoryInput = {
  storyId: string;
  role: CompositionRole;
  title: string;
  summary: string;
  topic: string;
  groundedDetails: string[];
};

const proposalSubjectSchema = artDirectionSubjectSchema.omit({ role: true, grounding: true }).extend({
  groundedDetailIndexes: z.array(z.number().int().nonnegative()).max(6),
  artisticInterpretation: z.string().min(1).max(300),
});

const artDirectionProposalSchema = z.object({
  world: artDirectionWorldSchema,
  subjects: z.array(proposalSubjectSchema).min(1).max(10),
});

export type ArtDirectionProposal = z.infer<typeof artDirectionProposalSchema>;

export function parseArtDirectionProposal(input: unknown): ArtDirectionProposal {
  return artDirectionProposalSchema.parse(input);
}

export type ArtDirectionProvider = {
  model: string;
  provider: string;
  promptVersion: typeof ART_DIRECTION_GENERATION_PROMPT_VERSION;
  propose(stories: ArtDirectionStoryInput[]): Promise<{
    proposal: ArtDirectionProposal;
    usage?: ProviderUsage;
  }>;
};

export function assignCompositionRoles(edition: SelectedEdition): ArtDirectionStoryInput[] {
  const validated = selectedEditionSchema.parse(edition);
  return [...validated.stories]
    .sort((left, right) =>
      right.visualProminenceScore - left.visualProminenceScore ||
      right.editorialScore - left.editorialScore ||
      left.rank - right.rank,
    )
    .map((story, index) => ({
      storyId: story.storyId,
      role: index < Math.min(2, validated.stories.length)
        ? "anchor"
        : index < Math.min(5, validated.stories.length)
          ? "supporting"
          : "detail",
      title: story.title,
      summary: story.summary,
      topic: story.topic,
      groundedDetails: story.visualDetails.map(({ detail }) => detail),
    }));
}

export async function generateArtDirection({
  createdAt = new Date(),
  edition,
  provider,
}: {
  createdAt?: Date;
  edition: SelectedEdition;
  provider: ArtDirectionProvider;
}): Promise<ArtDirection> {
  const validatedEdition = selectedEditionSchema.parse(edition);
  if (validatedEdition.stories.length === 0) {
    throw new Error("Art direction requires at least one selected story");
  }
  const storyInputs = assignCompositionRoles(validatedEdition);
  const { proposal: unparsedProposal, usage } = await provider.propose(storyInputs);
  const proposal = artDirectionProposalSchema.parse(unparsedProposal);
  const proposalById = new Map(proposal.subjects.map((subject) => [subject.storyId, subject]));
  if (proposalById.size !== proposal.subjects.length) {
    throw new Error("Art-direction provider returned duplicate story ids");
  }
  const expectedIds = new Set(storyInputs.map(({ storyId }) => storyId));
  const missing = storyInputs.filter(({ storyId }) => !proposalById.has(storyId));
  const unexpected = proposal.subjects.filter(({ storyId }) => !expectedIds.has(storyId));
  if (missing.length || unexpected.length) {
    throw new Error(`Art-direction coverage mismatch; missing=${missing.length}; unexpected=${unexpected.length}`);
  }

  const subjects = storyInputs.map((story) => {
    const subject = proposalById.get(story.storyId)!;
    const sourceDetails = subject.groundedDetailIndexes.map((index) => {
      const detail = story.groundedDetails[index];
      if (detail === undefined) {
        throw new Error(`Invalid grounded detail index ${index} for story ${story.storyId}`);
      }
      return detail;
    });
    return {
      storyId: story.storyId,
      role: story.role,
      subject: subject.subject,
      placement: subject.placement,
      scale: subject.scale,
      materials: subject.materials,
      visualCues: subject.visualCues,
      grounding: {
        sourceDetails,
        artisticInterpretation: subject.artisticInterpretation,
      },
    };
  });

  return artDirectionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "art-direction",
    editionId: validatedEdition.editionId,
    createdAt: createdAt.toISOString(),
    promptVersion: "panorama-scene-v1",
    inputs: { selectedEditionSha256: artifactSha256(validatedEdition) },
    producer: {
      type: provider.provider === "fixture" ? "fixture" : "model",
      provider: provider.provider,
      model: provider.model,
      promptVersion: provider.promptVersion,
      usage,
    },
    world: proposal.world,
    subjects,
    constraints: defaultArtDirectionConstraints,
  });
}
