import type { AuthorSignalAssessment, BrandProfile, DraftContent, GenerationParameters, Production, ProductionBrief, ProductionDetail, ProductionEvidence, WeeklyIdea, WriteWorkspace } from "./types";
import { deliveryForPlatform } from "./delivery";
import { isAuthorIdea } from "./intent";

export function blankDraft(brief: ProductionBrief): DraftContent {
  return { variants: brief.platforms.map(platform => ({ platform, delivery: deliveryForPlatform(platform, brief.delivery), posts: deliveryForPlatform(platform, brief.delivery) === "thread" ? ["", ""] : [""] })), hooks: [], claimSources: [] };
}

export function calendarProductions(productions: Production[]): Production[] {
  return productions.filter(production => production.status === "planned" && production.plannedAt)
    .sort((first, second) => Date.parse(first.plannedAt!) - Date.parse(second.plannedAt!));
}

/** Display review provenance separately from immutable writer annotations. This grants no approval. */
export function projectClaimSources({ content, evidence, review, revisionId, hasUnsavedChanges = false }: {
  content: DraftContent;
  evidence: ProductionEvidence[];
  review: ProductionDetail["review"];
  revisionId: string | null;
  hasUnsavedChanges?: boolean;
}): { verified: boolean; claims: DraftContent["claimSources"] } {
  const grounding = review?.criteria.find(criterion => criterion.id === "grounded-in-sources");
  if (hasUnsavedChanges || !revisionId || review?.revisionId !== revisionId || review.status !== "passed"
    || !grounding || !(grounding.score >= 5) || grounding.decision === "jev_failure"
    || review.issues.some(issue => issue.severity === "block" || issue.severity === "revise")) {
    return { verified: false, claims: content.claimSources.map(claim => ({ ...claim, evidenceIds: [...claim.evidenceIds] })) };
  }
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const published = [...content.variants.flatMap(variant => variant.posts), ...content.hooks].map(normalize);
  const sources = new Map(evidence.map(source => [source.id, source]));
  const claims = new Map<string, DraftContent["claimSources"][number]>();
  for (const support of grounding.support ?? []) {
    const source = sources.get(support.evidenceId);
    const claim = normalize(support.claim);
    if (!source || (isAuthorIdea(source) && support.claimKind !== "interpretation")
      || !claim || !published.some(text => text.includes(claim)) || !support.quote.trim()
      || !source.excerpt.includes(support.quote) || !support.reason.trim()) continue;
    const entry = claims.get(claim) ?? { claim: support.claim, evidenceIds: [] };
    if (!entry.evidenceIds.includes(source.id)) entry.evidenceIds.push(source.id);
    claims.set(claim, entry);
  }
  return { verified: true, claims: [...claims.values()] };
}

export async function copyDraft(text: string) { await navigator.clipboard.writeText(text); }
export function downloadDraft(content: DraftContent) {
  const url = URL.createObjectURL(new Blob([draftText(content)], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "sakamoto-draft.txt"; link.click(); URL.revokeObjectURL(url);
}
export function sourceLink(value?: string) { return value && (/^https?:\/\//i.test(value) || /^\/read\//.test(value)) ? value : undefined; }

export function draftText(content: DraftContent): string {
  return content.variants.map(variant => `${variant.platform === "x" ? "X" : "LinkedIn"}\n\n${variant.posts.map((post, i) => variant.delivery === "thread" ? `${i + 1}/${variant.posts.length}\n${post}` : post).join("\n\n—\n\n")}`).join("\n\n════\n\n");
}

export class WriteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "WriteRequestError"; }
}

/** An account-bound HTTP adapter. The caller aborts its scope when the account changes. */
export function createWriteClient(ownerId: string, signal?: AbortSignal) {
  async function request<T>(query = "", body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`/api/write${query}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-sakamoto-owner": ownerId },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    let value: T & { error?: string };
    try { value = await response.json(); }
    catch { throw new WriteRequestError("The writing desk could not be reached. Try again.", response.status); }
    if (!response.ok) throw new WriteRequestError(value.error || "The request could not be completed.", response.status);
    return value;
  }
  function production(action: string, id: string, fields: Record<string, unknown> = {}) {
    return request<ProductionDetail>("", { action, id, ...fields });
  }
  async function progress(detail: ProductionDetail, onProgress: (detail: ProductionDetail) => void): Promise<ProductionDetail> {
    let current = detail;
    // A foreground author action drives a bounded pipeline. A failed or paused
    // provider call is returned immediately; another attempt requires a new click.
    for (let step = 0; step < 10; step++) {
      current = await production("advance", current.production.id, { expectedVersion: current.production.version });
      onProgress(current);
      const p = current.production;
      if (["ready", "needs_input", "paused", "approved", "planned", "published", "cancelled"].includes(p.status)
        || p.stage === "complete") return current;
    }
    return current;
  }
  return {
    workspace: (sourceId?: string | null) => request<WriteWorkspace>(sourceId ? `?source=${encodeURIComponent(sourceId)}` : ""),
    detail: (id: string) => request<ProductionDetail>(`?productionId=${encodeURIComponent(id)}`),
    weekly: () => request<{ ideas: WeeklyIdea[] }>("?weekly=true"),
    create: (brief: ProductionBrief) => request<ProductionDetail>("", { action: "create", brief }),
    generate: async (brief: ProductionBrief, onProgress: (detail: ProductionDetail) => void) => {
      const created = await request<ProductionDetail>("", { action: "create", brief });
      onProgress(created);
      return progress(created, onProgress);
    },
    updateBrief: (id: string, expectedVersion: number, brief: ProductionBrief) => production("update_brief", id, { expectedVersion, brief }),
    profile: (profile: BrandProfile, expectedVersion: number) => request<BrandProfile>("", { action: "profile", profile, expectedVersion }),
    advance: (id: string, expectedVersion: number) => production("advance", id, { expectedVersion }),
    assessSignals: (id: string, expectedVersion: number, signals: AuthorSignalAssessment[]) => production("assess_signals", id, { expectedVersion, signals }),
    progress,
    choose: (id: string, expectedVersion: number, frameworkId: string, hookPatternId?: string) => production("choose", id, { expectedVersion, frameworkId, ...(hookPatternId ? { hookPatternId } : {}) }),
    save: (id: string, expectedVersion: number, content: DraftContent) => production("save", id, { expectedVersion, content }),
    regenerate: (id: string, expectedVersion: number, parameters: GenerationParameters) => production("regenerate", id, { expectedVersion, parameters }),
    revise: (id: string, expectedVersion: number, instruction: string) => production("revise", id, { expectedVersion, instruction }),
    approve: (id: string, expectedVersion: number, revisionId: string) => production("approve", id, { expectedVersion, revisionId }),
    plan: (id: string, expectedVersion: number, plannedAt: string) => production("plan", id, { expectedVersion, plannedAt }),
    publish: (id: string, expectedVersion: number) => production("publish", id, { expectedVersion }),
    published: (id: string, expectedVersion: number) => production("published", id, { expectedVersion }),
    cancel: (id: string, expectedVersion: number) => production("cancel", id, { expectedVersion }),
    feedback: (id: string, text: string) => production("feedback", id, { text }),
    suggestVoice: (id: string, feedbackId: string, update: Partial<BrandProfile>) => production("suggest_voice", id, { feedbackId, update }),
    acceptVoice: (id: string, feedbackId: string, expectedVersion: number) => request<{ profile: BrandProfile; detail: ProductionDetail }>("", { action: "accept_voice", id, feedbackId, expectedVersion }),
  };
}
export type WriteClient = ReturnType<typeof createWriteClient>;

const pastedContext = (item: NonNullable<ProductionBrief["agentContext"]>[number]) => /^pasted-context(?:-[2-9][0-9]*)?$/.test(item.id)
  && item.title === "Pasted context" && item.kind === "reference" && item.provenance.label === "Pasted by the author"
  && !item.provenance.url && !item.provenance.author && !item.provenance.capturedAt;

/** Edit only this form's pasted material; imported context keeps its provenance intact. */
export function pastedContextText(brief: ProductionBrief): string {
  return brief.agentContext?.find(pastedContext)?.text ?? "";
}
export function withPastedContext(brief: ProductionBrief, text: string): ProductionBrief {
  const existing = brief.agentContext ?? [];
  const owned = existing.find(pastedContext);
  if (owned) return { ...brief, agentContext: existing.flatMap(item => item === owned ? text.trim() ? [{ ...item, text }] : [] : [item]) };
  if (!text.trim()) return brief;
  // An imported item may use our usual identifier. Never overwrite it.
  let id = "pasted-context";
  for (let suffix = 2; existing.some(item => item.id === id); suffix++) id = `pasted-context-${suffix}`;
  return { ...brief, agentContext: [...existing, { id, title: "Pasted context", text, kind: "reference", provenance: { label: "Pasted by the author" } }] };
}
export function contextInputError(brief: ProductionBrief): string | null {
  const items = brief.agentContext ?? [];
  if (items.length > 8) return "Use at most 8 context items.";
  if (items.some(item => item.text.length > 12000)) return "Each context item can contain at most 12,000 characters.";
  if (items.reduce((bytes, item) => bytes + new TextEncoder().encode(item.text).length, 0) > 24000) return "Context can contain at most 24,000 UTF-8 bytes in total. Shorten the pasted material.";
  return null;
}

export function withSourcePolicy(brief: ProductionBrief, source: "library" | "web", enabled: boolean): ProductionBrief {
  const sourcePolicy = { library: true, web: true, ...brief.sourcePolicy, [source]: enabled };
  return { ...brief, sourcePolicy, sourceIds: sourcePolicy.library ? brief.sourceIds : [] };
}
