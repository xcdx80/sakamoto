"use client";

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchAuthorThread } from '@/lib/thread-client';
import { useStore } from '@/lib/store';
import type { AuthorThread, ThreadPost } from '@/lib/threads';

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
  },[enabled,itemId,owner,attempt]);
  if (!enabled) return children;
  const resolved = loaded?.itemId === itemId && loaded.owner === owner;
  const thread = resolved ? loaded.thread : null;
  const selected = thread?.posts.find((entry) => entry.itemId === itemId);
  if (!thread || !selected || selected.sourceRevision !== sourceRevision) return <>
    <p role="status" className="mb-6 text-[13px] text-ink-3">
      {!owner ? 'Sign in to read available author-thread context.' : !resolved ? 'Loading available author-thread context…' : 'Thread context is unavailable for this saved source. The post remains readable below.'}
      {owner && resolved && <button type="button" onClick={() => setAttempt((n)=>n+1)} className="ml-2 underline underline-offset-4">Retry context</button>}
    </p>
    {children}
  </>;
  return <section aria-label="Available author thread">
    <div className="mb-8 border-y border-rule py-5">
      <h2 className="font-serif text-[23px] text-ink">Available author thread</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">Only supplied, connected posts are shown. This view does not establish that the full thread or reply conversation was imported. Open each saved post to highlight it or add a note.</p>
      <p className="mt-2 text-[13px] text-ink-3">{thread.ordering === 'uncertain' ? 'Ordering is uncertain; displayed order is provisional.' : 'Posts are ordered by their supplied reply relationships.'}</p>
      <button type="button" onClick={() => setAttempt((n)=>n+1)} className="mt-3 text-[13px] underline underline-offset-4">Refresh context</button>
      {thread.gaps.length > 0 && <ul aria-label="Thread gaps" className="mt-4 space-y-2 text-[13px] text-ink-3">
        {thread.gaps.map((gap,index)=><li key={index}>{gap.kind}{gap.postId ? ` · post ${gap.postId}` : ''}{gap.fromPostId ? ` · ${gap.relationship === 'quote' ? 'quoted by' : 'parent of'} ${gap.fromPostId}` : ''}: {gap.reason}{gap.savedUrl && <Link href={gap.savedUrl} className="ml-2 underline underline-offset-4">Open saved post</Link>}</li>)}
      </ul>}
    </div>
    <ol className="space-y-10">
      {thread.posts.map((entry)=><li key={entry.postId} className="min-w-0 border-b border-rule pb-8">
        <PostLabel entry={entry} current={entry.itemId===itemId} />
        {entry.itemId===itemId ? children : <p className="whitespace-pre-wrap font-serif text-[19px] leading-relaxed text-ink">{entry.post.fullText}</p>}
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
  </section>;
}
