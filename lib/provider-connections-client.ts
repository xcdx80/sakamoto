import type { ConnectionSettings, CredentialProvider } from "./provider-connection-types";
export type ConnectionCommand = { action: "save"; provider: CredentialProvider; apiKey: string; expiresAt: string | null } | { action: "disconnect"; provider: CredentialProvider } | { action: "budget"; capUsd: number };
export async function requestConnections(owner: string, command?: ConnectionCommand, signal?: AbortSignal): Promise<ConnectionSettings> {
  const response = await fetch("/api/provider-connections", {
    method: command ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    headers: { "content-type": "application/json", "x-sakamoto-owner": owner },
    ...(command ? { body: JSON.stringify(command) } : {}),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Too many changes. Wait a minute and try again." : "API key settings could not be updated. Check your connection and sign-in, then try again.");
  return response.json();
}
export function expiryFromDate(date: string): string | null { return date ? new Date(date + "T23:59:59Z").toISOString() : null; }
