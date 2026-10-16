import { test, before } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

class BrowserStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, String(v));
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
}
Object.defineProperty(globalThis, "localStorage", { value: new BrowserStorage() });
Object.defineProperty(globalThis, "window", { value: new EventTarget() });
let store: typeof import("../lib/store");
before(async () => {
  store = await import("../lib/store");
});

test("anonymous adoption is explicit, copies text and notes, and account changes never expose or upload the previous account", async () => {
  const old = { id: "preserved-id", title: "Old document", origin: "paste" as const, blocks: [] };
  localStorage.setItem(
    "gloss:v1",
    JSON.stringify({
      library: [{ id: old.id, title: old.title, origin: "paste", words: 10, addedAt: 1, tags: ["manual"], favorite: true }],
      highlights: { [old.id]: [{ id: "old-highlight", articleId: old.id, note: "Keep this note", anchor: { quote: "old quote" }, createdAt: 1 }] },
      progress: { [old.id]: { block: "b1", pct: 0.5, at: 1 } },
    }),
  );
  await store.saveDoc(old, null);
  store.useStore.getState().activateAccount("owner-a");
  assert.equal(store.useStore.getState().library.length, 0);
  assert.equal(await store.loadDoc(old.id), null);
  await store.useStore.getState().adoptAnonymous();
  assert.equal((await store.loadDoc(old.id))?.title, "Old document");
  assert.deepEqual(store.useStore.getState().library[0].tags, ["manual"]);
  assert.equal(store.useStore.getState().highlights[old.id][0].note, "Keep this note");
  assert.equal(store.useStore.getState().progress[old.id].pct, 0.5);
  store.useStore.getState().activateAccount("owner-b");
  assert.equal(store.useStore.getState().library.length, 0);
  assert.equal(await store.loadDoc(old.id), null);
  store.useStore.getState().activateAccount("owner-a");
  assert.equal(store.useStore.getState().library[0].id, "preserved-id");
  store.useStore.getState().activateAccount(null);
  assert.equal(store.useStore.getState().highlights[old.id][0].id, "old-highlight");
  assert.equal((await store.loadDoc(old.id))?.title, "Old document");
});

test("an import started in one account cannot be saved by a late callback after switching accounts", async () => {
  const { importFromUrl, keep } = await import("../lib/import");
  store.useStore.getState().activateAccount("import-owner-a");
  let resolve!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((r) => {
      resolve = r;
    });
  const pending = importFromUrl("https://example.com/private");
  store.useStore.getState().activateAccount("import-owner-b");
  resolve(Response.json({ article: { id: "late-private", title: "Private A", origin: "url", blocks: [{ id: "b1", type: "p", runs: [{ text: "private text" }] }] } }));
  const result = await pending;
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture import failed");
  assert.match((await keep(result.article)) ?? "", /Account changed/);
  assert.equal(await store.loadDoc("late-private"), null);
  assert.equal(store.useStore.getState().library.length, 0);
});

test("legacy cache known to have synced accounts is not silently displayed when signed out", async () => {
  localStorage.clear();
  localStorage.setItem("gloss:v1", JSON.stringify({ library: [{ id: "legacy-private", title: "Previously synced private text", origin: "paste" }] }));
  localStorage.setItem("gloss:sync:legacy-owner", JSON.stringify({ since: "2026-01-01", seen: { articles: { "legacy-private": ["known", "legacy-private"] } } }));
  store.useStore.getState().activateAccount("legacy-owner");
  store.useStore.getState().activateAccount(null);
  assert.equal(store.useStore.getState().library.length, 0);
  store.useStore.getState().activateAccount("legacy-owner");
  await store.useStore.getState().adoptAnonymous();
  assert.equal(store.useStore.getState().library[0].id, "legacy-private");
  assert.equal(JSON.parse(localStorage.getItem("gloss:v1")!).library[0].id, "legacy-private");
});

test("a signed-out reader never fetches private server text into anonymous storage", async () => {
  const { fetchText } = await import("../lib/sync");
  store.useStore.getState().activateAccount(null);
  globalThis.fetch = async () => Response.json({ doc: { id: "server-private", title: "Private server content", blocks: [] } });
  assert.equal(await fetchText("server-private"), null);
});

test("explicit server categorization preserves local manual fields until an account-bound sync", async () => {
  const { reclassifyItem } = await import("../lib/processing-client");
  store.useStore.getState().activateAccount("manual-category-owner");
  const article = { id: "classification-race", title: "Manual tags", origin: "paste" as const, blocks: [] };
  store.useStore.getState().addToLibrary(article, 10);
  store.useStore.getState().shelve(article.id, { tags: [], topic: "work" });
  let request: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => { request = init; return Response.json({jobId:"1",state:"pending"}); };
  await reclassifyItem(article.id);
  assert.deepEqual(store.useStore.getState().library[0].tags, []);
  assert.equal(store.useStore.getState().library[0].topic, "work");
  assert.equal(new Headers(request!.headers).get("X-Sakamoto-Owner"), "manual-category-owner");
  assert.deepEqual(JSON.parse(request!.body as string), {itemId:article.id,reclassify:true});
});

test("accepted posts remain readable in grid/list filters while pending processing does not start legacy paid sorting", async () => {
  const { toLibraryBooks, filterBooks } = await import("../lib/library");
  const { ContentCards } = await import("../components/library/ContentCards");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  store.useStore.getState().activateAccount("pending-bookmark");
  const item = { id: "accepted-post", title: "A saved post", author: "Writer", words: 10, origin: "paste" as const, contentType: "post" as const, addedAt: 1, processing: { classification: "pending" as const, indexing: "pending" as const } };
  store.useStore.getState().applyRemote({ articles: [{ id: item.id, articleId: item.id, data: item, deleted: false, revision: 1 }] });
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return Response.json({ topic: "science", tags: [] }); };
  assert.equal(providerCalls, 0);
  const state = store.useStore.getState();
  const books = filterBooks(toLibraryBooks({ library: state.library, progress: state.progress, highlights: state.highlights, hydrated: true, hiddenSamples: [] }), { contentType: "post" });
  assert.equal(books.length, 1);
  for (const view of ["grid", "list"] as const) {
    const html = renderToStaticMarkup(createElement(ContentCards, { books, view, fresh: new Set<string>(), onManage() {}, onFavorite() {}, onTag() {}, selectedTag: null }));
    assert.match(html, /href="\/read\/accepted-post"/);
    assert.match(html, /Classification pending/);
    assert.match(html, /Indexing pending/);
  }
});

test("library answer transport binds the intended account and discards an answer received after account switching",async()=>{
  const {askSavedLibrary}=await import("../lib/library-answer-client");
  store.useStore.getState().activateAccount("answer-client-a");
  let release!: (response:Response)=>void;
  globalThis.fetch=async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get("X-Sakamoto-Owner"),"answer-client-a");
    assert.deepEqual(JSON.parse(String(init?.body)),{query:"How do I calibrate?",contentType:"document",tags:["stars"]});
    return new Promise<Response>(resolve=>{release=resolve;});
  };
  const pending=askSavedLibrary({query:"How do I calibrate?",contentType:"document",tags:["stars"]});
  store.useStore.getState().activateAccount("answer-client-b");
  release(Response.json({status:"answered",claims:[],citations:[],gaps:[],notice:"private a",retrieval:{}}));
  await assert.rejects(pending,/Account changed/);
});
