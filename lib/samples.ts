import catalogue from "@/content/examples/catalogue.json";
import type { TopicKey } from "./library";

type Sample = Omit<(typeof catalogue)[number], "topic"> & { topic: TopicKey };

/** The shelf only needs metadata; the reader loads the text on the server. */
export const SAMPLES = catalogue as Sample[];
export const isFeaturedSample = (id: string) => SAMPLES.some((article) => article.id === id);

/** Resolve existing notes and progress even after an example leaves the shelf. */
export const SAMPLE_TITLES = [
  ...SAMPLES,
  { id: "on-a-piece-of-chalk", title: "On a Piece of Chalk", author: "Thomas Henry Huxley" },
  { id: "on-thinking-for-oneself", title: "On Thinking for Oneself", author: "Arthur Schopenhauer" },
  { id: "walden-reading", title: "Reading", author: "Henry David Thoreau" },
];
