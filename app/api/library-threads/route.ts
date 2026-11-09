import {requestOwner} from '@/lib/owner';
import {readLibraryThreads,searchLibraryPosts} from '@/lib/library-threads';
export const runtime='nodejs';
export async function GET(req:Request){
 const owner=await requestOwner(req);if(!owner)return Response.json({error:'Sign in to read your threads.'},{status:401});
 try{return Response.json(await readLibraryThreads(owner),{headers:{'Cache-Control':'private, no-store'}});}
 catch{return Response.json({error:'Could not load saved threads. Refresh to retry.'},{status:400});}
}
export async function POST(req:Request){
 const owner=await requestOwner(req);if(!owner)return Response.json({error:'Sign in to search your posts.'},{status:401});
 try{const body=await req.json();if(typeof body.query!=='string')throw Error('Invalid query.');return Response.json({matchedItemIds:await searchLibraryPosts(owner,body.query)},{headers:{'Cache-Control':'private, no-store'}});}
 catch{return Response.json({error:'Could not search saved posts.'},{status:400});}
}
