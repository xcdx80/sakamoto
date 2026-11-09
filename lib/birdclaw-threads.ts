/** Port of the locally validated Birdclaw 0.16.0 thread extension (MIT, Peter Steinberger).
 * Collection rules stay here; Sakamoto supplies authenticated transport and storage.
 * License: ./vendor/birdclaw/LICENSE. Source fingerprints are retained with task evidence.
 */
import type { WirePost } from './bookmark-normalize';
export type ThreadAnchor={id:string;itemId:string;revision:number;authorId:string;handle:string;name:string;createdAt:string;conversationId:string;replyToId?:string;missingParents?:string[];searchCache?:{runId:string;endTime:string;observedAt:string}};
export type KnownThreadPost={id:string;authorId:string;parent?:string};
export type ThreadObservation={tweetId:string;status:'exhausted'|'partial'|'error';observedAt:string;posts:number;pages:number;nextCursor?:string;missingParents?:string[];unavailableReferences?:string[];error?:string};
export type ThreadPage={data:WirePost[];includes?:{users?:WirePost[];tweets?:WirePost[];posts?:WirePost[]};meta?:Record<string,any>};
export class ThreadStepYield extends Error {}
export class ThreadSourceChanged extends Error {}
export type ThreadIO={
 known:(ids?:string[])=>Promise<KnownThreadPost[]>;
 lookup:(ids:string[])=>Promise<ThreadPage>;
 search:(options:{query:string;startTime:string;endTime:string;cursor?:string;maxResults:number})=>Promise<ThreadPage>;
 store:(payload:ThreadPage)=>Promise<void>;
};
const parentOf=(post:WirePost)=>(post.referenced_posts??post.referenced_tweets??[]).find((ref:WirePost)=>ref.type==='replied_to')?.id as string|undefined;

export function birdclawThreadSearch(anchors:ThreadAnchor[],endTime:string,cursor?:string){
 const query=anchors.map(a=>`(conversation_id:${a.conversationId} from:${a.handle.replace(/^@/,'')} to:${a.handle.replace(/^@/,'')})`).join(' OR ');
 if(!anchors.length||query.length>1024)throw new Error('Thread search exceeds the historical query limit.');
 return {query,startTime:new Date(Math.min(...anchors.map(a=>Date.parse(a.createdAt)))-1000).toISOString(),endTime,cursor,maxResults:100};
}

/** Birdclaw's first-occurrence merge, including unavailable reference observations. */
export function mergeBirdclawThreadPages(pages:ThreadPage[]):ThreadPage{
 const posts=new Map<string,WirePost>(),users=new Map<string,WirePost>(),references=new Map<string,WirePost>(),missing=new Set<string>();
 for(const page of pages){for(const p of page.data)if(!posts.has(p.id))posts.set(p.id,p);for(const u of page.includes?.users??[])users.set(u.id,u);for(const p of page.includes?.posts??page.includes?.tweets??[])references.set(p.id,p);for(const id of page.meta?.missing_references??[])missing.add(id);}
 return {data:[...posts.values()],includes:{users:[...users.values()],tweets:[...references.values()]},meta:{...pages.at(-1)?.meta,result_count:posts.size,missing_references:[...missing]}};
}

/** Birdclaw's parent repair: owner-local first, batches of100, depth12, explicit gaps. */
async function hydrateParents(anchors:ThreadAnchor[],io:ThreadIO){
 const visited=new Set(anchors.map(a=>a.id)),gaps=new Set<string>(),errors=new Map<string,string>(),parentById=new Map<string,string|undefined>(anchors.map(a=>[a.id,a.replyToId]));
 let frontier=anchors.flatMap(a=>[...(a.replyToId?[a.replyToId]:[]),...(a.missingParents??[])]);
 for(let depth=0;depth<12&&frontier.length;depth++){
  const ids=[...new Set(frontier)].filter(id=>!visited.has(id));frontier=[];
  const known=new Map((await io.known(ids)).map(p=>[p.id,p])),missing:string[]=[];
  for(const id of ids){visited.add(id);const cached=known.get(id);if(cached){parentById.set(id,cached.parent);if(cached.parent)frontier.push(cached.parent);}else if(/^[1-9]\d*$/.test(id))missing.push(id);}
  for(let offset=0;offset<missing.length;offset+=100){
   const batch=missing.slice(offset,offset+100);
   try{
    const page=await io.lookup(batch),requested=new Set(batch),data=page.data.filter(p=>requested.has(p.id));
    await io.store({...page,data});const returned=new Set(data.map(p=>p.id));
    for(const id of batch)if(!returned.has(id))gaps.add(id);
    for(const p of data){const parent=parentOf(p);parentById.set(p.id,parent);if(parent)frontier.push(parent);}
   }catch(error){if(error instanceof ThreadStepYield||error instanceof ThreadSourceChanged)throw error;for(const id of batch){gaps.add(id);errors.set(id,error instanceof Error?error.message:'Parent lookup failed.');}}
  }
 }
 return {gaps:[...gaps],limited:[...new Set(frontier)].filter(id=>!visited.has(id)),errors,parentById};
}

/** One frozen group of up to8 anchors. Successful wire pages are durably cached by the adapter. */
export async function hydrateBirdclawThreadBatch(anchors:ThreadAnchor[],io:ThreadIO,endTime:string,maxPages=100):Promise<ThreadObservation[]>{
 if(!anchors.length||anchors.length>8)throw new Error('Thread search requires one to eight anchors.');
 const parents=await hydrateParents(anchors,io);
 if(anchors.some(a=>!/^[1-9]\d{0,23}$/.test(a.id)||!/^[1-9]\d{0,23}$/.test(a.conversationId)||!/^\w{1,15}$/.test(a.handle)||!a.authorId||!Number.isFinite(Date.parse(a.createdAt))||a.createdAt>=endTime))throw new Error('Bookmark is missing a stable author, conversation or historical timestamp.');
 const pages:ThreadPage[]=[],cursors=new Set<string>();let cursor:string|undefined;
 do{
  const page=await io.search(birdclawThreadSearch(anchors,endTime,cursor));pages.push(page);
  cursor=typeof page.meta?.next_token==='string'?page.meta.next_token:undefined;
  if(cursor&&cursors.has(cursor))throw new Error('X repeated a pagination cursor; thread coverage is unverified.');
  if(cursor)cursors.add(cursor);
 }while(cursor&&pages.length<maxPages);
 const dataById=new Map<string,WirePost>(),usersById=new Map<string,WirePost>(),referencesById=new Map<string,WirePost>();
 for(const page of pages){for(const p of page.data)if(!dataById.has(p.id))dataById.set(p.id,p);for(const u of page.includes?.users??[])usersById.set(u.id,u);for(const p of page.includes?.posts??page.includes?.tweets??[])referencesById.set(p.id,p);}
 const local=await io.known(),localById=new Map(local.map(p=>[p.id,p]));
 const unavailable=new Set<string>(pages.flatMap(p=>Array.isArray(p.meta?.missing_references)?p.meta.missing_references:[]));
 const observations:ThreadObservation[]=[];
 for(const anchor of anchors){
  const connected=new Set([anchor.id]),candidates=new Map([...dataById].filter(([,p])=>p.author_id===anchor.authorId&&p.conversation_id===anchor.conversationId));
  const bridges=local.filter(p=>p.authorId===anchor.authorId);
  let changed=true;while(changed){changed=false;for(const p of [...bridges,...[...candidates.values()].map(p=>({id:p.id,parent:parentOf(p)}))])if(p.parent&&connected.has(p.parent)&&!connected.has(p.id)){connected.add(p.id);changed=true;}}
  const data=[...candidates.values()].filter(p=>p.id!==anchor.id&&connected.has(p.id));
  const references=new Set<string>(data.flatMap(p=>(p.referenced_posts??p.referenced_tweets??[]).map((r:WirePost)=>r.id)));
  await io.store({data,includes:{users:[...usersById.values()],tweets:[...referencesById.values()].filter(p=>references.has(p.id))}});
  const parentById=new Map<string,string|undefined>(bridges.map(p=>[p.id,p.parent]));for(const p of candidates.values())parentById.set(p.id,parentOf(p));
  const missing=new Set<string>();
  for(const p of candidates.values()){
   if(connected.has(p.id))continue;let current:string|undefined=p.id;const visited=new Set<string>();
   while(current&&!connected.has(current)){
    if(visited.has(current)){missing.add(current);break;}
    if(!parentById.has(current)){const known=localById.get(current);if(!known||known.authorId===anchor.authorId)missing.add(current);break;}
    visited.add(current);current=parentById.get(current);
   }
  }
  // Grouping must not make one bookmark inherit another anchor's parent gaps.
  const needed=new Set<string>(),frontier=[...(anchor.replyToId?[anchor.replyToId]:[]),...(anchor.missingParents??[])];
  while(frontier.length&&needed.size<1000){const id=frontier.shift()!;if(needed.has(id))continue;needed.add(id);const parent=parents.parentById.get(id);if(parent)frontier.push(parent);}
  for(const id of [...parents.gaps,...parents.limited])if(needed.has(id))missing.add(id);
  const parentErrors=[...new Set([...parents.errors].filter(([id])=>needed.has(id)).map(([,error])=>error))];
  const missingParents=[...missing],unavailableReferences=[...unavailable].filter(id=>references.has(id)||missing.has(id));
  observations.push({tweetId:anchor.id,status:cursor||missingParents.length||parentErrors.length?'partial':'exhausted',observedAt:anchor.searchCache?.observedAt??new Date().toISOString(),posts:data.length,pages:pages.length,...(cursor?{nextCursor:cursor}:{}),...(missingParents.length?{missingParents}:{}),...(unavailableReferences.length?{unavailableReferences}:{}),...(parentErrors.length?{error:parentErrors.join(' ').slice(0,2000)}:{})});
 }
 return observations;
}
