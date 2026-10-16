"use client";

import { accountEpoch, accountScope, scopedKey } from "./account-scope";

/** Existing painted covers remain cached and readable; new generation is unavailable. */


const DB = "gloss-covers";
const STORE = "covers";

let opening: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await idb();
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

const urls = new Map<string, string>();

/** A painted cover's picture, as an object URL: this device first, then the account. */
export async function paintedUrl(id: string): Promise<string | null> {
  const epoch = accountEpoch(),
    key = scopedKey(id);
  const hit = urls.get(key);
  if (hit) return hit;
  let blob = (await tx<Blob>("readonly", (s) => s.get(key))) ?? null;
  if (accountEpoch() !== epoch) return null;
  if (!blob) {
    if (!accountScope()) return null;
    try {
      const res = await fetch(`/api/covers/${encodeURIComponent(id)}`, {headers:{"X-Sakamoto-Owner":accountScope()!}});
      if (res.ok) {
        blob = await res.blob();
        if (accountEpoch() !== epoch) return null;
        await tx("readwrite", (s) => s.put(blob, key));
      }
    } catch {}
  }
  if (!blob || accountEpoch() !== epoch) return null;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export const forgetCover = (id: string) => {
  const key = scopedKey(id);
  return tx("readwrite", (s) => s.delete(key));
};
