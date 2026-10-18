/** Browser-only SQLite extraction. Upload bookmarks, never the database, DMs or credentials. */
import { threadCoverageOf } from "./thread-coverage";
import type { Database, SqlValue } from 'sql.js/dist/sql-wasm-browser.js';
import { normalizePost, attachContext, type ImportedPost } from './bookmark-normalize';
export type BirdclawArchive={accounts:{id:string;name:string;handle:string;count:number}[];accountId:string|null;posts:ImportedPost[]};
function query(database:Database,sql:string,params:SqlValue[]=[]){
 const statement=database.prepare(sql);try{statement.bind(params);const result:Record<string,SqlValue>[]=[];while(statement.step())result.push(statement.getAsObject());return result;}finally{statement.free();}
}
function json(raw:SqlValue|undefined){try{return typeof raw==='string'?JSON.parse(raw):{};}catch{return {};}}
export async function extractBirdclaw(bytes:Uint8Array,accountId?:string,wasmBinary?:Uint8Array):Promise<BirdclawArchive>{
 if(bytes.length>128*1024*1024||new TextDecoder().decode(bytes.slice(0,16))!=='SQLite format 3\0')throw new Error('Choose a Birdclaw SQLite snapshot of at most 128 MB.');
 const {default:init}=await import('sql.js/dist/sql-wasm-browser.js');
 const SQL=await init({locateFile:()=>'/vendor/sql.js/sql-wasm-browser.wasm',...(wasmBinary?{wasmBinary}:{})}), database=new SQL.Database(bytes);
 try{
  database.run('PRAGMA query_only=ON');
  // Reject views: an import must not execute arbitrary SQL supplied as schema code.
  const schema=query(database,"select name,type from sqlite_master where name in ('accounts','profiles','tweets','tweet_collections')");
  if(schema.length!==4||schema.some(r=>r.type!=='table'))throw new Error('This file does not have the supported Birdclaw bookmark schema.');
  const accounts=query(database,`select a.id,a.name,a.handle,count(c.tweet_id) as count from accounts a join tweet_collections c on c.account_id=a.id and c.kind='bookmarks' group by a.id,a.name,a.handle order by a.id`).map(r=>({id:String(r.id),name:String(r.name),handle:String(r.handle),count:Number(r.count)}));
  const selected=accountId??(accounts.length===1?accounts[0].id:null);
  if(!selected)return {accounts,accountId:null,posts:[]};
  if(!accounts.some(a=>a.id===selected))throw new Error('Choose a bookmarked account present in this file.');
  if(accounts.find(a=>a.id===selected)!.count>20000)throw new Error('Import at most 20,000 bookmarks per snapshot.');
  const rows=query(database,`select t.*,p.handle,p.display_name,c.raw_json,c.updated_at from tweet_collections c left join tweets t on t.id=c.tweet_id left join profiles p on p.id=t.author_profile_id where c.kind='bookmarks' and c.account_id=? order by c.tweet_id`,[selected]);
  const map=new Map<string,ImportedPost>();
  const convert=(r:Record<string,SqlValue>)=>{
   const raw=json(r.raw_json),authorId=String(r.author_profile_id??'').match(/^profile_user_([1-9]\d*)$/)?.[1];return normalizePost({...raw,id:r.id,text:r.text,author_id:authorId??raw.author_id,created_at:r.created_at,entities:raw.entities??json(r.entities_json),referenced_tweets:raw.referenced_tweets??[...(r.reply_to_id?[{id:r.reply_to_id,type:'replied_to'}]:[]),...(r.quoted_tweet_id?[{id:r.quoted_tweet_id,type:'quoted'}]:[])]},{username:r.handle,name:r.display_name},String(r.updated_at??r.created_at??'1970-01-01T00:00:00Z'),true);
  };
  const posts=rows.map(r=>{const p=convert(r);map.set(p.postId,p);return p;});
  const [edges]=query(database,"select type from sqlite_master where name='tweet_account_edges'");
  if(edges&&edges.type!=='table')throw new Error('Thread account membership must be a stored table.');
  const columns=new Set(query(database,'pragma table_info(tweets)').map(r=>String(r.name)));
  const active=['deleted_at','superseded_at'].filter(name=>columns.has(name)).map(name=>`and t.${name} is null`).join(' ');
  if(edges)for(let index=0;index<posts.length;index++){
   const root=posts[index],profileId=rows[index].author_profile_id,queue=[root.postId],seen=new Set(queue),thread:ImportedPost[]=[];
   while(queue.length&&thread.length<99){
    const parent=queue.shift()!;
    const children=query(database,`select t.*,p.handle,p.display_name from tweets t join profiles p on p.id=t.author_profile_id where t.reply_to_id=? and t.author_profile_id=? ${active} and exists(select 1 from tweet_account_edges e where e.tweet_id=t.id and e.account_id=?) order by t.created_at,t.id limit 100`,[parent,profileId,selected]);
    for(const row of children){
     const id=String(row.id);if(seen.has(id))continue;seen.add(id);
     if(thread.length>=99)break;
     try{const child=convert(row);thread.push(child);map.set(id,child);queue.push(id);}catch{/* A missing bridge stays a visible relationship gap. */}
    }
   }
   if(thread.length)root.threadPosts=thread;
   if(queue.length)root.completeness={status:'unknown',reason:'Stored author thread reached the 100-post import limit; further coverage is unverified.'};
  }
  const [cache]=query(database,"select type from sqlite_master where name='sync_cache'");
  if(cache?.type==='table') for(const post of posts){
   const [entry]=query(database,'select value_json from sync_cache where cache_key=?',[`bookmark-thread:v1:${selected}:${post.postId}`]);
   if(entry)try{const raw=json(entry.value_json);if(['exhausted','partial'].includes(raw.status))post.threadCoverage=threadCoverageOf({status:raw.status,observedAt:raw.observedAt,missingPostIds:raw.missingParents??[]});}catch{/* Malformed archive observations never establish coverage. */}
  }
  // Follow only necessary parents/quotes already on disk, at most eight per root. No network.
  for(const root of posts){const queue=[root.replyToPostId,root.quotedPostId],seen=new Set([root.postId]);let read=0;
   while(queue.length&&read<8){const id=queue.shift();if(!id||seen.has(id))continue;seen.add(id);read++;
    if(!map.has(id)){const [r]=query(database,`select t.*,p.handle,p.display_name from tweets t join profiles p on p.id=t.author_profile_id where t.id=?`,[id]);if(r)try{map.set(id,convert(r));}catch{/* Missing context remains a visible relationship gap. */}}
    const p=map.get(id);if(p)queue.push(p.replyToPostId,p.quotedPostId);
   }
  }
  return {accounts,accountId:selected,posts:posts.map(p=>attachContext(p,map))};
 }finally{database.close();}
}
