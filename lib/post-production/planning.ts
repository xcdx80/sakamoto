import { db } from "../db";
import { modelText, type Article } from "../article";
import { getProfile } from "./repository";
import type { ContentPillar, ProductionBrief, WeeklyIdea } from "./types";

type SourceCandidate = { id: string; title: string; excerpt: string; topic: string; indexed: boolean; pillar: ContentPillar };
const pillarSignals: [ContentPillar, RegExp][] = [
  ["education", /\b(teach\w*|learn\w*|beginner\w*|course\w*|explain\w*|education\w*)\b/gi],
  ["transformation", /\b(transform\w*|adopt\w*|business\w*|workflow\w*|support\w*|organiz\w*|deploy\w*)\b/gi],
  ["engineering", /\b(engineer\w*|evaluat\w*|test\w*|agent\w*|retriev\w*|model\w*|architect\w*|prompt\w*)\b/gi],
];
function matchingPillar(text: string): ContentPillar {
  return pillarSignals.map(([pillar, pattern]) => ({ pillar, score: [...text.matchAll(pattern)].length }))
    .sort((a, b) => b.score - a.score).find(item => item.score > 0)?.pillar ?? "other";
}
const genericWords = new Set(["the", "and", "for", "with", "from", "that", "this", "have", "into", "your", "saved", "source", "examine", "implications", "trade", "offs"]);
function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 2 && !genericWords.has(word)));
}
function overlaps(left: string, right: string): boolean {
  const a = words(left), b = words(right);
  if (a.size < 2 || b.size < 2) return left.trim().toLowerCase() === right.trim().toLowerCase();
  const common = [...a].filter(word => b.has(word)).length;
  return common / Math.min(a.size, b.size) >= 0.8;
}
const meaningfulTopic = (topic: string): string => ["unsorted", "other", "general", ""].includes(topic.trim().toLowerCase()) ? "" : topic.trim().toLowerCase();

/** Proposals are alternatives until the author explicitly creates a production. */
export async function proposeWeeklyIdeas(owner: string): Promise<WeeklyIdea[]> {
  if (!owner.trim()) throw new Error("An authenticated owner is required.");
  // Editorial history must not disappear behind the workspace's 200-production display limit.
  const [profile, historyRows] = await Promise.all([getProfile(owner), db().query(
    "select brief from post_productions where owner_id=$1 and status in ('planned','published')", [owner],
  )]);
  const history = historyRows as { brief: ProductionBrief }[];
  const usedIds = new Set(history.flatMap(p => p.brief.sourceIds));
  const historicalRows = usedIds.size ? await db().query("select id,data,doc from articles where user_id=$1 and id=any($2::text[]) and not deleted", [owner, [...usedIds]]) : [];
  const usedTopics = new Set(historicalRows.map(row => meaningfulTopic(String(row.data?.topic ?? ""))).filter(Boolean));
  const usedArguments = [...history.map(p => p.brief.idea), ...historicalRows.map(row => String(row.doc?.title || row.data?.title || ""))];
  const usedExcerpts = historicalRows.map(row => ((row.doc?.blocks ?? []) as Article["blocks"]).map(modelText).join("\n").slice(0, 4000)).filter(Boolean);
  const rows = await db().query(`select a.id,a.data,a.doc,
    (select string_agg(p.text,E'\\n' order by p.ordinal) from (
      select text,ordinal from saved_passages where user_id=a.user_id and source_id=a.id
        and source_revision=a.source_revision order by ordinal limit 3
    ) p) as excerpt
    from articles a where a.user_id=$1 and not a.deleted and a.doc is not null
    order by a.updated_at desc,a.id limit 300`, [owner]);
  const candidates: SourceCandidate[] = rows.flatMap(row => {
    const doc = row.doc as Article;
    const title = String(doc.title || row.data?.title || "").trim();
    const excerpt = String(row.excerpt || (doc.blocks ?? []).map(modelText).join("\n")).trim().slice(0, 4000);
    if (!title || !excerpt) return [];
    const sourceText = `${title} ${excerpt}`;
    const detectedPillar = matchingPillar(sourceText);
    const sourceWords = words(sourceText);
    const configuredPillar = profile.pillars.find(value => {
      const declared = matchingPillar(value);
      return declared === "other" ? [...words(value)].some(word => sourceWords.has(word)) : declared === detectedPillar;
    });
    if (!configuredPillar) return [];
    const pillar = matchingPillar(configuredPillar);
    const topic = meaningfulTopic(String(row.data?.topic ?? ""));
    if (usedIds.has(row.id) || (topic && usedTopics.has(topic)) || usedArguments.some(argument => overlaps(title, argument)) || usedExcerpts.some(previous => overlaps(excerpt, previous))) return [];
    return [{ id: row.id, title, excerpt, topic, indexed: Boolean(row.excerpt), pillar }];
  });
  const selected: SourceCandidate[] = [];
  const count = Math.min(3, Math.max(1, profile.weeklyIdeas || 3));
  while (selected.length < count && candidates.length) {
    const pillarCount = (pillar: ContentPillar) => selected.filter(s => s.pillar === pillar).length * 2 + history.filter(p => p.brief.pillar === pillar).length;
    candidates.sort((a, b) => pillarCount(a.pillar) - pillarCount(b.pillar));
    const next = candidates.shift()!;
    if (selected.some(previous => (next.topic && previous.topic === next.topic) || overlaps(next.title, previous.title) || overlaps(next.excerpt, previous.excerpt))) continue;
    selected.push(next);
  }
  return selected.map(source => ({
    brief: { idea: `Examine “${source.title.slice(0, 220)}”: implications and trade-offs for ${profile.audience || "the intended audience"}.`,
      notes: "", audience: profile.audience, goal: profile.defaultGoal, pillar: source.pillar,
      platforms: ["x", "linkedin"], delivery: "single", sourceIds: [source.id] },
    reason: `Saved source “${source.title}” offers material for the ${source.pillar} pillar, balanced against this account's planned/published history. Source excerpt: ${source.excerpt.slice(0, 350)}`,
    warnings: [source.indexed ? "Review the saved passages before making claims; this proposal uses excerpts." : "Needs source review: saved document excerpt used because current passages are not indexed.",
      "Attribute the saved author's claims. Add your own experience explicitly before using a personal story.",
      "Provisional lexical match from up to 300 recently updated saved sources; review topic overlap and choose your own cadence."],
  }));
}
