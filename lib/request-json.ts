/** Bound streamed requests before parsing them; never rely on Content-Length. */
export async function boundedJson(req:Request,limit:number):Promise<Record<string,unknown>> {
 const reader=req.body?.getReader();if(!reader)return {};
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Request exceeds the allowed size.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 const body=JSON.parse(new TextDecoder().decode(bytes)||'{}');
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Expected request options.');return body;
}
