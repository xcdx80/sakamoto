import type { Production, ProductionStatus } from "./types";

/** A brief can include instructions; the workspace heading needs only its topic. */
export function postTitle(idea: string): string {
  const line = idea.trim().split(/\n/)[0].replace(/\s+/g, " ");
  const firstSentence = line.split(/(?<=[.!?])\s+/)[0];
  const title = firstSentence.length >= 24 ? firstSentence : line;
  if (title.length <= 120) return title;
  return title.slice(0, 117).replace(/\s+\S*$/, "").trimEnd() + "…";
}

const statusLabels: Record<ProductionStatus, string> = {
  draft: "Draft", working: "Generating", needs_input: "Needs input", paused: "Paused", review: "In review",
  ready: "Ready", approved: "Approved", planned: "Planned", published: "Published", cancelled: "Cancelled",
};
export function postSummary(post: Production) {
  const planned = post.status === "planned" && post.plannedAt && Number.isFinite(Date.parse(post.plannedAt)) ? new Date(post.plannedAt) : null;
  return {
    status: statusLabels[post.status],
    pillar: { engineering: "AI engineering", transformation: "AI transformation", education: "AI education", other: "Other" }[post.brief.pillar],
    date: planned ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(planned) : null,
  };
}
