import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import type {Book} from '../lib/library';

// Only the browser geometry/events adapter is synthetic; the card tree and virtualizer are real.
const {window:browser,document}=parseHTML('<html><body><main><div id="root"></div></main></body></html>');
let y=0;
Object.defineProperties(browser,{innerWidth:{value:1100},innerHeight:{value:720},scrollY:{get:()=>y},scrollX:{value:0},scrollTo:{value:({top}:{top?:number})=>{const next=top??y;if(next===y)return;y=next;browser.dispatchEvent(new browser.Event('scroll'))}}});
class BrowserResizeObserver {
  constructor(private callback:ResizeObserverCallback){}
  observe(element:Element){queueMicrotask(()=>this.callback([{target:element,borderBoxSize:[{blockSize:240,inlineSize:1100}]}] as unknown as ResizeObserverEntry[],this as unknown as ResizeObserver))}
  unobserve(){} disconnect(){}
}
Object.defineProperties(globalThis,{self:{value:browser},navigator:{value:{userAgent:'test-browser'}},window:{value:browser},document:{value:document},ResizeObserver:{value:BrowserResizeObserver},getComputedStyle:{value:()=>({getPropertyValue:()=> '3'})}});
Object.defineProperty(browser,'ResizeObserver',{value:BrowserResizeObserver});
Object.defineProperty(browser.HTMLElement.prototype,'offsetHeight',{get(){return 240}});
browser.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:100-y,top:100-y,bottom:340-y,left:0,right:1100,width:1100,height:240,toJSON(){return {}}} as DOMRect};
const until=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('Window did not reach expected rows')};

test('scrolling a complete library loads distant rows and recycles earlier rows without reducing the searchable dataset',async()=>{
 const {createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {ContentCards}=await import('../components/library/ContentCards');
 const books:Book[]=Array.from({length:2166},(_,i)=>({id:'item-'+i,title:'Saved item '+i,author:'Example',topic:'tech',contentType:'post',minutes:2,tags:[],favorite:false,pct:0,highlights:0,added:i,agent:false,sample:false}));
 const root=createRoot(document.getElementById('root')!);
 const render=(rows:Book[])=>root.render(createElement(ContentCards,{books:rows,view:'list',fresh:new Set<string>(),onManage(){},onFavorite(){},onTag(){},selectedTag:null}));
 try{
  render(books);await until(()=>Boolean(document.querySelector('[aria-posinset="1"]')));
  assert(document.querySelectorAll('.content-card').length<40);
  const extent=()=>Number.parseFloat((document.querySelector('.content-window') as HTMLElement).style.height);
  browser.scrollTo({top:extent()/2});await until(()=>[...document.querySelectorAll('.content-card')].some(element=>Number(element.getAttribute('aria-posinset'))>1000));
  assert.equal(document.querySelector('[aria-posinset="1"]'),null);assert(document.querySelectorAll('.content-card').length<40);
  assert.equal(document.querySelector('.content-card')?.getAttribute('aria-setsize'),'2166');
  browser.scrollTo({top:extent()+100-720});await until(()=>Boolean(document.querySelector('[aria-posinset="2166"]')));
  assert(document.querySelectorAll('.content-card').length<40);
  const {filterBooks}=await import('../lib/library');const matches=filterBooks(books,{query:'Saved item 2147'});assert.equal(matches[0]?.id,'item-2147');
  browser.scrollTo({top:0});render(matches);await until(()=>Boolean(document.querySelector('a[href="/read/item-2147"]')));
  assert.equal(document.querySelectorAll('.content-card').length,1);
 }finally{root.unmount()}
});

test('the chosen library view survives opening a reader and mounting the library again',async()=>{
 const {createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {useLibraryPrefs,setLibraryPrefs}=await import('../lib/library-prefs');
 const View=()=>createElement('button',{onClick:()=>setLibraryPrefs({view:'list'})},useLibraryPrefs().view);
 const host=document.getElementById('root')!;let root=createRoot(host);
 try{
  root.render(createElement(View));await until(()=>Boolean(host.querySelector('button')));
  host.querySelector('button')!.dispatchEvent(new browser.Event('click',{bubbles:true}));await until(()=>host.textContent==='list');
  root.unmount();root=createRoot(host);root.render(createElement(View));await until(()=>host.textContent==='list');
 }finally{root.unmount()}
});

test('returning from a reader restores the measured row window rather than estimating a different position',async()=>{
 const {createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {ContentCards}=await import('../components/library/ContentCards');
 const books:Book[]=Array.from({length:2166},(_,i)=>({id:'return-'+i,title:'Saved item '+i,author:'Example',topic:'tech',contentType:'post',minutes:2,tags:[],favorite:false,pct:0,highlights:0,added:i,agent:false,sample:false}));
 const host=document.getElementById('root')!;let root=createRoot(host);browser.scrollTo({top:0});
 const render=()=>root.render(createElement(ContentCards,{books,view:'list',fresh:new Set<string>(),onManage(){},onFavorite(){},onTag(){},selectedTag:null}));
 const first=()=>Number(document.querySelector('.content-card')?.getAttribute('aria-posinset'));
 try{
  render();await until(()=>first()===1);browser.scrollTo({top:500000});await until(()=>first()>900);await new Promise(resolve=>setTimeout(resolve,20));
  const position=first();root.unmount();root=createRoot(host);render();await until(()=>Boolean(document.querySelector('.content-card')));await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(first(),position,'The same scroll offset must restore the same measured rows');
 }finally{root.unmount()}
});

test('a thread card presents its opening post while actions retain the bookmarked member',async()=>{
 const {createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {ContentCards}=await import('../components/library/ContentCards');const {toLibraryBooks}=await import('../lib/library');
 const library=[{id:'context',title:'The opening post',origin:'paste' as const,contentType:'post' as const,words:20,addedAt:1},{id:'bookmark',title:'Saved middle post',origin:'paste' as const,contentType:'post' as const,words:20,addedAt:2,favorite:true}];
 const books=toLibraryBooks({library,progress:{},highlights:{},hydrated:true,hiddenSamples:[],threads:{groups:[{rootId:'context',memberIds:['context','bookmark'],bookmarkIds:['bookmark']}],postItemIds:['context','bookmark']}}).filter(book=>!book.sample);
 const host=document.getElementById('root')!;const root=createRoot(host);const actions:string[]=[];
 try{
  root.render(createElement(ContentCards,{books,view:'list',fresh:new Set<string>(),onManage:book=>actions.push('manage:'+book.id),onFavorite:book=>actions.push('favorite:'+book.id),onTag(){},selectedTag:null}));
  await until(()=>Boolean(host.querySelector('a[href="/read/context"]')));
  assert.equal(host.querySelector('h2')?.textContent,'The opening post');
  host.querySelector('[aria-label="Unfavorite Saved middle post"]')!.dispatchEvent(new browser.Event('click',{bubbles:true}));
  host.querySelector('[aria-label="Manage Saved middle post"]')!.dispatchEvent(new browser.Event('click',{bubbles:true}));
  assert.deepEqual(actions,['favorite:bookmark','manage:bookmark']);
 }finally{root.unmount()}
});

test('an old cached thread graph cannot enable actions before or after a failed refresh',async()=>{
 const {createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {useLibraryThreads}=await import('../lib/library-threads-client');const {useStore}=await import('../lib/store');
 const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},configurable:true});
 const owner='old-thread-cache';
 localStorage.setItem('sakamoto:threads:v1:'+owner,JSON.stringify({libraryKey:'bookmark\ncontext',index:{groups:[{rootId:'context',memberIds:['context','bookmark']}],postItemIds:['context','bookmark']}}));
 useStore.getState().activateAccount(owner);useStore.setState({syncReady:true,library:[{id:'context',title:'Opening',origin:'paste',words:10,addedAt:1},{id:'bookmark',title:'Middle',origin:'paste',words:10,addedAt:1}]});
 let release!:(response:Response)=>void;const nativeFetch=globalThis.fetch;globalThis.fetch=()=>new Promise(resolve=>{release=resolve});
 const host=document.getElementById('root')!;const root=createRoot(host);let observed:ReturnType<typeof useLibraryThreads>;
 const Graph=()=>{observed=useLibraryThreads('');return createElement('span',null,observed.index?'actionable':observed.error||'waiting')};
 try{
  root.render(createElement(Graph));await until(()=>Boolean(release));
  assert.equal(observed!.index,undefined);assert.equal(host.textContent,'waiting');
  release(Response.json({error:'Offline'},{status:503}));await until(()=>Boolean(observed!.error));
  assert.equal(observed!.index,undefined);assert.notEqual(host.textContent,'actionable');
 }finally{root.unmount();globalThis.fetch=nativeFetch;useStore.getState().activateAccount(null)}
});
