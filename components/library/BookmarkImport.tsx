'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser, SignInButton } from '@clerk/nextjs';
import { ArrowLeft, Database, RefreshCw, Upload, CheckCircle2 } from 'lucide-react';
import { TopBar } from '@/components/ui/TopBar';
import { useStore } from '@/lib/store';
import { bookmarkImportStatus, connectX, disconnectX, inspectBirdclaw, importBirdclaw, runXSync, processImported, type BirdclawSelection, type Connection, type XRun } from '@/lib/bookmark-import-client';
import {receivedProcessing,type ProcessingStatus} from '@/lib/processing-client';
export function BookmarkImport(){
 const {isSignedIn,isLoaded}=useUser(),owner=useStore(s=>s.scope);
 const [connection,setConnection]=useState<Connection|null>(null),[run,setRun]=useState<XRun|null>(null),[archive,setArchive]=useState<BirdclawSelection|null>(null),[file,setFile]=useState<File|null>(null),[limit,setLimit]=useState(25),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[processing,setProcessing]=useState<ProcessingStatus|null>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{let current=true;setArchive(null);setFile(null);setConnection(null);setRun(null);setMessage('');setProcessing(null);setError('');
  if(owner)void bookmarkImportStatus().then(s=>{if(current){setConnection(s.connection);setRun(s.run);setProcessing(s.processing);}},e=>{if(current)setError(e.message);});
  return()=>{current=false;active.current?.abort();};
 },[owner]);
 useEffect(()=>{
  if(!owner)return;
  let current=true;
  const timer=setInterval(()=>{
   void receivedProcessing().then(status=>{if(current)setProcessing(status);},()=>{});
  },10_000);
  return()=>{current=false;clearInterval(timer);};
 },[owner]);
 const act=async(work:(signal:AbortSignal)=>Promise<void>)=>{const controller=new AbortController();active.current=controller;setBusy(true);setError('');try{await work(controller.signal);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not import bookmarks.');}finally{if(active.current===controller){active.current=null;setBusy(false);}}};
 const process=async(signal:AbortSignal)=>{setMessage('Processing saved material… Keep this page open.');const status=await processImported(status=>{if(!signal.aborted)setProcessing(status);},signal);if(!signal.aborted)setMessage(status.summary?.pending?'Ready work processed. Some jobs are waiting for a retry, provider configuration or another active step.':'All available processing has finished. Uncertain categories and failed imports remain visible in X sync status.');};
 const select=async(value:File,accountId?:string)=>act(async signal=>{setFile(value);setArchive(null);const result=await inspectBirdclaw(value,accountId);if(signal.aborted)return;setArchive(result);setMessage(result.accountId?`${result.posts.length.toLocaleString()} bookmarks ready to import. No X API calls.`:'Choose the Birdclaw account to import.');});
 return <div className="min-h-screen"><TopBar/><main className="bookmark-import mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-8">
  <Link href="/library" className="inline-flex items-center gap-2 text-sm text-ink-3"><ArrowLeft size={15}/> Your library</Link>
  <header className="mb-8 mt-7"><p className="content-eyebrow">Bring your bookmarks home</p><h1 className="mt-2 font-serif text-4xl">Import from X</h1><p className="mt-3 max-w-xl text-ink-3">Save posts once, then read, search and ask your library. Both methods use the same categories, search index and linked article pipeline.</p></header>
  {!isLoaded?<p>Loading your account…</p>:!isSignedIn?<div className="bookmark-import-panel"><p>Sign in to import into your private library.</p><SignInButton mode="modal"><button className="bookmark-import-primary mt-3">Sign in</button></SignInButton></div>:<>
   <section className="bookmark-import-panel" aria-labelledby="birdclaw-heading"><div className="flex items-center gap-3"><Database size={21}/><div><h2 id="birdclaw-heading" className="font-semibold">Import a Birdclaw database</h2><p className="mt-1 text-sm text-ink-3">Already synced? Import without using X API credits.</p></div></div>
    <p className="mt-4 text-sm text-ink-2">Choose a consistent SQLite snapshot from Birdclaw. The file stays on your device; only the selected account’s bookmarks and available parent/quote context are sent to Sakamoto.</p>
    <details className="mt-3 text-sm text-ink-3"><summary>Where to find the database</summary><p className="mt-2">Birdclaw stores it at <code>~/.birdclaw/birdclaw.sqlite</code>. On your Mac, create a current snapshot with the command below, then choose it. This also includes committed data still in the WAL file.</p><code className="my-3 block overflow-x-auto rounded-lg bg-sunk p-3 text-xs">sqlite3 -readonly ~/.birdclaw/birdclaw.sqlite ".backup ~/Downloads/birdclaw-import.sqlite"</code><p>Up to 128 MB and 20,000 bookmarks per snapshot. Other accounts, DMs and credentials are not imported. Stored long-post text may be incomplete.</p></details>
    <label className="mt-5 block text-sm font-medium">Birdclaw SQLite snapshot<input disabled={busy} type="file" accept=".sqlite,.sqlite3,.db" onChange={e=>{const f=e.target.files?.[0];if(f)void select(f);}} className="mt-2 block w-full rounded-xl border border-rule bg-bg-raised p-3 text-sm"/></label>
    {archive&&archive.accounts.length>1&&<label className="mt-4 block text-sm">Birdclaw account<select disabled={busy} value={archive.accountId??''} onChange={e=>{if(file&&e.target.value)void select(file,e.target.value);}} className="ml-3 rounded-lg border border-rule bg-bg-raised p-2"><option value="">Choose an account</option>{archive.accounts.map(a=><option key={a.id} value={a.id}>@{a.handle} · {a.count} bookmarks</option>)}</select></label>}
    <button disabled={busy||!archive?.posts.length} className="bookmark-import-primary mt-5" onClick={()=>void act(async signal=>{await importBirdclaw(archive!,setMessage,signal);if(!signal.aborted)await process(signal);})}><Upload size={16}/>{archive?.posts.length?`Import ${archive.posts.length.toLocaleString()} bookmarks`:'Import bookmarks'}</button>
    <p className="mt-3 text-xs text-ink-3">Interrupted? Select the same snapshot again to resume safely. Existing posts, your edits and deleted items are preserved.</p>
   </section>
   <section className="bookmark-import-panel mt-5" aria-labelledby="x-api-heading"><div className="flex items-center gap-3"><RefreshCw size={21}/><div><h2 id="x-api-heading" className="font-semibold">Sync directly with X</h2><p className="mt-1 text-sm text-ink-3">Fetch bookmarks inside Sakamoto. No Birdclaw or Grok required.</p></div></div>
    {connection?.connected?<p className="mt-4 flex items-center gap-2 text-sm"><CheckCircle2 size={16}/> Connected as @{connection.handle}<button disabled={busy} className="ml-auto underline" onClick={()=>void act(async()=>{setConnection(await disconnectX());})}>Disconnect</button></p>:<><p className="mt-4 text-sm text-ink-3">Connect your X account with read-only bookmark access. X API usage is billed separately from your Sakamoto AI budget.</p><button disabled={busy||!connection?.configured} className="bookmark-import-primary mt-4" onClick={()=>void act(async()=>{await connectX();})}>Connect X</button></>}
    {connection&&!connection.configured&&<details className="mt-3 text-sm text-ink-3"><summary>Server setup required</summary><p className="mt-2">Set X_CLIENT_ID and X_CREDENTIAL_ENCRYPTION_KEY from .env.example. Add X_CLIENT_SECRET for a confidential X app. Register this exact callback in your X developer app:</p><code className="mt-2 block break-all">{connection.callbackUrl}</code></details>}
    {connection?.connected&&<><label className="mt-5 flex flex-wrap items-center gap-3 text-sm">Total page request limit<input type="number" min={1} max={1000} value={limit} disabled={busy} onChange={e=>setLimit(Number(e.target.value))} className="w-24 rounded-lg border border-rule bg-bg-raised px-3 py-2"/></label><p className="mt-2 text-xs text-ink-3">Up to 90 bookmarks per page. Stops at this limit or the end of X’s available pages. Failed read attempts count toward the limit. This is a request limit, not a dollar cap.</p>
    <button className="bookmark-import-primary mt-4" disabled={busy||!Number.isInteger(limit)||limit<1||limit>1000} onClick={()=>void act(async signal=>{await runXSync(run&&run.state!=='exhausted'?'resume':'start',limit,value=>{if(!signal.aborted)setRun(value);},signal);if(!signal.aborted)await process(signal);})}>{run&&run.state!=='exhausted'?'Resume X sync':'Sync bookmarks'}</button>
    {run&&run.state!=='exhausted'&&<button className="bookmark-import-secondary ml-3 mt-4" disabled={busy} onClick={()=>void act(async signal=>{await runXSync('restart',limit,value=>{if(!signal.aborted)setRun(value);},signal);if(!signal.aborted)await process(signal);})}>Start fresh · replace checkpoint</button>}
    </>}
    {run&&<div className="mt-4 rounded-xl border border-rule bg-sunk p-3 text-sm" role="status"><p className="font-medium">{run.state==='exhausted'?'All currently available X pages fetched':run.state==='limited'?'Request limit reached':run.state==='blocked'?'Sync needs attention':'Sync checkpoint saved'}</p><p className="mt-1 text-ink-3">{run.received.toLocaleString()} bookmarks acknowledged · {run.pages} pages · {run.requests}/{run.requestLimit} page requests</p>{run.error&&<p className="mt-2">{run.error}</p>}{run.retryAt&&run.state==='blocked'&&<p className="mt-1">Retry after {new Date(run.retryAt).toLocaleString()}</p>}<p className="mt-2 text-xs text-ink-3">X pagination does not establish a complete historical archive or full author threads. Saved posts are kept if you later unbookmark them.</p></div>}
   </section>
   <section className="bookmark-import-panel mt-5" aria-labelledby="import-progress"><h2 id="import-progress" className="font-semibold">Categories, search and linked reading</h2><p className="mt-2 text-sm text-ink-3">Processing runs in parallel batches. Keep this page open to advance work through the browser, or run Sakamoto’s background worker on the server. Each step is saved before the next one starts. Closing this page pauses browser-triggered steps; an active background worker continues independently. Processing uses your existing AI budget.</p>
    <div className="mt-4 flex flex-wrap gap-3"><button className="bookmark-import-secondary" disabled={busy} onClick={()=>void act(process)}>Process saved material</button>{busy&&<button className="bookmark-import-secondary" onClick={()=>{active.current?.abort();setMessage('Stopping after the current step. Saved work and checkpoints are retained.');}}>Pause after this step</button>}<Link href="/library" className="bookmark-import-secondary">Read your library →</Link></div>
    {processing?.worker?.active&&<p className="mt-4 text-sm font-medium">Background worker active · you can close this page.</p>}
    {processing?.summary&&<p className="mt-4 text-sm">{processing.summary.complete.toLocaleString()} jobs complete · {processing.summary.pending.toLocaleString()} waiting · {processing.summary.attention.toLocaleString()} need attention</p>}
    {message&&<p role="status" className="mt-4 text-sm">{message}</p>}{error&&<p role="alert" className="mt-4 text-sm text-red">{error}</p>}
   </section>
  </>}
 </main></div>;
}
