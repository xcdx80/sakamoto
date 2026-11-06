import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
const original = 'A small evaluation exposed missing source attribution.';
const revised = 'A bounded evaluation revealed a source attribution gap.';
function ready(platforms = ['x','linkedin'], number = 1): any {
  const id = 'fixture-revision-' + number;
  return { production: { id:'fixture-production', version:number * 5, brief:{ idea:'Concrete author attribution lesson',notes:original,audience:'Engineers',goal:'trust',pillar:'engineering',platforms,delivery:'single',sourceIds:[]},
    status:'ready',stage:'complete',checkpoint:{profile:{version:0},evidence:[{id:'AUTHOR_NOTE',itemId:'',sourceRevision:0,title:'Author note',excerpt:original,kind:'author_note'}],reviewPin:{reviewPromptVersion:'fixture-prompt'}},latestRevisionId:id,approvedRevisionId:null,plannedAt:null,notice:null,createdAt:'2026-11-06T12:00:00Z',updatedAt:'2026-11-06T12:00:00Z'},
    revisions:[{id,productionId:'fixture-production',number,origin:'writer',createdAt:'2026-11-06T12:00:00Z',content:{ variants:platforms.map(platform=>({platform,delivery:platform==='x'?'single':'long',posts:[original]})),hooks:[],claimSources:[{claim:original,evidenceIds:['AUTHOR_NOTE']}] }}],
    review:{ revisionId:id,status:'passed',issues:[],criteria:[],writerModel:'fixture-writer',reviewerModel:'fixture-reviewer'},feedback:[] };
}
test('removing a previously selected platform keeps the remaining editor editable', async ({app,screen,browser}) => {
  let current = ready();
  await browser.route('**/api/write**', async route => {
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body = JSON.parse(route.request.postData!);
    if(body.action==='update_brief') { current=ready(body.brief.platforms,2); current.production.brief=body.brief; current.production.stage='context';current.production.status='draft';current.production.latestRevisionId=null;current.review=null; }
    else if(body.action==='advance') current=ready(current.production.brief.platforms,2);
    else throw new Error('Unexpected fixture action ' + body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await screen.getByRole('button',{name:'Revise brief & sources'}).click();
  await screen.getByRole('checkbox',{name:/LinkedIn/}).uncheck();
  await screen.getByRole('button',{name:'Save revised brief'}).click();
  await expect(screen.getByRole('button',{name:'Save & review edits'})).toBeVisible();
  await screen.getByLabel('X post',{exact:true}).fill('The remaining X adaptation accepts my edit.');
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue('The remaining X adaptation accepts my edit.');
});
test('unsaved manual edits disable dependent actions and saved author wording requires new approval', async ({app,screen,browser}) => {
  let current=ready(['x']); let save: any;
  current.production.status='approved';current.production.approvedRevisionId=current.production.latestRevisionId;
  await browser.route('**/api/write**', async route => {
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!);
    if(body.action==='save') {
      save=body;
      const prior=current.revisions[0]; current=ready(['x'],2);
      current.revisions[0].origin='author';current.revisions[0].content={...body.content,claimSources:[]};
      current.revisions.unshift(prior);current.production.status='review';current.production.stage='review';current.review=null;
    }
    if(body.action==='advance') {current.production.status='ready';current.production.stage='complete';current.review={revisionId:current.production.latestRevisionId,status:'passed',issues:[],criteria:[],writerModel:'author',reviewerModel:'fixture-reviewer'};}
    if(!['save','advance'].includes(body.action)) throw new Error('Unexpected fixture action ' + body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByLabel(/Plan a publication time/).fill('2030-01-01T09:00');
  await expect(screen.getByRole('button',{name:'Add to calendar'})).toBeEnabled();
  await expect(screen.getByRole('button',{name:'Revise brief & sources'})).toBeEnabled();
  await screen.getByLabel('X post',{exact:true}).fill(revised);
  await expect(screen.getByRole('button',{name:'Add to calendar'})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Revise brief & sources'})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Approve revision 1'})).toBeDisabled();
  await expect(screen.getByLabel(/What would you like to change/)).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Save & review edits'})).toBeEnabled();
  await screen.getByRole('button',{name:'Save & review edits'}).click();
  await expect.poll(()=>save?.content.variants[0].posts[0]).toBe(revised);
  // HTTP responses are fixtures: actual citation repair is covered by the backend integration suite.
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue(revised);
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Approve revision 2'})).toBeEnabled();
  await expect(screen.getByText('This revision has your approval.')).not.toBeVisible();
});

test('earlier revisions remain readable when a revised brief cannot generate a replacement', async ({app,screen,browser}) => {
  let current = ready(['x']);
  await browser.route('**/api/write**', async route => {
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!);
    if(body.action==='update_brief') {
      current=structuredClone(current); current.production.brief=body.brief; current.production.version++;
      current.production.latestRevisionId=null; current.production.status='draft'; current.production.stage='context'; current.review=null;
    } else if(body.action==='advance') {
      current.production.version++; current.production.status='needs_input';current.production.notice='Add concrete author notes before continuing.';
    } else throw new Error('Unexpected fixture action ' + body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Revise brief & sources'}).click();
  await screen.getByRole('button',{name:'Save revised brief'}).click();
  await expect(screen.getByText('Add concrete author notes before continuing.')).toBeVisible();
  await expect(screen.getByText(/Revision history/)).toBeVisible();
  await screen.getByText(/Revision history/).click();
  await screen.getByText(/Revision 1 · First draft/).click();
  await expect(browser.locator('pre')).toContainText(original);
  await expect(screen.getByRole('button',{name:'Approve revision 1'})).not.toBeVisible();
});

test('Sources shows the current reviewed mapping and labels dirty writer hints unverified', async ({app,screen,browser}) => {
  const current = ready(['x']);
  current.production.checkpoint.evidence = [
    {id:'WEB1',itemId:'',sourceRevision:0,kind:'web_source',title:'Official memory release',excerpt:original},
    {id:'WEB3',itemId:'',sourceRevision:0,kind:'web_source',title:'Different API release',excerpt:'A different API feature was released.'},
    {id:'AUTHOR_IDEA',itemId:'',sourceRevision:0,kind:'author_idea',title:'Author topic',excerpt:'A proposed evaluation method.'},
  ];
  current.revisions[0].content.claimSources=[{claim:original,evidenceIds:['WEB3']}];
  current.review.criteria=[{id:'grounded-in-sources',score:5,reason:'The official release directly establishes the exact author finding.',support:[{claim:original,evidenceId:'WEB1',quote:original,reason:'This source explicitly documents the same source attribution finding.',claimKind:'fact'}]}];
  await browser.route('**/api/write**', async route => {
    if(route.request.method!=='GET') throw new Error('This source projection test must not change saved data.');
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('tab',{name:'Sources'}).click();
  await expect(screen.getByText('Your topic')).toBeVisible();
  await expect(screen.getByText('Verified claim sources')).toBeVisible();
  await screen.getByText('Verified claim sources').click();
  await expect(browser.locator('.write-claim-sources')).toContainText('Official memory release');
  await expect(browser.locator('.write-claim-sources')).not.toContainText('Different API release');
  await screen.getByLabel('X post',{exact:true}).fill(revised);
  await expect(screen.getByText('Draft source hints · not verified')).toBeVisible();
  await expect(screen.getByText('Verified claim sources')).not.toBeVisible();
  await expect(browser.locator('.write-claim-sources')).toContainText('Different API release');
});

test('legacy pins outside the recent source list remain removable despite search filters', async ({app,screen,browser}) => {
  const pins=Array.from({length:20},(_,index)=>`legacy-${index+1}`);
  let current=ready(['x']);current.production.brief.sourceIds=[...pins];let saved: any;
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!);
    if(body.action==='update_brief') {saved=body;current=ready(['x'],2);current.production.brief=body.brief;}
    else if(body.action!=='advance') throw new Error('Unexpected fixture action '+body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Revise brief & sources'}).click();
  await screen.getByText(/Supporting notes & pinned sources/).click();
  await expect(screen.getByRole('button',{name:'Save revised brief'})).toBeDisabled();
  await screen.getByLabel('Find a saved source').fill('does-not-match-any-selected-source');
  await expect(screen.getByRole('checkbox',{name:'Pin source legacy-20: Previously selected source [legacy-20]'})).toBeVisible();
  await expect(browser.locator('.write-source-options input[type="checkbox"]')).toHaveCount(20);
  for(const id of pins.slice(13)) await screen.getByRole('checkbox',{name:`Pin source ${id}: Previously selected source [${id}]`}).uncheck();
  await expect(screen.getByRole('button',{name:'Save revised brief'})).toBeEnabled();
  await screen.getByRole('button',{name:'Save revised brief'}).click();
  await expect.poll(()=>saved?.brief.sourceIds).toEqual(pins.slice(0,13));
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Revise brief & sources'})).toBeEnabled();
  // A single unavailable pin also has an explicit removal control.
  current.production.brief.sourceIds=[pins[0]];saved=undefined;
  await browser.reload();
  await screen.getByRole('button',{name:'Revise brief & sources'}).click();
  await screen.getByText(/Supporting notes & pinned sources/).click();
  await screen.getByRole('checkbox',{name:`Pin source ${pins[0]}: Previously selected source [${pins[0]}]`}).uncheck();
  await screen.getByRole('button',{name:'Save revised brief'}).click();
  await expect.poll(()=>saved?.brief.sourceIds).toEqual([]);
});
