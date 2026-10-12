export type DemoStory = {
  id: string;
  number: string;
  category: string;
  title: string;
  summary: string;
  representation: string;
  x: number;
  y: number;
  tone: "cyan" | "amber" | "green";
};

export const demoStories: DemoStory[] = [
  {
    id: "energy-storage",
    number: "01",
    category: "Clean energy",
    title: "A longer life for stored energy",
    summary:
      "A fictional demonstration of how a breakthrough in grid storage might become a durable landmark in the daily world.",
    representation: "Wind turbines and three brushed-metal energy vessels",
    x: 31,
    y: 23,
    tone: "amber",
  },
  {
    id: "penguin-conservation",
    number: "02",
    category: "Conservation",
    title: "A safer passage for penguins",
    summary:
      "A sample conservation story represented by a protected shelf where ice, ocean, and habitat meet.",
    representation: "A small penguin colony on the western ice shelf",
    x: 11,
    y: 38,
    tone: "cyan",
  },
  {
    id: "coral-restoration",
    number: "03",
    category: "Ocean",
    title: "Coral nurseries begin to flourish",
    summary:
      "An illustrative restoration effort imagined as a clear lagoon filled with growing coral structures.",
    representation: "A restored coral lagoon and submerged nursery domes",
    x: 20,
    y: 70,
    tone: "cyan",
  },
  {
    id: "genetics",
    number: "04",
    category: "Health science",
    title: "A genetic clue comes into view",
    summary:
      "A fictional research milestone made spatial through a monumental helix at the center of a public garden.",
    representation: "The luminous DNA structure in the central glasshouse",
    x: 48,
    y: 22,
    tone: "cyan",
  },
  {
    id: "climate-satellite",
    number: "05",
    category: "Earth science",
    title: "A clearer view of a changing planet",
    summary:
      "A sample Earth-observation mission shown tracing a quiet arc above the landscape it helps us understand.",
    representation: "The small climate satellite crossing the morning sky",
    x: 62,
    y: 8,
    tone: "amber",
  },
  {
    id: "clean-water",
    number: "06",
    category: "Infrastructure",
    title: "Clean water reaches farther",
    summary:
      "An imagined filtration advance represented by a visible sequence of channels, pools, and wetlands.",
    representation: "Circular waterworks cascading into the valley",
    x: 61,
    y: 51,
    tone: "cyan",
  },
  {
    id: "reforestation",
    number: "07",
    category: "Restoration",
    title: "A native forest returns",
    summary:
      "A fictional community restoration project expressed through new growth spreading across a once-bare slope.",
    representation: "Young trees and protective forms on the eastern hillside",
    x: 78,
    y: 34,
    tone: "green",
  },
  {
    id: "field-robot",
    number: "08",
    category: "Responsible technology",
    title: "A field robot learns a gentler touch",
    summary:
      "A sample robotics development imagined as a compact tool tending the garden rather than replacing its ecosystem.",
    representation: "The small non-humanoid rover beside the garden path",
    x: 84,
    y: 72,
    tone: "amber",
  },
  {
    id: "pollinator-gardens",
    number: "09",
    category: "Cities & nature",
    title: "Pollinator gardens connect a city",
    summary:
      "An illustrative urban habitat network represented as warm glass pavilions woven into a flowering landscape.",
    representation: "The glowing pollinator gardens on the eastern terrace",
    x: 91,
    y: 54,
    tone: "green",
  },
  {
    id: "deep-space",
    number: "10",
    category: "Space",
    title: "A telescope opens a deeper window",
    summary:
      "A fictional astronomical milestone placed at the world’s highest point, looking beyond the edge of the day.",
    representation: "The white observatory on the distant mountain",
    x: 93,
    y: 10,
    tone: "cyan",
  },
];

export const demoEdition = {
  eyebrow: "Demonstration edition · Fictional stories",
  date: "October 12, 2026",
  title: "Signals of renewal",
  description:
    "Ten imagined signals of discovery, restoration, and care—gathered into one explorable place.",
};

