import type { DraftRevision, PostPlatform, ProductionDetail } from "@/lib/post-production/types";
import { revisionContext } from "@/lib/post-production/editor-view";
import { PlatformPostPreview, type PlatformPreviewAuthor } from "./PlatformPostPreview";

export function RevisionComparison({ selected, other, revisions, platform, detail, author, onCompare }: {
  selected: DraftRevision; other: DraftRevision; revisions: DraftRevision[]; platform: PostPlatform; detail: ProductionDetail; author?: PlatformPreviewAuthor; onCompare: (id: string) => void;
}) {
  return <div className="write-version-comparison" role="region" aria-label="Version comparison">{[selected, other].map((revision, index) => {
    const variant = revision.content.variants.find(item => item.platform === platform);
    const context = revisionContext(detail, revision);
    return <section className="write-comparison-column" key={index} aria-label={`Version ${revision.number}`}>
      {index === 0 ? <h4>Version {revision.number}{revision.id === detail.production.latestRevisionId ? " · Current" : ""}</h4> : <label>Compare with<select aria-label="Compare with version" value={other.id} onChange={event => onCompare(event.target.value)}>{revisions.filter(item => item.id !== selected.id).map(item => <option key={item.id} value={item.id}>Version {item.number}{item.id === detail.production.latestRevisionId ? " · Current" : ""}</option>)}</select></label>}
      {variant ? <PlatformPostPreview variant={variant} author={author} /> : <p>This version has no {platform === "x" ? "X" : "LinkedIn"} adaptation.</p>}
      <p className="write-comparison-meta">{context?.brief.idea ?? "Historical settings not recorded"}</p>
    </section>;
  })}</div>;
}
