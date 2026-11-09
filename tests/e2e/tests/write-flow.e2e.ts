import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
const original = 'A small evaluation exposed missing source attribution.';
const revised = 'A bounded evaluation revealed a source attribution gap.';
test('saved adaptations open in native feed previews and the context sidebar collapses without changing the draft', async ({app,screen,browser}) => {
  const current = ready();
  await browser.route('**/api/write**', route => route.fulfill({json:current}));
  await app.open('/');
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toBeVisible();
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await expect(screen.getByRole('region',{name:'LinkedIn feed preview',exact:true})).toBeVisible();
  await expect(screen.getByRole('heading',{name:/^Research & citations/})).toBeVisible();
  await screen.getByRole('button',{name:'Review',exact:true}).click();
  await expect(screen.getByRole('heading',{name:/^Issues/})).toBeVisible();
  await screen.getByRole('button',{name:'Sources',exact:true}).click();
  await screen.getByRole('button',{name:'Hide draft context',exact:true}).click();
  await expect(screen.getByRole('heading',{name:/^Research & citations/})).not.toBeVisible();
  await screen.getByRole('button',{name:'Show draft context',exact:true}).click();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByLabel('LinkedIn post',{exact:true})).toHaveValue(original);
});
function ready(platforms = ['x','linkedin'], number = 1): any {
  const id = 'fixture-revision-' + number;
  return { production: { id:'fixture-production', version:number * 5, brief:{ idea:'Concrete author attribution lesson',notes:original,audience:'Engineers',goal:'trust',pillar:'engineering',platforms,delivery:'single',sourceIds:[]},
    status:'ready',stage:'complete',checkpoint:{profile:{version:0},evidence:[{id:'AUTHOR_NOTE',itemId:'',sourceRevision:0,title:'Author note',excerpt:original,kind:'author_note'}],reviewPin:{reviewPromptVersion:'fixture-prompt'}},latestRevisionId:id,approvedRevisionId:null,plannedAt:null,notice:null,createdAt:'2026-11-06T12:00:00Z',updatedAt:'2026-11-06T12:00:00Z'},
    revisions:[{id,productionId:'fixture-production',number,origin:'writer',createdAt:'2026-11-06T12:00:00Z',content:{ variants:platforms.map(platform=>({platform,delivery:platform==='x'?'single':'long',posts:[original]})),hooks:[],claimSources:[{claim:original,evidenceIds:['AUTHOR_NOTE']}] }}],
    review:{ revisionId:id,status:'passed',issues:[],criteria:[],writerModel:'fixture-writer',reviewerModel:'fixture-reviewer'},feedback:[] };
}
test('an author can write, save and copy a first draft while generation is unavailable without approving it', async ({app,screen,browser}) => {
  let current = ready(['x']); let saved: any;
  await browser.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
    writeText: async (text: string) => { sessionStorage.setItem('fixture-copied-draft', text); },
  } }));
  current.production.latestRevisionId = null;
  current.production.status = 'needs_input'; current.production.stage = 'context';
  current.production.checkpoint = {}; current.revisions = []; current.review = null;
  await browser.route('**/api/write**', async route => {
    if (route.request.method === 'GET') return route.fulfill({json:current});
    const body = JSON.parse(route.request.postData!);
    if (body.action !== 'save') throw new Error('Unavailable generation must not advance or approve a manual draft.');
    saved = body;
    current = ready(['x']); current.production.checkpoint = {};
    current.revisions[0].origin = 'author'; current.revisions[0].content = body.content;
    current.production.status = 'draft'; current.production.stage = 'review'; current.review = null;
    await route.fulfill({json:current});
  });
  await app.open('/#providers=unavailable');
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue('');
  await expect(screen.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();
  await screen.getByLabel('X post',{exact:true}).fill(revised);
  await screen.getByRole('button',{name:'Copy X',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
  await expect(await browser.evaluate(() => sessionStorage.getItem('fixture-copied-draft'))).toBe(revised);
  await screen.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect.poll(()=>saved?.content.variants[0].posts[0]).toBe(revised);
  await expect(screen.getByText('Revision 1 · saved')).toBeVisible();
  await expect(screen.getByRole('alert')).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Save draft',exact:true})).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Continue review',exact:true})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeDisabled();
  await browser.reload();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue(revised);
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeDisabled();
});
test('a failed first generation leaves manual authoring available after busy controls unlock', async ({app,screen,browser}) => {
  let current = ready(['x']); let saved: any;
  current.production.latestRevisionId = null; current.production.stage = 'context'; current.production.status = 'draft';
  current.production.checkpoint = {}; current.revisions = []; current.review = null;
  let finishGeneration!: () => void;
  const generating = new Promise<void>(resolve => { finishGeneration = resolve; });
  await browser.route('**/api/write**', async route => {
    if (route.request.method === 'GET') return route.fulfill({json:current});
    const body = JSON.parse(route.request.postData!);
    if (body.action === 'advance') {
      if (!saved) await generating;
      current.production.status = 'needs_input'; current.production.version++;
      current.production.notice = 'Add concrete author notes before continuing.';
    } else if (body.action === 'save') {
      saved = body; current = ready(['x']); current.production.checkpoint = {};
      current.revisions[0].origin = 'author'; current.revisions[0].content = body.content;
      current.production.status = 'review'; current.production.stage = 'review'; current.review = null;
    } else throw new Error('A failed generation must not approve the manual revision.');
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Continue to draft',exact:true}).click();
  await expect(screen.getByLabel('X post',{exact:true})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Save & review edits',exact:true})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Copy X',exact:true})).toBeEnabled();
  finishGeneration();
  await expect(screen.getByText('Add concrete author notes before continuing.')).toBeVisible();
  await expect(screen.getByLabel('X post',{exact:true})).toBeEnabled();
  await screen.getByLabel('X post',{exact:true}).fill(revised);
  await screen.getByRole('button',{name:'Save & review edits',exact:true}).click();
  await expect.poll(()=>saved?.content.variants[0].posts[0]).toBe(revised);
  await expect(screen.getByText('Revision 1 · saved')).toBeVisible();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue(revised);
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeDisabled();
});
test('removing a previously selected platform keeps the remaining editor editable', async ({app,screen,browser}) => {
  let current = ready();
  await browser.route('**/api/write**', async route => {
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body = JSON.parse(route.request.postData!);
    if(body.action==='regenerate') { current=ready(body.parameters.brief.platforms,2); current.production.brief=body.parameters.brief; current.production.stage='context';current.production.status='draft';current.production.latestRevisionId=null;current.review=null; }
    else if(body.action==='advance') current=ready(current.production.brief.platforms,2);
    else throw new Error('Unexpected fixture action ' + body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByRole('checkbox',{name:/LinkedIn/}).uncheck();
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
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
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeEnabled();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await screen.getByLabel('X post',{exact:true}).fill(revised);
  await expect(screen.getByRole('button',{name:'Add to calendar'})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeDisabled();
  await screen.getByRole('button',{name:'Hide draft context',exact:true}).press('Escape');
  await expect(screen.getByRole('button',{name:'Approve revision 1'})).toBeDisabled();
  await screen.getByText('Request changes',{exact:true}).click();
  await expect(screen.getByLabel(/What would you like to change/)).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Save & review edits'})).toBeEnabled();
  await screen.getByRole('button',{name:'Save & review edits'}).click();
  await expect.poll(()=>save?.content.variants[0].posts[0]).toBe(revised);
  // HTTP responses are fixtures: actual citation repair is covered by the backend integration suite.
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByLabel('X post',{exact:true})).toHaveValue(revised);
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Approve revision 2'})).toBeEnabled();
  await expect(screen.getByText('This revision has your approval.')).not.toBeVisible();
});

test('earlier revisions remain readable while a revised brief is pending and when replacement generation fails', async ({app,screen,browser}) => {
  let current = ready(['x']);
  let finishGeneration!: () => void;
  const generating = new Promise<void>(resolve => { finishGeneration = resolve; });
  const requests: string[] = [];
  await browser.route('**/api/write**', async route => {
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!); requests.push(body.action);
    if(body.action==='regenerate') {
      current=structuredClone(current);
      current.revisions[0].generationContext={...current.production.checkpoint,brief:current.production.brief};
      current.production.brief=body.parameters.brief; current.production.version++;
      current.production.checkpoint={pendingGeneration:true,generationParameters:body.parameters};
      current.production.status='working'; current.production.stage='context'; current.review=null;
    } else if(body.action==='advance') {
      await generating;
      current.production.version++; current.production.status='needs_input';current.production.notice='Add concrete author notes before continuing.';
    } else throw new Error('Unexpected fixture action ' + body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByLabel('Post topic',{exact:true}).fill('A changed direction for a new version');
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  await expect.poll(()=>requests).toEqual(['regenerate','advance']);
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  await expect(screen.getByText('Revision 1 · saved')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).not.toBeVisible();
  finishGeneration();
  await expect(screen.getByText('Add concrete author notes before continuing.')).toBeVisible();
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await expect(screen.getByLabel('View version',{exact:true})).toHaveValue('fixture-revision-1');
  await screen.getByLabel('View version',{exact:true}).press('Escape');
  await expect(screen.getByRole('button',{name:'Approve revision 1'})).toBeDisabled();
  await expect.poll(()=>requests).toEqual(['regenerate','advance']);
});

test('Sources shows independently reviewed Library and Web passages and dirty writer hints stay pending', async ({app,screen,browser}) => {
  const current = ready(['x']);
  current.production.checkpoint.evidence = [
    {id:'WEB1',itemId:'',sourceRevision:0,kind:'web_source',title:'Official memory release',excerpt:original,originalUrl:'https://docs.example.org/memory-release'},
    {id:'LIB1',itemId:'library-fixture',sourceRevision:2,kind:'saved_source',title:'Saved evaluation notes',excerpt:original,readUrl:'/read/library-fixture',originalUrl:'https://research.example.org/evaluation'},
    {id:'WEB3',itemId:'',sourceRevision:0,kind:'web_source',title:'Different API release',excerpt:'A different API feature was released.'},
    {id:'AUTHOR_IDEA',itemId:'',sourceRevision:0,kind:'author_idea',title:'Author topic',excerpt:'A proposed evaluation method.'},
  ];
  current.revisions[0].content.claimSources=[{claim:original,evidenceIds:['WEB3']}];
  current.review.issues=[{code:'voice-suggestion',severity:'suggestion',message:'Consider a more direct opening.',platform:'x',postIndex:0}];
  current.review.criteria=[{id:'grounded-in-sources',score:5,reason:'The two passages establish this exact attribution finding.',support:['WEB1','LIB1'].map(evidenceId=>({claim:original,evidenceId,quote:original,reason:'The source directly documents this attribution finding.',claimKind:'fact'}))}];
  await browser.route('**/api/write**', async route => {
    if(route.request.method!=='GET') throw new Error('This source projection test must not change saved data.');
    await route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('heading',{name:/^Research & citations/})).toBeVisible();
  await expect(screen.getByText('Verified citations connect exact source passages to this revision. Other research below was supplied as context.')).toBeVisible();
  await expect(browser.locator('.draft-context-source[data-status="verified"]')).toHaveCount(2);
  await expect(browser.locator('.draft-context-source[data-status="verified"]')).toContainText(['Saved evaluation notes','Official memory release']);
  await expect(browser.locator('.draft-context-source[data-status="verified"] blockquote')).toHaveText([original,original]);
  await expect(screen.getByRole('link',{name:'Read in library',exact:true})).toHaveAttribute('href','/read/library-fixture');
  await expect(screen.getByRole('link',{name:'Open source',exact:true})).toHaveAttribute('href','https://docs.example.org/memory-release');
  await expect(screen.getByText('Your topic',{exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  // Keep the mapped claim in edited wording: its writer hint must remain
  // visible as pending, never inherit the saved review's verified status.
  await screen.getByLabel('X post',{exact:true}).fill(original+'\n\n'+revised);
  await expect(screen.getByText('These resources were supplied to the writer. Citations for this wording await independent review.')).toBeVisible();
  await expect(screen.getByText('Pending review · writer source hint')).toBeVisible();
  await expect(browser.locator('.draft-context-source[data-status="pending"]')).toHaveCount(1);
  await expect(browser.locator('.draft-context-source[data-status="pending"]')).toContainText('Different API release');
  await expect(screen.getByText('Verified citations connect exact source passages to this revision. Other research below was supplied as context.')).not.toBeVisible();
  await screen.getByRole('button',{name:'Review',exact:true}).click();
  await expect(screen.getByText('Your edits are pending review. Save and review this wording to update its issues and sources.')).toBeVisible();
  await expect(screen.getByText('Consider a more direct opening.')).not.toBeVisible();
});

test('legacy pins outside the recent source list remain removable despite search filters', async ({app,screen,browser}) => {
  const pins=Array.from({length:20},(_,index)=>`legacy-${index+1}`);
  let current=ready(['x']);current.production.brief.sourceIds=[...pins];let saved: any;
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!);
    if(body.action==='regenerate') {saved=body;current=ready(['x'],2);current.production.brief=body.parameters.brief;}
    else if(body.action!=='advance') throw new Error('Unexpected fixture action '+body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByText(/Pinned library sources/).click();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeDisabled();
  await screen.getByLabel('Find a library source').fill('does-not-match-any-selected-source');
  await expect(screen.getByRole('checkbox',{name:/legacy-20/})).toBeVisible();
  await expect(browser.locator('.write-pinned-sources input[type="checkbox"]')).toHaveCount(20);
  for(const id of pins.slice(13)) await screen.getByRole('checkbox',{name:new RegExp('\\['+id+'\\]$')}).uncheck();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeEnabled();
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  await expect.poll(()=>saved?.parameters.brief.sourceIds).toEqual(pins.slice(0,13));
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).not.toBeVisible();
  // A single unavailable pin also has an explicit removal control.
  current.production.brief.sourceIds=[pins[0]];saved=undefined;
  await browser.reload();
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByText(/Pinned library sources/).click();
  await screen.getByRole('checkbox',{name:/legacy-1\]$/}).uncheck();
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  await expect.poll(()=>saved?.parameters.brief.sourceIds).toEqual([]);
});

// The real UI and HTTP client cross this seam; all server responses are synthetic.
test('Brief and Decisions send exact next-version settings while preserving saved wording until replacement', async ({app,screen,browser}) => {
  let current=ready(); let generated: any;
  current.production.checkpoint.evidence=[{id:'WEB1',kind:'web_source',itemId:'',sourceRevision:0,title:'Official memory release',excerpt:original}];
  const old=structuredClone(current.revisions[0]);
  let finishGeneration!: () => void;
  const generating=new Promise<void>(resolve=>{finishGeneration=resolve;});
  const actions:string[]=[];
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData!);actions.push(body.action);
    if(body.action==='regenerate') {
      generated=body;current=structuredClone(current);current.production.version++;
      current.production.brief=body.parameters.brief;current.production.status='working';current.production.stage='context';
      current.production.checkpoint={pendingGeneration:true,generationParameters:body.parameters};current.review=null;
    } else if(body.action==='advance') {
      await generating;current=ready(['x'],2);current.production.brief=generated.parameters.brief;
      current.production.checkpoint.generationParameters=generated.parameters;
      current.revisions[0].content.variants=[{platform:'x',delivery:'thread',posts:[revised,'The next step is to test the attribution boundary.']}];
      current.revisions.push(old);
    } else throw new Error('Only explicit regeneration may run: '+body.action);
    await route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByLabel('Post topic',{exact:true}).fill('An evaluation we can reproduce');
  await screen.getByLabel('Audience',{exact:true}).fill('Staff engineers');
  await screen.getByLabel('Purpose',{exact:true}).selectOption({value:'reach'});
  await screen.getByLabel('Content pillar',{exact:true}).selectOption({value:'education'});
  await screen.getByLabel('X delivery',{exact:true}).selectOption({value:'thread'});
  await screen.getByRole('checkbox',{name:'LinkedIn',exact:true}).uncheck();
  await screen.getByLabel('Supporting notes',{exact:true}).fill('Use a bounded public evaluation.');
  await screen.getByText(/Pinned library sources/).click();
  await screen.getByRole('checkbox',{name:/Saved evaluation notes/}).check();
  await screen.getByRole('button',{name:'Decisions',exact:true}).click();
  await expect(screen.getByLabel(/^Hook for next version/)).toBeDisabled();
  await screen.getByLabel('Framework for next version').selectOption({value:'story-lesson'});
  await screen.getByLabel(/^Hook for next version/).selectOption({value:'story-cold-open'});
  await screen.getByLabel('Research for next version').selectOption({value:'selected'});
  await screen.getByRole('checkbox',{name:/Official memory release/}).check();
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  await expect.poll(()=>actions).toEqual([]);
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  await expect.poll(()=>generated).toEqual({action:'regenerate',id:'fixture-production',expectedVersion:5,parameters:{
    brief:{idea:'An evaluation we can reproduce',audience:'Staff engineers',goal:'reach',pillar:'education',platforms:['x'],delivery:'thread',notes:'Use a bounded public evaluation.',sourceIds:['library-fixture']},
    frameworkId:'story-lesson',hookPatternId:'story-cold-open',sourceMode:'selected',evidenceIds:['WEB1'],
  }});
  await expect.poll(()=>actions).toEqual(['regenerate','advance']);
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  finishGeneration();
  await expect(screen.getByText('Revision 2 · saved')).toBeVisible();
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(revised);
  await expect(screen.getByRole('article',{name:'X post 2 of 2',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByLabel('View version',{exact:true}).selectOption({value:old.id});
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-label') ?? null)).toBe('Post tools');
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  await expect.poll(()=>actions).toEqual(['regenerate','advance']);
});

test('version selection and comparison retain each context without borrowing current sources for legacy history', async ({app,screen,browser}) => {
  const current=ready(['x'],3);
  const old=ready(['x'],2).revisions[0];old.content.variants[0].posts=[revised];
  const legacy=ready(['x'],1).revisions[0];legacy.content.variants[0].posts=['Legacy wording retained without source context.'];
  const latest=current.revisions[0];latest.content.variants[0].posts=['Current wording with its own documented sources.'];
  const snapshot=(revision:any,title:string,frameworkId:string,hookPatternId:string)=>({
    brief:{...current.production.brief,idea:title},frameworkId,hookPatternId,
    evidence:[{id:'SOURCE-'+revision.number,itemId:'',sourceRevision:0,kind:'web_source',title:title+' source',excerpt:revision.content.variants[0].posts[0],originalUrl:'https://example.org/version-'+revision.number}],
    editorialDecision:{framework:{selectedId:frameworkId,reason:title+' framework rationale.',support:[]},hook:{selectedId:hookPatternId,reason:title+' opening rationale.'}},
  });
  latest.generationContext=snapshot(latest,'Current version','single-paragraph-insight','parallel-best');
  old.generationContext=snapshot(old,'Earlier version','story-lesson','story-cold-open');
  for(const revision of [latest,old]) revision.review={revisionId:revision.id,status:'passed',issues:[],criteria:[{id:'grounded-in-sources',score:5,reason:'Fixture source matches this exact version.',support:[{claim:revision.content.variants[0].posts[0],quote:revision.content.variants[0].posts[0],evidenceId:'SOURCE-'+revision.number,reason:'Exact matching recorded passage.',claimKind:'fact'}]}]};
  current.revisions=[legacy,old,latest];current.review=latest.review;
  current.production.checkpoint.evidence=latest.generationContext.evidence;
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') throw new Error('Version inspection must remain read-only.');
    return route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('heading',{name:'Current version source',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByLabel('View version',{exact:true}).selectOption({value:old.id});
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-label') ?? null)).toBe('Post tools');
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(revised);
  await expect(screen.getByRole('heading',{name:'Earlier version source',exact:true})).toBeVisible();
  await expect(screen.getByRole('heading',{name:'Current version source',exact:true})).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Edit post',exact:true})).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Approve revision 3'})).not.toBeVisible();
  await screen.getByRole('button',{name:'Decisions',exact:true}).click();
  await expect(screen.getByText('Earlier version framework rationale.',{exact:true})).toBeVisible();
  await expect(screen.getByText('At {age}, I was {specific situation}. I thought {belief}.',{exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByRole('button',{name:'Compare versions',exact:true}).click();
  await screen.getByLabel('Compare with version',{exact:true}).selectOption({value:latest.id});
  await expect(screen.getByRole('region',{name:'Version comparison',exact:true})).toBeVisible();
  await expect(screen.getByRole('region',{name:'Version 2',exact:true})).toContainText(revised);
  await expect(screen.getByRole('region',{name:'Version 3',exact:true})).toContainText('Current wording with its own documented sources.');
  await expect(browser.locator('.write-version-comparison textarea')).toHaveCount(0);
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByRole('button',{name:'Close comparison',exact:true}).click();
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByLabel('View version',{exact:true}).selectOption({value:legacy.id});
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText('Legacy wording retained without source context.');
  await expect(screen.getByText('Settings and sources were not recorded for this older version. Its wording is retained.')).toBeVisible();
  await screen.getByRole('button',{name:'Sources',exact:true}).click();
  await expect(screen.getByText('Source context for this revision was not recorded.')).toBeVisible();
  await expect(screen.getByRole('heading',{name:'Current version source',exact:true})).not.toBeVisible();
  await expect(screen.getByRole('heading',{name:'Earlier version source',exact:true})).not.toBeVisible();
  await screen.getByRole('button',{name:'Return to current version',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'Current version source',exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Edit post',exact:true})).toBeEnabled();
});

test('long native previews clamp and expand at feed widths while preserving literal text and newlines', async ({app,screen,browser}) => {
  const current=ready();
  const text=Array.from({length:15},(_,index)=>`Line ${index+1}: a concrete evaluation observation.`).join('\n')+'\n<strong>Literal markup stays text.</strong>';
  current.revisions[0].content.variants.forEach((variant:any)=>{variant.delivery='long';variant.posts=[text];});
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') throw new Error('Expanding a preview must not mutate saved data.');
    return route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('button',{name:'Show more',exact:true})).toHaveAttribute('aria-expanded','false');
  const x=await browser.evaluate(()=>{
    const body=document.querySelector<HTMLElement>('.platform-preview-x .platform-preview-text')!;
    const feed=document.querySelector<HTMLElement>('.platform-preview-x .platform-preview-feed')!;
    return {text:body.textContent,fontSize:getComputedStyle(body).fontSize,lineHeight:getComputedStyle(body).lineHeight,height:body.clientHeight,background:getComputedStyle(feed).backgroundColor};
  });
  await expect(x).toEqual({text,fontSize:'15px',lineHeight:'20px',height:200,background:'rgb(255, 255, 255)'});
  await expect(browser.locator('.platform-preview-text strong')).toHaveCount(0);
  await screen.getByRole('button',{name:'Show more',exact:true}).click();
  await expect(screen.getByRole('button',{name:'See less',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(await browser.evaluate(()=>document.querySelector<HTMLElement>('.platform-preview-x .platform-preview-text')!.clientHeight)).toBeGreaterThan(200);
  await screen.getByRole('button',{name:'See less',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Show more',exact:true})).toHaveAttribute('aria-expanded','false');
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await expect(screen.getByRole('button',{name:'…see more',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(await browser.evaluate(()=>{
    const body=document.querySelector<HTMLElement>('.platform-preview-linkedin .platform-preview-text')!;
    return {text:body.textContent,fontSize:getComputedStyle(body).fontSize,lineHeight:getComputedStyle(body).lineHeight,height:body.clientHeight};
  })).toEqual({text,fontSize:'14px',lineHeight:'20px',height:60});
  await screen.getByRole('button',{name:'…see more',exact:true}).click();
  await expect(screen.getByRole('button',{name:'See less',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(browser.locator('.platform-preview-text strong')).toHaveCount(0);
});

test('parameter-only edits offer a local settings reset and summarize the next generation choices truthfully', async ({app,screen,browser}) => {
  const current=ready(['x']);
  current.production.checkpoint.frameworkId='single-paragraph-insight';
  current.production.checkpoint.hookPatternId='parallel-best';
  const mutations:string[]=[];
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') {
      mutations.push(route.request.postData || '');
      throw new Error('Editing and resetting generation settings must not mutate saved data.');
    }
    return route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeEnabled();
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByLabel('Audience',{exact:true}).fill('A different audience for the next version');
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Save & review edits',exact:true})).not.toBeVisible();
  await expect(screen.getByText(/Generate a new version or reset your settings/)).toBeVisible();
  await expect(screen.getByText('Save your direct edits before requesting another version.')).not.toBeVisible();
  await expect(screen.getByText('Save your changes to start an independent review before approving it.')).not.toBeVisible();
  await screen.getByRole('button',{name:'Reset settings',exact:true}).click();
  await expect(screen.getByLabel('Audience',{exact:true})).toHaveValue('Engineers');
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeEnabled();
  await expect(screen.getByRole('button',{name:'Save & review edits',exact:true})).not.toBeVisible();
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toContainText(original);
  await expect.poll(()=>mutations).toEqual([]);
  await screen.getByRole('button',{name:'Decisions',exact:true}).click();
  await screen.getByLabel('Framework for next version').selectOption({value:'story-lesson'});
  await screen.getByLabel(/^Hook for next version/).selectOption({value:'story-cold-open'});
  await expect(browser.locator('.write-control-summary')).toContainText('Story to lesson');
  await expect(browser.locator('.write-control-summary')).toContainText('Story cold open');
  await expect.poll(()=>mutations).toEqual([]);
});

test('calendar navigation keeps unsaved post edits when cancelled and leaves only after confirmation', async ({app,screen,browser}) => {
  const current=ready(['linkedin']);
  await browser.route('**/api/write**',route=>route.fulfill({json:new URL(route.request.url).searchParams.has('productionId') ? current : {productions:[]}}));
  await app.open('/');
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await screen.getByLabel('LinkedIn post',{exact:true}).fill(revised);
  const messages:string[]=[];
  const off=await browser.onDialog(async dialog=>{messages.push(dialog.message);await dialog.dismiss();});
  await screen.getByRole('link',{name:'Calendar',exact:true}).click();
  await expect(screen.getByLabel('LinkedIn post',{exact:true})).toHaveValue(revised);
  await expect(messages[0]).toBe('Leave this draft without saving your edits?');
  await off();
  await browser.onDialog('accept');
  await screen.getByRole('link',{name:'Calendar',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'November 2026',exact:true})).toBeVisible();
});

test('calendar navigation stays blocked during active generation and becomes available when work finishes', async ({app,screen,browser}) => {
  const current=ready(['linkedin']); let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='POST' && JSON.parse(route.request.postData!).action==='regenerate')await pending;
    return route.fulfill({json:new URL(route.request.url).searchParams.has('productionId') || route.request.method==='POST' ? current : {productions:[]}});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByRole('button',{name:'Generate new version',exact:true}).click();
  try {
    await expect(screen.getByRole('link',{name:'Calendar',exact:true})).toHaveAttribute('aria-disabled','true');
    await screen.getByRole('link',{name:'Calendar',exact:true}).press('Enter');
    await expect(screen.getByRole('region',{name:'LinkedIn feed preview',exact:true})).toBeVisible();
  } finally {release();}
  await expect(screen.getByRole('link',{name:'Calendar',exact:true})).not.toHaveAttribute('aria-disabled','true');
  await screen.getByRole('link',{name:'Calendar',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'November 2026',exact:true})).toBeVisible();
});

test('saved choices populate the next-version controls and close-ranking audits explain their concrete fit', async ({app,screen,browser}) => {
  const current=ready(['linkedin']);
  current.production.brief.idea='A short lesson about review boundaries. '+('Supporting instructions. '.repeat(22));
  current.production.checkpoint.frameworkId='single-paragraph-insight';current.production.checkpoint.hookPatternId='parallel-best';
  current.production.checkpoint.signals=[{signal:'one_clear_insight',strength:2,evidenceIds:['AUTHOR_NOTE'],rationale:'The author describes one concrete source-attribution lesson.'}];
  current.production.checkpoint.recommendations=[{frameworkId:'single-paragraph-insight',name:'Single-paragraph insight',reasons:['one_clear_insight (2 × 3) supported by AUTHOR_NOTE.'],outline:['Insight'],hookPatternIds:['parallel-best'],score:15}];
  current.production.checkpoint.editorialDecision={framework:{selectedId:'single-paragraph-insight',mode:'editorial_tiebreak',reason:"Jev's relative preference was uncertain.",support:[]},hook:{selectedId:'parallel-best',mode:'editorial_tiebreak',reason:"Jev's relative preference was uncertain.",support:[]}};
  await browser.route('**/api/write**',route=>route.fulfill({json:current}));
  await app.open('/');
  await expect(screen.getByRole('heading',{name:'A short lesson about review boundaries.',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Decisions',exact:true}).click();
  await expect(screen.getByLabel('Framework for next version',{exact:true})).toHaveValue('single-paragraph-insight');
  await expect(screen.getByLabel('Hook for next version',{exact:false})).toHaveValue('parallel-best');
  await expect(screen.getByText('The author describes one concrete source-attribution lesson.',{exact:true})).toBeVisible();
  await expect(screen.getByText("Jev's relative preference was uncertain.",{exact:true})).not.toBeVisible();
});

test('brief and decisions disclosures expose their state and animate content without losing local settings', async ({app,screen,browser}) => {
  await browser.route('**/api/write**',route=>route.fulfill({json:ready(['linkedin'])}));
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Brief',exact:true})).toHaveAttribute('aria-expanded','true');
  await screen.getByLabel('Audience',{exact:true}).fill('A retained audience');
  await screen.getByRole('button',{name:'Decisions',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Brief',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(screen.getByRole('button',{name:'Decisions',exact:true})).toHaveAttribute('aria-expanded','true');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByLabel('Audience',{exact:true})).toHaveValue('A retained audience');
});



test('X preview uses the connected X identity and explicitly refreshes without generating or changing the draft', async ({app,screen,browser}) => {
  await browser.route('https://pbs.twimg.com/profile_images/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="gray"/></svg>'}));
  const current=ready(['x','linkedin']);const actions:string[]=[];
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='GET') return route.fulfill({json:current});
    const body=JSON.parse(route.request.postData || '{}');actions.push(body.action);
    if(body.action!=='x_profile') throw new Error('Profile refresh must not run generation or mutate the post');
    return route.fulfill({json:{connected:true,author:{name:'Refreshed X Name',handle:'real_handle',imageUrl:'https://pbs.twimg.com/profile_images/888/avatar.jpg'},fetchedAt:'2026-11-09T10:00:00Z',refreshAllowedAt:'2099-01-01T00:00:00Z'}});
  });
  await app.open('/');
  const x=screen.getByRole('region',{name:'X feed preview',exact:true});
  await expect(x).toContainText('Connected X Author');await expect(x).toContainText('@connected_x');
  await expect(x).not.toContainText('Clerk Author');
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByRole('button',{name:'Refresh X profile',exact:true}).click();
  await expect(x).toContainText('Refreshed X Name');await expect(x).toContainText('@real_handle');
  await expect(browser.locator('.platform-preview-avatar img')).toHaveAttribute('src','https://pbs.twimg.com/profile_images/888/avatar.jpg');
  await expect(screen.getByRole('button',{name:'Refresh X profile',exact:true})).toBeDisabled();
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await expect(screen.getByRole('region',{name:'LinkedIn feed preview',exact:true})).toContainText('Clerk Author');
  await expect.poll(()=>actions).toEqual(['x_profile']);
});

test('reduced-motion disclosures retain distinct arrow states and keyboard access without animation', async ({app,screen,browser}) => {
  await browser.emulateMedia({reducedMotion:'reduce'});
  await browser.route('**/api/write**',route=>route.fulfill({json:ready(['linkedin'])}));
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).press('Enter');
  await expect(screen.getByRole('button',{name:'Brief',exact:true})).toHaveAttribute('aria-expanded','true');
  await screen.getByRole('button',{name:'Brief',exact:true}).press('Enter');
  await expect(screen.getByRole('button',{name:'Brief',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(screen.getByLabel('Audience',{exact:true})).not.toBeVisible();
});

test('mobile sticky controls and expandable settings stay within the viewport', async ({app,screen,browser}) => {
  await browser.setViewport({width:390,height:844});
  await browser.route('**/api/write**',route=>route.fulfill({json:ready(['x'])}));
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByLabel('Audience',{exact:true}).fill('A mobile engineering audience');
  await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth)).toBe(true);
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByLabel('X post',{exact:true})).toBeVisible();
});

test('profile refresh re-enables on an idle desk when the server cooldown expires without another request', async ({app,screen,browser}) => {
  let calls=0;
  await browser.route('**/api/write**',route=>{
    if(route.request.method==='GET') return route.fulfill({json:ready(['x'])});
    const body=JSON.parse(route.request.postData!);
    if(body.action!=='x_profile') throw new Error('Cooldown must not generate a post');
    calls++;
    return route.fulfill({json:{connected:true,author:{name:'Connected X Author',handle:'connected_x'},fetchedAt:new Date().toISOString(),refreshAllowedAt:new Date(Date.now()+1200).toISOString()}});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await screen.getByRole('button',{name:'Refresh X profile',exact:true}).click();
  await expect(screen.getByRole('button',{name:'Refresh X profile',exact:true})).toBeDisabled();
  await expect(screen.getByRole('button',{name:'Refresh X profile',exact:true})).toBeEnabled();
  await expect.poll(()=>calls).toBe(1);
});

test('the post leads the editor while review stays actionable and secondary controls are discoverable in Post tools', async ({app,screen,browser}) => {
  const current=ready(['x']);current.production.status='planned';current.production.approvedRevisionId=current.production.latestRevisionId;current.production.checkpoint.reviewPin={reviewPromptVersion:'older-guidance'};
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') throw new Error('Exploring post tools must not generate, refresh, or change saved work');
    return route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Refresh review',exact:true})).toBeEnabled();
  await expect(screen.getByLabel('View version',{exact:true})).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Refresh X profile',exact:true})).not.toBeVisible();
  await expect(screen.getByLabel(/What would you like to change/)).not.toBeVisible();
  await expect(screen.getByRole('button',{name:'Approve revision 1',exact:true})).toBeDisabled();
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await expect(screen.getByLabel('View version',{exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Refresh X profile',exact:true})).toBeVisible();
  await screen.getByLabel('View version',{exact:true}).press('Escape');
  await expect(screen.getByRole('dialog',{name:'Post tools',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-label') ?? null)).toBe('Post tools');
  await screen.getByText('Request changes',{exact:true}).click();
  await expect(screen.getByLabel(/What would you like to change/)).toBeVisible();
  await expect(await browser.evaluate(()=>{const tabs=document.querySelector('[aria-label="Platform adaptations"]')!.getBoundingClientRect();const preview=document.querySelector('[aria-label="X feed preview"]')!.getBoundingClientRect();return preview.top-tabs.bottom<140;})).toBe(true);
});


test('mobile Post tools stays inside the screen and pointer dismissal preserves the chosen control', async ({app,screen,browser}) => {
  await browser.setViewport({width:390,height:844});
  await browser.route('**/api/write**',route=>route.fulfill({json:ready(['x','linkedin'])}));
  await app.open('/');
  await screen.getByRole('button',{name:'Post tools',exact:true}).click();
  await expect(screen.getByRole('dialog',{name:'Post tools',exact:true})).toBeVisible();
  await expect(await browser.evaluate(()=>{const r=document.querySelector('[role="dialog"][aria-label="Post tools"]')!.getBoundingClientRect();return r.left>=0&&r.right<=document.documentElement.clientWidth&&document.documentElement.scrollWidth===document.documentElement.clientWidth;})).toBe(true);
  await screen.getByRole('button',{name:'Edit post',exact:true}).click();
  await expect(screen.getByRole('dialog',{name:'Post tools',exact:true})).not.toBeVisible();
  await expect(screen.getByLabel('X post',{exact:true})).toBeVisible();
  await expect(await browser.evaluate(()=>document.activeElement?.textContent?.trim() ?? null)).toBe('Preview post');
});

test('opening a post shows its content directly under the heading and toolbar, with workflow detail available on demand', async ({app,screen,browser}) => {
  const current=ready(['x','linkedin']);current.production.checkpoint.research={library:'searched',web:'searched',notice:null};
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') throw new Error('Inspecting the compact workspace must not run generation');
    return route.fulfill({json:current});
  });
  await app.open('/');
  await expect(screen.getByRole('region',{name:'X feed preview',exact:true})).toBeVisible();
  await expect(browser.locator('[aria-label="Writing progress"]')).not.toBeVisible();
  await expect(screen.getByText('Your direction',{exact:true})).not.toBeVisible();
  await expect(screen.getByText('Library sources checked. Web research checked.',{exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>{const heading=document.querySelector('.write-production-heading')!.getBoundingClientRect();const preview=document.querySelector('[aria-label="X feed preview"]')!.getBoundingClientRect();return preview.top-heading.bottom<150;})).toBe(true);
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByLabel('Audience',{exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Review',exact:true}).click();
  await expect(browser.locator('[aria-label="Writing progress"]')).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).not.toBeVisible();
  await screen.getByRole('tab',{name:/LinkedIn/}).click();
  await expect(screen.getByRole('region',{name:'LinkedIn feed preview',exact:true})).toBeVisible();
});


test('finishing a generation keeps keyboard focus in the compact workspace when its generate action disappears', async ({app,screen,browser}) => {
  let current=ready(['x']);let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await browser.route('**/api/write**',async route=>{
    if(route.request.method==='GET') return route.fulfill({json:current});
    const action=JSON.parse(route.request.postData!).action;
    if(action==='regenerate') {await pending;current=ready(['x'],2);}
    else if(action!=='advance') throw new Error('Unexpected generation fixture action');
    return route.fulfill({json:current});
  });
  await app.open('/');
  await screen.getByRole('button',{name:'Brief',exact:true}).press('Enter');
  await screen.getByRole('button',{name:'Generate new version',exact:true}).press('Enter');
  release();
  await expect(screen.getByText('Revision 2 · saved',{exact:true})).toBeVisible();
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-controls') ?? null)).toBe('generation-brief');
});

test('Brief opens one attached settings card with a contextual footer and wheel scrolling never moves the background', async ({app,screen,browser}) => {
  await browser.setViewport({width:989,height:954});
  await browser.route('**/api/write**',route=>{
    if(route.request.method!=='GET') throw new Error('Settings inspection must not dispatch paid generation');
    const current=ready(['x','linkedin']);current.production.brief.delivery='thread';current.revisions[0].content.variants[0].delivery='thread';current.revisions[0].content.variants[0].posts=Array.from({length:3},()=>Array.from({length:12},()=>original).join('\n\n'));
    return route.fulfill({json:current});
  });
  await app.open('/');
  const before=await browser.evaluate(()=>({pageY:scrollY,postTop:document.querySelector('[aria-label="X feed preview"]')!.getBoundingClientRect().top}));
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByRole('region',{name:'Next version settings',exact:true})).toBeVisible();
  await expect(screen.getByRole('region',{name:'Next version settings',exact:true})).toContainText('Engineers');
  await expect(await browser.evaluate(()=>{const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent?.includes('Generate new version'));return Boolean(button?.closest('footer'))&&!document.querySelector('.write-control-bar')!.textContent!.includes('Generate new version');})).toBe(true);
  await expect.poll(()=>browser.evaluate((postTop:number)=>Math.abs(document.querySelector('[aria-label="X feed preview"]')!.getBoundingClientRect().top-postTop)<2,before.postTop)).toBe(true);
  const point=await browser.evaluate(()=>{const r=document.querySelector('[aria-label="Settings content"]')!.getBoundingClientRect();return {x:r.right-25,y:r.top+30};});
  await browser.mouse.move(point.x,point.y);
  await browser.mouse.wheel(0,5000);
  await expect.poll(()=>browser.evaluate(()=>{const body=document.querySelector('[aria-label="Settings content"]')!;return body.scrollTop>0&&body.scrollHeight-body.clientHeight-body.scrollTop<2;})).toBe(true);
  await browser.mouse.wheel(0,2500);
  await expect(await browser.evaluate(()=>scrollY)).toBe(before.pageY);
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeVisible();
  const upwardPoint=await browser.evaluate(()=>{const r=document.querySelector('[aria-label="Settings content"]')!.getBoundingClientRect();return {x:r.left+8,y:r.top+r.height/2};});
  await browser.mouse.move(upwardPoint.x,upwardPoint.y);
  // Separate upward wheel gestures until the scrollable form reaches its top.
  // Wheel completion does not wait for Chromium's compositor scroll sequence.
  await expect.poll(async()=>{
    await browser.mouse.wheel(0,-600);
    return browser.evaluate(()=>document.querySelector('[aria-label="Settings content"]')!.scrollTop);
  }).toBe(0);
  await browser.mouse.wheel(0,-600);
  await expect(await browser.evaluate(()=>scrollY)).toBe(before.pageY);
  await screen.getByRole('button',{name:'Brief',exact:true}).click();
  await expect(screen.getByRole('region',{name:'Next version settings',exact:true})).not.toBeVisible();
});


test('keyboard settings stay usable in a short viewport and reset keeps focus when generation is disabled', async ({app,screen,browser}) => {
  await browser.setViewport({width:989,height:954});
  await browser.route('**/api/write**',route=>route.fulfill({json:ready(['x'])}));
  await app.open('/');
  // Match the real app's global sticky-navigation scroll padding.
  await browser.evaluate(()=>{document.documentElement.style.scrollPaddingTop='84px';return true;});
  await screen.getByRole('button',{name:'Brief',exact:true}).press('Enter');
  await expect(screen.getByRole('region',{name:'Next version settings',exact:true})).toBeVisible();
  await browser.setViewport({width:640,height:400});
  await expect.poll(()=>browser.evaluate(()=>{const body=document.querySelector('.write-settings-body')!.getBoundingClientRect();const footer=document.querySelector('.write-settings-footer')!.getBoundingClientRect();return body.height>=80&&footer.bottom<=innerHeight&&document.documentElement.scrollWidth===document.documentElement.clientWidth;})).toBe(true);
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-label') ?? null)).toBe('Settings content');
  await screen.getByRole('region',{name:'Settings content',exact:true}).press('Tab');
  await expect(await browser.evaluate(()=>document.activeElement?.tagName ?? null)).toBe('TEXTAREA');
  // Keyboard navigation can enter the card and edit its form.
  await screen.getByLabel('Post topic',{exact:true}).fill('');
  await expect(screen.getByRole('button',{name:'Generate new version',exact:true})).toBeDisabled();
  await screen.getByRole('button',{name:'Reset settings',exact:true}).press('Enter');
  await expect(screen.getByRole('button',{name:'Reset settings',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>Boolean(document.activeElement?.closest('[aria-label="Next version settings"]')))).toBe(true);
  await screen.getByRole('region',{name:'Settings content',exact:true}).press('Escape');
  await expect(screen.getByRole('region',{name:'Next version settings',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>({focus:document.activeElement?.getAttribute('aria-controls') ?? null,overflow:document.documentElement.style.overflow}))).toEqual({focus:'generation-brief',overflow:''});
  await screen.getByRole('button',{name:'Decisions',exact:true}).press('Enter');
  await expect(screen.getByLabel('Framework for next version')).toBeVisible();
  await screen.getByRole('region',{name:'Settings content',exact:true}).press('Escape');
  await expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-controls') ?? null)).toBe('generation-decisions');
});
