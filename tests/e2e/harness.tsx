import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionEditor } from '../../components/write/ProductionEditor';
import { createWriteClient } from '../../lib/post-production/client';
import { defaultProfile } from '../../lib/post-production/profile';
import type { ProductionDetail, WriteWorkspace } from '../../lib/post-production/types';

const client = createWriteClient('fixture-owner');
const workspace = {
  profile: defaultProfile(), productions: [], history: [], sources: [],
  catalog: { frameworks: [], hooks: [] },
  providers: { ready: true, promptVersion: 'fixture-prompt' },
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

createRoot(document.getElementById('root')!).render(<Harness />);
