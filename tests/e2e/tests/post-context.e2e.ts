import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
const imported = { id: 'research', title: 'Imported research', text: 'Exact imported findings', kind: 'analysis', provenance: { label: 'Research assistant', author: 'Original author', url: 'https://example.com/source' } };
function ready(): any {
  return { production: { id: 'fixture-production', version: 5, brief: { idea: 'A sourced topic', notes: '', audience: 'Engineers', goal: 'trust', pillar: 'engineering', platforms: ['x'], delivery: 'single', sourceIds: ['library-fixture'], agentContext: [imported] }, status: 'ready', stage: 'complete', checkpoint: { evidence: [], reviewPin: { reviewPromptVersion: 'fixture-prompt' } }, latestRevisionId: 'revision', approvedRevisionId: null, plannedAt: null }, revisions: [{ id: 'revision', number: 1, origin: 'writer', content: { variants: [{ platform: 'x', delivery: 'single', posts: ['Saved wording stays intact.'] }], hooks: [], claimSources: [] } }], review: { revisionId: 'revision', status: 'passed', criteria: [], issues: [] }, feedback: [] };
}
test('pasted creation context and independent source switches reach the brief HTTP request', async ({ app, screen, browser }) => {
  let submitted: any;
  await browser.route('**/api/write**', route => { submitted = JSON.parse(route.request.postData!); return route.fulfill({ json: ready() }); });
  await app.open('/#create');
  const library = screen.getByRole('checkbox', { name: /^Library\s*Search saved/ });
  const web = screen.getByRole('checkbox', { name: /^Web search\s*Find supporting/ });
  await expect(library).toBeChecked(); await expect(web).toBeChecked();
  await screen.getByLabel(/^What do you want to post about/).fill('A source-grounded engineering lesson');
  await screen.getByLabel(/^Paste supporting material/).fill('First finding.\nSecond finding with a source excerpt.');
  await screen.getByText(/^Supporting notes & pinned sources/).click();
  const pin = screen.getByRole('checkbox', { name: /Pin source library-fixture:/ });
  await pin.check(); await expect(pin).toBeChecked();
  await library.uncheck(); await expect(pin).not.toBeChecked(); await expect(pin).toBeDisabled(); await expect(web).toBeChecked();
  await library.check(); await expect(pin).not.toBeChecked(); await library.uncheck();
  await web.uncheck(); await expect(screen.getByText(/^Context only:/)).toBeVisible();
  await screen.getByRole('button', { name: 'Generate draft', exact: true }).click();
  await expect.poll(() => submitted?.brief.sourcePolicy).toEqual({ library: false, web: false });
  await expect.poll(() => submitted?.brief.sourceIds).toEqual([]);
  await expect.poll(() => submitted?.brief.agentContext).toEqual([{ id: 'pasted-context', title: 'Pasted context', text: 'First finding.\nSecond finding with a source excerpt.', kind: 'reference', provenance: { label: 'Pasted by the author' } }]);
  await expect(screen.getByRole('status')).toContainText('Brief submitted');
});
test('regeneration preserves imported context across close reopen reset and repeated generation', async ({ app, screen, browser }) => {
  let current = ready(); const submitted: any[] = [];
  await browser.route('**/api/write**', route => {
    if (route.request.method !== 'GET') {
      const body = JSON.parse(route.request.postData!);
      if (body.action === 'regenerate') { submitted.push(body.parameters); current = structuredClone(current); current.production.brief = body.parameters.brief; current.production.version++; current.production.checkpoint.generationParameters = body.parameters; }
      else if (body.action !== 'advance') throw Error('Unexpected mutation: ' + body.action);
    }
    return route.fulfill({ json: current });
  });
  await app.open('/'); await screen.getByRole('button', { name: 'Brief', exact: true }).click();
  const pasted = screen.getByLabel(/^Paste supporting material/);
  await pasted.fill('Unsaved temporary research');
  await screen.getByRole('button', { name: 'Hide draft context', exact: true }).click();
  await screen.getByRole('button', { name: 'Brief', exact: true }).click();
  await expect(pasted).toHaveValue('Unsaved temporary research');
  await screen.getByRole('button', { name: 'Reset settings', exact: true }).click(); await expect(pasted).toHaveValue('');
  await pasted.fill('Added reference material');
  await screen.getByRole('checkbox', { name: /^Library\s*Search saved/ }).uncheck();
  await screen.getByRole('checkbox', { name: /^Web search\s*Find supporting/ }).uncheck();
  await screen.getByRole('button', { name: 'Generate new version', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  await expect.poll(() => submitted[0]?.brief.agentContext[0]).toEqual(imported);
  await expect.poll(() => submitted[0]?.brief.agentContext[1].text).toBe('Added reference material');
  await expect.poll(() => submitted[0]?.brief.sourcePolicy).toEqual({ library: false, web: false });
  await expect.poll(() => submitted[0]?.brief.sourceIds).toEqual([]);
  await screen.getByRole('button', { name: 'Brief', exact: true }).click(); await expect(pasted).toHaveValue('Added reference material');
  await pasted.fill('Updated reference material'); await screen.getByRole('button', { name: 'Generate new version', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(2); await expect.poll(() => submitted[1]?.brief.agentContext.length).toBe(2);
  await expect.poll(() => submitted[1]?.brief.agentContext[0]).toEqual(imported);
  await expect.poll(() => submitted[1]?.brief.agentContext[1].text).toBe('Updated reference material');
});

test('research status distinguishes disabled searches from selected source reuse', async ({ app, screen, browser }) => {
  let current = ready();
  current.production.brief.sourcePolicy = { library: false, web: false };
  current.production.checkpoint.research = { library: 'disabled', web: 'disabled', notice: null };
  await browser.route('**/api/write**', route => route.fulfill({ json: current }));
  await app.open('/');
  await expect(browser.locator('.write-research-status')).toContainText('Library research is off. Web research is off.');
  current.production.checkpoint.research = { library: 'selected', web: 'selected', notice: null };
  await app.open('/');
  await expect(browser.locator('.write-research-status')).toContainText('Selected library sources retained. Selected web sources retained.');
});
