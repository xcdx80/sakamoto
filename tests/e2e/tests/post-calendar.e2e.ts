import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

function planned(id: string, idea: string, plannedAt: string, status = 'planned') {
  return {id, brief:{idea, platforms:['x','linkedin'], pillar:'engineering'}, status, plannedAt};
}
test('the calendar shows plans by date, navigates months and opens the exact post', async ({app,screen,browser}) => {
  const posts = [planned('nov-plan','Engineering release gates','2026-11-10T10:30:00Z'), planned('dec-plan','December planning','2026-12-02T15:00:00Z'), planned('cancelled-plan','Cancelled draft','2026-11-10T11:00:00Z','cancelled')];
  await browser.route('**/api/write**', route => route.fulfill({json:{productions:posts}}));
  await app.open('/calendar');
  await expect(screen.getByRole('heading',{name:'November 2026',exact:true})).toBeVisible();
  await expect(screen.getByRole('link',{name:/Engineering release gates/})).toBeVisible();
  await expect(screen.getByRole('link',{name:/Cancelled draft/})).not.toBeVisible();
  await screen.getByRole('button',{name:'Next month',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'December 2026',exact:true})).toBeVisible();
  await expect(screen.getByRole('link',{name:/December planning/})).toBeVisible();
  await screen.getByRole('button',{name:'Today',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'November 2026',exact:true})).toBeVisible();
  await expect(screen.getByRole('link',{name:/Engineering release gates/})).toHaveAttribute('href','/write?post=nov-plan');
});

test('selecting a day exposes its full plans in time order while empty days stay clear', async ({app,screen,browser}) => {
  const posts = [planned('late','Later release check','2026-11-10T16:00:00Z'),planned('early','Morning review','2026-11-10T09:00:00Z')];
  await browser.route('**/api/write**', route => route.fulfill({json:{productions:posts}}));
  await app.open('/calendar');
  await expect(screen.getByText('No posts planned for this day.',{exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Tuesday, 10 November 2026 · 2 planned posts',exact:true}).click();
  const agenda=screen.getByRole('region',{name:'Selected day',exact:true});
  await expect(agenda.getByRole('link')).toHaveCount(2);
  await expect(agenda.getByRole('link').first()).toContainText('Morning review');
  await expect(agenda.getByRole('link').last()).toContainText('Later release check');
  await screen.getByRole('button',{name:'Next month',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'December 2026',exact:true})).toBeVisible();
  await expect(agenda.getByRole('link')).toHaveCount(0);
});

test('calendar dates use the displayed timezone across midnight and month/year boundaries', async ({app,screen,browser}) => {
  const posts = [planned('boundary','Local October plan','2026-11-01T00:30:00Z')];
  await browser.route('**/api/write**', route => route.fulfill({json:{productions:posts}}));
  await app.open('/calendar#zone=America%2FNew_York');
  await expect(screen.getByText('0 planned posts · America/New York',{exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Saturday, 31 October 2026 · 1 planned post',exact:true}).click();
  const agenda=screen.getByRole('region',{name:'Selected day',exact:true});
  await expect(agenda.getByRole('link')).toContainText('20:30');
  await screen.getByRole('button',{name:'Next month',exact:true}).click();
  await screen.getByRole('button',{name:'Next month',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'January 2027',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Previous month',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'December 2026',exact:true})).toBeVisible();
});

test('a calendar entry opens its retained draft through the account-bound HTTP client', async ({app,screen,browser}) => {
  let requested='';
  const post={...planned('exact-post','A retained release checklist','2026-11-10T10:30:00Z'),version:4,brief:{idea:'A retained release checklist',platforms:['linkedin'],pillar:'engineering',goal:'trust',audience:'Engineers',notes:'',sourceIds:[],delivery:'single'},stage:'complete',checkpoint:{evidence:[]},latestRevisionId:'saved-revision',approvedRevisionId:'saved-revision'};
  await browser.route('**/api/write**', route => {
    if(route.request.method!=='GET')throw Error('Calendar browsing must not mutate or generate posts.');
    const id=new URL(route.request.url).searchParams.get('productionId');
    if(!id)return route.fulfill({json:{productions:[post]}});
    requested=id;
    return route.fulfill({json:{production:post,revisions:[{id:'saved-revision',number:1,origin:'author',content:{variants:[{platform:'linkedin',delivery:'long',posts:['This is the exact saved calendar draft.']}],hooks:[],claimSources:[]}}],review:null,feedback:[]}});
  });
  await app.open('/calendar');
  await screen.getByRole('link',{name:'10:30 A retained release checklist',exact:true}).click();
  await expect(screen.getByRole('region',{name:'LinkedIn feed preview',exact:true})).toContainText('This is the exact saved calendar draft.');
  await expect.poll(()=>requested).toBe('exact-post');
});

test('the posts overview uses compact rows, explicit platform icons and a separate calendar link', async ({app,screen,browser}) => {
  const post=planned('overview-post','A readable post title','2026-11-10T10:30:00Z');
  await browser.route('**/api/write**', route=>route.fulfill({json:{productions:[post]}}));
  await app.open('/write');
  await expect(screen.getByRole('heading',{name:'Posts 1',exact:true})).toBeVisible();
  await expect(screen.getByRole('img',{name:'X + LinkedIn',exact:true})).toBeVisible();
  await expect(screen.getByRole('link',{name:'Calendar',exact:true})).toHaveAttribute('href','/calendar');
  await expect(screen.getByRole('button',{name:'New post',exact:true})).toBeVisible();
  await expect(screen.getByText('Good writing begins',{exact:false})).not.toBeVisible();
  await expect(screen.getByRole('heading',{name:'Publication calendar',exact:true})).not.toBeVisible();
  await expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('.write-post-row h3')!).fontSize)).toBe('15px');
});
