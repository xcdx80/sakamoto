import "server-only";

import { db } from "./db";
import { isFeaturedSample } from "./samples";
import type { BriefData } from "./article";
import type { Gloss } from "./store";

export async function readSampleBrief(id: string): Promise<BriefData | null> {
  if (!isFeaturedSample(id)) return null;
  const [row] = await db().query("select brief from public_sample_reader where article_id = $1", [id]);
  return row?.brief ?? null;
}

export async function readSampleGlosses(id: string): Promise<Gloss[]> {
  if (!isFeaturedSample(id)) return [];
  const [row] = await db().query("select glosses from public_sample_reader where article_id = $1", [id]);
  return row?.glosses ?? [];
}
