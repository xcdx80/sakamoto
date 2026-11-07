"use client";

import { useEffect, useMemo, useState } from "react";
import { accountEpoch } from "./account-scope";
import { useStore } from "./store";
import type { LibraryRelation, RelatedSource, RelationPage } from "./library-relations";

export type ItemConnections = { parents: RelatedSource[]; children: RelatedSource[] };
function connectionIndex(relations: LibraryRelation[]) {
  const index = Object.create(null) as Record<string, ItemConnections>;
  for (const { post, linked } of relations) {
    const parent = index[post.id] ??= { parents: [], children: [] };
    const child = index[linked.id] ??= { parents: [], children: [] };
    if (!parent.children.some(item => item.id === linked.id)) parent.children.push(linked);
    if (!child.parents.some(item => item.id === post.id)) child.parents.push(post);
  }
  return index;
}

/** Paginated, owner-bound reads shared by library and reader; no source text is fetched. */
async function relationPage(owner: string, itemId: string | undefined, after: string, signal: AbortSignal): Promise<RelationPage> {
  const epoch = accountEpoch(), query = new URLSearchParams();
  if (itemId) query.set("itemId", itemId);
  if (after) query.set("after", after);
  const response = await fetch("/api/library-relations?" + query, { headers: { "X-Sakamoto-Owner": owner }, cache: "no-store", signal });
  if (accountEpoch() !== epoch || useStore.getState().scope !== owner) throw new Error("Account changed.");
  if (!response.ok) throw new Error("Saved connections could not be loaded. Please retry.");
  return response.json();
}

export function useLibraryRelations(itemId?: string) {
  const owner = useStore(s => s.scope ?? null), library = useStore(s => s.library);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ owner: string | null; itemId?: string; relations: LibraryRelation[]; loading: boolean; error: string }>({ owner: null, relations: [], loading: false, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({ owner, itemId, relations: previous.owner === owner && previous.itemId === itemId ? previous.relations : [], loading: Boolean(owner), error: "" }));
    if (!owner) return () => controller.abort();
    void (async () => {
      const relations: LibraryRelation[] = [], cursors = new Set<string>();
      let after = "";
      do {
        const page = await relationPage(owner, itemId, after, controller.signal);
        if (controller.signal.aborted) return;
        relations.push(...page.relations);
        setState({ owner, itemId, relations: [...relations], loading: Boolean(page.next), error: "" });
        after = page.next ?? "";
        if (after && cursors.has(after)) throw new Error("Saved connections need a refresh.");
        cursors.add(after);
      } while (after);
    })().catch(error => {
      if (!controller.signal.aborted) setState(s => ({ ...s, loading: false, error: error instanceof Error ? error.message : "Could not load saved connections." }));
    });
    return () => controller.abort();
  }, [owner, itemId, library, attempt]);
  const relations = state.owner === owner && state.itemId === itemId ? state.relations : [];
  const index = useMemo(() => connectionIndex(relations), [relations]);
  const groups = useMemo(() => Object.entries(index).filter(([, value]) => value.children.length).map(([id, value]) => ({ post: relations.find(r => r.post.id === id)!.post, linked: value.children })), [index, relations]);
  return { index, groups, loading: state.owner === owner && state.itemId === itemId && state.loading, error: state.owner === owner && state.itemId === itemId ? state.error : "", refresh: () => setAttempt(n => n + 1) };
}
