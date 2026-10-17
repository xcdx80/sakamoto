"use client";

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchAuthorThread } from '@/lib/thread-client';
import { useStore } from '@/lib/store';
import type { AuthorThread, ThreadPost } from '@/lib/threads';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';

function PostLabel({ entry, current }: { entry: ThreadPost; current?: boolean }) {
  return <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
    <span className="font-medium text-ink">{entry.post.author.name} @{entry.post.author.handle}</span>
    <span>{entry.role === 'bookmark' ? 'Bookmarked' : 'Context only'}</span>
    {current && <span aria-current="true">Open post</span>}
    <Link href={entry.savedUrl} className="underline underline-offset-4">Saved post {entry.postId}</Link>
    <a href={entry.post.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Original</a>
  </div>;
}

/** Composition keeps the open post's reader/annotation surface intact; other posts retain their own links. */
export function ThreadReading({ itemId, sourceRevision = 1, enabled, children }: { itemId: string; sourceRevision?: number; enabled: boolean; children: ReactNode }) {
  const owner = useStore((s) => s.scope);
  const [loaded, setLoaded] = useState<{ itemId: string; owner: string | null; thread: AuthorThread | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !owner) return;
    const controller = new AbortController();
    fetchAuthorThread(itemId,controller.signal)
      .then((thread) => { if (!controller.signal.aborted) setLoaded({itemId,owner,thread}); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({itemId,owner,thread:null}); });
    return () => controller.abort();
  },[enabled,itemId,sourceRevision,owner,attempt]);
  if (!enabled) return children;
  const resolved = loaded?.itemId === itemId && loaded.owner === owner;
  const thread = resolved ? loaded.thread : null;
  const selected = thread?.posts.find((entry) => entry.itemId === itemId);
  const ready = Boolean(thread && selected && selected.sourceRevision === sourceRevision);
  return <ThreadContext itemId={itemId} thread={ready ? thread : null} status={!owner ? 'signed_out' : !resolved ? 'loading' : ready ? 'ready' : 'unavailable'} onRefresh={() => setAttempt(n => n + 1)}>{children}</ThreadContext>;
}

/** Current source stays first and mounted while optional context loads or refreshes. */
export function ThreadContext({ itemId, thread, status, onRefresh, children }: { itemId: string; thread: AuthorThread | null; status: 'ready' | 'loading' | 'unavailable' | 'signed_out'; onRefresh: () => void; children: ReactNode }) {
  const selected = thread?.posts.find(entry => entry.itemId === itemId);
  const hasContext = thread && (thread.posts.length > 1 || thread.context.length > 0 || thread.gaps.length > 0);
  const label = status === 'loading' ? 'Context loading…' : status === 'signed_out' ? 'Thread context · sign in' : status === 'unavailable' ? 'Context unavailable' : thread && thread.posts.length > 1 ? `Author thread · ${thread.posts.length} posts` : '1 saved post';
  return <>
    <div className="reader-thread-controls focus-hide">
      <Popover label="About author-thread context" tip="Saved thread context · details and refresh" align="left" width={280} triggerClass="reader-utility-pill" trigger={<><MessageSquare size={13} aria-hidden />{label}{selected && <span> · {selected.role === 'bookmark' ? 'Bookmarked' : 'Context only'}</span>}{Boolean(thread?.gaps.length) && <span className="text-rubric-text"> · {thread!.gaps.length} {thread!.gaps.length === 1 ? 'gap' : 'gaps'}</span>}{thread?.ordering === 'uncertain' && <span className="text-rubric-text"> · order uncertain</span>}</>}>
        {() => <div className="text-[13px] leading-relaxed text-ink-2">
          <p>Only supplied, connected posts are shown. This does not establish that the full thread or reply conversation was imported.</p>
          <p className="mt-2">{thread?.ordering === 'uncertain' ? 'Ordering is uncertain; displayed order is provisional.' : 'Posts are ordered by their supplied reply relationships.'} Open a saved post to highlight it or add a note.</p>
          {status === 'unavailable' && <p className="mt-2">Context is unavailable for this source. Your saved text remains readable.</p>}
          {status === 'signed_out' ? <p className="mt-2">Sign in to read available author-thread context.</p> : <button type="button" disabled={status === 'loading'} onClick={onRefresh} className="mt-3 underline underline-offset-4">Refresh context</button>}
        </div>}
      </Popover>
    </div>
    {children}
    {hasContext && <details aria-label="Author thread and context" className="reader-thread-details focus-hide">
      <summary>Author thread and context <ChevronDown size={14} aria-hidden /></summary>
      <div className="reader-thread-details-body">
      {thread.gaps.length > 0 && <ul aria-label="Thread gaps" className="mb-5 space-y-2 text-[13px] text-ink-3">
        {thread.gaps.map((gap,index)=><li key={index}>{gap.kind}{gap.postId ? ` · post ${gap.postId}` : ''}{gap.fromPostId ? ` · ${gap.relationship === 'quote' ? 'quoted by' : 'parent of'} ${gap.fromPostId}` : ''}: {gap.reason}{gap.savedUrl && <Link href={gap.savedUrl} className="ml-2 underline underline-offset-4">Open saved post</Link>}</li>)}
      </ul>}
    <ol className="space-y-10">
      {thread.posts.map((entry)=><li key={entry.postId} data-post-id={entry.postId} className="min-w-0 border-b border-rule pb-8">
        <PostLabel entry={entry} current={entry.itemId===itemId} />
        {entry.itemId===itemId ? <p className="text-[13px] text-ink-3">You’re reading this post above.</p> : <p className="whitespace-pre-wrap font-serif text-[19px] leading-relaxed text-ink">{entry.post.fullText}</p>}
      </li>)}
    </ol>
    {thread.context.length > 0 && <section aria-label="Parent and quoted context" className="mt-10 rounded-xl border border-rule p-5">
      <h3 className="mb-6 font-serif text-[21px]">Parent and quoted context</h3>
      <ul className="space-y-8">
        {thread.context.map((entry)=><li key={entry.postId}>
          <PostLabel entry={entry} />
          <p className="mb-3 text-[13px] text-ink-3">{entry.relationships.map((r)=>`${r.kind==='quote'?'Quoted by':'Parent of'} post ${r.fromPostId}`).join(' · ')}</p>
          <p className="whitespace-pre-wrap font-serif text-[18px] leading-relaxed text-ink">{entry.post.fullText}</p>
        </li>)}
      </ul>
    </section>}
      </div>
    </details>}
  </>;
}
