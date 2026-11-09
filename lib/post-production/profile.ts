import type { AgentContextItem, BrandProfile, ProductionBrief, DraftContent, SourcePolicy } from "./types";
import { assertPinnedSourceLimit } from "./limits";

/** Provisional public voice. Only an explicit save changes an account's profile. */
export function defaultProfile(): BrandProfile {
  return {
    version: 0,
    positioning: "Explain concrete AI engineering and transformation cases, decisions and lessons.",
    audience: "Founders, CTOs, product leaders and engineering leaders",
    pillars: ["AI engineering", "AI transformation", "AI education"],
    voice: "English. A thoughtful, casual conversation with a friend. Clear, concrete mechanisms and useful lessons earn trust.",
    preferredMoves: ["Start with a concrete case or use case", "Explain context, decisions, trade-offs and lessons"],
    bannedMoves: ["Code samples", "Humour", "Promotional language", "Follow requests", "Repost requests"],
    ending: "End with a useful observation or an honest question when it fits.",
    language: "English",
    defaultGoal: "trust",
    weeklyIdeas: 3,
    examples: [],
  };
}
const text = (value: unknown, length: number): string => typeof value === "string" ? value.trim().slice(0, length) : "";
const texts = (value: unknown, count: number, length: number): string[] => Array.isArray(value) ? value.slice(0, count).map((v) => text(v, length)).filter(Boolean) : [];

export function normalizeProfile(input: BrandProfile): BrandProfile {
  const defaults = defaultProfile();
  return {
    version: 0,
    positioning: text(input.positioning, 3000),
    audience: text(input.audience, 2000),
    pillars: texts(input.pillars, 12, 200),
    voice: text(input.voice, 5000),
    preferredMoves: texts(input.preferredMoves, 30, 500),
    bannedMoves: texts(input.bannedMoves, 30, 500),
    ending: text(input.ending, 2000),
    language: "English",
    defaultGoal: ["trust", "reach", "convert"].includes(input.defaultGoal) ? input.defaultGoal : defaults.defaultGoal,
    weeklyIdeas: Math.max(1, Math.min(14, Math.floor(Number(input.weeklyIdeas) || defaults.weeklyIdeas))),
    examples: texts(input.examples, 10, 5000),
  };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function productionSourcePolicy(brief: Pick<ProductionBrief, "sourcePolicy">): SourcePolicy {
  const value = brief.sourcePolicy;
  if (value === undefined) return { library: true, web: true };
  if (!record(value) || Object.keys(value).some(key => !["library", "web"].includes(key))
    || typeof value.library !== "boolean" || typeof value.web !== "boolean") throw new Error("A valid library and web source policy is required.");
  return { library: value.library, web: value.web };
}
function suppliedContext(value: unknown): AgentContextItem[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Choose at most 8 supplied context items.");
  const ids = new Set<string>();
  const requiredText = (input: unknown, limit: number) => {
    if (typeof input !== "string" || !input.trim() || input.length > limit) throw new Error("Invalid supplied context text or size.");
    return input.trim();
  };
  const items = value.map(item => {
    if (!record(item) || Object.keys(item).some(key => !["id", "title", "text", "kind", "provenance"].includes(key))
      || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)
      || !["author_statement", "reference", "analysis"].includes(String(item.kind)) || !record(item.provenance))
      throw new Error("Valid unique supplied context IDs, kinds and provenance are required.");
    ids.add(item.id);
    const source = item.provenance;
    if (Object.keys(source).some(key => !["label", "url", "author", "capturedAt"].includes(key))) throw new Error("Invalid supplied context provenance.");
    const provenance: AgentContextItem["provenance"] = { label: requiredText(source.label, 500) };
    if (source.url !== undefined) {
      const url = requiredText(source.url, 2000);
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error("A valid HTTP or HTTPS context source URL is required."); }
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("A valid HTTP or HTTPS context source URL without credentials is required.");
      provenance.url = url;
    }
    if (source.author !== undefined) provenance.author = requiredText(source.author, 200);
    if (source.capturedAt !== undefined) {
      const date = requiredText(source.capturedAt, 100);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("A valid capturedAt timestamp is required.");
      provenance.capturedAt = date;
    }
    return { id: item.id, title: requiredText(item.title, 200), text: requiredText(item.text, 12000), kind: item.kind as AgentContextItem["kind"], provenance };
  });
  if (Buffer.byteLength(items.map(item => item.text).join(""), "utf8") > 24000) throw new Error("Supplied context exceeds the 24,000 byte limit. Shorten the material.");
  return items;
}
export function normalizeBrief(input: ProductionBrief): ProductionBrief {
  const idea = text(input.idea, 3000);
  if (!idea) throw new Error("An idea is required.");
  const platforms = [...new Set(input.platforms)].filter((p) => p === "x" || p === "linkedin");
  if (!platforms.length) throw new Error("Choose at least one platform.");
  const sourceIds = [...new Set(texts(input.sourceIds, Array.isArray(input.sourceIds) ? input.sourceIds.length : 0, 200))];
  assertPinnedSourceLimit(sourceIds);
  const sourcePolicy = productionSourcePolicy(input);
  if (!sourcePolicy.library && sourceIds.length) throw new Error("Remove saved source pins when library sources are disabled.");
  const agentContext = input.agentContext === undefined ? undefined : suppliedContext(input.agentContext);
  if (sourceIds.length + (agentContext?.length ?? 0) + (sourcePolicy.web ? 5 : 0) + (text(input.notes, 12000) ? 1 : 0) + 1 > 20)
    throw new Error("Too many sources and context items. Remove library pins or supplied context items.");
  return {
    idea,
    notes: text(input.notes, 12000),
    audience: text(input.audience, 2000),
    goal: ["trust", "reach", "convert"].includes(input.goal) ? input.goal : "trust",
    pillar: ["engineering", "transformation", "education", "other"].includes(input.pillar) ? input.pillar : "other",
    platforms,
    delivery: ["single", "thread", "long"].includes(input.delivery) ? input.delivery : "single",
    sourceIds,
    ...(input.sourcePolicy !== undefined ? { sourcePolicy } : {}),
    ...(agentContext !== undefined ? { agentContext } : {}),
  };
}
export function normalizeDraftContent(input: DraftContent): DraftContent {
  if (!Array.isArray(input.variants) || input.variants.length > 4 || !Array.isArray(input.hooks) || input.hooks.length > 12 || !Array.isArray(input.claimSources) || input.claimSources.length > 100) throw new Error("Invalid draft size.");
  const variants = input.variants.map((variant) => {
    if (!["x", "linkedin"].includes(variant.platform) || !["single", "thread", "long"].includes(variant.delivery)) throw new Error("Invalid draft variant.");
    if (!Array.isArray(variant.posts) || variant.posts.length > 30 || variant.posts.some(post => typeof post !== "string" || post.length > 30000 || !post.trim())) throw new Error("Invalid draft text or size. Keep each post within 30,000 characters.");
    return { platform: variant.platform, delivery: variant.delivery, posts: variant.posts.map(post => post.trim()) };
  });
  if (!variants.length || variants.some((v) => !v.posts.length)) throw new Error("Draft text is required.");
  return {
    variants,
    hooks: texts(input.hooks, 12, 1000),
    claimSources: input.claimSources.slice(0, 100).map((source) => ({ claim: text(source.claim, 3000), evidenceIds: texts(source.evidenceIds, 20, 200) })),
  };
}
