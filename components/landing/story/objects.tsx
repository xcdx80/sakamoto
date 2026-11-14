/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";

/** The things people save, made of paper. Decorative: the layer holding them is aria-hidden. */

export function XBookmark() {
  return (
    <div className="pc pc-tweet">
      <div className="pc-tweet-head"><i /><span><b>X bookmarks</b><em>Synced to InView</em></span></div>
      <p>A thread on how to take better notes</p>
      <small>Saved from X</small>
    </div>
  );
}

function XPostCard({ name, handle, label, children, links }: {
  name: string;
  handle: string;
  label?: string;
  children: ReactNode;
  links?: readonly string[];
}) {
  return (
    <div className="pc pc-tweet pc-post-card">
      <div className="pc-tweet-head">
        <i />
        <span><b>{name}</b><em>{handle}</em></span>
        <b className="pc-post-mark">𝕏</b>
      </div>
      <p>{children}</p>
      {links && <div className="pc-post-links">{links.map((link) => <span key={link}>{link}</span>)}</div>}
      {label && <small>{label}</small>}
    </div>
  );
}

const threadAuthor = { name: "Maya Chen", handle: "@mayareads" };

export function XThreadStack() {
  return (
    <div className="pc-stack pc-thread-stack">
      <XPostCard {...threadAuthor}>3/3 End with one question worth coming back to.</XPostCard>
      <XPostCard {...threadAuthor}>2/3 Write down one good idea in your own words.</XPostCard>
      <XPostCard {...threadAuthor} label="X thread">1/3 A small habit that made my reading notes more useful.</XPostCard>
    </div>
  );
}

function LinkedArticleCard({ title, source }: { title: string; source: string }) {
  return (
    <div className="pc pc-article-card">
      <small>{source}</small>
      <b>{title}</b>
      <small>Auto-saved to InView</small>
    </div>
  );
}

export function XLinkedArticlesStack() {
  return (
    <div className="pc-stack pc-linked-stack">
      <LinkedArticleCard title="A Better Reading List" source="The Reading Room" />
      <LinkedArticleCard title="A Guide to Marginalia" source="Field Notes" />
      <XPostCard name="Nora Ellis" handle="@norareads" label="2 linked articles saved" links={["t.co/k8L4pQ2m", "t.co/r6W9dV3n"]}>
        Two good reads for the weekend:
      </XPostCard>
    </div>
  );
}

export function PdfCorner() {
  return (
    <div className="pc pc-pdf">
      <span className="pc-pdf-tag">PDF</span>
      <div className="pc-lines"><i /><i /><i /><i style={{ width: "62%" }} /></div>
      <small>field-notes.pdf</small>
    </div>
  );
}

export function Clipping() {
  return (
    <div className="pc pc-clip">
      <small>Saved web article</small>
      <h4>The Art of Noticing</h4>
      <div className="pc-columns"><i /><i /></div>
    </div>
  );
}

export function IndexCard() {
  return (
    <div className="pc pc-index">
      <span>Pasted text</span>
      <p>Notes from a</p>
      <p>favorite essay</p>
    </div>
  );
}

export function Sticky({ tone, children }: { tone: "marigold" | "blush"; children: string }) {
  return <div className={`pc pc-sticky is-${tone}`}><p>{children}</p></div>;
}

export function Stamp() {
  return (
    <div className="pc pc-stamp">
      <div><b>1¢</b><small>Read me</small></div>
    </div>
  );
}

export function DueCard() {
  return (
    <div className="pc pc-due">
      <span>Date due</span>
      <i>MAR 04</i>
      <i>JUN 11</i>
      <i className="is-late">OVERDUE</i>
    </div>
  );
}

export function Paperclip() {
  return (
    <svg className="pc pc-svg" width="30" height="74" viewBox="0 0 30 74" fill="none">
      <path d="M22 18v40a8 8 0 0 1-16 0V13a10 10 0 0 1 20 0v41" stroke="var(--ink-3)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Pencil() {
  return (
    <svg className="pc pc-svg" width="170" height="26" viewBox="0 0 170 26" fill="none">
      <rect x="20" y="4" width="118" height="18" fill="var(--toy-marigold)" />
      <rect x="20" y="10" width="118" height="5" fill="#000" opacity=".07" />
      <rect x="8" y="4" width="14" height="18" rx="3" fill="var(--toy-blush)" />
      <rect x="18" y="4" width="8" height="18" fill="var(--toy-kraft)" />
      <path d="M138 4l24 9-24 9z" fill="var(--toy-kraft)" opacity=".7" />
      <path d="M154 10l8 3-8 3z" fill="var(--ink)" />
    </svg>
  );
}

export function Book({ cover, title }: { cover: string; title: string }) {
  return (
    <div className="pc pc-book" title={title}>
      <img src={cover} alt="" draggable={false} />
    </div>
  );
}

export function Receipt() {
  return (
    <div className="pc pc-receipt">
      <span>In your library</span>
      <p><em>X posts</em><em>✓</em></p>
      <p><em>Articles</em><em>✓</em></p>
      <p className="is-total"><em>PDFs</em><em>✓</em></p>
    </div>
  );
}

export function Envelope() {
  return (
    <div className="pc pc-envelope">
      <svg viewBox="0 0 150 96" preserveAspectRatio="none" fill="none"><path d="M1 2l74 54 74-54" stroke="#000" strokeOpacity=".22" /></svg>
      <small>Newsletter link</small>
      <b>Saved from the web</b>
    </div>
  );
}

export function Highlighter() {
  return (
    <svg className="pc pc-svg" width="150" height="34" viewBox="0 0 150 34" fill="none">
      <rect x="2" y="5" width="96" height="24" rx="5" fill="var(--ink)" />
      <rect x="96" y="7" width="24" height="20" fill="var(--toy-marigold)" />
      <path d="M120 9l24 3v10l-24 3z" fill="var(--toy-marigold)" />
      <text x="16" y="21" fontFamily="var(--font-mono)" fontSize="10" fill="var(--bg-raised)" letterSpacing="1">INVIEW</text>
    </svg>
  );
}

export function Ribbon() {
  return <div className="pc pc-ribbon" />;
}

export function Tag() {
  return (
    <div className="pc pc-tag">
      <i />
      <span>To read</span>
    </div>
  );
}

export function Screenshot() {
  return (
    <div className="pc pc-shot">
      <div className="pc-lines"><i /><i /><b /><i style={{ width: "48%" }} /></div>
      <small>IMG_4821</small>
    </div>
  );
}

export function Sticker() {
  return <div className="pc pc-sticker"><span>Later</span></div>;
}
