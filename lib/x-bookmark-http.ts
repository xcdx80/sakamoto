/** HTTP contract receives identity exclusively from the Clerk/session adapter, never request JSON. */
import { boundedJson } from './request-json';
import { beginXConnection, finishXConnection, disconnectX, xConnectionStatus, callbackUrl } from './x-credentials';
import { startXSync, resumeXSync, stepXSync, xSyncStatus } from './x-bookmark-sync';
const headers={'Cache-Control':'private, no-store'};
export async function xConnectionHttp(req:Request,owner:string|null){
 if(!owner)return Response.json({error:'Sign in to manage your X connection.'},{status:401,headers});
 try{
  const url=new URL(req.url);
  if(url.pathname.endsWith('/callback')){
   await finishXConnection(owner,url.searchParams.get('state')??'',url.searchParams.get('code')??'');
   return new Response(null,{status:303,headers:{...headers,Location:new URL('/library?x=connected',callbackUrl()).toString(),'Referrer-Policy':'no-referrer'}});
  }
  if(req.method==='GET')return Response.json(await xConnectionStatus(owner),{headers});
  const body=await boundedJson(req,4096);
  if(Object.keys(body).some(k=>k!=='action'))throw new Error('Unsupported connection option.');
  if(body.action==='connect')return Response.json(await beginXConnection(owner),{headers});
  if(body.action==='disconnect'){await disconnectX(owner);return Response.json(await xConnectionStatus(owner),{headers});}
  throw new Error('Choose connect or disconnect.');
 }catch{return Response.json({error:'X connection could not complete. Check server configuration or reconnect X; your library is retained.'},{status:400,headers});}
}
export async function xSyncHttp(req:Request,owner:string|null){
 if(!owner)return Response.json({error:'Sign in to sync bookmarks.'},{status:401,headers});
 try{
  if(req.method==='GET')return Response.json(await xSyncStatus(owner),{headers});
  const body=await boundedJson(req,4096);
  if(Object.keys(body).some(k=>!['action','maxPages'].includes(k)))throw new Error('Unsupported sync option.');
  const result=body.action==='restart'?await startXSync(owner,body.maxPages,true):body.action==='start'?await startXSync(owner,body.maxPages):body.action==='resume'?await resumeXSync(owner,body.maxPages):body.action==='step'?await stepXSync(owner):null;
  if(!result)throw new Error('Choose start, resume or step.');return Response.json(result,{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Could not sync bookmarks.'},{status:400,headers});}
}
