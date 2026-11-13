import { randomBytes } from "node:crypto";
import { saveProviderConnection, disconnectProvider } from "../lib/provider-connections";
import type { CredentialProvider } from "../lib/provider-connection-types";
const envNames = {openai:"OPENAI_API_KEY",google:"GOOGLE_API_KEY",typesafe:"TYPESAFE_API_KEY",exa:"EXA_API_KEY",monid:"MONID_API_KEY"} as const;
/** Explicitly provision an isolated test owner from the existing synthetic provider fixtures. Never called by application code. */
export async function connectFixtureProviders(owner: string) {
  process.env.PROVIDER_CREDENTIAL_KEYS ??= JSON.stringify({fixture:randomBytes(32).toString("base64")});
  process.env.PROVIDER_CREDENTIAL_ACTIVE_KEY ??= "fixture";
  process.env.PROVIDER_CREDENTIAL_CONTEXT ??= "isolated-provider-fixtures";
  for (const [provider, env] of Object.entries(envNames)) {
    const key = process.env[env];
    if (key) {
      if (!/^(fixture|isolated|review-limit)/.test(key)) throw new Error("Only synthetic keys may be used in provider fixtures.");
      await saveProviderConnection(owner,provider as CredentialProvider,key,null);
    } else await disconnectProvider(owner,provider as CredentialProvider);
  }
}
export async function connectedContext<T extends {owner:string}>(context:T):Promise<T> {
  await connectFixtureProviders(context.owner); return context;
}

export async function connectedOwner(owner:string) {await connectFixtureProviders(owner);return owner;}
