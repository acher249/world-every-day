import type { WorldGuideFixtureTurn } from "@/lib/world-guide";

export const worldGuideFixtureTurns: readonly WorldGuideFixtureTurn[] = [
  {
    type: "navigate",
    utterance: "Take me to the story about grid storage",
    input: { editionId: "demo-2026-10-12", storyId: "energy-storage", openPanel: true },
  },
  {
    type: "navigate",
    utterance: "Show me the penguin route story",
    input: { editionId: "demo-2026-10-12", storyId: "penguin-conservation", openPanel: true },
  },
  {
    type: "research",
    utterance: "What did the researchers find?",
    input: { editionId: "demo-2026-10-12", storyIds: ["energy-storage"], question: "What did the researchers find?" },
    result: {
      answer: "The fictional demo has no linked reporting, so this mock cannot add source-backed details.",
      retrievedAt: "2026-01-01T00:00:00Z",
      citations: [],
    },
  },
  {
    type: "clarify",
    utterance: "Take me to the climate story",
    candidateStoryIds: ["climate-satellite", "penguin-conservation"],
    reply: "Do you mean the climate monitoring satellite or the penguin protection story?",
  },
  {
    type: "not-found",
    utterance: "Take me to the story about moon gardens",
    reply: "I don’t see a story about moon gardens in this world.",
  },
];
