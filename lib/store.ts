"use client";

import { READER_METADATA_FIELDS, type ReaderMetadataField } from "./library-ownership";
import { accountEpoch, accountScope, scopedKey, selectAccount } from "./account-scope";
import { create } from "zustand";
import type { Action } from "./actions";
import { contentTypeOf, type Article, type BriefData, type ContentType } from "./article";
import { derivedDocument, derivedDocumentMetadata } from "./source-edits";
import { modelOf, type ModelKey, type Source, type Usage } from "./models";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Marker, type Settings } from "./settings";

/** A point in the text: block id and a character offset into its plain text. */
export type Point = { b: string; o: number };
export type Anchor = { start: Point; end: Point; quote: string };

export type Turn = {
  role: "user" | "assistant";
  content: string;
  usage?: Usage;
  model?: string;
  modelKey?: ModelKey;
  /** Historical error flag retained for stored-result compatibility. */
  needKey?: boolean;
  /** Looking things up on the web before the answer starts. */
  searching?: boolean;
  /** The web results this answer may cite as [1], [2]. */
  sources?: Source[];
  error?: string;
  streaming?: boolean;
};

export type Gloss = {
  sourceRevision?: number;
  id: string;
  articleId: string;
  /** Anchored to a selection... */
  anchor?: Anchor;
  /** ...or asked about the whole text from a reading position (a block id). */
  at?: string;
  action: Action;
  question?: string;
  turns: Turn[];
  createdAt: number;
};

/**
 * Where a highlight stands in the daily review: when it is next due, how many
 * times it has come round, when it was last seen, and whether it was retired.
 */
export type Review = { due: number; step: number; last: number; off?: boolean };

export type Highlight = { sourceRevision?: number; id: string; articleId: string; anchor: Anchor; createdAt: number; color?: Marker; note?: string; review?: Review };

export type BriefState = { sourceRevision?: number } & (
  { status: "loading" } | { status: "ready"; data: BriefData; usage?: Usage; modelKey?: ModelKey; at: number } | { status: "error"; error: string; needKey?: boolean }
);

export type { Settings } from "./settings";

export type LibraryItem = {
  postId?: string;
  processing?: import("./bookmarks").ProcessingState;
  id: string;
  title: string;
  author?: string;
  source?: string;
  words: number;
  origin: Article["origin"];
  /** Optional for entries saved before content types were introduced. */
  contentType?: ContentType;
  addedAt: number;
  /** Bumped when the text itself is replaced (read more carefully), so sync sends it again. */
  rev?: number;
  sourceRevision?: number;
  recoveredFrom?: { itemId: string; sourceRevision: number };
  manualFields?: ReaderMetadataField[];
  /* The library: where it is shelved, and what it looks like there. */
  /** One of the library's topics (lib/library.ts); missing until it has been sorted. */
  topic?: string;
  tags?: string[];
  /** What the painted cover shows, written when the text is sorted. */
  scene?: string;
  dek?: string;
  year?: number;
  sourceUrl?: string;
  /** The page's own lead picture. */
  image?: string;
  /** A painted cover: a bundled one by path, or "painted" for one made for this text. */
  cover?: string;
  favorite?: boolean;
  /** When it was first read to the end. */
  finishedAt?: number;
  /** Saved by an agent, through the Sakamoto MCP server. */
  addedBy?: "agent";
  /** Which connection an agent saved it through, by the name the reader gave it. */
  addedVia?: string;
};

export type Progress = { sourceRevision?: number; block: string; pct: number; at: number };

/** A row from the account, as the sync route sends it. `data` is null on a tombstone. */
export type RemoteRow<T> = { id: string; articleId: string; data: T | null; deleted: boolean; revision?: number; sourceRevision?: number };
export type RemoteChanges = {
  articles?: RemoteRow<LibraryItem>[];
  highlights?: RemoteRow<Highlight>[];
  glosses?: RemoteRow<Gloss>[];
  briefs?: RemoteRow<BriefState>[];
  progress?: RemoteRow<Progress>[];
};

type Persisted = {
  glosses: Record<string, Gloss[]>;
  highlights: Record<string, Highlight[]>;
  briefs: Record<string, BriefState>;
  progress: Record<string, Progress>;
  library: LibraryItem[];
};

type UI = {
  syncError: string | null;
  syncNotice: string | null;
  hydrated: boolean;
  activeGloss: string | null;
  hoverGloss: string | null;
  enteringGloss: string | null;
  activeHighlight: string | null;
  /** Just created: its mark is drawn on rather than appearing. */
  enteringHighlight: string | null;
  notebookOpen: boolean;
  shortcutsOpen: boolean;
  focusMode: boolean;
  cursor: string | null;
  briefOpen: boolean;
  /** The passage a question is being typed about, shown while the native selection is gone. */
  pending: Anchor | null;
  /** The whole shelf, pulled up over the desk: its texts, or every highlight across them. */
  shelf: null | "texts" | "highlights";
};

type State = Persisted &
  UI & {
    scope: string | null | undefined;
    activateAccount: (owner: string | null) => void;
    adoptAnonymous: () => Promise<void>;
    anonymousCount: () => number;
    settings: Settings;
    hydrate: () => void;
    setSettings: (s: Partial<Settings>) => void;
    setUI: (u: Partial<UI>) => void;
    addGloss: (g: Gloss) => void;
    updateGloss: (articleId: string, id: string, fn: (g: Gloss) => Gloss) => void;
    removeGloss: (articleId: string, id: string) => void;
    addHighlight: (h: Highlight) => void;
    updateHighlight: (articleId: string, id: string, patch: Partial<Highlight>) => void;
    removeHighlight: (articleId: string, id: string) => void;
    setBrief: (articleId: string, b: BriefState | null) => void;
    setProgress: (articleId: string, p: Progress) => void;
    addToLibrary: (a: Article, words: number, extra?: Partial<LibraryItem>) => void;
    /** Change a shelf entry's library fields: its topic, tags, cover, favourite. */
    shelve: (id: string, patch: Partial<LibraryItem>, options?: { automatic?: boolean }) => void;
    removeFromLibrary: (id: string) => void;
    replaceText: (a: Article, words: number) => Promise<boolean>;
    updateText: (a: Article, words: number) => Promise<boolean>;
    applyRemote: (c: RemoteChanges) => void;
  };

const KEY = "gloss:v1";
const DOC_PREFIX = "gloss:doc:";
const ANONYMOUS_KEY = "sakamoto:anonymous:v2";
function hasLegacyAccountSync(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("gloss:sync:")) return true;
  } catch {}
  return false;
}
function localSnapshotKey() {
  return accountScope() ? scopedKey(KEY) : ANONYMOUS_KEY;
}
function readAnonymous(): Partial<Persisted> {
  try {
    const current = localStorage.getItem(ANONYMOUS_KEY);
    if (current) return JSON.parse(current);
    // Old versions mixed signed-in and anonymous content. Keep an uncertain cache quarantined for explicit adoption.
    if (hasLegacyAccountSync()) return {};
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function adoptionSnapshot(): Partial<Persisted> {
  const current = readAnonymous();
  if (!hasLegacyAccountSync()) return current;
  try {
    const legacy = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Persisted>;
    return {
      ...legacy,
      ...current,
      library: [...(legacy.library ?? []).filter((x) => !current.library?.some((y) => y.id === x.id)), ...(current.library ?? [])],
      highlights: { ...legacy.highlights, ...current.highlights },
      glosses: { ...legacy.glosses, ...current.glosses },
      briefs: { ...legacy.briefs, ...current.briefs },
      progress: { ...legacy.progress, ...current.progress },
    };
  } catch {
    return current;
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const useStore = create<State>((set, get) => ({
  glosses: {},
  highlights: {},
  briefs: {},
  progress: {},
  library: [],
  syncError: null,
  syncNotice: null,
  scope: undefined,
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  activeGloss: null,
  hoverGloss: null,
  enteringGloss: null,
  activeHighlight: null,
  enteringHighlight: null,
  notebookOpen: false,
  shortcutsOpen: false,
  focusMode: false,
  cursor: null,
  briefOpen: true,
  pending: null,
  shelf: null,

  activateAccount: (owner) => {
    if (get().scope === owner) return;
    if (get().hydrated) persist(get());
    selectAccount(owner);
    set({
      scope: owner,
      syncError: null,
      syncNotice: null,
      hydrated: false,
      library: [],
      highlights: {},
      glosses: {},
      briefs: {},
      progress: {},
      activeGloss: null,
      activeHighlight: null,
      pending: null,
    });
    get().hydrate();
  },
  anonymousCount: () => {
    return adoptionSnapshot().library?.length ?? 0;
  },
  adoptAnonymous: async () => {
    const owner = accountScope();
    if (!owner) return;
    const epoch = accountEpoch();
    const currentOwner = () => accountScope() === owner && accountEpoch() === epoch;
    const fail = (title: string): never => {
      const error = new Error(`Could not durably copy “${title}”. Anonymous data is unchanged. Free storage or restore the source and retry.`);
      if (currentOwner()) set({ syncError: error.message });
      throw error;
    };
    const old = adoptionSnapshot();
    for (const item of old.library ?? []) {
      const destination = await loadDoc(item.id, owner);
      if (!currentOwner()) return;
      if (destination) continue; // Keep an existing readable account copy without replacement.
      const doc = await loadDoc(item.id, null, true);
      if (!currentOwner()) return;
      if (doc && !(await saveDoc(doc, owner))) fail(item.title);
      if (!currentOwner()) return;
    }
    const current = get();
    const arrays = <T extends { id: string }>(older: Record<string, T[]>, newer: Record<string, T[]>) =>
      Object.fromEntries(
        [...new Set([...Object.keys(older), ...Object.keys(newer)])].map((id) => [
          id,
          [...(older[id] ?? []).filter((x) => !(newer[id] ?? []).some((y) => x.id === y.id)), ...(newer[id] ?? [])],
        ]),
      );
    const adopted: Persisted = {
      library: [...(old.library ?? []).filter((x) => !current.library.some((y) => y.id === x.id)), ...current.library],
      highlights: arrays(old.highlights ?? {}, current.highlights),
      glosses: arrays(old.glosses ?? {}, current.glosses),
      briefs: { ...old.briefs, ...current.briefs },
      progress: { ...old.progress, ...current.progress },
    };
    if (!persist(adopted)) fail("anonymous library");
    set({ ...adopted, syncError: null });
  },
  hydrate: () => {
    if (get().hydrated) return;
    let data: Partial<Persisted> = {};
    let settings: Partial<Settings> = {};
    try {
      data = accountScope() ? JSON.parse(localStorage.getItem(localSnapshotKey()) || "{}") : readAnonymous();
      settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {}
    // A reload mid-answer leaves a dangling stream: mark it, never spin forever.
    const glosses = data.glosses ?? {};
    for (const list of Object.values(glosses)) {
      for (const g of list) {
        for (const t of g.turns) {
          if (t.streaming) {
            t.streaming = false;
            if (!t.content) t.error = "Interrupted. Ask again to retry.";
          }
        }
      }
    }
    const briefs = data.briefs ?? {};
    for (const [k, b] of Object.entries(briefs)) if (b.status !== "ready") delete briefs[k];
    set({
      glosses,
      highlights: data.highlights ?? {},
      briefs,
      progress: data.progress ?? {},
      library: data.library ?? [],
      settings: { ...DEFAULT_SETTINGS, ...settings, model: modelOf(settings.model) },
      hydrated: true,
    });
    void migrateDocs();
  },

  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  },

  setUI: (u) => set(u),

  addGloss: (g) =>
    set((st) => ({
      glosses: {
        ...st.glosses,
        [g.articleId]: [...(st.glosses[g.articleId] ?? []), { ...g, sourceRevision: g.sourceRevision ?? st.library.find((x) => x.id === g.articleId)?.sourceRevision ?? 1 }],
      },
      activeGloss: g.id,
      enteringGloss: g.id,
    })),

  updateGloss: (articleId, id, fn) =>
    set((st) => ({
      glosses: { ...st.glosses, [articleId]: (st.glosses[articleId] ?? []).map((g) => (g.id === id ? fn(g) : g)) },
    })),

  removeGloss: (articleId, id) =>
    set((st) => ({
      glosses: { ...st.glosses, [articleId]: (st.glosses[articleId] ?? []).filter((g) => g.id !== id) },
      activeGloss: st.activeGloss === id ? null : st.activeGloss,
      hoverGloss: st.hoverGloss === id ? null : st.hoverGloss,
    })),

  addHighlight: (h) => {
    set((st) => ({
      highlights: {
        ...st.highlights,
        [h.articleId]: [...(st.highlights[h.articleId] ?? []), { ...h, sourceRevision: h.sourceRevision ?? st.library.find((x) => x.id === h.articleId)?.sourceRevision ?? 1 }],
      },
      enteringHighlight: h.id,
    }));
    setTimeout(() => get().enteringHighlight === h.id && set({ enteringHighlight: null }), 700);
  },

  updateHighlight: (articleId, id, patch) =>
    set((st) => ({
      highlights: { ...st.highlights, [articleId]: (st.highlights[articleId] ?? []).map((h) => (h.id === id ? { ...h, ...patch } : h)) },
    })),

  removeHighlight: (articleId, id) =>
    set((st) => ({
      highlights: { ...st.highlights, [articleId]: (st.highlights[articleId] ?? []).filter((h) => h.id !== id) },
      activeHighlight: st.activeHighlight === id ? null : st.activeHighlight,
    })),

  setBrief: (articleId, b) =>
    set((st) => {
      const briefs = { ...st.briefs };
      if (b) briefs[articleId] = { ...b, sourceRevision: b.sourceRevision ?? st.library.find((x) => x.id === articleId)?.sourceRevision ?? 1 };
      else delete briefs[articleId];
      return { briefs };
    }),

  setProgress: (articleId, p) =>
    set((st) => {
      // The first time a text is read to the end, the library notes when.
      const done = p.pct >= 1 && st.library.some((x) => x.id === articleId && !x.finishedAt);
      return {
        progress: { ...st.progress, [articleId]: { ...p, sourceRevision: p.sourceRevision ?? st.library.find((x) => x.id === articleId)?.sourceRevision ?? 1 } },
        ...(done ? { library: st.library.map((x) => (x.id === articleId ? { ...x, finishedAt: p.at } : x)) } : {}),
      };
    }),

  addToLibrary: (a, words, extra) =>
    set((st) => {
      const year = Number(a.published?.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]) || undefined;
      const item: LibraryItem = {
        id: a.id,
        title: a.title,
        author: a.author,
        source: a.source,
        words,
        origin: a.origin,
        contentType: contentTypeOf(a),
        addedAt: a.addedAt ?? Date.now(),
        dek: a.dek,
        year,
        sourceUrl: a.sourceUrl,
        image: a.image,
        ...extra,
      };
      // Undefined fields are left out, so a shelf entry's JSON stays as small as it was.
      for (const k of Object.keys(item) as (keyof LibraryItem)[]) if (item[k] === undefined) delete item[k];
      return { library: [item, ...st.library.filter((x) => x.id !== a.id)] };
    }),

  shelve: (id, patch, options) =>
    set((st) => ({
      library: st.library.map((x) => {
        if (x.id !== id) return x;
        const manualFields = options?.automatic
          ? x.manualFields
          : [...new Set([...(x.manualFields ?? []), ...READER_METADATA_FIELDS.filter((field) => Object.hasOwn(patch, field))])];
        return { ...x, ...patch, ...(manualFields ? { manualFields } : {}) };
      }),
    })),

  removeFromLibrary: (id) => {
    void dropDoc(id);
    set((st) => ({ library: st.library.filter((x) => x.id !== id) }));
  },

  // Part of a text read again (an existing saved page replacement) where no mark is anchored:
  // the marks stay. The rev bump makes sync send the text again.
  updateText: async (a, words) => {
    const epoch = accountEpoch();
    if (!(await saveDoc(derivedDocument(a))) || accountEpoch() !== epoch) return false;
    set((st) => ({ library: st.library.map((x) => (x.id === a.id ? { ...derivedDocumentMetadata(x), words, rev: (x.rev ?? 0) + 1 } : x)) }));
    return true;
  },

  // A new reading of the same text. Every mark is anchored to a block id and offset in the old
  // text, so highlights, glosses and the whole-text gloss go with it; the caller asks first.
  replaceText: async (a, words) => {
    const epoch = accountEpoch();
    if (!(await saveDoc(derivedDocument(a))) || accountEpoch() !== epoch) return false;
    set((st) => {
      const rest = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== a.id)) as Record<string, T>;
      return {
        library: st.library.map((x) => (x.id === a.id ? { ...derivedDocumentMetadata(x), words, rev: (x.rev ?? 0) + 1 } : x)),
        highlights: rest(st.highlights),
        glosses: rest(st.glosses),
        briefs: rest(st.briefs),
        progress: rest(st.progress),
      };
    });
    return true;
  },

  // Changes from another device. The server's copy replaces the local one,
  // except a gloss that is still being written here.
  applyRemote: (c) =>
    set((st) => {
      let library = st.library;
      for (const r of c.articles ?? []) {
        library = library.filter((x) => x.id !== r.id);
        if (r.deleted || !r.data) void dropDoc(r.id);
        else library = [r.data, ...library];
      }

      const merge = <T extends { id: string; createdAt: number }>(cur: Record<string, T[]>, rows: RemoteRow<T>[] = [], keep?: (t: T) => boolean) => {
        if (!rows.length) return cur;
        const next = { ...cur };
        for (const r of rows) {
          const list = next[r.articleId] ?? [];
          const local = list.find((x) => x.id === r.id);
          if (local && keep?.(local)) continue;
          next[r.articleId] = list.filter((x) => x.id !== r.id);
          if (!r.deleted && r.data) next[r.articleId] = [...next[r.articleId], r.data].sort((a, b) => a.createdAt - b.createdAt);
        }
        return next;
      };

      const byArticle = <T>(cur: Record<string, T>, rows: RemoteRow<T>[] = []) => {
        if (!rows.length) return cur;
        const next = { ...cur };
        for (const r of rows) {
          if (r.deleted || !r.data) delete next[r.id];
          else next[r.id] = r.data;
        }
        return next;
      };

      return {
        library,
        highlights: merge(st.highlights, c.highlights),
        glosses: merge(st.glosses, c.glosses, (g) => g.turns.some((t) => t.streaming)),
        briefs: byArticle(st.briefs, c.briefs),
        progress: byArticle(st.progress, c.progress),
      };
    }),
}));

/* Account snapshots persist synchronously so identity changes never move pending writes between scopes. */
function persist(st: Persisted): boolean {
  const { glosses, highlights, briefs, progress, library } = st;
  try {
    localStorage.setItem(localSnapshotKey(), JSON.stringify({ glosses, highlights, briefs, progress, library }));
    return true;
  } catch {
    return false;
  }
}
/** Require discoverable metadata to be durable before source-conflict invalidation. */
export function checkpointLibrary(): boolean {
  return persist(useStore.getState());
}

if (typeof window !== "undefined") {
  useStore.subscribe((st, prev) => {
    if (!st.hydrated || st.scope !== prev.scope) return;
    if (st.library !== prev.library || st.glosses !== prev.glosses || st.highlights !== prev.highlights || st.briefs !== prev.briefs || st.progress !== prev.progress) persist(st);
  });
}

/* Texts live in IndexedDB, which holds far more than localStorage's few
   megabytes. Older builds kept them in localStorage; they move over on first read. */

const DB_NAME = "gloss";
const DOCS = "docs";
/** The original files of imported PDFs, for reading them again more carefully. Local only; never synced. */
const FILES = "files";
let dbp: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of [DOCS, FILES]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = DOCS): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const req = fn(transaction.objectStore(store));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Browser storage transaction aborted."));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveDoc(a: Article, owner: string | null = accountScope()): Promise<boolean> {
  try {
    await tx("readwrite", (s) => s.put(a, scopedKey(a.id, owner)));
    return true;
  } catch {}
  // No IndexedDB (some private windows): the old, smaller home still works.
  try {
    localStorage.setItem(scopedKey(DOC_PREFIX + a.id, owner), JSON.stringify(a));
    return true;
  } catch {
    return false;
  }
}

/** Stamp only the exact uploaded cache value; a later local edit must never be replaced by its receipt. */
export async function acknowledgeDocRevision(
  uploaded: Article,
  revision: number,
  owner: string,
): Promise<Article | null> {
  const key = scopedKey(uploaded.id, owner),
    expected = JSON.stringify(uploaded);
  let unavailable: unknown;
  try {
    const db = await idb();
    const result = await new Promise<{
      found: boolean;
      acknowledged: Article | null;
    }>((resolve, reject) => {
      const transaction = db.transaction(DOCS, "readwrite"),
        store = transaction.objectStore(DOCS),
        read = store.get(key);
      let acknowledged: Article | null = null,
        found = false;
      read.onsuccess = () => {
        found = Boolean(read.result);
        if (found && JSON.stringify(read.result) === expected) {
          acknowledged = { ...read.result, sourceRevision: revision };
          store.put(acknowledged, key);
        }
      };
      transaction.oncomplete = () => resolve({ found, acknowledged });
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error("Source revision cache write failed."),
        );
      transaction.onerror = () => reject(transaction.error);
    });
    if (result.found) return result.acknowledged;
  } catch (error) {
    unavailable = error;
  }
  const raw = localStorage.getItem(scopedKey(DOC_PREFIX + uploaded.id, owner));
  if (raw) {
    const cached = JSON.parse(raw) as Article;
    if (JSON.stringify(cached) !== expected) return null;
    const acknowledged = { ...cached, sourceRevision: revision };
    localStorage.setItem(
      scopedKey(DOC_PREFIX + uploaded.id, owner),
      JSON.stringify(acknowledged),
    );
    return acknowledged;
  }
  if (unavailable) throw unavailable;
  return null;
}

export async function loadDoc(id: string, owner: string | null = accountScope(), explicitLegacyAdoption = false): Promise<Article | null> {
  if (owner === null && hasLegacyAccountSync() && !explicitLegacyAdoption && !readAnonymous().library?.some((x) => x.id === id)) return null;
  try {
    const a = await tx<Article | undefined>("readonly", (s) => s.get(scopedKey(id, owner)));
    if (a) return a;
  } catch {}
  let legacy: Article | null = null;
  try {
    const raw = localStorage.getItem(scopedKey(DOC_PREFIX + id, owner));
    legacy = raw ? (JSON.parse(raw) as Article) : null;
  } catch {}
  if (legacy) {
    try {
      await tx("readwrite", (s) => s.put(legacy, scopedKey(id, owner)));
      localStorage.removeItem(scopedKey(DOC_PREFIX + id, owner));
    } catch {}
  }
  return legacy;
}

/** Moves every text an older build left in localStorage into IndexedDB, freeing room for notes. */
async function migrateDocs() {
  let ids: string[] = [];
  try {
    ids = Object.keys(localStorage)
      .filter((k) => k.startsWith(DOC_PREFIX))
      .map((k) => k.slice(DOC_PREFIX.length));
  } catch {}
  for (const id of ids) await loadDoc(id);
}

/** Keep an imported PDF's original file, by its article id. */
export async function savePdf(id: string, file: Blob): Promise<boolean> {
  const key = scopedKey(id);
  try {
    await tx("readwrite", (s) => s.put(file, key), FILES);
    return true;
  } catch {
    return false;
  }
}

/** The original PDF behind an article, when this browser imported it. */
export async function loadPdf(id: string): Promise<Blob | null> {
  const key = scopedKey(id);
  try {
    return (await tx<Blob | undefined>("readonly", (s) => s.get(key), FILES)) ?? null;
  } catch {
    return null;
  }
}

/** Forget this device's copy of a text (not its PDF): it changed elsewhere and is fetched again on open. */
export async function forgetDoc(id: string, owner: string | null = accountScope()) {
  const key = scopedKey(id, owner);
  try {
    localStorage.removeItem(scopedKey(DOC_PREFIX + id, owner));
  } catch {}
  try {
    await tx("readwrite", (s) => s.delete(key));
  } catch {}
}

async function dropDoc(id: string) {
  const key = scopedKey(id);
  try {
    localStorage.removeItem(scopedKey(DOC_PREFIX + id));
  } catch {}
  try {
    await tx("readwrite", (s) => s.delete(key));
    await tx("readwrite", (s) => s.delete(key), FILES);
  } catch {}
}

const EMPTY: never[] = [];
export const useGlosses = (articleId: string) => useStore((s) => s.glosses[articleId] ?? EMPTY);
export const useHighlights = (articleId: string) => useStore((s) => s.highlights[articleId] ?? EMPTY);
