/** Durable account metadata and sync checkpoints, isolated per browser context and account. */
import {scopedKey} from './account-scope';
type Entry = {key:string; value:unknown};
type Envelope = {generation:number; value:unknown};
type Bundle = {version:1; entries:Record<string,Envelope>};
const ANONYMOUS = 'sakamoto:anonymous:v2';
export const syncCacheKey = (owner:string) => `sakamoto:sync:v2:${owner}`;
export const threadCacheKey = (owner:string) => `sakamoto:threads:v2:${owner}`;
function groupOf(key:string):string {
 if(key===ANONYMOUS)return 'anonymous';
 const account=key.match(/^sakamoto:account:([^:]+):gloss:v1$/);
 if(account)return `account:${account[1]}`;
 for(const prefix of ['sakamoto:sync:v2:','sakamoto:threads:v2:'])if(key.startsWith(prefix))return `account:${encodeURIComponent(key.slice(prefix.length))}`;
 throw new Error('Unknown library cache key.');
}
const fallbackKey = (group:string) => `sakamoto:cache-fallback:v1:${group}`;
function fallbackBundle(group:string):Bundle {
 try {const value=JSON.parse(localStorage.getItem(fallbackKey(group))??'null');if(value?.version===1&&value.entries)return value;}catch{}
 return {version:1,entries:{}};
}
function envelope(value:any):Envelope|undefined {
 if(value===undefined)return undefined;
 return typeof value?.generation==='number'&&Object.hasOwn(value,'value')?value:{generation:0,value};
}
/** Instances represent independent page lifetimes, sharing the browser's durable storage. */
export function createLibraryCache(){
 const memory = new Map<string,unknown>();
 const committed = new Map<string,Envelope>();
 const pending = new Map<string,number>();
 let generation=0, opening:Promise<IDBDatabase>|undefined, writes:Promise<unknown>=Promise.resolve();
 function remember(key:string,value:Envelope){
  generation=Math.max(generation,value.generation);
  committed.set(key,value);
  if((pending.get(key)??-1)<=value.generation)memory.set(key,value.value);
 }
 function database(){
  opening??=new Promise<IDBDatabase>((resolve,reject)=>{
   const request=indexedDB.open('sakamoto-library-cache',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('cache');
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=undefined};resolve(db)};
   request.onerror=()=>reject(request.error);
  });
  opening.catch(()=>{opening=undefined});return opening;
 }
 function read<T>(key:string):T|undefined {
  if(memory.has(key))return memory.get(key) as T;
  const fallback=fallbackBundle(groupOf(key)).entries[key];
  if(fallback){remember(key,fallback);return fallback.value as T;}
  try {const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);remember(key,{generation:0,value});return value;}}catch{}
  return undefined;
 }
 /** Preload before activation, including anonymous notes offered only for explicit adoption. */
 async function preload(owner:string|null){
  const keys=owner?[scopedKey('gloss:v1',owner),syncCacheKey(owner),threadCacheKey(owner),ANONYMOUS]:[ANONYMOUS];
  const loaded=new Map<string,Envelope>();
  for(const key of keys){const fallback=fallbackBundle(groupOf(key)).entries[key];if(fallback)loaded.set(key,fallback);}
  try {
   const db=await database();
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('cache','readonly');
    for(const key of keys){const request=tx.objectStore('cache').get(key);request.onsuccess=()=>{const value=envelope(request.result);if(value&&value.generation>=(loaded.get(key)?.generation??-1))loaded.set(key,value)}}
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
   });
  }catch{/* A successfully committed fallback remains authoritative when IndexedDB is unavailable. */}
  for(const [key,value] of loaded)if(value.generation>=(committed.get(key)?.generation??-1))remember(key,value);
 }
 /** The snapshot and cursor commit in one IndexedDB transaction or one fallback value. */
 function save(entries:Entry[]):Promise<boolean>{
  const captured=structuredClone(entries), groups=new Set(captured.map(entry=>groupOf(entry.key)));
  if(groups.size!==1)return Promise.resolve(false);
  const group=[...groups][0], fallback=fallbackBundle(group);
  for(const value of Object.values(fallback.entries))generation=Math.max(generation,value.generation);
  generation=Math.max(Date.now()*1000,generation+1);
  const version=generation;
  for(const entry of captured){pending.set(entry.key,version);if(!entry.key.startsWith('sakamoto:sync:'))memory.set(entry.key,entry.value);}
  const write=async()=>{
   let durable=false;
   try {
    const db=await database();
    await new Promise<void>((resolve,reject)=>{
     const tx=db.transaction('cache','readwrite');for(const entry of captured)tx.objectStore('cache').put({generation:version,value:entry.value},entry.key);
     tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
    });durable=true;
   }catch{}
   if(!durable)try {
    const bundle=fallbackBundle(group);
    for(const [key,value] of committed)if(groupOf(key)===group&&value.generation>(bundle.entries[key]?.generation??-1))bundle.entries[key]=value;
    for(const entry of captured)bundle.entries[entry.key]={generation:version,value:entry.value};
    localStorage.setItem(fallbackKey(group),JSON.stringify(bundle));durable=true;
   }catch{}
   if(durable){
    for(const entry of captured){remember(entry.key,{generation:version,value:entry.value});if(pending.get(entry.key)===version)pending.delete(entry.key);}
    // Small legacy mirrors keep existing migration/private-window paths readable; not the checkpoint authority.
    for(const entry of captured)try {const json=JSON.stringify(entry.value);if(json.length<128000)localStorage.setItem(entry.key,json);}catch{}
   }
   return durable;
  };
  const result=writes.then(write,write);writes=result;return result;
 }
 return {read,preload,save};
}
const cache=createLibraryCache();
export const readLibraryCache=cache.read, preloadLibraryCache=cache.preload, saveLibraryCache=cache.save;
