import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
const values=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{if(v.length>12000)throw new DOMException('Full','QuotaExceededError');values.set(k,v)},removeItem:(k:string)=>values.delete(k),key:(i:number)=>[...values.keys()][i]??null,get length(){return values.size}}});
Object.defineProperty(globalThis,'window',{value:new EventTarget()});
Object.defineProperty(globalThis,'document',{value:Object.assign(new EventTarget(),{visibilityState:'visible'})});

test('a library larger than localStorage can be checkpointed and restored with its manual edits',async()=>{
 const {useStore,checkpointLibrary}=await import('../lib/store');
 const owner='large-cache-'+crypto.randomUUID();useStore.getState().activateAccount(owner);
 const rows=Array.from({length:30},(_,i)=>({id:'saved-'+i,articleId:'saved-'+i,revision:1,sourceRevision:1,deleted:false,data:{id:'saved-'+i,title:'Saved post '+i+' '+ 'long metadata '.repeat(80),origin:'paste' as const,words:50,addedAt:1}}));
 useStore.getState().applyRemote({articles:rows});useStore.getState().shelve('saved-0',{tags:['my tag'],favorite:true});
 assert.equal(await checkpointLibrary(),true,'A full account snapshot must remain durable when localStorage is full');
 useStore.getState().activateAccount('other-cache-owner');assert.equal(useStore.getState().library.length,0);
 useStore.getState().activateAccount(owner);assert.equal(useStore.getState().library.length,30);
 assert.deepEqual(useStore.getState().library.find(i=>i.id==='saved-0')?.tags,['my tag']);assert.equal(useStore.getState().library.find(i=>i.id==='saved-0')?.favorite,true);
});

const until=async(check:()=>boolean)=>{for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,2))}assert.fail('Timed out waiting for sync')};
test('paged account sync keeps the last library visible until the complete snapshot arrives',async()=>{
 const {useStore}=await import('../lib/store');const {startSync}=await import('../lib/sync');
 const owner='atomic-cache-'+crypto.randomUUID();useStore.getState().activateAccount(owner);
 const row=(id:string)=>({id,articleId:id,revision:1,sourceRevision:1,deleted:false,data:{id,title:id,origin:'paste' as const,words:10,addedAt:1}});
 useStore.getState().applyRemote({articles:[row('cached')]});
 let secondStarted=false,release!:()=>void;const second=new Promise<void>(r=>{release=r});
 globalThis.fetch=async(_url,init)=>{
  if(init?.method==='POST'){const {changes}=JSON.parse(String(init.body));return Response.json({accepted:Object.entries(changes).flatMap(([collection,rows]:any)=>(rows as any[]).map(r=>({collection,id:r.id,revision:1,sourceRevision:1}))),conflicts:[]})}
  if(String(_url).includes('cursor=page-1')){secondStarted=true;await second;return Response.json({cursor:'complete',hasMore:false,changes:{articles:[row('linked-article')]}})}
  return Response.json({cursor:'page-1',hasMore:true,changes:{articles:[row('root'),row('tip')]}});
 };
 const sync=startSync(owner);
 try{await until(()=>secondStarted);assert.deepEqual(useStore.getState().library.map(i=>i.id),['cached'],'Partial history pages must not become visible arrivals or changing totals');release();await until(()=>useStore.getState().library.length===4)}finally{release();sync.stop()}
});

test('the library exposes no raw post count before sync and thread projection are ready',async()=>{
 const {projectLibrary,libraryStats}=await import('../lib/library');
 const post={id:'root',title:'Opening',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:1};
 const tip={...post,id:'tip',title:'Continuation'};const article={...post,id:'article',contentType:'article' as const,title:'Article'};
 const base={progress:{},highlights:{},hydrated:true,hiddenSamples:[],account:'owner'};
 const inputs=[{...base,library:[post,article],syncReady:false},{...base,library:[post,tip,article],syncReady:true},{...base,library:[post,tip,article],syncReady:true,threads:{groups:[{rootId:'root',memberIds:['root','tip']}],postItemIds:['root','tip']}}];
 const counts=inputs.map(input=>{const view=projectLibrary(input);return view.ready?libraryStats(view.books.filter(b=>!b.sample)).count:null});
 assert.deepEqual(counts,[null,null,2]);
});

test('account adoption cannot publish into an account selected during its durable checkpoint',async()=>{
 const {useStore,saveDoc,checkpointLibrary}=await import('../lib/store');
 useStore.getState().activateAccount(null);const doc={id:'anonymous-race',title:'Anonymous note',origin:'paste' as const,blocks:[]};await saveDoc(doc,null);useStore.getState().addToLibrary(doc,1);await checkpointLibrary();
 useStore.getState().activateAccount('adoption-a');await checkpointLibrary();
 const put=IDBObjectStore.prototype.put;let switched=false;
 IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){
  const request=put.call(this,value,key),snapshot=value.value??value;
  if(!switched&&this.name==='cache'&&String(key).includes('adoption-a:gloss:v1')&&snapshot.library?.some((i:any)=>i.id===doc.id)){switched=true;queueMicrotask(()=>useStore.getState().activateAccount('adoption-b'))}
  return request;
 };
 try{await useStore.getState().adoptAnonymous();assert.equal(switched,true);assert.equal(useStore.getState().scope,'adoption-b');assert.equal(useStore.getState().library.some(i=>i.id===doc.id),false)}finally{IDBObjectStore.prototype.put=put}
});

test('a fresh browser restores the newest successful fallback snapshot and cursor together',async()=>{
 const {createLibraryCache,syncCacheKey}=await import('../lib/library-cache');
 const owner='fallback-'+crypto.randomUUID(),key=`sakamoto:account:${owner}:gloss:v1`,syncKey=syncCacheKey(owner);
 const first=createLibraryCache();assert.equal(await first.save([{key,value:{library:[{id:'old'}]}}]),true);
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(){throw new DOMException('Disk full','QuotaExceededError')};
 try{assert.equal(await first.save([{key,value:{library:[{id:'new',tags:['offline-note']}]}},{key:syncKey,value:{since:'new-cursor',complete:true}}]),true)}finally{IDBObjectStore.prototype.put=put}
 const fresh=createLibraryCache();await fresh.preload(owner);
 assert.equal(fresh.read<any>(key).library[0].id,'new');assert.equal(fresh.read<any>(syncKey).since,'new-cursor');
});

test('a signed-in fresh browser can discover large anonymous notes stored only in IndexedDB',async()=>{
 const {createLibraryCache}=await import('../lib/library-cache');const first=createLibraryCache();
 assert.equal(await first.save([{key:'sakamoto:anonymous:v2',value:{library:[{id:'anonymous-large',title:'note '.repeat(5000)}]}}]),true);
 const fresh=createLibraryCache();await fresh.preload('signed-in-owner');assert.equal(fresh.read<any>('sakamoto:anonymous:v2')?.library[0].id,'anonymous-large');
});

test('a failed durable checkpoint never acknowledges its new cursor in memory',async()=>{
 const {createLibraryCache,syncCacheKey}=await import('../lib/library-cache');const cache=createLibraryCache();const key=syncCacheKey('failed-checkpoint');
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Disk full','QuotaExceededError')};
 try{assert.equal(await cache.save([{key,value:{since:'uncommitted',payload:'x'.repeat(20000)}}]),false);assert.equal(cache.read(key),undefined)}finally{IDBObjectStore.prototype.put=put}
});


test('account adoption keeps edits made while the snapshot is being persisted',async()=>{
 const {useStore,saveDoc,checkpointLibrary}=await import('../lib/store');
 useStore.getState().activateAccount(null);const doc={id:'anonymous-concurrent',title:'Anonymous note',origin:'paste' as const,blocks:[]};await saveDoc(doc,null);useStore.getState().addToLibrary(doc,1);await checkpointLibrary();
 useStore.getState().activateAccount('adoption-edits');await checkpointLibrary();
 const put=IDBObjectStore.prototype.put;let edited=false;
 IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){
  const request=put.call(this,value,key),snapshot=value.value??value;
  if(!edited&&this.name==='cache'&&String(key).includes('adoption-edits:gloss:v1')&&snapshot.library?.some((i:any)=>i.id===doc.id)){edited=true;queueMicrotask(()=>useStore.getState().addToLibrary({id:'new-local-edit',title:'Keep my edit',blocks:[]},1))}
  return request;
 };
 try{await useStore.getState().adoptAnonymous();assert.equal(edited,true);assert(useStore.getState().library.some(i=>i.id===doc.id));assert(useStore.getState().library.some(i=>i.id==='new-local-edit'))}finally{IDBObjectStore.prototype.put=put}
});

test('fresh account metadata does not delete thousands of nonexistent cached texts',async()=>{
 const {useStore}=await import('../lib/store');const {startSync}=await import('../lib/sync');
 const owner='cold-invalidation-'+crypto.randomUUID();useStore.getState().activateAccount(owner);
 const rows=Array.from({length:100},(_,i)=>({id:'cold-'+i,articleId:'cold-'+i,revision:1,sourceRevision:1,deleted:false,data:{id:'cold-'+i,title:'Post '+i,origin:'paste' as const,words:10,addedAt:1}}));
 globalThis.fetch=async()=>Response.json({cursor:'cold-complete',hasMore:false,changes:{articles:rows}});
 const remove=IDBObjectStore.prototype.delete;let deletes=0;
 IDBObjectStore.prototype.delete=function(key){if(this.name==='docs')deletes++;return remove.call(this,key)};
 const sync=startSync(owner);
 try{await until(()=>useStore.getState().syncReady);assert.equal(useStore.getState().library.length,100);assert.equal(deletes,0)}finally{sync.stop();IDBObjectStore.prototype.delete=remove}
});

test('a source refresh invalidates an orphaned cached text without touching another account',async()=>{
 const {useStore,saveDoc,loadDoc}=await import('../lib/store');const {startSync}=await import('../lib/sync');
 const owner='orphan-source-'+crypto.randomUUID();useStore.getState().activateAccount(owner);
 const doc={id:'orphan',title:'Old cached source',blocks:[]};await saveDoc(doc,owner);await saveDoc(doc,'other-source-owner');
 globalThis.fetch=async()=>Response.json({cursor:'orphan-complete',hasMore:false,changes:{articles:[{id:doc.id,articleId:doc.id,revision:2,sourceRevision:2,deleted:false,data:{...doc,origin:'paste',words:10,addedAt:1}}]}});
 const sync=startSync(owner);
 try{await until(()=>useStore.getState().syncReady);assert.equal(await loadDoc(doc.id,owner),null);assert.equal((await loadDoc(doc.id,'other-source-owner'))?.title,doc.title)}finally{sync.stop()}
});

test('an edit committed while another source is checked survives invalidation and is recovered on retry',async()=>{
 const {useStore,saveDoc,loadDoc,checkpointLibrary}=await import('../lib/store');const {startSync}=await import('../lib/sync');
 if(typeof CustomEvent==='undefined')Object.defineProperty(globalThis,'CustomEvent',{value:class<T> extends Event{detail:T;constructor(type:string,options:{detail:T}){super(type);this.detail=options.detail}}});
 const owner='invalidation-edit-'+crypto.randomUUID();useStore.getState().activateAccount(owner);
 const doc=(id:string)=>({id,title:id,origin:'paste' as const,sourceRevision:1,blocks:[{id:'b1',type:'p' as const,runs:[{text:'Original '+id}]}]});
 const row=(id:string,sr:number)=>({id,articleId:id,revision:sr,sourceRevision:sr,deleted:false,data:{id,title:id,origin:'paste' as const,words:2,addedAt:1,sourceRevision:sr,rev:0}});
 globalThis.fetch=async()=>Response.json({cursor:'initial',hasMore:false,changes:{articles:[row('a',1)]}});
 let sync=startSync(owner);await until(()=>useStore.getState().syncReady);sync.stop();await checkpointLibrary();
 await saveDoc(doc('a'),owner);await saveDoc(doc('b'),owner);useStore.getState().addToLibrary(doc('b'),2);await checkpointLibrary();
 let blocked=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('/api/articles/b')){blocked=true;await held;return Response.json({doc:doc('b')})}
  if(init?.method==='POST')throw new Error('This preservation fixture must not push');
  return Response.json({cursor:'updated',hasMore:false,changes:{articles:[row('a',2),row('b',1)]}});
 };
 sync=startSync(owner);
 try{
  await until(()=>blocked);assert.equal(await useStore.getState().updateText({...doc('a'),blocks:[{id:'b1',type:'p',runs:[{text:'Keep this concurrent edit'}]}]},4),true);release();
  await until(()=>Boolean(useStore.getState().syncError));
  assert.equal((await loadDoc('a',owner))?.blocks[0].runs?.[0].text,'Keep this concurrent edit');
  assert(useStore.getState().library.find(item=>item.id==='a')?.pendingSource);
  assert.equal(useStore.getState().library.find(item=>item.id==='a')?.sourceRevision,1);
 }finally{release();sync.stop()}
 sync=startSync(owner);
 try{
  await until(()=>useStore.getState().library.find(item=>item.id==='a')?.sourceRevision===2);
  const recovery=useStore.getState().library.find(item=>item.recoveredFrom?.itemId==='a');
  assert(recovery);assert.equal((await loadDoc(recovery.id,owner))?.blocks[0].runs?.[0].text,'Keep this concurrent edit');
 }finally{sync.stop()}
});
