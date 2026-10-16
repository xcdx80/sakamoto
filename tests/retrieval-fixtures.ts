/** Curated expected evidence. Provider vectors below are fixture transport, not live model-quality evidence. */
export const retrievalFixtures = [
  {
    id: "a-cosmology",
    title: "Related observations",
    type: "article",
    topic: "science",
    tags: ["physics"],
    text: "Galaxy rotation curves provide observational clues about invisible mass.",
    vector: [0, 0, 0, 1],
    queries: [],
  },
  {
    id: "neural-repair",
    title: "Regeneration",
    type: "article",
    topic: "science",
    tags: ["biology"],
    text: "Axolotl neurons can regrow after severe spinal damage.",
    vector: [1, 0, 0, 0],
    queries: [
      "How does a salamander recover damaged nerve cells?",
      '"Axolotl neurons"',
    ],
  },
  {
    id: "queue-backpressure",
    title: "Reliable systems",
    type: "document",
    topic: "infra",
    tags: ["systems"],
    text: "Bounded queues reject new work when consumers cannot keep up, preventing memory exhaustion.",
    vector: [0, 1, 0, 0],
    queries: ["How can slow workers avoid filling all available memory?"],
  },
  {
    id: "solar-storage",
    title: "Armazenamento de energia",
    type: "post",
    topic: "climate",
    tags: ["energy"],
    text: "Baterias armazenam energia solar durante o dia para abastecer casas durante a noite.",
    vector: [0, 0, 1, 0],
    queries: ["How can houses use sunlight after sunset?", "energia solar"],
  },
  {
    id: "rubin",
    title: "Galaxy measurements",
    type: "article",
    topic: "science",
    tags: ["physics"],
    text: "Vera Rubin measured galaxy rotation and found evidence for dark matter.",
    vector: [0, 0, 0, 1],
    queries: ['"Vera Rubin"', '"dark matter"'],
  },
] as const;
export function fixtureVector(text: string): number[] {
  const match = retrievalFixtures.find(
    (f) =>
      text.includes(f.text) ||
      f.queries.some((q) => text === "task: search result | query: " + q),
  );
  return [...(match?.vector ?? [0.5, 0.5, 0.5, 0.5]), ...Array(764).fill(0)];
}
