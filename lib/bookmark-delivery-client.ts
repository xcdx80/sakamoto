'use client';
import { accountEpoch } from './account-scope';
import { useStore } from './store';
import type { bookmarkDeliveryStatus } from './bookmark-deliveries';
export type DeliveryStatus=Awaited<ReturnType<typeof bookmarkDeliveryStatus>>;
export async function receivedBookmarkDeliveries(after?:string):Promise<DeliveryStatus>{
 const owner=useStore.getState().scope,epoch=accountEpoch();
 if(!owner)throw new Error('Sign in to view bookmark delivery.');
 const response=await fetch('/api/bookmark-deliveries'+(after?'?after='+encodeURIComponent(after):''),{headers:{'X-Sakamoto-Owner':owner},cache:'no-store'});
 const result=await response.json();
 if(accountEpoch()!==epoch||useStore.getState().scope!==owner)throw new Error('Account changed; reload delivery progress.');
 if(!response.ok)throw new Error(result.error??'Could not load delivery progress.');
 return result;
}
