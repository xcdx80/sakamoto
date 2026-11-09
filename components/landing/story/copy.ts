import { SAMPLES } from "@/lib/samples";

/** Real sentences from the bundled samples, so the story shows the real thing. */
export const LIBRARY_SENTENCE = "A library may be very large; but if it is in disorder, it is not so useful as one that is small but well arranged.";
export const LIBRARY_FOLLOW = "In the same way, a man may have a great mass of knowledge, but if he has not worked it up by thinking it over for himself, it has much less value than a far smaller amount which he has thoroughly pondered.";

export const QUESTION = "Is a bigger library a better one?";

export type AnswerPart = string | { cite: number };
export const ANSWER: AnswerPart[] = [
  "Not by itself. A small, well-arranged library beats a large, disordered one.", { cite: 1 },
  " What you have thought over is worth more than what you have merely stored.", { cite: 1 },
  " Thoreau wants books read as deliberately as they were written.", { cite: 2 },
  " Your saved thread agrees, loudly.", { cite: 3 },
];

export const SOURCES = [
  { n: 1, kind: "Article", title: "On Thinking for Oneself", by: "Schopenhauer, 1851" },
  { n: 2, kind: "Article", title: "Reading", by: "Thoreau, 1854" },
  { n: 3, kind: "Saved post", title: "stop hoarding, start reading", by: "@saved_it_once" },
  { n: 0, kind: "Document", title: "On a Piece of Chalk", by: "Not needed for this one" },
];

export const DRAFT = "A bigger library is not a better one. Schopenhauer worked that out in 1851. I worked it out at bookmark four thousand.";

export const NOTES = ["“small but well arranged”", "me, every bookmark folder", "write about this?"];

export const CLOSE_LINE = "Everything you saved, finally useful.";

export const samplesForChips = () => SAMPLES.slice(0, 3);
