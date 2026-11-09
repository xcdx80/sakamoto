/** Recover ordering only from retained X responses and acknowledged API receipts. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, shelfOf } from '../lib/db';
import { extractBirdclaw } from '../lib/birdclaw-import';
import { repairBookmarkOrder } from '../lib/bookmark-order';
import type { BookmarkOrder } from '../lib/bookmark-order-input';

async function main(){
 const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 if(args.includes('--help')){console.log('node --env-file-if-exists=.env.local --import tsx scripts/repair-bookmark-order.ts --owner <id> [--birdclaw <snapshot>] [--apply --evidence-dir <directory>]');return;}
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply')continue;
  if(['--owner','--birdclaw','--evidence-dir'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}
  throw new Error('Unknown or incomplete repair option.');
 }
 const owner=value('--owner'),evidence=value('--evidence-dir');
 if(!owner||args.includes('--apply')&&!evidence)throw new Error('Supply --owner, and --evidence-dir when applying.');
 const snapshots:BookmarkOrder[]=[];
 const path=value('--birdclaw');
 if(path){
  const archive=await extractBirdclaw(new Uint8Array(await readFile(path)),undefined,new Uint8Array(await readFile('public/vendor/sql.js/sql-wasm-browser.wasm')));
  if(!archive.accountId)throw new Error('The archive must contain one bookmarked account.');
  const [connection]=await db().query('select handle from x_connections where user_id=$1',[owner]);
  const account=archive.accounts.find(account=>account.id===archive.accountId)!;
  if(!connection||connection.handle.replace(/^@/,'').toLowerCase()!==account.handle.replace(/^@/,'').toLowerCase())throw new Error('Archive account does not match this owner’s connected X account.');
  snapshots.push(...archive.orders??[]);
 }
 const receipts=await db().query(`select run_id,batch_id,received_at,result->'results' as results from bookmark_deliveries
 where user_id=$1 and via='X API' and result is not null order by received_at,id`,[owner]);
 const runs=new Map<string,{at:string;batches:{page:number;offset:number;ids:string[]}[]}>();
 for(const row of receipts){
  const match=row.batch_id.match(/^page-(\d+)-offset-(\d+)(?:-retry-.+)?$/);if(!match)continue;
  const run=runs.get(row.run_id)??{at:new Date(row.received_at).toISOString(),batches:[]};
  const ids=row.results.filter((result:any)=>result.postId&&!['removed','rejected'].includes(result.status)).map((result:any)=>result.postId as string);
  run.batches.push({page:Number(match[1]),offset:Number(match[2]),ids});runs.set(row.run_id,run);
 }
 for(const run of runs.values())snapshots.push({observedAt:run.at,postIds:[...new Set(run.batches.sort((a,b)=>a.page-b.page||a.offset-b.offset).flatMap(batch=>batch.ids))]});
 snapshots.sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
 const rows=await db().query(`select p.post_id,a.id,a.data->'savedAt' as saved_at,a.data->'bookmarkOrderObservedAt' as observed_at
 from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and p.role='bookmark' and not a.deleted`,[owner]);
 const recovered=new Set(snapshots.flatMap(snapshot=>snapshot.postIds));
 const summary={observations:snapshots.length,bookmarks:rows.length,recoverable:rows.filter(row=>recovered.has(row.post_id)).length,unrecovered:rows.filter(row=>!recovered.has(row.post_id)).length};
 console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'preview',...summary}));
 if(!args.includes('--apply'))return;
 const fingerprint=async()=>{
  const [row]=await db().query(`select md5(string_agg(jsonb_build_array(id,deleted,source_revision,manual_fields,data-array['savedAt','bookmarkOrderObservedAt'],doc)::text,'' order by id)) as fingerprint from articles where user_id=$1`,[owner]);
  return row.fingerprint;
 };
 await mkdir(evidence!,{recursive:true});
 const before=await fingerprint();
 await writeFile(join(evidence!,'order-before.json'),JSON.stringify({owner,fingerprint:before,rows},null,2),{flag:'wx',mode:0o600});
 let writes=0;
 for(const snapshot of snapshots)writes+=(await repairBookmarkOrder(owner,snapshot)).updated;
 const after=await fingerprint();
 if(before!==after)throw new Error('Non-ordering library state changed during repair. Inspect concurrent writes before claiming preservation.');
 const ordered=(await shelfOf(owner)).filter(row=>recovered.has(String(row.data.postId))).map(row=>({id:row.id,postId:row.data.postId,savedAt:row.data.savedAt}));
 const result={...summary,writes,nonOrderingFingerprint:after,ordering:ordered};
 await writeFile(join(evidence!,'order-after.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify({state:'repaired',...summary,writes,nonOrderingStatePreserved:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Bookmark order repair failed.');process.exitCode=1;});
