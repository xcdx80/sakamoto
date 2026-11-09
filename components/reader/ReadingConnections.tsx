"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, FileText, Link2, MessageSquare, Newspaper } from "lucide-react";
import { useLibraryRelations } from "@/lib/library-relations-client";
import type { RelatedSource } from "@/lib/library-relations";

const icons = { post: MessageSquare, article: Newspaper, document: FileText };
const labels = { post: "Saved X post", article: "Linked article", document: "Linked document" };

function ReadingCard({ source, current }: { source: RelatedSource; current: boolean }) {
  const Icon = icons[source.contentType];
  const label = source.postRole === "bookmark" ? "X bookmark" : source.postRole === "context" ? "X context post" : labels[source.contentType];
  const content = <><span className="connection-kind"><Icon size={14} aria-hidden />{label}{current && <span className="connection-current">Reading now</span>}</span><strong>{source.title}</strong>{source.author && <span className="connection-author">{source.author}</span>}{!current && <ArrowUpRight className="connection-arrow" size={16} aria-hidden />}</>;
  return current ? <div className="reading-connection-card" aria-current="page">{content}</div> : <Link className="reading-connection-card" href={"/read/" + encodeURIComponent(source.id)}>{content}</Link>;
}

export function ReadingConnections({ itemId }: { itemId: string }) {
  const { groups, loading, error, refresh } = useLibraryRelations(itemId);
  if (!groups.length && !error) return null;
  return <aside id="reading-connections" aria-label="Saved together" className="focus-hide reading-connections">
    <div className="reading-connections-heading"><span><Link2 size={15} aria-hidden />Saved together</span><button type="button" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    <p className="reading-connections-caption">Saved X posts and the reading they link to.</p>
    {error && <p role="alert">{error}</p>}
    {groups.map(group => <div className="reading-connection-group" key={group.post.id}>
      <ReadingCard source={group.post} current={group.post.id === itemId} />
      <div className="reading-connection-bridge"><ArrowDown size={15} aria-hidden /><span>Linked reading</span></div>
      <div className="reading-connection-children">{group.linked.map(source => <ReadingCard key={source.id} source={source} current={source.id === itemId} />)}</div>
    </div>)}
  </aside>;
}
