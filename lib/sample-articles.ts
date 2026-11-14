import chalk from "@/content/on-a-piece-of-chalk.json";
import thinking from "@/content/on-thinking-for-oneself.json";
import walden from "@/content/walden-reading.json";
import brokenWindow from "@/content/examples/broken-window.json";
import labour from "@/content/examples/division-of-labour.json";
import memory from "@/content/examples/ebbinghaus-memory.json";
import ads from "@/content/examples/effects-of-advertisements.json";
import features from "@/content/examples/feature-visualization.json";
import circuits from "@/content/examples/introduction-to-circuits.json";
import habits from "@/content/examples/laws-of-habit.json";
import liberty from "@/content/examples/liberty-of-discussion.json";
import colour from "@/content/examples/newton-on-colour.json";
import simultaneity from "@/content/examples/relativity-of-simultaneity.json";
import reliance from "@/content/examples/self-reliance.json";
import campaigns from "@/content/examples/test-campaigns.json";
import type { Article } from "./article";

const articles = new Map(
  [chalk, thinking, walden, brokenWindow, labour, memory, ads, features, circuits, habits, liberty,
    colour, simultaneity, reliance, campaigns].map((article) => [
    article.id, { ...(article as Article), origin: "sample" as const },
  ]),
);

/** Retired samples still resolve shared links and anchors in personal notes. */
export const sampleById = (id: string) => articles.get(id) ?? null;
