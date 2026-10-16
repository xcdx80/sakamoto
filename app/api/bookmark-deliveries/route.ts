import { bookmarkDeliveryStatus, DeliveryInputError } from '@/lib/bookmark-deliveries';
import { requestOwner } from '@/lib/owner';
export const runtime='nodejs';
export async function GET(req:Request) {
 const owner=await requestOwner(req);
 if(!owner)return Response.json({error:'Sign in to view bookmark delivery progress.'},{status:401});
 const url=new URL(req.url);
 const args:Record<string,unknown>=Object.fromEntries(url.searchParams);
 if(args.limit!==undefined)args.limit=Number(args.limit);
 try{return Response.json(await bookmarkDeliveryStatus(owner,args),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return Response.json({error:error instanceof DeliveryInputError?error.message:'Delivery progress is unavailable; received material remains saved.'},{status:error instanceof DeliveryInputError?400:503});}
}
