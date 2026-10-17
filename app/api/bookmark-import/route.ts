import { requestOwner } from '@/lib/owner';
import { importBookmarks } from '@/lib/bookmarks';
import { boundedJson } from '@/lib/request-json';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 const owner=await requestOwner(req);if(!owner)return Response.json({error:'Sign in to import bookmarks.'},{status:401});
 try{return Response.json(await importBookmarks(owner,await boundedJson(req,2_000_000),'Birdclaw database'),{headers:{'Cache-Control':'private, no-store'}});}
 catch{return Response.json({error:'Import could not be acknowledged. Retry the same file and batch; already saved posts remain safe.'},{status:400});}
}
