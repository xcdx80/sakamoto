import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {useStore} from '../lib/store';
import {watchLibraryProcessing} from '../lib/processing-client';

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;useStore.getState().activateAccount(null);});
const status=(pending:number,ready=pending,extra:Record<string,unknown>={})=>({summary:{pending,ready,running:0,complete:3-pending,attention:0,...extra},jobs:[],next:null,description:'Fixture processing'});

test('opening the library drains successive ready batches without overlapping requests or starting X sync',{timeout:2000},async()=>{
 const owner='automatic-reader';useStore.getState().activateAccount(owner);
 let remaining=3,posts=0,active=0,peak=0;
 globalThis.fetch=async(input,options)=>{
  assert.equal(String(input),'/api/processing?');assert.equal((options?.headers as Record<string,string>)['X-Sakamoto-Owner'],owner);
  active++;peak=Math.max(peak,active);await Promise.resolve();
  if(options?.method==='POST'){assert.deepEqual(JSON.parse(String(options.body)),{limit:48});posts++;remaining--;}
  active--;return Response.json({...status(remaining),...(options?.method==='POST'?{processed:1,finished:1}:{})});
 };
 let resolve!:()=>void;const finished=new Promise<void>(r=>{resolve=r});
 const stop=watchLibraryProcessing(owner,progress=>{if(progress.phase==='idle')resolve();});
 try{await finished;assert.equal(posts,3);assert.equal(peak,1);}finally{stop();}
});

test('a processing budget pause prevents automatic paid dispatch instead of marking the backlog finished',{timeout:2000},async()=>{
 const owner='budget-reader';useStore.getState().activateAccount(owner);let posts=0;
 globalThis.fetch=async(_input,options)=>{if(options?.method==='POST')posts++;return Response.json(status(3,3,{budget_paused:true}));};
 let resolve!:(phase:string)=>void;const observed=new Promise<string>(r=>{resolve=r});
 const stop=watchLibraryProcessing(owner,progress=>{if(progress.phase!=='checking')resolve(progress.phase);});
 try{assert.equal(await observed,'paused');assert.equal(posts,0);}finally{stop();}
});

test('saved-post reconciliation still runs locally while paid processing is budget-paused',{timeout:2000},async()=>{
 const owner='local-ready-reader';useStore.getState().activateAccount(owner);let posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;return Response.json({...status(0,0,{budget_paused:true,local_ready:0}),processed:1,finished:1});}
  return Response.json(status(1,1,{budget_paused:true,local_ready:1}));
 };
 let resolve!:()=>void;const finished=new Promise<void>(r=>{resolve=r});
 const stop=watchLibraryProcessing(owner,progress=>{if(progress.phase==='idle')resolve();});
 try{await finished;assert.equal(posts,1);}finally{stop();}
});

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('multiple library views share one loop and the last unmount cancels future polling',{timeout:2000},async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const owner='shared-reader';useStore.getState().activateAccount(owner);let remaining=1,posts=0,gets=0;
 globalThis.fetch=async(_input,options)=>{if(options?.method==='POST'){posts++;remaining=0;}else gets++;return Response.json({...status(remaining),...(options?.method==='POST'?{processed:1,finished:1}:{})});};
 const stopFirst=watchLibraryProcessing(owner,()=>{}),stopSecond=watchLibraryProcessing(owner,()=>{});
 try{
  await turn();assert.equal(posts,1);assert.equal(gets,1);
  stopFirst();remaining=1;t.mock.timers.tick(10_000);await turn();assert.equal(posts,2);assert.equal(gets,2);
  stopSecond();t.mock.timers.tick(60_000);await turn();assert.equal(posts,2);assert.equal(gets,2);
 }finally{stopFirst();stopSecond();}
});

test('leaving the library during an active batch never dispatches the next batch',{timeout:2000},async()=>{
 const owner='closing-reader';useStore.getState().activateAccount(owner);let posts=0,finishBatch!:(response:Response)=>void,signal:AbortSignal|null|undefined;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;signal=options.signal;return new Promise<Response>(resolve=>{finishBatch=resolve});}
  return Response.json(status(3));
 };
 const stop=watchLibraryProcessing(owner,()=>{});
 try{await turn();assert.equal(posts,1);stop();assert.equal(signal?.aborted,true);finishBatch(Response.json({...status(2),processed:1}));await turn();assert.equal(posts,1);}finally{stop();}
});

test('a late status response from a previous account cannot start paid work for the next account',{timeout:2000},async()=>{
 useStore.getState().activateAccount('previous-reader');let finish!:(response:Response)=>void,posts=0,updates=0;
 globalThis.fetch=async(_input,options)=>{if(options?.method==='POST')posts++;return new Promise<Response>(resolve=>{finish=resolve});};
 const stop=watchLibraryProcessing('previous-reader',()=>{updates++});
 try{await turn();useStore.getState().activateAccount('next-reader');finish(Response.json(status(3)));await turn();assert.equal(posts,0);assert.equal(updates,1);}finally{stop();}
});

test('transient network failures back off and resume automatically rather than abandoning the backlog',{timeout:2000},async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const owner='offline-reader';useStore.getState().activateAccount(owner);let gets=0,posts=0,failed=true;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;return Response.json({...status(0),processed:1,finished:1});}
  gets++;if(failed){failed=false;throw new TypeError('Fixture network unavailable');}return Response.json(status(1));
 };
 const phases:string[]=[];const stop=watchLibraryProcessing(owner,progress=>phases.push(progress.phase));
 try{
  await turn();assert.ok(phases.includes('error'));assert.equal(gets,1);
  t.mock.timers.tick(1999);await turn();assert.equal(gets,1);
  t.mock.timers.tick(1);await turn();assert.equal(posts,1);assert.ok(phases.includes('idle'));
 }finally{stop();}
});

test('retryable or externally running work is checked again even when no jobs are ready initially',{timeout:2000},async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const owner='retry-reader';useStore.getState().activateAccount(owner);let gets=0,posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;return Response.json({...status(0),processed:1,finished:1});}
  gets++;return Response.json(status(1,gets===1?0:1));
 };
 const stop=watchLibraryProcessing(owner,()=>{});
 try{await turn();assert.equal(posts,0);t.mock.timers.tick(10_000);await turn();assert.equal(posts,1);}finally{stop();}
});

test('an empty queue stays idle even when the deployment budget is paused',{timeout:2000},async()=>{
 useStore.getState().activateAccount('empty-reader');
 globalThis.fetch=async()=>Response.json(status(0,0,{budget_paused:true}));
 let resolve!:(phase:string)=>void;const observed=new Promise<string>(r=>{resolve=r});
 const stop=watchLibraryProcessing('empty-reader',progress=>{if(progress.phase!=='checking')resolve(progress.phase);});
 try{assert.equal(await observed,'idle');}finally{stop();}
});

test('a contended batch waits before trying again and a cleared budget resumes work',{timeout:2000},async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 useStore.getState().activateAccount('contention-reader');let paused=true,posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;return Response.json({...status(posts===1?1:0),processed:posts===1?0:1,finished:posts===1?0:1});}
  return Response.json(status(1,1,{budget_paused:paused}));
 };
 const stop=watchLibraryProcessing('contention-reader',()=>{});
 try{
  await turn();assert.equal(posts,0);paused=false;t.mock.timers.tick(10_000);await turn();assert.equal(posts,1);
  t.mock.timers.tick(999);await turn();assert.equal(posts,1);
  t.mock.timers.tick(1);await turn();assert.equal(posts,2);
 }finally{stop();}
});

test('live queue progress uses measured recent batches and stops estimating on completion',{timeout:2000},async(t)=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 useStore.getState().activateAccount('estimate-reader');let posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;now+=2000;return Response.json({...status(posts===3?0:20-posts*4),processed:4,finished:4});}
  return Response.json(status(20));
 };
 const updates:import('../lib/processing-client').LibraryProcessingProgress[]=[];
 let resolve!:()=>void;const finished=new Promise<void>(r=>{resolve=r});
 const stop=watchLibraryProcessing('estimate-reader',progress=>{updates.push(progress);if(progress.phase==='idle')resolve();});
 try{
  await finished;
  const running=updates.find(p=>p.phase==='processing'&&p.processedTasks===8)!;
  assert.ok(running);assert.equal(running.remainingTasks,12);assert.equal(running.progressPercent,40);assert.equal(running.estimatedSeconds,6);
  assert.equal(updates.find(p=>p.phase==='processing')!.estimatedSeconds,undefined);
  const last=updates.at(-1)!;assert.equal(last.processedTasks,12);assert.equal(last.progressPercent,100);assert.equal(last.estimatedSeconds,undefined);
 }finally{stop();}
});

test('continuations and retries do not inflate completed task counts or produce an unfounded estimate',{timeout:2000},async(t)=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 useStore.getState().activateAccount('continuation-reader');let posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;now+=1000;return Response.json({...status(posts===4?0:1),processed:1,finished:posts===4?1:0});}
  return Response.json(status(1));
 };
 const updates:import('../lib/processing-client').LibraryProcessingProgress[]=[];
 let resolve!:()=>void;const finished=new Promise<void>(r=>{resolve=r});
 const stop=watchLibraryProcessing('continuation-reader',progress=>{updates.push(progress);if(progress.phase==='idle')resolve();});
 try{
  await finished;
  for(const progress of updates.filter(p=>p.phase==='processing')){
   assert.equal(progress.processedTasks,0);assert.equal(progress.progressPercent,0);assert.equal(progress.estimatedSeconds,undefined);
  }
  assert.equal(updates.at(-1)!.processedTasks,1);
 }finally{stop();}
});

test('failed and blocked outcomes never count as successful progress or imply full completion',{timeout:2000},async()=>{
 useStore.getState().activateAccount('failed-progress-reader');let posts=0;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){posts++;return Response.json({...status(0,0,{attention:3,blocked:1}),processed:3,finished:3,succeeded:0,failed:2,blocked:1});}
  return Response.json(status(3));
 };
 let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r});
 const updates:import('../lib/processing-client').LibraryProcessingProgress[]=[];
 const stop=watchLibraryProcessing('failed-progress-reader',p=>{updates.push(p);if(p.phase==='idle'||p.phase==='paused')resolve();});
 try{await done;const last=updates.at(-1)!;assert.equal(posts,1);assert.equal(last.processedTasks,0);assert.equal(last.progressPercent,0);assert.equal(last.failedTasks,2);assert.equal(last.blockedTasks,1);}finally{stop();}
});
