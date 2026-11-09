import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { xApi, type XTokens } from './x-api';
function key(){const value=Buffer.from(process.env.X_CREDENTIAL_ENCRYPTION_KEY??'','base64');if(value.length!==32)throw new Error('Configure a 32-byte base64 X_CREDENTIAL_ENCRYPTION_KEY.');return value;}
export function xConfigured(){try{key();return Boolean(process.env.X_CLIENT_ID&&callbackUrl());}catch{return false;}}
export function callbackUrl(){const url=new URL(process.env.NEXT_PUBLIC_SITE_URL??'http://localhost:3100');if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error('Configure an HTTPS public origin for X.');return url.origin+'/api/x-bookmarks/callback';}
function seal(owner:string,value:unknown){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce);cipher.setAAD(Buffer.from(owner));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');}
function open<T>(owner:string,value:string):T{const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAAD(Buffer.from(owner));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function beginXConnection(owner:string){
 if(!xConfigured())throw new Error('Configure X_CLIENT_ID and X_CREDENTIAL_ENCRYPTION_KEY on the server.');
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
 await db().query('delete from x_oauth_states where user_id=$1 or expires_at<now()',[owner]);
 await db().query('insert into x_oauth_states(state_hash,user_id,encrypted_verifier,expires_at) values($1,$2,$3,now()+interval \'10 minutes\')',[hash(state),owner,seal(owner,verifier)]);
 const url=new URL('https://x.com/i/oauth2/authorize');url.search=new URLSearchParams({response_type:'code',client_id:process.env.X_CLIENT_ID!,redirect_uri:callbackUrl(),scope:'tweet.read users.read bookmark.read offline.access',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return {url:url.toString()};
}
export async function finishXConnection(owner:string,state:string,code:string){
 if(!state||state.length>500||!code||code.length>2000)throw new Error('Invalid X authorization response.');
 const [row]=await db().query('delete from x_oauth_states where state_hash=$1 and user_id=$2 and expires_at>now() returning encrypted_verifier',[hash(state),owner]);
 if(!row)throw new Error('X authorization expired or belongs to another session. Connect again.');
 const tokens=await xApi.exchange(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callbackUrl(),code_verifier:open<string>(owner,row.encrypted_verifier)})),user=await xApi.identity(tokens.access_token);
 const encrypted=seal(owner,{...tokens,expiresAt:Date.now()+tokens.expires_in*1000});
 await db().query(`insert into x_connections(user_id,x_user_id,handle,generation,encrypted_credentials,profile,profile_requested_at) values($1,$2,$3,$4,$5,$6::jsonb,now()) on conflict(user_id) do update set x_user_id=excluded.x_user_id,handle=excluded.handle,generation=excluded.generation,encrypted_credentials=excluded.encrypted_credentials,profile=excluded.profile,profile_requested_at=now(),updated_at=now()`,[owner,user.id,user.username,crypto.randomUUID(),encrypted,JSON.stringify({...publicXAuthor(user),fetchedAt:new Date().toISOString()})]);
}
export async function disconnectX(owner:string){
 await db().query('delete from x_connections where user_id=$1',[owner]);await db().query('delete from x_oauth_states where user_id=$1',[owner]);
 await db().query("update x_bookmark_runs set state='paused',lease_token=null,lease_expires_at=null where user_id=$1 and state<>'exhausted'",[owner]);
}
export async function xConnectionStatus(owner:string){const [row]=await db().query('select handle from x_connections where user_id=$1',[owner]);return {configured:xConfigured(),connected:Boolean(row),handle:row?.handle??null,callbackUrl:callbackUrl()};}
/** Refresh only under the sync run's exclusive lease; CAS prevents publishing into a replaced connection. */
export async function xAccess(owner:string,expectedId:string,allowRefresh=true){
 const [row]=await db().query('select x_user_id,generation,encrypted_credentials from x_connections where user_id=$1',[owner]);
 if(!row||row.x_user_id!==expectedId)throw new Error('Reconnect the X account that started this sync.');
 let tokens=open<XTokens>(owner,row.encrypted_credentials);
 if((tokens.expiresAt??0)<Date.now()+60_000){
  if(!allowRefresh)throw new XProfileError('X access expired. Reconnect X to load your current profile.');
  if(!tokens.refresh_token)throw new Error('X access expired. Reconnect X.');
  const refreshed=await xApi.exchange(new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token}));tokens={...refreshed,refresh_token:refreshed.refresh_token??tokens.refresh_token,expiresAt:Date.now()+refreshed.expires_in*1000};
  const updated=await db().query('update x_connections set encrypted_credentials=$3,updated_at=now() where user_id=$1 and generation=$2 returning user_id',[owner,row.generation,seal(owner,tokens)]);
  if(!updated.length)throw new Error('X connection changed; resume with the current connection.');
 }
 return tokens.access_token;
}

/** Read-only metadata projection: no provider calls and no credential fields. */
export class XProfileError extends Error {}
export type XPreviewProfile = { connected: boolean; author?: { name: string; handle: string; imageUrl?: string }; fetchedAt?: string; refreshAllowedAt?: string };
function publicXAuthor(user: { username: string; name?: string; profile_image_url?: string }) {
 let imageUrl: string | undefined;
 try { const url = new URL(user.profile_image_url ?? ""); if (url.protocol === "https:" && url.hostname === "pbs.twimg.com" && !url.username && !url.password) imageUrl = url.toString(); } catch { /* Missing or unsafe avatar uses the neutral silhouette. */ }
 return { name: user.name?.trim().slice(0, 100) || `@${user.username}`, handle: user.username, ...(imageUrl ? { imageUrl } : {}) };
}
export async function xPreviewProfile(owner: string): Promise<XPreviewProfile> {
 const [row] = await db().query('select handle,profile,profile_requested_at from x_connections where user_id=$1',[owner]);
 if (!row) return { connected: false };
 const cached = row.profile;
 return { connected: true, author: publicXAuthor({ username: row.handle, name: cached?.name, profile_image_url: cached?.imageUrl }),
  ...(cached?.fetchedAt ? { fetchedAt: cached.fetchedAt } : {}),
  ...(row.profile_requested_at ? { refreshAllowedAt: new Date(new Date(row.profile_requested_at).getTime() + 15 * 60_000).toISOString() } : {}) };
}
/** Explicit bounded identity read. A durable cooldown prevents concurrent/repeated paid reads even on failure. */
export async function refreshXPreviewProfile(owner: string): Promise<XPreviewProfile> {
 const [row] = await db().query(`update x_connections set profile_requested_at=now() where user_id=$1
  and (profile_requested_at is null or profile_requested_at < now()-interval '15 minutes') returning x_user_id,generation`,[owner]);
 if (!row) throw new XProfileError('Connect X, or wait 15 minutes after your last profile request before refreshing.');
 // Profile reads must not rotate tokens concurrently with a bookmark/thread sync lease.
 const token = await xAccess(owner,row.x_user_id,false);
 const user = await xApi.identity(token);
 if (user.id !== row.x_user_id) throw new XProfileError('X returned a different connected account. Reconnect X.');
 const profile = { ...publicXAuthor(user), fetchedAt: new Date().toISOString() };
 const updated = await db().query('update x_connections set handle=$3,profile=$4::jsonb where user_id=$1 and generation=$2 returning user_id',[owner,row.generation,user.username,JSON.stringify(profile)]);
 if (!updated.length) throw new XProfileError('X connection changed. Reload the current connection.');
 return xPreviewProfile(owner);
}
