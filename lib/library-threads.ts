/** Owner-scoped thread projection and exact post-text search. Source bodies stay in their own records. */
import { db } from './db';
import { allow } from './ratelimit';
export type LibraryThreadGroup = { rootId: string; bookmarkIds?: string[]; memberIds: string[]; missingPostCount?: number; contextOnly?: boolean };
export type LibraryThreadIndex = { groups: LibraryThreadGroup[]; postItemIds: string[] };
type Node = { article_id: string; post_id: string; role: string; author: {id?:string;handle?:string}|null; parents: string[]; missing: string[] };
const sameAuthor=(a:Node,b:Node)=>a.author&&b.author&&(a.author.id&&b.author.id?a.author.id===b.author.id:Boolean(a.author.handle&&b.author.handle&&a.author.handle.toLowerCase()===b.author.handle.toLowerCase()));
const compare=(a:Node,b:Node)=>a.post_id.length-b.post_id.length||a.post_id.localeCompare(b.post_id);
export async function readLibraryThreads(owner:string):Promise<LibraryThreadIndex>{
 const rows=await db().query(`select p.article_id,p.post_id,p.role,a.doc#>'{post,author}' as author,
 coalesce((select jsonb_agg(r.target_post_id) from post_relationships r where r.user_id=p.user_id and r.post_id=p.post_id and r.kind='reply'),'[]') as parents,
 coalesce(p.thread_coverage->'missingPostIds','[]') as missing
 from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
 where p.user_id=$1 and not a.deleted order by length(p.post_id),p.post_id limit 50001`,[owner]) as Node[];
 if(rows.length>50000)throw new Error('This library has more posts than the thread view can load.');
 const byId=new Map(rows.map(n=>[n.post_id,n])), leaders=new Map(rows.map(n=>[n.post_id,n.post_id]));
 function find(id:string):string{let head=id;while(leaders.get(head)!==head)head=leaders.get(head)!;while(id!==head){const next=leaders.get(id)!;leaders.set(id,head);id=next;}return head;}
 for(const node of rows)for(const parentId of node.parents){const parent=byId.get(parentId);if(parent&&sameAuthor(node,parent)){const a=find(node.post_id),b=find(parentId);if(a!==b)leaders.set(a,b);}}
 const components=new Map<string,Node[]>();for(const node of rows){const key=find(node.post_id);const group=components.get(key)??[];group.push(node);components.set(key,group);}
 const groups:LibraryThreadGroup[]=[];
 for(const nodes of components.values()){
  const contextOnly=!nodes.some(n=>n.role==='bookmark');
  const members=new Set(nodes.map(n=>n.post_id));
  const roots=nodes.filter(n=>!n.parents.some(id=>members.has(id)&&sameAuthor(n,byId.get(id)!))).sort(compare);
  const root=roots[0]??[...nodes].sort(compare)[0];
  const missing=new Set(nodes.flatMap(n=>n.missing).filter(id=>!byId.has(id)));
  groups.push({contextOnly,rootId:root.article_id,bookmarkIds:nodes.filter(n=>n.role==='bookmark').sort(compare).map(n=>n.article_id),memberIds:nodes.sort(compare).map(n=>n.article_id),...(missing.size?{missingPostCount:missing.size}:{})});
 }
 return {groups,postItemIds:rows.map(n=>n.article_id)};
}
export class PostSearchError extends Error {
 constructor(message:string,readonly status:number,readonly retryAfter?:number){super(message);}
}
const activeSearches=new Set<string>();
/** Search pending and saved post bodies with bounded terms, per-instance admission and a database deadline. */
export async function searchLibraryPosts(owner:string,query:string):Promise<string[]>{
 if(!query.trim()||Buffer.byteLength(query)>1000)throw new PostSearchError('Enter a query of at most 1000 UTF8 bytes.',400);
 const words=[...new Set(query.toLowerCase().trim().split(/\s+/))];
 if(words.length>16)throw new PostSearchError('Enter at most 16 distinct search terms.',400);
 if(activeSearches.has(owner))throw new PostSearchError('A post search is still running. Retrying shortly.',429,1);
 if(!allow(`post-search:${owner}`,30,60_000))throw new PostSearchError('Too many post searches. Wait a moment and retry.',429,60);
 const adapter=db();if(!adapter.queryWithTimeout)throw new PostSearchError('Bounded post search is unavailable.',503);
 activeSearches.add(owner);
 try {
  // Normalize each source once, instead of once per query term. The deadline is set before this statement starts.
  const rows=await adapter.queryWithTimeout(`with searchable as materialized (
   select p.article_id,lower(concat_ws(' ',a.doc#>>'{post,fullText}',a.data->>'title',a.data->>'author',a.data->>'topic',a.data->'tags')) as text
   from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
   where p.user_id=$1 and not a.deleted
  ) select article_id from searchable where not exists(select 1 from unnest($2::text[]) word where strpos(text,word)=0)
  order by article_id limit 50001`,[owner,words],2000);
  if(rows.length>50000)throw new PostSearchError('Refine the query to search fewer posts.',400);
  return rows.map(r=>r.article_id);
 } catch(e) {
  if(e&&typeof e==='object'&&'code' in e&&e.code==='57014')throw new PostSearchError('Post search took too long. Narrow the query and retry.',503);
  throw e;
 } finally {activeSearches.delete(owner);}
}
