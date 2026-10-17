"use client";

import { SignInButton } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, BookmarkPlus, Check, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import { importFromUrl, keep, looksLikeUrl } from "@/lib/import";
import { normalizeUrl } from "@/lib/links";
import { bookmarkWorkflow } from "@/lib/bookmark-workflow";
import { agentConnections, makeAgentConnection, revokeAgentConnection } from "@/lib/agent-client";
import { SITE_URL } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { Mark, MarkStack, type AgentMark } from "./AgentMarks";
import { Glyph } from "./Book";

export type AddTab = "links" | "agent";

/**
 * Adding to the library: paste links (one or many), or connect an agent that
 * saves to it through the Sakamoto MCP server.
 */
export function AddPanel({ tab, onTab, onClose, signedIn }: { tab: AddTab; onTab: (t: AddTab) => void; onClose: () => void; signedIn: boolean }) {
  const account = useStore(s => s.scope);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="presentation">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" style={{ animation: "fade 0.2s both" }} onClick={onClose} />
      <section role="dialog" aria-modal aria-label="Add to the library" className="add-panel">
        <header className="flex items-center justify-between gap-3">
          <div className="lib-sort !ml-0" role="tablist" aria-label="Add">
            <button type="button" role="tab" aria-selected={tab === "agent"} aria-checked={tab === "agent"} onClick={() => onTab("agent")}>
              Connect an agent
            </button>
            <button type="button" role="tab" aria-selected={tab === "links"} aria-checked={tab === "links"} onClick={() => onTab("links")}>
              Save links manually
            </button>
          </div>
          <button type="button" aria-label="Close" data-tip="Close" data-tip-kbd="Esc" onClick={onClose} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
            <X size={17} />
          </button>
        </header>
        {tab === "links" ? <Links /> : <Agent key={account ?? "anonymous"} signedIn={signedIn} />}
      </section>
    </div>,
    document.body
  );
}

/**
 * What opens the panel: plain about adding articles, with the agents that can
 * do it for you. On hover the marks fan out to the right from Grok, which
 * holds its place, and the plus turns.
 */
export function AddButton({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`lib-add${compact ? " is-compact" : ""}`}>
      <MarkStack size={compact ? 22 : 26} />
      <span className="min-w-0 text-left">
        <span className="lib-add-title">Add articles</span>
        {!compact && <span className="lib-add-sub">Connect an agent, or paste links</span>}
      </span>
      {!compact && (
        <span className="lib-add-plus" aria-hidden>
          <Plus size={15} strokeWidth={2.2} />
        </span>
      )}
    </button>
  );
}

/* ---------- links ---------- */

type Row = { url: string; state: "waiting" | "reading" | "saved" | "already" | "failed"; title?: string; error?: string };

/** How many links one Save reads in. A Pocket export can hold thousands; the rest wait in the box for the next Save. */
const BATCH = 100;

/** Every web link in an export: Pocket, Instapaper and Raindrop CSVs, Pocket's HTML, or a plain list. */
function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>,]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[).;\]]+$/, "")))];
}

function Links() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const urls = [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(looksLikeUrl))];

  const fromExport = async (f: File) => {
    const found = linksIn(await f.text().catch(() => ""));
    if (!found.length) return setNote(`No links found in ${f.name}.`);
    setText((cur) => [cur.trim(), ...found].filter(Boolean).join("\n"));
    setNote(`Found ${found.length} link${found.length === 1 ? "" : "s"} in ${f.name}.`);
  };

  const save = async () => {
    if (!urls.length || busy) return;
    setBusy(true);
    const have = new Set(useStore.getState().library.flatMap((x) => (x.sourceUrl ? [normalizeUrl(x.sourceUrl)] : [])));
    const all: Row[] = urls.map((url) => ({ url, state: have.has(normalizeUrl(url)) ? "already" : "waiting" }));
    const fresh = all.filter((r) => r.state === "waiting");
    const known = all.length - fresh.length;
    const rest = fresh.slice(BATCH).map((r) => r.url);
    // A long export lists only what is being read now; a short paste shows every link, saved before or not.
    const list = all.length > BATCH ? fresh.slice(0, BATCH) : all;
    setRows(list);
    setText(rest.join("\n"));
    setNote(
      all.length > BATCH
        ? [rest.length ? `Saving ${BATCH} now; ${rest.length} more wait above for the next Save.` : `Saving ${fresh.length}.`, known ? `${known} already in your library.` : ""].filter(Boolean).join(" ")
        : null
    );
    const set = (i: number, r: Partial<Row>) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, ...r } : x)));
    const todo = list.map((r, i) => ({ r, i })).filter((x) => x.r.state === "waiting");
    const next = async () => {
      for (let x = todo.shift(); x; x = todo.shift()) {
        set(x.i, { state: "reading" });
        const r = await importFromUrl(x.r.url, (_, label) => label && set(x!.i, { title: label }));
        const err = r.ok ? await keep(r.article, r.file) : r.error;
        set(x.i, err ? { state: "failed", error: err, title: undefined } : { state: "saved", title: r.ok ? r.article.title : undefined });
      }
    };
    // A few at a time, so a slow site never holds the rest up.
    await Promise.all([next(), next(), next()]);
    setBusy(false);
  };

  return (
    <div className="mt-5">
      <p className="text-[19px] font-serif leading-tight text-ink">Save links to your library</p>
      <p className="mt-1 text-[13px] text-ink-3">
        One or many, a line each. Sakamoto reads each page in and sorts it onto a topic. PDFs work too. Leaving Pocket, Instapaper or Raindrop?{" "}
        <button type="button" onClick={() => fileRef.current?.click()} className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
          Drop its export here
        </button>
        .
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.html,.htm,.txt,.json,text/csv,text/html,text/plain,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void fromExport(f);
          e.target.value = "";
        }}
      />
      <textarea
        ref={ref}
        value={text}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          setOver(false);
          if (!f) return;
          e.preventDefault();
          void fromExport(f);
        }}
        style={over ? { borderColor: "var(--rubric)", borderStyle: "dashed" } : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder={"https://paulgraham.com/greatwork.html\nhttps://..."}
        rows={4}
        className="add-text"
        aria-label="Links to save"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-4">{urls.length ? `${urls.length} link${urls.length === 1 ? "" : "s"}` : text.trim() ? "No links found yet" : ""}</span>
        <button type="button" onClick={save} disabled={!urls.length || busy} className="add-btn">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "Saving" : urls.length > 1 ? `Save ${Math.min(urls.length, BATCH)}` : "Save"}
        </button>
      </div>
      {note && <p className="mt-2 text-[12.5px] text-ink-3">{note}</p>}
      {rows.length > 0 && (
        <ul className="add-rows scroll-thin">
          {rows.map((r) => (
            <li key={r.url} data-state={r.state}>
              <span className="add-dot" aria-hidden>
                {r.state === "reading" ? <Loader2 size={13} className="animate-spin" /> : r.state === "saved" || r.state === "already" ? <Check size={13} /> : r.state === "failed" ? <X size={13} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{r.title ?? r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {r.state === "saved" ? "On the shelf" : r.state === "already" ? "Already in your library" : r.state === "failed" ? r.error : r.state === "reading" ? "Reading" : "Waiting"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Bookmarklets />
    </div>
  );
}

/**
 * Bookmarklets: one click on any page opens it in Sakamoto, in a new tab, to read now
 * or to shelve for later (`/?url=` and `/?save=` on the home page).
 */
function Bookmarklets() {
  const readRef = useRef<HTMLAnchorElement>(null);
  const saveRef = useRef<HTMLAnchorElement>(null);
  const [origin, setOrigin] = useState(SITE_URL);
  const code = (param: "url" | "save") => `javascript:void(window.open('${origin}/?${param}='+encodeURIComponent(location.href)))`;
  useEffect(() => setOrigin(window.location.origin), []);
  // React refuses javascript: links in JSX, so they are set by hand.
  useEffect(() => {
    readRef.current?.setAttribute("href", code("url"));
    saveRef.current?.setAttribute("href", code("save"));
  });
  const pill = "inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing";
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <p className="lib-label">From any page</p>
      <p className="mt-1 text-[13px] text-ink-3">Drag one to your bookmarks bar, then click it on any article.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a ref={readRef} onClick={(e) => e.preventDefault()} data-tip="Drag me to your bookmarks bar" className={pill}>
          <BookOpen size={14} className="text-ink-3" /> Read in Sakamoto
        </a>
        <a ref={saveRef} onClick={(e) => e.preventDefault()} data-tip="Drag me to your bookmarks bar" className={pill}>
          <BookmarkPlus size={14} className="text-ink-3" /> Save to Sakamoto
        </a>
      </div>
      <details className="mt-3 text-[12.5px] text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">On a phone</summary>
        <div className="mt-2">
          <CopyBlock title="Bookmark any page, then edit the bookmark" body="Paste this as its address and name it Save to Sakamoto." text={code("save")} />
        </div>
      </details>
    </div>
  );
}

/* ---------- an agent ---------- */

type Conn = { id: string; label: string; createdAt: string; lastUsedAt: string | null };
const LABELS: { label: string; mark?: AgentMark }[] = [
  { label: "Grok Bot", mark: "grok" },
  { label: "Claude", mark: "claude" },
  { label: "ChatGPT", mark: "chatgpt" },
  { label: "Other" },
];

function Agent({ signedIn }: { signedIn: boolean }) {
  const account = useStore(s => s.scope);
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [made, setMade] = useState<{ token: string; label: string } | null>(null);
  const [label, setLabel] = useState("Grok Bot");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : SITE_URL;

  useEffect(() => {
    let active = true;
    setConns(null); setMade(null); setErr(null);
    if (signedIn && account) agentConnections().then(c => { if(active) setConns(c); }, e => { if(active) setErr(e.message); });
    return () => { active = false; };
  }, [signedIn, account]);

  if (!signedIn)
    return (
      <div className="mt-5">
        <AgentIntro />
        <p className="mt-4 text-[13.5px] text-ink-2">An agent saves to the library in your account, so it needs you signed in.</p>
        <SignInButton mode="modal">
          <button type="button" className="add-btn mt-4">
            Sign in to connect
          </button>
        </SignInButton>
      </div>
    );

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const j = await makeAgentConnection(label);
      setMade({ token: j.token, label: j.label });
      setConns(c => [{id:j.id,label:j.label,createdAt:new Date().toISOString(),lastUsedAt:null}, ...(c??[])]);
    } catch(e) { setErr(e instanceof Error?e.message:"Could not make a connection."); }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    try { await revokeAgentConnection(id); setConns(c => c?.filter(x => x.id !== id) ?? null); }
    catch(e) { setErr(e instanceof Error?e.message:"Could not revoke the connection."); }
  };

  return (
    <div className="mt-5">
      <AgentIntro />
      {made ? (
        <Setup token={made.token} label={made.label} origin={origin} />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="lib-sort !ml-0" role="radiogroup" aria-label="Which agent">
            {LABELS.map((l) => (
              <button key={l.label} type="button" role="radio" aria-checked={label === l.label} onClick={() => setLabel(l.label)} className="inline-flex items-center gap-1.5">
                {l.mark && <Mark k={l.mark} size={14} />}
                {l.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={create} disabled={busy} className="add-btn">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Make a connection
          </button>
          {err && <p className="w-full text-[12.5px] text-rubric-text">{err}</p>}
        </div>
      )}
      {conns && conns.length > 0 && (
        <div className="mt-6">
          <p className="lib-label">Connected</p>
          <ul className="mt-2 divide-y divide-rule">
            {conns.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{c.label}</span>
                  <span className="ml-2 text-ink-3">
                    {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "not used yet"}
                  </span>
                </span>
                <button type="button" onClick={() => revoke(c.id)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
                  <Trash2 size={13} /> Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AgentIntro() {
  return (
    <div className="flex items-start gap-3.5">
      <Glyph k="agent" size={46} className="shrink-0" />
      <div>
        <p className="font-serif text-[19px] leading-tight text-ink">Let your agent shelve for you</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">
          Connect Sakamoto to your agent to save full bookmarked posts, their available author-thread context, and directly linked articles or PDFs. Grok Bot needs its own authenticated X connection. Accepted sources stay saved while paid categorization and indexing process separately.
        </p>
      </div>
    </div>
  );
}



function Setup({ token, label, origin }: { token: string; label: string; origin: string }) {
  const [time, setTime] = useState("09:00"), [timeZone, setTimeZone] = useState("Europe/Lisbon");
  let prepared: ReturnType<typeof bookmarkWorkflow>;
  try { prepared = bookmarkWorkflow(origin,time,timeZone); } catch { prepared = bookmarkWorkflow(origin); }
  const url = `${origin}/mcp`;
  const steps: { title: string; body: string; copy: string }[] =
    label === "Grok Bot" || label === "Grok"
      ? [
          { title: "Grok Bot: custom MCP, Remote HTTPS", body: "In Connect apps, add Sakamoto as a custom Remote HTTPS server when available. Supply this endpoint; ask Grok to guide the connection if its controls differ.", copy: prepared.endpoint ?? "Deploy an approved public HTTPS Sakamoto origin first." },
          { title: "Authentication header", body: "Put this in the connector’s protected header/secret field. Keep it out of chat, prompts and receipts. Complete X plugin sign-in separately using secure handoff.", copy: prepared.remoteReady ? `Authorization: Bearer ${token}` : "Cloud connection unavailable from this local origin." },
        ]
      : label === "Claude"
        ? [
            { title: "Claude Code: run this", body: "Then ask Claude to save something to your Sakamoto library.", copy: `claude mcp add --transport http sakamoto ${url} --header "Authorization: Bearer ${token}"` },
            { title: "Or claude.ai: Settings, Connectors, Add custom connector", body: "This link carries your token, so keep it private.", copy: `${url}/${token}` },
          ]
        : [
            { title: "The server URL and a header", body: `URL ${url}, and this header:`, copy: `Authorization: Bearer ${token}` },
            { title: "Or, for apps that only take a URL, one with your token in it", body: "Keep it private: it can end up in logs.", copy: `${url}/${token}` },
          ];
  return (
    <div className="mt-5 space-y-3">
      <p className="text-[13px] text-good">Made. This token is shown once: copy it now.</p>
      {steps.map((s) => (
        <CopyBlock key={s.title} title={s.title} body={s.body} text={s.copy} />
      ))}
      <p className="text-[12px] text-ink-3">{prepared.connectionNotice}</p>
      <CopyBlock title="Full-post sample and resumable backfill workflow" body="Verify the mixed sample first, then continue within your existing authorized backfill/account scope. These instructions do not configure a connection or a routine." text={prepared.workflow} />
      <details>
        <summary className="text-[13px]">Prepare the daily Grok routine</summary>
        <label className="mt-2 block text-[12px]">Daily time <input aria-label="Grok routine daily time" type="time" value={time} onChange={e=>setTime(e.target.value)} className="rounded border border-rule p-1" /></label>
        <label className="mt-2 block text-[12px]">Time zone <select aria-label="Grok routine time zone" value={timeZone} onChange={e=>setTimeZone(e.target.value)} className="rounded border border-rule p-1"><option>Europe/Lisbon</option><option>UTC</option><option>America/New_York</option><option>America/Los_Angeles</option></select></label>
        <CopyBlock title="Prepared routine — not enabled" body="After the sample passes, enable only within your authorized routine/account scope; existing authorization applies. Inspect its Test run, next run and history; Grok allowance is separate from Sakamoto’s budget." text={prepared.routine} />
      </details>
      <p className="text-[12px] text-ink-3">Official Grok Bot guidance: {prepared.sources.map(source=><a key={source.url} className="mr-2 underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}. An unavailable account, expired X login or missing routine feature needs attention in Grok; Sakamoto cannot schedule source fetching.</p>
    </div>
  );
}

function CopyBlock({ title, body, text }: { title: string; body: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[14px] border border-rule bg-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{title}</p>
          <p className="text-[12px] text-ink-3">{body}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {}
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunk px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">{text}</pre>
    </div>
  );
}
