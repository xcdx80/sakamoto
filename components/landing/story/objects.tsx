/* eslint-disable @next/next/no-img-element */
/** The things people save, made of paper. Decorative: the layer holding them is aria-hidden. */

export function TweetSlip() {
  return (
    <div className="pc pc-tweet">
      <div className="pc-tweet-head"><i /><span><b>a stranger</b><em>@saved_it_once</em></span></div>
      <p>this thread changed my life. haven’t read it yet.</p>
      <small>Bookmarked 3 years ago</small>
    </div>
  );
}

export function PdfCorner() {
  return (
    <div className="pc pc-pdf">
      <span className="pc-pdf-tag">PDF</span>
      <div className="pc-lines"><i /><i /><i /><i style={{ width: "62%" }} /></div>
      <small>report_FINAL_v7(2).pdf</small>
    </div>
  );
}

export function Clipping() {
  return (
    <div className="pc pc-clip">
      <small>Morning Edition</small>
      <h4>Local Reader Finally Opens Tab From 2019</h4>
      <div className="pc-columns"><i /><i /></div>
    </div>
  );
}

export function IndexCard() {
  return (
    <div className="pc pc-index">
      <span>Ideas</span>
      <p>read more</p>
      <p>(see: every year)</p>
    </div>
  );
}

export function Sticky({ tone, children }: { tone: "marigold" | "blush"; children: string }) {
  return <div className={`pc pc-sticky is-${tone}`}><p>{children}</p></div>;
}

export function Ticket() {
  return (
    <div className="pc pc-ticket">
      <div>
        <small>Boarding</small>
        <b>NOW <span>→</span> LATER</b>
        <small>Seat: couch</small>
      </div>
      <em>Read<br />later</em>
    </div>
  );
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
      <span>Your browser</span>
      <p><em>Open tabs</em><em>47</em></p>
      <p><em>Read</em><em>0</em></p>
      <p className="is-total"><em>Total</em><em>Guilt</em></p>
    </div>
  );
}

export function Envelope() {
  return (
    <div className="pc pc-envelope">
      <svg viewBox="0 0 150 96" preserveAspectRatio="none" fill="none"><path d="M1 2l74 54 74-54" stroke="#000" strokeOpacity=".22" /></svg>
      <small>Newsletter</small>
      <b>Unread (312)</b>
    </div>
  );
}

export function Highlighter() {
  return (
    <svg className="pc pc-svg" width="150" height="34" viewBox="0 0 150 34" fill="none">
      <rect x="2" y="5" width="96" height="24" rx="5" fill="var(--ink)" />
      <rect x="96" y="7" width="24" height="20" fill="var(--toy-marigold)" />
      <path d="M120 9l24 3v10l-24 3z" fill="var(--toy-marigold)" />
      <text x="16" y="21" fontFamily="var(--font-mono)" fontSize="10" fill="var(--bg-raised)" letterSpacing="1">SAKAMOTO</text>
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
