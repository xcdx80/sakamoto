'use client';
import {useEffect,useMemo,useState} from 'react';
import {accountEpoch} from './account-scope';
import {useStore} from './store';
import type {LibraryThreadIndex} from './library-threads';
import {readLibraryCache,saveLibraryCache,threadCacheKey} from './library-cache';
/** Account-bound graph and debounced full-post search. Late responses never cross accounts. */
export function useLibraryThreads(query:string){
 const owner=useStore(s=>s.scope??null),library=useStore(s=>s.library),syncReady=useStore(s=>s.syncReady);
 const libraryKey=useMemo(()=>library.map(item=>item.id).sort().join('\n'),[library]);
 const [attempt,setAttempt]=useState(0);
 const [state,setState]=useState<{owner:string|null;index?:LibraryThreadIndex;libraryKey?:string;error:string}>({owner:null,error:''});
 const [search,setSearch]=useState<{owner:string|null;query:string;ids?:string[];error:string}>({owner:null,query:'',error:''});
 const text=query.trim();
 useEffect(()=>{
  if(!owner||!syncReady)return;
  const controller=new AbortController(),epoch=accountEpoch();
  void fetch('/api/library-threads',{headers:{'X-Sakamoto-Owner':owner},cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Saved threads could not be loaded.');const index=await response.json() as LibraryThreadIndex;
   if(!controller.signal.aborted&&epoch===accountEpoch()&&useStore.getState().scope===owner){setState({owner,index,libraryKey,error:''});void saveLibraryCache([{key:threadCacheKey(owner),value:{libraryKey,index}}]);}
  }).catch(e=>{if(!controller.signal.aborted&&epoch===accountEpoch())setState(previous=>previous.owner===owner?{...previous,error:e.message}:{owner,libraryKey,error:e.message});});
  return()=>controller.abort();
 },[owner,library,libraryKey,syncReady,attempt]);
 useEffect(()=>{
  if(!owner||!text||!syncReady)return;
  const controller=new AbortController(),epoch=accountEpoch();
  const timer=setTimeout(()=>{
   void fetch('/api/library-threads',{method:'POST',headers:{'content-type':'application/json','X-Sakamoto-Owner':owner},body:JSON.stringify({query:text}),cache:'no-store',signal:controller.signal}).then(async response=>{
    if(!response.ok)throw Error('Full post search is unavailable.');const result=await response.json() as {matchedItemIds:string[]};
    if(!controller.signal.aborted&&epoch===accountEpoch()&&useStore.getState().scope===owner)setSearch({owner,query:text,ids:result.matchedItemIds,error:''});
   }).catch(e=>{if(!controller.signal.aborted&&epoch===accountEpoch())setSearch({owner,query:text,error:e.message});});
  },250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[owner,text,library,syncReady,attempt]);
 const matches=useMemo(()=>search.ids?new Set(search.ids):undefined,[search.ids]);
 const current=Boolean(owner&&search.owner===owner&&search.query===text);
 const cached=owner?readLibraryCache<{libraryKey:string;index:LibraryThreadIndex}>(threadCacheKey(owner)):undefined;
 const index=owner&&state.owner===owner&&state.libraryKey===libraryKey?state.index:cached?.libraryKey===libraryKey?cached.index:undefined;
 return {index,loading:Boolean(owner&&!index),error:owner&&state.owner===owner?state.error:'',matchedItemIds:current?matches:undefined,searching:Boolean(owner&&text&&(!current||(!search.ids&&!search.error))),searchError:current?search.error:'',refresh:()=>setAttempt(n=>n+1)};
}
