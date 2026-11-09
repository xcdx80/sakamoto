/// <reference types="next" />
import { BriefForm } from "../../components/write/WritingForms";
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionEditor } from '../../components/write/ProductionEditor';
import { createWriteClient } from '../../lib/post-production/client';
import { defaultProfile } from '../../lib/post-production/profile';
import type { ProductionDetail, WriteWorkspace } from '../../lib/post-production/types';

const client = createWriteClient('fixture-owner');
const workspace = {
  profile: defaultProfile(), productions: [], history: [], sources: [{ id: "library-fixture", title: "Saved fixture source" }],
  catalog: { frameworks: [], hooks: [] },
  providers: { ready: new URLSearchParams(window.location.hash.slice(1)).get('providers') !== 'unavailable', promptVersion: 'fixture-prompt' },
  publishing: { ready: false, platforms: [] },
} as unknown as WriteWorkspace;

function Harness() {
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { client.detail('fixture-production').then(setDetail).catch(error => setError(error.message)); }, []);

  async function action(label: string, work: () => Promise<ProductionDetail>) {
    setBusy(label); setError('');
    try { setDetail(await work()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Fixture action failed.'); }
    finally { setBusy(''); }
  }

  return <main>
    <p role="note">Synthetic fixture: actual Sakamoto editor, forms and HTTP client. Authentication, database and providers are not exercised.</p>
    {error && <p role="alert">{error}</p>}
    {detail ? <ProductionEditor key={detail.production.id} detail={detail} workspace={workspace} client={client} busy={busy}
      onAction={action} onProgress={setDetail} onProfile={() => {}} onDirty={() => {}} /> : <p>Loading fixture…</p>}
  </main>;
}

function CreationHarness() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  return <main><BriefForm profile={workspace.profile} sources={workspace.sources} sourceId={null} busy={busy} onSubmit={async brief => { setBusy(true); try { await client.create(brief); setResult('Brief submitted'); } finally { setBusy(false); } }} /><p role="status">{result}</p></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.hash.slice(1)).has('create') ? <CreationHarness /> : <Harness />);
