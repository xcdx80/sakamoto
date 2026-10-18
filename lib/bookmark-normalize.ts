import type { ThreadCoverage } from "./thread-coverage";
/** Shared X-wire normalization for live API pages and the local Birdclaw snapshot. No I/O. */
export type WirePost = Record<string, any>;
export type ImportedPost = {
 threadCoverage?:ThreadCoverage;
 postId:string;url:string;text:string;author:{id?:string;name:string;handle:string};observedAt:string;
 publishedAt?:string;replyToPostId?:string;quotedPostId?:string;conversationId?:string;title?:string;
 links:string[];completeness:{status:'complete'|'partial'|'unknown';reason:string};contextPosts?:ImportedPost[];threadPosts?:ImportedPost[];
};
export function normalizePost(raw:WirePost,user:WirePost|undefined,observedAt:string,local:boolean):ImportedPost {
 if(!/^[1-9]\d{0,23}$/.test(raw.id)||!user||!/^\w{1,15}$/.test(user.username??''))throw new Error('A bookmarked post is missing its stable ID or author. No checkpoint was advanced.');
 const note=raw.note_post??raw.note_tweet, text=note?.text??raw.text;
 if(typeof text!=='string'||!text.trim())throw new Error('A bookmarked post has no readable text. No checkpoint was advanced.');
 const refs=raw.referenced_posts??raw.referenced_tweets??[], reply=refs.find((r:WirePost)=>r.type==='replied_to')?.id,quote=refs.find((r:WirePost)=>r.type==='quoted')?.id;
 const urls=[...(raw.entities?.urls??[]),...(note?.entities?.urls??[])];
 const links=[...new Set<string>(urls.map((u:WirePost)=>u.unwound_url||u.expanded_url||u.url).filter((v:unknown)=>{
  if(typeof v!=='string')return false;try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
 }))].slice(0,50);
 const partial=Boolean(raw.article)||(!note?.text&&/(?:…|\.\.\.)\s*(?:https?:\/\/\S+)?\s*$/.test(text));
 return {postId:raw.id,url:`https://x.com/${user.username}/status/${raw.id}`,text,author:{name:user.name||user.username,handle:user.username,...(/^[1-9]\d*$/.test(raw.author_id??user.id??'')?{id:raw.author_id??user.id}:{})},observedAt,
  ...(raw.created_at?{publishedAt:raw.created_at}:{}),...(reply?{replyToPostId:reply}:{}),...(quote?{quotedPostId:quote}:{}),...(raw.conversation_id?{conversationId:raw.conversation_id}:{}),
  links,completeness:{status:partial?'partial':local?'unknown':'complete',reason:partial?'Stored preview or X Article; full content is not established.':local?'Exact Birdclaw text. Long-post and full-thread coverage are not established.':'Text returned by X API, preferring the full long-post field; this does not establish a complete thread.'}};
}
export function attachContext(post:ImportedPost,available:Map<string,ImportedPost>):ImportedPost {
 const queue=[post.replyToPostId,post.quotedPostId],seen=new Set([post.postId]),context:ImportedPost[]=[];
 while(queue.length&&context.length<8){const id=queue.shift();if(!id||seen.has(id))continue;seen.add(id);const p=available.get(id);if(!p)continue;const source={...p};delete source.contextPosts;delete source.threadPosts;delete source.threadCoverage;context.push(source);queue.push(p.replyToPostId,p.quotedPostId);}
 return context.length?{...post,contextPosts:context}:post;
}
export function normalizeXPage(payload:WirePost,observedAt:string):ImportedPost[] {
 const primaryIds=new Set<string>((Array.isArray(payload.data)?payload.data:[]).map((p:WirePost)=>p.id));
 const contextIds=new Set<string>((Array.isArray(payload.data)?payload.data:[]).flatMap((p:WirePost)=>(p.referenced_posts??p.referenced_tweets??[]).filter((r:WirePost)=>r.type==='quoted'||r.type==='replied_to').map((r:WirePost)=>r.id)));
 const errors=payload.errors??[];
 if(!Array.isArray(errors)||errors.some((e:WirePost)=>!contextIds.has(e.resource_id)||primaryIds.has(e.resource_id)))throw new Error('X returned errors for the bookmark page. Resume after resolving access; the checkpoint is unchanged.');
 if(payload.data===undefined&&payload.meta?.result_count!==0)throw new Error('X returned an invalid bookmark page.');
 if(payload.data!==undefined&&!Array.isArray(payload.data))throw new Error('X returned an invalid bookmark page.');
 const users=new Map<string,WirePost>((payload.includes?.users??[]).map((u:WirePost)=>[u.id,u]));
 const all=new Map<string,ImportedPost>();
 for(const raw of [...(payload.includes?.posts??payload.includes?.tweets??[]),...(payload.data??[])]){
  // An inaccessible context post must not discard readable bookmarks.
  try{all.set(raw.id,normalizePost(raw,users.get(raw.author_id),observedAt,false));}catch{if((payload.data??[]).includes(raw))throw new Error('X did not return a readable bookmarked post and author. The checkpoint is unchanged.');}
 }
 return (payload.data??[]).map((p:WirePost)=>attachContext(all.get(p.id)!,all));
}
