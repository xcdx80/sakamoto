"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, FileText, MessageSquare, MoreHorizontal, Newspaper, Star, Trash2, X } from "lucide-react";
import { reclassifyItem } from "@/lib/processing-client";
import { fmtMinutes, TOPIC, TOPICS, type Book, type TopicKey } from "@/lib/library";

export type LibraryView = "grid" | "list";
type Patch = { title?: string; topic?: TopicKey; favorite?: boolean };

const TYPE_LABEL = { article: "Article", document: "Document", post: "Post" };
const TYPE_ICON = { article: Newspaper, document: FileText, post: MessageSquare };

/** A source is a reading destination; its management controls remain separate links and buttons. */
export function ContentCards({ books, view, fresh, onManage, onFavorite, onTag, selectedTag }: {
  books: Book[];
  view: LibraryView;
  fresh: Set<string>;
  onManage: (book: Book) => void;
  onFavorite: (book: Book) => void;
  onTag: (tag: string) => void;
  selectedTag: string | null;
}) {
  return (
    <ul className={view === "grid" ? "content-grid" : "content-list"} aria-label={view === "grid" ? "Library cards" : "Library list"}>
      {books.map((b) => {
        const Icon = TYPE_ICON[b.contentType];
        return (
          <li key={b.id} className="content-card" data-fresh={fresh.has(b.id) || undefined}>
            <Link href={`/read/${b.id}`} className="content-card-read" aria-label={`Read ${b.title}`}>
              <div className="content-card-meta">
                <span className="content-kind"><Icon size={14} strokeWidth={1.6} aria-hidden />{TYPE_LABEL[b.contentType]}</span>
                <span className="content-card-topic"><i aria-hidden style={{ background: TOPIC[b.topic].shades[0] }} />{TOPIC[b.topic].name}</span>
              </div>
              <div className="content-card-text">
                <h2>{b.title}<ArrowUpRight className="content-card-arrow" size={18} strokeWidth={1.5} aria-hidden /></h2>
                <p className="content-card-author">{b.author}{b.year ? ` · ${b.year}` : ""}</p>
                {b.dek && <p className="content-card-dek">{b.dek}</p>}
              </div>
              <div className="content-card-reading">
                {b.processing?.classification && b.processing.classification !== "complete" && <span title={b.processing.classificationMessage}>Classification {b.processing.classification}</span>}
                {b.processing?.indexing === "pending" && <span>Indexing pending</span>}
                <span>{fmtMinutes(b.minutes)} read</span>
                {b.pct >= 1 ? <span className="content-read-state"><Check size={12} aria-hidden /> Read</span> : b.pct > 0 ? <span className="content-read-state">{Math.round(b.pct * 100)}% read</span> : b.sample ? <span>Sample</span> : null}
                {b.highlights > 0 && <span>{b.highlights} {b.highlights === 1 ? "highlight" : "highlights"}</span>}
              </div>
            </Link>
            <div className="content-card-footer">
              <div className="content-card-tags" aria-label={`Tags for ${b.title}`}>
                {b.tags.map((tag) => <button key={tag} type="button" aria-pressed={selectedTag === tag} onClick={() => onTag(tag)}>{tag}</button>)}
              </div>
              <div className="content-card-actions">
                {!b.sample && <button type="button" aria-label={`${b.favorite ? "Unfavorite" : "Favorite"} ${b.title}`} aria-pressed={b.favorite} onClick={() => onFavorite(b)}><Star size={16} fill={b.favorite ? "currentColor" : "none"} strokeWidth={1.5} aria-hidden /></button>}
                <button type="button" aria-label={`Manage ${b.title}`} onClick={() => onManage(b)}><MoreHorizontal size={19} aria-hidden /></button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Native dialog supplies focus trapping, Escape dismissal, and focus return. */
export function ContentDetails({ book, onClose, onShelve, onRemove }: {
  book: Book;
  onClose: () => void;
  onShelve: (book: Book, patch: Patch) => void;
  onRemove: (book: Book) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState("");
  const reclassify = async () => {
    setCategoryBusy(true);setCategoryMessage("");
    try {await reclassifyItem(book.id);setCategoryMessage("Category queued. Use Process now to advance it; manual choices are preserved.");}
    catch(e){setCategoryMessage(e instanceof Error?e.message:"Could not schedule categorization.");}
    finally{setCategoryBusy(false);}
  };
  useEffect(() => { ref.current?.showModal(); }, []);

  return (
    <dialog ref={ref} className="content-dialog" aria-labelledby="content-detail-title" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}>
      <div className="content-dialog-panel">
        <div className="content-dialog-head">
          <p className="content-eyebrow">{book.sample ? "From the sample library" : "In your library"}</p>
          <button type="button" aria-label="Close item details" onClick={() => ref.current?.close()}><X size={18} /></button>
        </div>
        <h2 id="content-detail-title">{book.title}</h2>
        <p className="content-detail-byline">{book.author} · {TYPE_LABEL[book.contentType]} · {fmtMinutes(book.minutes)}</p>
        {book.dek && <p className="content-detail-dek">{book.dek}</p>}
        {!book.sample && <form className="content-detail-form" onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          onShelve(book, { title: String(data.get("title")).trim() || book.title, topic: String(data.get("topic")) as TopicKey });
          ref.current?.close();
        }}>
          <label>Title<input name="title" defaultValue={book.title} required maxLength={500} /></label>
          <label>Topic<select name="topic" defaultValue={book.topic}>{TOPICS.map((topic) => <option key={topic.key} value={topic.key}>{topic.name}</option>)}</select></label>
          <div className="content-detail-form-actions">
            <button type="button" className="content-detail-favorite" aria-pressed={book.favorite} onClick={() => onShelve(book, { favorite: !book.favorite })}><Star size={16} fill={book.favorite ? "currentColor" : "none"} aria-hidden />{book.favorite ? "Favorited" : "Add to favorites"}</button>
            <button className="content-primary" type="submit">Save changes</button>
          </div>
        </form>}
        {!book.sample && <div><button type="button" disabled={categoryBusy} onClick={reclassify}>{categoryBusy ? "Scheduling…" : "Reclassify"}</button><p role="status">{categoryMessage}</p></div>}
        <div className="content-detail-links">
          <Link href={`/read/${book.id}`}>Open reader <ArrowUpRight size={15} aria-hidden /></Link>
          {book.url && <a href={book.url} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={15} aria-hidden /></a>}
        </div>
        <div className="content-detail-remove">
          {confirmRemove ? <><p>{book.sample ? "Hide this sample from your library?" : "Remove this item from your library?"}</p><div><button type="button" onClick={() => onRemove(book)}>Yes, remove</button><button type="button" onClick={() => setConfirmRemove(false)}>Keep it</button></div></> : <button type="button" onClick={() => setConfirmRemove(true)}><Trash2 size={14} aria-hidden />{book.sample ? "Hide sample" : "Remove from library"}</button>}
        </div>
      </div>
    </dialog>
  );
}
