import { accountEpoch, accountScope } from "./account-scope";
import { loadDoc, saveDoc, uid, useStore } from "./store";
import type { Article } from "./article";

export class OfflineSourceConflictError extends Error {
  constructor() {
    super("A newer source conflicts with offline text. Sync paused because the offline copy could not be saved; your original local text is retained. Free storage and retry.");
  }
}

/** Preserve an intentional offline edit under a separate document identity before adopting a conflicting source. */
export async function preserveOfflineSource(id: string, owner: string): Promise<string> {
  const epoch = accountEpoch(),
    item = useStore.getState().library.find((x) => x.id === id);
  if (accountScope() !== owner || !item) throw new OfflineSourceConflictError();
  const original = await loadDoc(id, owner);
  const current = () => accountScope() === owner && accountEpoch() === epoch && useStore.getState().library.find((x) => x.id === id)?.rev === item.rev;
  if (!original || !current()) throw new OfflineSourceConflictError();
  const recoveredFrom = { itemId: id, sourceRevision: item.sourceRevision ?? 1 };
  const copy: Article = {
    ...original,
    id: "offline-" + uid(),
    title: item.title + " (offline copy)",
    origin: "paste",
    contentType: "document",
    source: "Offline recovery",
    sourceRevision: 1,
    recoveredFrom,
  };
  delete copy.sourceUrl;
  if (!(await saveDoc(copy, owner)) || !current()) throw new OfflineSourceConflictError();
  useStore.getState().addToLibrary(copy, item.words, { tags: item.tags, favorite: item.favorite, topic: item.topic, recoveredFrom });
  return copy.title;
}
