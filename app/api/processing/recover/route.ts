import {requestOwner} from '@/lib/owner';
import {supplyLinkedText} from '@/lib/linked-text';
export const runtime='nodejs';
export async function POST(req:Request) {
 const owner=await requestOwner(req);
 if (!owner) return Response.json({error:'Sign in to supply extracted text.'},{status:401});
 try {
  const reader=req.body?.getReader(); const chunks:Uint8Array[]=[]; let bytes=0;
  if (reader) try { for (;;) {const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1_100_000){await reader.cancel();return Response.json({error:'Extracted text request exceeds 1.1 MB.'},{status:413});}chunks.push(value);}} finally {reader.releaseLock();}
  const args=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!args || typeof args!=='object' || Array.isArray(args)) throw new Error('Invalid recovery request.');
  const result=await supplyLinkedText(owner,args);
  return result?Response.json(result):Response.json({error:'This source is unavailable, has changed, or is not awaiting text recovery.'},{status:409});
 } catch(e) {return Response.json({error:e instanceof Error?e.message:'Could not save extracted text.'},{status:400});}
}
