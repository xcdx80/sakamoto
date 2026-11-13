import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('API key entry clears after save, shows only metadata, survives reload and disconnects explicitly', async ({app,screen,browser}) => {
  const key = 'sk-browser-synthetic-secret';
  let connected=false, saves=0;
  await browser.route('**/api/provider-connections', route => {
    if(route.request.method==='POST') {
      const body=JSON.parse(route.request.postData!);
      if(body.action==='save') {if(body.apiKey!==key)throw Error('Wrong fixture key');connected=true;saves++;}
      if(body.action==='disconnect') connected=false;
    }
    return route.fulfill({json:{connections:[{provider:'openai',connected,stored:connected,updatedAt:null,expiresAt:null}],budget:{capUsd:10,usedUsd:0,reservedUsd:0}}});
  });
  await app.open('/settings/providers');
  const field=screen.getByLabel('OpenAI API key',{exact:true});
  await field.fill(key);
  await screen.getByRole('button',{name:'Save key',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'OpenAI · Connected',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Replace key',exact:true}).click();
  await expect.poll(()=>saves).toBe(1);
  await app.open('/settings/providers');
  await expect(screen.getByRole('heading',{name:'OpenAI · Connected',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Replace key',exact:true}).click();
  await expect.poll(()=>saves).toBe(1);
  await screen.getByRole('button',{name:'Disconnect',exact:true}).click();
  await screen.getByRole('button',{name:'Confirm disconnect',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'OpenAI · Not connected',exact:true})).toBeVisible();
});

test('failed saves clear the password field and show a safe error', async ({app,screen,browser}) => {
  let attempts=0;
  await browser.route('**/api/provider-connections', route => route.request.method==='POST' ? (attempts++, route.fulfill({status:503,json:{error:'unavailable'}})) : route.fulfill({json:{connections:[{provider:'openai',connected:false,stored:false,updatedAt:null,expiresAt:null}],budget:{capUsd:10,usedUsd:0,reservedUsd:0}}}));
  await app.open('/settings/providers');
  const field=screen.getByLabel('OpenAI API key',{exact:true});
  await field.fill('sk-browser-failure-fixture');
  await screen.getByRole('button',{name:'Save key',exact:true}).click();
  await expect(screen.getByRole('status')).toContainText('could not be updated');
  await screen.getByRole('button',{name:'Save key',exact:true}).click();
  await expect.poll(()=>attempts).toBe(1);
});

test('an expired stored key can be removed immediately', async ({app,screen,browser}) => {
  let stored=true;
  await browser.route('**/api/provider-connections', route => {
    if(route.request.method==='POST') {const body=JSON.parse(route.request.postData!);if(body.action==='disconnect')stored=false;}
    return route.fulfill({json:{connections:[{provider:'openai',connected:false,stored,updatedAt:null,expiresAt:'2020-01-01T00:00:00Z'}],budget:{capUsd:10,usedUsd:0,reservedUsd:0}}});
  });
  await app.open('/settings/providers');
  await expect(screen.getByRole('heading',{name:'OpenAI · Expired',exact:true})).toBeVisible();
  await screen.getByRole('button',{name:'Disconnect',exact:true}).click();
  await screen.getByRole('button',{name:'Confirm disconnect',exact:true}).click();
  await expect(screen.getByRole('heading',{name:'OpenAI · Not connected',exact:true})).toBeVisible();
});
