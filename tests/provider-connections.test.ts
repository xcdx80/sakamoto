import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { pool, setupPostgres } from "./postgres";
import { providerConnectionsHttp } from "../lib/provider-connections-http";
import { prepareProviderConnection, executeProviderRequest } from "../lib/provider-connections";

before(async () => {
  process.env.PROVIDER_CREDENTIAL_KEYS = JSON.stringify({ test: randomBytes(32).toString("base64") });
  process.env.PROVIDER_CREDENTIAL_ACTIVE_KEY = "test";
  process.env.PROVIDER_CREDENTIAL_CONTEXT = "isolated-byok-tests";
  await setupPostgres();
});
after(() => pool.end());
const key = "sk-test-private-credential-never-return-this";
function request(body?: unknown) {
  return new Request("https://sakamoto.test/api/provider-connections", {
    method: body ? "POST" : "GET",
    headers: { origin: "https://sakamoto.test", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("a reader connects a provider without revealing the credential and only their execution uses it", async () => {
  const saved = await providerConnectionsHttp(request({ action: "save", provider: "openai", apiKey: key }), "alice");
  assert.equal(saved.status, 200);
  const metadata = await saved.text();
  assert.ok(!metadata.includes(key));
  assert.ok(JSON.parse(metadata).connections.find((c: any) => c.provider === "openai").connected);
  const other = await providerConnectionsHttp(request(), "bob");
  assert.equal((await other.json()).connections.some((c: any) => c.connected), false);
  await assert.rejects(prepareProviderConnection("bob", "openai"), /Connect your OpenAI/);
  const connection = await prepareProviderConnection("alice", "openai");
  assert.ok(!JSON.stringify(connection).includes(key));
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer " + key);
    assert.equal(options?.redirect, "error");
    return Response.json({ ok: true });
  };
  try {
    const response = await executeProviderRequest(connection, "openai-chat", { body: "{}" });
    assert.deepEqual(await response.json(), { ok: true });
  } finally { globalThis.fetch = original; }
});

test("ciphertext is bound to owner/provider, rotated connections invalidate prepared work, and failures never dispatch", async () => {
  const { rows } = await pool.query("select * from provider_connections where owner_id='alice'");
  assert.ok(!JSON.stringify(rows).includes(key));
  const original = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent++; return Response.json({}); };
  try {
    await pool.query("insert into provider_connections select 'mallory',provider,gen_random_uuid(),key_id,ciphertext,expires_at,updated_at from provider_connections where owner_id='alice'");
    await assert.rejects(executeProviderRequest(await prepareProviderConnection('mallory','openai'), 'openai-chat', {body:'{}'}));
    const old = await prepareProviderConnection('alice','openai');
    await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:'replacement-secret-fixture'}),'alice');
    await assert.rejects(executeProviderRequest(old,'openai-chat',{body:'{}'}));
    const current = await prepareProviderConnection('alice','openai');
    await providerConnectionsHttp(request({action:'disconnect',provider:'openai'}),'alice');
    await assert.rejects(executeProviderRequest(current,'openai-chat',{body:'{}'}));
    assert.equal(sent,0);
    process.env.OPENAI_API_KEY = 'shared-key-must-never-be-used';
    await assert.rejects(prepareProviderConnection('alice','openai'));
  } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; await pool.query("delete from provider_connections where owner_id='mallory'"); }
});

test("management rejects foreign origins, bearer access, oversized input and returns no cacheable key data", async () => {
  assert.equal((await providerConnectionsHttp(request(),null)).status,401);
  const cross = request({action:'save',provider:'openai',apiKey:key});cross.headers.set('origin','https://attacker.test');
  assert.equal((await providerConnectionsHttp(cross,'victim')).status,403);
  const bearer = request();bearer.headers.set('authorization','Bearer anything');
  assert.equal((await providerConnectionsHttp(bearer,'victim')).status,401);
  assert.equal((await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:'a'.repeat(9000)}),'victim')).status,400);
  const safe = await providerConnectionsHttp(request(),'victim');
  assert.match(safe.headers.get('cache-control')!,/no-store/);
  assert.equal((await safe.json()).connections.some((c:any)=>c.connected),false);
});

test("per-user budget reservations are atomic and one user's cap does not authorize another", async () => {
  const {reservePaidWork} = await import('../lib/paid-work');
  await providerConnectionsHttp(request({action:'budget',capUsd:0.08}),'bounded');
  const results = await Promise.allSettled(Array.from({length:5},(_,i)=>reservePaidWork({owner:'bounded',operationId:'budget-'+i,attemptId:'one',model:'gpt-6-luna',serializedInput:'{}',maxOutputTokens:900})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  await providerConnectionsHttp(request({action:'budget',capUsd:0}),'paused');
  await assert.rejects(reservePaidWork({owner:'paused',operationId:'x',attemptId:'x',model:'gpt-6-luna',serializedInput:'{}',maxOutputTokens:900}),/budget/);
});

test("account deletion removes keys, rejects stale writes, and old keys can be rotated without revealing them", async () => {
  const { rotateProviderCredentials, deleteOwnerCredentials } = await import('../lib/credential-lifecycle');
  await providerConnectionsHttp(request({action:'save',provider:'google',apiKey:key}),'deleted');
  const ticket = await prepareProviderConnection('deleted','google');
  const oldKeys = process.env.PROVIDER_CREDENTIAL_KEYS!;
  process.env.PROVIDER_CREDENTIAL_KEYS = JSON.stringify({...JSON.parse(oldKeys),next:randomBytes(32).toString('base64')});
  process.env.PROVIDER_CREDENTIAL_ACTIVE_KEY = 'next';
  await rotateProviderCredentials();
  const {rows} = await pool.query("select key_id,ciphertext from provider_connections where owner_id='deleted'");
  assert.equal(rows[0].key_id,'next'); assert.ok(!rows[0].ciphertext.includes(key));
  await deleteOwnerCredentials('deleted');
  await assert.rejects(executeProviderRequest(ticket,'google-embedding',{body:'{}'}));
  assert.equal((await providerConnectionsHttp(request({action:'save',provider:'google',apiKey:key}),'deleted')).status,503);
  assert.equal((await pool.query("select * from provider_connections where owner_id='deleted'")).rowCount,0);
  process.env.PROVIDER_CREDENTIAL_KEYS=oldKeys; process.env.PROVIDER_CREDENTIAL_ACTIVE_KEY='test';
});

test("credential reflection is filtered across stream chunks and missing encryption keys fail closed", async () => {
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key}),'reflected');
  const ticket=await prepareProviderConnection('reflected','openai');
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('start '+key.slice(0,9)));c.enqueue(new TextEncoder().encode(key.slice(9)+' end'));c.close();}}),{headers:{'x-request-id':key,'content-type':key}});
  try {
    const response=await executeProviderRequest(ticket,'openai-chat',{body:'{}'});
    assert.equal(await response.text(),'start [redacted] end');
    assert.ok(!JSON.stringify([...response.headers]).includes(key));
    const ring=process.env.PROVIDER_CREDENTIAL_KEYS!;
    delete process.env.PROVIDER_CREDENTIAL_KEYS;
    try {await assert.rejects(executeProviderRequest(ticket,'openai-chat',{body:'{}'}),/Connect your/);}
    finally{process.env.PROVIDER_CREDENTIAL_KEYS=ring;}
  }finally{globalThis.fetch=original;}
});

test("disconnect after paid authorization refunds known undispatched work", async () => {
  const {prepareReaderAttempt,runReaderAttempt}=await import('../lib/reader-answers');
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key}),'queued');
  const prepared=await prepareReaderAttempt('queued','queued-work','one',[{role:'user',content:'hello'}],100);
  await providerConnectionsHttp(request({action:'disconnect',provider:'openai'}),'queued');
  const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Disconnected work cannot dispatch');
  try {await assert.rejects(async()=>{for await(const _ of runReaderAttempt(prepared,new AbortController().signal)){};},/Connect your/);}
  finally{globalThis.fetch=original;}
  assert.equal((await pool.query('select status from paid_attempts where id=$1',[prepared.reservation.id])).rows[0].status,'released');
});

test("Clerk deletion requires a valid signed event and tolerates delivery replay", async () => {
  const {POST}=await import('../app/api/webhooks/clerk/route');
  const {NextRequest}=await import('next/server');
  const {createHmac}=await import('node:crypto');
  const secret=randomBytes(32);process.env.CLERK_WEBHOOK_SIGNING_SECRET='whsec_'+secret.toString('base64');
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key}),'webhook-owner');
  const body=JSON.stringify({type:'user.deleted',data:{id:'webhook-owner',deleted:true,object:'user'},object:'event'}),id='msg_fixture',stamp=String(Math.floor(Date.now()/1000));
  const signed=()=>new NextRequest('https://sakamoto.test/api/webhooks/clerk',{method:'POST',body,headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+createHmac('sha256',secret).update(`${id}.${stamp}.${body}`).digest('base64')}});
  assert.equal((await POST(new NextRequest('https://sakamoto.test/api/webhooks/clerk',{method:'POST',body}))).status,400);
  assert.ok(await prepareProviderConnection('webhook-owner','openai'));
  assert.equal((await POST(signed())).status,204);
  assert.equal((await POST(signed())).status,204);
  await assert.rejects(prepareProviderConnection('webhook-owner','openai'));
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
});

test("expired keys remain removable and expiration is rechecked after authorization latency", async () => {
  const {configureDatabase}=await import('../lib/db');
  const {databaseAdapter}=await import('./postgres');
  const expiry=new Date(Date.now()+60000).toISOString();
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key,expiresAt:expiry}),'expires');
  const ticket=await prepareProviderConnection('expires','openai'),now=Date.now;
  configureDatabase({query:async(sql,params)=>{const rows=await databaseAdapter.query(sql,params);if(sql.includes('authorize_provider_request'))Date.now=()=>Date.parse(expiry)+1;return rows;}});
  const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Expired authorization must not dispatch');
  try {
    await assert.rejects(executeProviderRequest(ticket,'openai-chat',{body:'{}'}));
    const status=await (await providerConnectionsHttp(request(),'expires')).json();
    const connection=status.connections.find((c:any)=>c.provider==='openai');
    assert.equal(connection.stored,true);assert.equal(connection.connected,false);
    assert.equal((await providerConnectionsHttp(request({action:'disconnect',provider:'openai'}),'expires')).status,200);
    assert.equal((await pool.query("select * from provider_connections where owner_id='expires'")).rowCount,0);
  }finally{Date.now=now;globalThis.fetch=original;configureDatabase(databaseAdapter);}
});

test("disconnect serializes with authorization: new authorizations stop, already authorized work may finish", async () => {
  const {configureDatabase}=await import('../lib/db');
  const {databaseAdapter}=await import('./postgres');
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key}),'authorization-race');
  const ticket=await prepareProviderConnection('authorization-race','openai');
  let authorized!:()=>void,resume!:()=>void;
  const reached=new Promise<void>(resolve=>authorized=resolve),release=new Promise<void>(resolve=>resume=resolve);
  configureDatabase({query:async(sql,params)=>{const rows=await databaseAdapter.query(sql,params);if(sql.includes('authorize_provider_request') && rows.length){authorized();await release;}return rows;}});
  const original=globalThis.fetch;let sent=0;globalThis.fetch=async()=>{sent++;return Response.json({ok:true});};
  const pending=executeProviderRequest(ticket,'openai-chat',{body:'{}'});
  try {
    await reached;
    await providerConnectionsHttp(request({action:'disconnect',provider:'openai'}),'authorization-race');
    await assert.rejects(executeProviderRequest(ticket,'openai-chat',{body:'{}'}));
    assert.equal(sent,0);
    resume();await (await pending).text();assert.equal(sent,1);
    assert.equal((await pool.query("select count(*)::int as count from credential_audit where owner_id='authorization-race' and action='authorize'")).rows[0].count,1);
  }finally{resume();await pending.catch(()=>{});globalThis.fetch=original;configureDatabase(databaseAdapter);}
});

test("rotation waits for the owner lock without locking a row needed by account deletion", async () => {
  const {rotateProviderCredentials}=await import('../lib/credential-lifecycle');
  await providerConnectionsHttp(request({action:'save',provider:'openai',apiKey:key}),'rotation-race');
  const connection=await pool.connect();
  let rotation:ReturnType<typeof rotateProviderCredentials>|undefined;
  try {
    await connection.query('begin');
    await connection.query("select pg_advisory_xact_lock(hashtextextended('rotation-race',72621026))");
    rotation=rotateProviderCredentials();
    const deadline=Date.now()+3000;let waiting=false;
    while(Date.now()<deadline){
      waiting=(await pool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like 'select rotate_provider_connection%'")).rowCount!>0;
      if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'rotation must wait on the owner lock');
    await connection.query("select delete_owner_credentials('rotation-race')");
    await connection.query('commit');
    await rotation;
    await assert.rejects(prepareProviderConnection('rotation-race','openai'));
  }finally{await connection.query('rollback');connection.release();await rotation?.catch(()=>{});}
});

test("management rate limits simultaneous mutations durably per owner", async () => {
  const responses=await Promise.all(Array.from({length:24},()=>providerConnectionsHttp(request({action:'budget',capUsd:10}),'rate-limited')));
  assert.equal(responses.filter(r=>r.status===200).length,20);
  assert.equal(responses.filter(r=>r.status===429).length,4);
  assert.equal((await providerConnectionsHttp(request({action:'budget',capUsd:10}),'independent-rate')).status,200);
});
