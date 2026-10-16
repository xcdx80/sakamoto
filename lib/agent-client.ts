'use client';
import { accountEpoch } from './account-scope';
import { useStore } from './store';
export type AgentConnection={id:string;label:string;createdAt:string;lastUsedAt:string|null};
async function connectionRequest(method:string,body?:unknown,id?:string){
 const owner=useStore.getState().scope,epoch=accountEpoch();
 if(!owner)throw new Error('Sign in to manage agent connections.');
 const response=await fetch('/api/agent-tokens'+(id?'?id='+encodeURIComponent(id):''),{method,headers:{'X-Sakamoto-Owner':owner,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();
 if(accountEpoch()!==epoch||useStore.getState().scope!==owner)throw new Error('Account changed; reopen agent connections.');
 if(!response.ok)throw new Error(result.error??'Could not manage the agent connection.');
 return result;
}
export async function agentConnections():Promise<AgentConnection[]>{return (await connectionRequest('GET')).tokens;}
export async function makeAgentConnection(label:string):Promise<{id:string;token:string;label:string}>{return connectionRequest('POST',{label});}
export async function revokeAgentConnection(id:string){await connectionRequest('DELETE',undefined,id);}
