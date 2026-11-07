import { accountEpoch, accountScope } from "./account-scope";
import {
  bindPendingSource,
  checkpointLibrary,
  loadDoc,
  saveDoc,
  uid,
  useStore,
} from "./store";
import type { Article } from "./article";
import { derivedDocument } from "./source-edits";

export class OfflineSourceConflictError extends Error {
  constructor() {
    super(
      "A newer source conflicts with offline text. Sync paused because the offline copy could not be saved; your original local text is retained. Free storage and retry.",
    );
  }
}

/** Preserve an intentional offline edit under a separate document identity before adopting a conflicting source. */
export async function preserveOfflineSource(
  id: string,
  owner: string | null,
): Promise<string> {
  const epoch = accountEpoch(),
    item = useStore.getState().library.find((x) => x.id === id);
  if (accountScope() !== owner || !item) throw new OfflineSourceConflictError();
  const original = await loadDoc(id, owner);
  const current = () =>
    accountScope() === owner &&
    accountEpoch() === epoch &&
    useStore.getState().library.find((x) => x.id === id)?.rev === item.rev;
  if (!original || !current()) throw new OfflineSourceConflictError();
  const recoveredFrom = {
    itemId: id,
    sourceRevision: item.sourceRevision ?? 1,
  };
  const copy: Article = {
    ...derivedDocument(original, "Offline recovery"),
    id: "offline-" + uid(),
    title: item.title + " (offline copy)",
    origin: "paste",
    contentType: "document",
    source: "Offline recovery",
    sourceRevision: 1,
    recoveredFrom,
  };
  if (!(await saveDoc(copy, owner)) || !current())
    throw new OfflineSourceConflictError();
  useStore
    .getState()
    .addToLibrary(copy, item.words, {
      tags: item.tags,
      favorite: item.favorite,
      topic: item.topic,
      manualFields: item.manualFields,
      recoveredFrom,
    });
  try {
    if (original.pendingSource)
      await bindPendingSource(id, original.pendingSource, copy.id, 1);
    else if (!(await checkpointLibrary())) throw new OfflineSourceConflictError();
    if (!current()) throw new OfflineSourceConflictError();
  } catch {
    if (current()) useStore.getState().removeFromLibrary(copy.id);
    throw new OfflineSourceConflictError();
  }
  useStore
    .getState()
    .setUI({
      syncNotice: `Your earlier local text and pending annotations are saved as “${copy.title}”.`,
    });
  return copy.title;
}
