import { requestOwner } from '@/lib/owner';
import { bookmarkWorkflow } from '@/lib/bookmark-workflow';
export const runtime='nodejs';
export async function GET(req:Request){
 const owner=await requestOwner(req);
 if(!owner)return Response.json({error:'Sign in to prepare your bookmark workflow.'},{status:401});
 return Response.json(bookmarkWorkflow(new URL(req.url).origin),{headers:{'Cache-Control':'private, no-store'}});
}
