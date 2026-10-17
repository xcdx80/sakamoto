/** Standalone X OAuth/API transport. No Birdclaw, xurl, browser cookies or shell at runtime. */
export type XTokens={access_token:string;refresh_token?:string;expires_in:number;expiresAt?:number};
export class XApiError extends Error {
 constructor(message:string,public retryAt?:number){super(message);}
}
async function json(response:Response){
 if(!response.ok){
  const reset=Number(response.headers.get('x-rate-limit-reset'))*1000;
  const retry=Number(response.headers.get('retry-after'))*1000+Date.now();
  const message=response.status===429?'X rate limit reached. Resume after the retry time.':response.status===401||response.status===403?'X denied access. Reconnect with bookmark read access.':response.status===402?'X API credits are unavailable. Add credits or import a Birdclaw database.':'X request failed. Your saved material and checkpoint are retained.';
  throw new XApiError(message,response.status===429?Math.max(Date.now()+60_000,Number.isFinite(reset)?reset:0,Number.isFinite(retry)?retry:0):Date.now()+60_000);
 }
 const reader=response.body?.getReader();if(!reader)throw new XApiError('X returned an empty response.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16_000_000){await reader.cancel();throw new XApiError('X response exceeded the safe page size.');}chunks.push(value);}}finally{reader.releaseLock();}
 const buffer=new Uint8Array(size);let offset=0;for(const c of chunks){buffer.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(buffer));
}
const real={
 async exchange(params:URLSearchParams):Promise<XTokens>{
  const client=process.env.X_CLIENT_ID;if(!client)throw new Error('Configure X_CLIENT_ID.');
  params.set('client_id',client);
  const secret=process.env.X_CLIENT_SECRET;
  const result=await json(await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(secret?{Authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64')}:{})},body:params,signal:AbortSignal.timeout(15_000),redirect:'error',cache:'no-store'}));
  if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw new Error('X did not return a valid access token.');
  return result;
 },
 async identity(token:string):Promise<{id:string;username:string}>{
  const result=await json(await fetch('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15_000),redirect:'error',cache:'no-store'}));
  if(!/^[1-9]\d*$/.test(result.data?.id)||!/^\w{1,15}$/.test(result.data?.username??''))throw new Error('X did not return the connected account.');return result.data;
 },
 async bookmarks(token:string,id:string,cursor:string|null):Promise<Record<string,any>>{
  const url=new URL(`https://api.x.com/2/users/${id}/bookmarks`);
  // Follow Birdclaw's conservative 90-result paginated walk; default to the wire vocabulary used by the installed Birdclaw.
  const modern=process.env.X_API_VOCABULARY==='posts';
  url.searchParams.set('max_results','90');
  url.searchParams.set(modern?'post.fields':'tweet.fields',modern?'created_at,conversation_id,entities,referenced_posts,note_post,article':'created_at,conversation_id,entities,referenced_tweets,note_tweet,article');
  url.searchParams.set('expansions',modern?'author_id,referenced_posts':'author_id,referenced_tweets.id,referenced_tweets.id.author_id');url.searchParams.set('user.fields','id,name,username');
  if(cursor)url.searchParams.set('pagination_token',cursor);
  return json(await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(18_000),redirect:'error',cache:'no-store'}));
 },
};
export type XTransport=typeof real;
let transport:XTransport=real;
/** Only the external provider transport is substitutable in deterministic HTTP tests. */
export function configureXTransport(overrides:Partial<XTransport>={}){transport={...real,...overrides};}
export const xApi: XTransport={exchange:p=>transport.exchange(p),identity:t=>transport.identity(t),bookmarks:(t,id,c)=>transport.bookmarks(t,id,c)};
