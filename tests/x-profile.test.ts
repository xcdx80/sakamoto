import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, setupPostgres } from './postgres';
import { configureXTransport } from '../lib/x-api';
import { xConnectionHttp } from '../lib/x-bookmark-http';
import { writeHttp } from '../lib/post-production/http';
before(setupPostgres);after(()=>pool.end());
const req=(action:string)=>new Request('https://sakamoto.test/api/write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});
async function connect(owner:string){
 const response=await xConnectionHttp(new Request('https://sakamoto.test/api/x-bookmarks',{method:'POST',body:JSON.stringify({action:'connect'})}),owner);
 const {url}=await response.json();
 assert.equal((await xConnectionHttp(new Request('https://sakamoto.test/api/x-bookmarks/callback?state='+new URL(url).searchParams.get('state')+'&code=fixture'),owner)).status,303);
}
test('X preview caches the authenticated account, scopes by owner, and explicitly refreshes at most once per cooldown',async()=>{
 process.env.X_CLIENT_ID='fixture';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';
 let reads=0;
 configureXTransport({exchange:async()=>({access_token:'private-token',refresh_token:'private-refresh',expires_in:7200}),identity:async()=>{reads++;return {id:'777',username:'real_account',name:'Real X Name',profile_image_url:'https://pbs.twimg.com/profile_images/777/avatar.jpg'};}});
 const owner='profile-'+crypto.randomUUID();await connect(owner);assert.equal(reads,1);
 for(let i=0;i<2;i++){
  const workspace=await(await writeHttp(new Request('https://sakamoto.test/api/write'),owner)).json();
  assert.deepEqual(workspace.xProfile.author,{name:'Real X Name',handle:'real_account',imageUrl:'https://pbs.twimg.com/profile_images/777/avatar.jpg'});
  assert.doesNotMatch(JSON.stringify(workspace.xProfile),/private-token|private-refresh|encrypted/);
 }
 assert.equal(reads,1);
 const other=await(await writeHttp(new Request('https://sakamoto.test/api/write'),'different-owner')).json();assert.equal(other.xProfile.connected,false);
 await pool.query("update x_connections set profile=null,profile_requested_at=null where user_id=$1",[owner]);
 const responses=await Promise.all([writeHttp(req('x_profile'),owner),writeHttp(req('x_profile'),owner)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);assert.equal(reads,2);
 assert.equal((await writeHttp(req('x_profile'),owner)).status,400);assert.equal(reads,2);
 assert.equal((await writeHttp(req('x_profile'),null)).status,401);
 configureXTransport();
});
test('profile refresh rejects a changed account, retains cooldown after failures, and never rotates expired credentials',async()=>{
 let reads=0,exchanges=0;
 configureXTransport({exchange:async()=>{exchanges++;return {access_token:'private',refresh_token:'rotate',expires_in:7200};},identity:async()=>({id:'777',username:'account'})});
 const owner='profile-failure-'+crypto.randomUUID();await connect(owner);
 await pool.query('update x_connections set profile_requested_at=null where user_id=$1',[owner]);
 configureXTransport({identity:async()=>{reads++;return {id:'888',username:'other'};}});
 assert.equal((await writeHttp(req('x_profile'),owner)).status,400);
 assert.equal((await writeHttp(req('x_profile'),owner)).status,400);assert.equal(reads,1);
 const row=(await pool.query('select handle,profile from x_connections where user_id=$1',[owner])).rows[0];assert.equal(row.handle,'account');
 configureXTransport({exchange:async()=>{exchanges++;return {access_token:'expired',refresh_token:'rotate',expires_in:0};},identity:async()=>({id:'777',username:'account'})});
 await connect(owner);await pool.query('update x_connections set profile_requested_at=null where user_id=$1',[owner]);
 const before=exchanges;const response=await writeHttp(req('x_profile'),owner);assert.equal(response.status,400);assert.match((await response.json()).error,/expired|Reconnect/i);assert.equal(exchanges,before);
 configureXTransport();
});
