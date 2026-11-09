/** X list order is authoritative; observation dates are bounds, never publication dates. */
import { db } from './db';
import { bookmarkOrderOf, type BookmarkOrder } from './bookmark-order-input';

export type BookmarkOrderEntry = { postId: string; savedAt: number };

/** Keep stable known dates as anchors. A moved bookmark is placed ahead of its newer neighbours. */
export async function planBookmarkOrder(owner:string, order:BookmarkOrder, before?:number|null, promoteCount=0):Promise<BookmarkOrderEntry[]> {
 const rows=await db().query(`select p.post_id,a.data->'savedAt' as saved_at from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
 where p.user_id=$1 and p.role='bookmark' and not a.deleted and p.post_id=any($2::text[])`,[owner,order.postIds]);
 const known=new Map(rows.map(row=>[row.post_id,row.saved_at]));
 const ceiling=Math.min(before??Infinity,Date.parse(order.observedAt)+1);
 const anchors=new Map<number,number>();
 let lower=0;
 for(let i=order.postIds.length-1;i>=promoteCount;i--){
  const at=known.get(order.postIds[i]);
  if(typeof at==='number' && Number.isFinite(at) && at>lower && at<ceiling){anchors.set(i,at);lower=at;}
 }
 const result:BookmarkOrderEntry[]=[];
 let upper=ceiling,start=0;
 for(let end=0;end<=order.postIds.length;end++){
  if(end!==order.postIds.length&&!anchors.has(end))continue;
  const anchor=anchors.get(end)??0,count=end-start;
  const step=Math.min(1,(upper-anchor)/(count+1));
  for(let i=start;i<end;i++)result.push({postId:order.postIds[i],savedAt:upper-step*(i-start+1)});
  if(end<order.postIds.length){result.push({postId:order.postIds[end],savedAt:anchor});upper=anchor;}
  start=end+1;
 }
 return result;
}

/** Metadata-only writes publish through normal sync, preserving text, annotations and reader choices. */
export async function applyBookmarkOrder(owner:string, entries:BookmarkOrderEntry[], observedAt:string, lease?:{runId:string;token:string}) {
 return db().query(`update articles a set data=a.data || jsonb_build_object('savedAt',entry."savedAt",'bookmarkOrderObservedAt',$3::text)
 from post_sources p,jsonb_to_recordset($2::jsonb) as entry("postId" text,"savedAt" double precision)
 where a.user_id=$1 and p.user_id=a.user_id and p.article_id=a.id and p.post_id=entry."postId" and p.role='bookmark' and not a.deleted
 and coalesce(a.data->>'bookmarkOrderObservedAt','')<=$3
 and (a.data->'savedAt' is distinct from to_jsonb(entry."savedAt") or a.data->>'bookmarkOrderObservedAt' is distinct from $3)
 and ($4::text is null or exists(select 1 from x_bookmark_runs r where r.user_id=$1 and r.run_id=$4 and r.lease_token=$5 and r.state='active' and r.lease_expires_at>clock_timestamp())) returning a.id`,[owner,JSON.stringify(entries),observedAt,lease?.runId??null,lease?.token??null]);
}

export async function repairBookmarkOrder(owner:string, raw:unknown) {
 const order=bookmarkOrderOf(raw),entries=await planBookmarkOrder(owner,order);
 return {updated:(await applyBookmarkOrder(owner,entries,order.observedAt)).length};
}
