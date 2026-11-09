/// <reference types="next" />
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BriefForm } from '../../components/write/WritingForms';
import { ProductionEditor } from '../../components/write/ProductionEditor';
import { PostCalendar } from '../../components/write/PostCalendar';
import { PostsOverview } from '../../components/write/PostsOverview';
import { WritingLink } from '../../components/write/WritingLink';
import { createWriteClient } from '../../lib/post-production/client';
import { defaultProfile } from '../../lib/post-production/profile';
import '../../app/write/write.css';
import './fixture-theme.css';
import type { ProductionDetail, WriteWorkspace } from '../../lib/post-production/types';


const client = createWriteClient('fixture-owner');
const workspace = {
  xProfile: { connected: true, author: { name: "Connected X Author", handle: "connected_x", imageUrl: "https://pbs.twimg.com/profile_images/777/avatar.jpg" }, fetchedAt: "2026-11-09T09:00:00Z" },
  profile: defaultProfile(), productions: [], history: [],
  sources: [{ id: 'library-fixture', title: 'Saved evaluation notes', kind: 'article', author: 'Fixture author' }],
  // Minimal presentation fixtures use IDs, names, compatible hooks and templates
  // from the actual catalogue. Selection and providers remain HTTP fixtures.
  catalog: {
    frameworks: [
      { id: 'single-paragraph-insight', name: 'Single-paragraph insight', summary: 'One thought-provoking paragraph on a core topic.', hookPatternIds: ['parallel-best'] },
      { id: 'story-lesson', name: 'Story to lesson', summary: 'A short personal (or sourced) story with a turning point, followed by the lesson it taught.', hookPatternIds: ['story-cold-open'] },
    ],
    hooks: [
      { id: 'parallel-best', name: "Parallel 'the best X is'", description: "Repeated sentence frame that reframes 'best' choices as simple ones.", template: 'The best {X} is the one {plain truth}. The best {Y} is {plain truth}.' },
      { id: 'story-cold-open', name: 'Story cold open', description: 'Start inside a moment, with concrete detail.', template: 'At {age}, I was {specific situation}. I thought {belief}.' },
    ],
  },
  providers: { ready: new URLSearchParams(window.location.hash.slice(1)).get('providers') !== 'unavailable', promptVersion: 'fixture-prompt' },
  publishing: { ready: false, platforms: [] },
} as unknown as WriteWorkspace;

function Harness() {
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [xProfile, setXProfile] = useState(workspace.xProfile);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { client.detail(new URLSearchParams(location.search).get('post') || 'fixture-production').then(setDetail).catch(error => setError(error.message)); }, []);

  async function action(label: string, work: () => Promise<ProductionDetail>) {
    setBusy(label); setError('');
    try { setDetail(await work()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Fixture action failed.'); }
    finally { setBusy(''); }
  }

  return <main className="write-page write-shell">
    <WritingLink href="/calendar" writingState={{dirty,busy:Boolean(busy)}}>Calendar</WritingLink>
    <p role="note">Synthetic fixture: actual Sakamoto editor, forms and HTTP client. Authentication, database and providers are not exercised.</p>
    {error && <p role="alert">{error}</p>}
    {detail ? <ProductionEditor key={detail.production.id} detail={detail} workspace={{...workspace,xProfile}} client={client} busy={busy} author={{name:"Clerk Author",imageUrl:"https://images.example/clerk.png"}} onXProfile={setXProfile}
      onAction={action} onProgress={setDetail} onProfile={() => {}} onDirty={setDirty} /> : <p>Loading fixture…</p>}
  </main>;
}

function CalendarHarness() {
  const [value, setValue] = useState<WriteWorkspace | null>(null);
  useEffect(() => { client.workspace().then(setValue); }, []);
  return <main className="write-page write-shell">{value ? <PostCalendar productions={value.productions} now={new Date('2026-11-08T12:00:00Z')} timeZone={new URLSearchParams(location.hash.slice(1)).get('zone') || 'Europe/Lisbon'} /> : <p>Loading calendar…</p>}</main>;
}
function OverviewHarness() {
  const [value, setValue] = useState<WriteWorkspace | null>(null);
  useEffect(() => { client.workspace().then(setValue); }, []);
  return <main className="write-page write-shell">{value ? <PostsOverview posts={value.productions} ideas={null} busy={false} onStart={() => {}} onOpen={id => location.assign(`/write?post=${encodeURIComponent(id)}`)} onSuggest={() => {}} onDismissIdeas={() => {}} /> : <p>Loading posts…</p>}</main>;
}
function CreationHarness() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  return <main className="write-page write-shell"><BriefForm profile={workspace.profile} sources={workspace.sources} sourceId={null} busy={busy} onSubmit={async brief => { setBusy(true); try { await client.create(brief); setResult('Brief submitted'); } finally { setBusy(false); } }} /><p role="status">{result}</p></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.hash.slice(1)).has('create') ? <CreationHarness /> : location.pathname === '/calendar' ? <CalendarHarness /> : location.pathname === '/write' && !location.search ? <OverviewHarness /> : <Harness />);
