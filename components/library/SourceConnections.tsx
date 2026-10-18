import Link from "next/link";
import { ArrowRight, ArrowUpLeft, CornerDownRight, FileText, MessageSquare, Newspaper } from "lucide-react";
import type { ItemConnections } from "@/lib/library-relations-client";
import type { RelatedSource } from "@/lib/library-relations";

function RelatedReadingRow({ source }: { source: RelatedSource }) {
  const Icon = source.contentType === "post" ? MessageSquare : source.contentType === "document" ? FileText : Newspaper;
  const kind = source.contentType === "post" ? source.postRole === "bookmark" ? "X bookmark" : "Saved X post" : source.contentType === "document" ? "Document" : "Article";
  return <li className="connection-branch">
    <Link prefetch={false} href={"/read/" + encodeURIComponent(source.id)} className="connection-destination">
      <span className="connection-type-icon"><Icon size={16} aria-hidden /></span>
      <span className="connection-destination-copy">
        <span className="connection-destination-meta">{kind}{source.author ? ` · ${source.author}` : ""}</span>
        <span className="connection-destination-title">{source.title}</span>
      </span>
      <ArrowRight size={15} aria-hidden />
    </Link>
  </li>;
}

/** Related destinations stay outside the main card link, including in list view. */
export function SourceConnections({ connections, itemId, view = "grid" }: { connections?: ItemConnections; itemId: string; view?: "grid" | "list" }) {
  if (!connections || (!connections.parents.length && !connections.children.length)) return null;
  const provenance = connections.parents.every(post => post.postRole === "bookmark") ? "From X bookmark" : "From saved X post";
  return <div className={`content-card-connections ${view === "list" ? "list-source-connections" : "grid-source-connections"}`} aria-label="Related saved sources">
    {connections.parents.length > 0 && <section className="source-connection-group" aria-label="Source posts">
      <div className="source-connection-heading"><ArrowUpLeft size={15} aria-hidden /><strong>Source {connections.parents.length === 1 ? "post" : "posts"}</strong><span>{provenance}{connections.parents.length > 1 ? "s" : ""}</span></div>
      <ul className="connection-branches">{connections.parents.slice(0, 2).map(post => <RelatedReadingRow key={post.id} source={post} />)}</ul>
    </section>}
    {connections.children.length > 0 && <section className="source-connection-group" aria-label="Linked reading">
      <div className="source-connection-heading"><CornerDownRight size={15} aria-hidden /><strong>Linked reading</strong><span>{connections.children.length} saved {connections.children.length === 1 ? "item" : "items"} from this post</span></div>
      <ul className="connection-branches">{connections.children.slice(0, 2).map(source => <RelatedReadingRow key={source.id} source={source} />)}</ul>
    </section>}
    {(connections.parents.length > 2 || connections.children.length > 2) && <Link prefetch={false} className="connection-more" href={"/read/" + encodeURIComponent(itemId) + "#reading-connections"}>View all connections <ArrowRight size={12} aria-hidden /></Link>}
  </div>;
}
