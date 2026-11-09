"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ProductionStage } from "@/lib/post-production/types";
import type { projectSourcePresentation } from "@/lib/post-production/source-presentation";

type Review = ReturnType<typeof projectSourcePresentation>["review"];

const STEPS = ["Brief", "Structure", "Draft", "Review", "Ready"];
const CURRENT_STEP: Record<ProductionStage, number> = { context: 0, selection: 1, writing: 2, review: 3, revision: 3, complete: 4 };

export function ReviewPanel({ review, stage, notes }: { review: Review; stage: ProductionStage; notes?: ReactNode }) {
  const current = CURRENT_STEP[stage];
  return <>
    <ol className="write-progress" aria-label="Writing progress">{STEPS.map((name, index) => <li key={name} data-state={index < current ? "done" : index === current ? "now" : "next"} aria-current={index === current ? "step" : undefined}><i aria-hidden="true" />{name}</li>)}</ol>
    <h3>Issues <span className="draft-context-count">{review.issues.length}</span></h3>
    <p className={`draft-context-review-state draft-context-review-${review.status}`}>{review.message}</p>
    {review.issues.map((issue, index) => <article className={`draft-context-issue draft-context-issue-${issue.severity}`} key={`${issue.code}-${index}`}>
      <span className="draft-context-caption">{issue.label}{issue.location && ` · ${issue.location}`}</span>
      <p>{issue.message}</p>
    </article>)}
    {review.criteria.length > 0 && <details className="draft-context-details">
      <summary>Review details <ChevronDown size={13} aria-hidden="true" /></summary>
      {review.criteria.map(criterion => <div className="draft-context-criterion" key={criterion.id}><h4>{criterion.title} <span>{criterion.score}</span></h4><p>{criterion.reason}</p></div>)}
    </details>}
    {notes}
  </>;
}
