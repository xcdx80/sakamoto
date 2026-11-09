import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {useStore} from '../lib/store';
import {runXSync} from '../lib/bookmark-import-client';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;useStore.getState().activateAccount(null);});
test('a direct bookmark sync automatically hydrates threads using only its remaining API read allowance',async()=>{
 useStore.getState().activateAccount('thread-client-reader');const actions:any[]=[];
 const run={id:'bookmarks',state:'exhausted',requests:2,requestLimit:5,received:10};
 globalThis.fetch=async(input,options)=>{
  const body=options?.body?JSON.parse(String(options.body)):undefined;actions.push({url:String(input),body});
  if(String(input).includes('kind=threads'))return Response.json({threadRun:null});
  if(body?.action==='threads:start')return Response.json({threadRun:{id:'threads',state:'active',requests:0,requestLimit:3,total:1,processed:0}});
  if(body?.action==='threads:step')return Response.json({threadRun:{id:'threads',state:'exhausted',requests:1,requestLimit:3,total:1,processed:1}});
  return Response.json({run});
 };
 await runXSync('start',5,()=>{},new AbortController().signal);
 assert.deepEqual(actions.filter(a=>a.body).map(a=>a.body.action),['start','threads:start','threads:step']);
 assert.equal(actions.find(a=>a.body?.action==='threads:start').body.maxRequests,3);
});

test('exhausting bookmark reads still records a resumable thread phase without silently buying more reads',async()=>{
 useStore.getState().activateAccount('no-spare-thread-reader');const bodies:any[]=[];
 globalThis.fetch=async(input,options)=>{
  const body=options?.body?JSON.parse(String(options.body)):undefined;if(body)bodies.push(body);
  if(String(input).includes('kind=threads'))return Response.json({threadRun:null});
  if(body?.action==='threads:start')return Response.json({threadRun:{id:'limited-threads',state:'limited',requests:0,requestLimit:0,total:1,processed:0}});
  return Response.json({run:{id:'bookmarks',state:'exhausted',requests:1,requestLimit:1}});
 };
 await runXSync('start',1,()=>{},new AbortController().signal);
 assert.deepEqual(bodies.map(b=>b.action),['start','threads:start']);assert.equal(bodies[1].maxRequests,0);
});

test('leaving after bookmark receipt does not start the automatic thread stage',async()=>{
 useStore.getState().activateAccount('leaving-thread-reader');const controller=new AbortController();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({run:{id:'bookmarks',state:'exhausted',requests:1,requestLimit:5}});};
 await runXSync('start',5,()=>controller.abort(),controller.signal);assert.equal(calls,1);
});

test('a retained thread pass is resumed before checking newly imported anchors once without replaying its partial observations',async()=>{
 useStore.getState().activateAccount('retained-thread-client');const bodies:any[]=[];
 globalThis.fetch=async(input,options)=>{
  const body=options?.body?JSON.parse(String(options.body)):undefined;if(body)bodies.push(body);
  if(String(input).includes('kind=threads'))return Response.json({threadRun:{id:'old-threads',state:'limited',requests:1,total:1,processed:0}});
  if(body?.action==='threads:resume')return Response.json({threadRun:{id:'old-threads',state:'active',requests:1,total:1,processed:0}});
  if(body?.action==='threads:step')return Response.json({threadRun:{id:'old-threads',state:'partial',requests:3,total:1,processed:1}});
  if(body?.action==='threads:start')return Response.json({threadRun:{id:'new-threads',state:'exhausted',requests:0,total:0,processed:0}});
  return Response.json({run:{id:'bookmarks',state:'exhausted',requests:2,requestLimit:6}});
 };
 await runXSync('start',6,()=>{},new AbortController().signal);
 assert.deepEqual(bodies.map(b=>b.action),['start','threads:resume','threads:step','threads:start']);assert.equal(bodies[1].maxRequests,5);assert.equal(bodies[3].maxRequests,2);assert.equal(bodies[3].afterRunId,'old-threads');
});
