"use client";
import { useEffect, useRef, useState } from "react";
import { providerCatalog, type ConnectionSettings, type CredentialProvider } from "@/lib/provider-connection-types";
import { expiryFromDate, requestConnections, type ConnectionCommand } from "@/lib/provider-connections-client";

/** Mount keyed by the authenticated owner so a switched account never retains an input or response. */
export function ProviderConnections({ owner }: { owner: string }) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    requestConnections(owner, undefined, abort.signal).then(setSettings).catch(() => { if (!abort.signal.aborted) setMessage("API key settings are unavailable. Try reloading."); });
    return () => abort.abort();
  }, [owner]);
  async function change(command: ConnectionCommand) {
    const signal = controller.current!.signal;
    setBusy(true); setMessage("");
    try {
      const result = await requestConnections(owner, command, signal);
      if (!signal.aborted) { setSettings(result); setMessage(command.action === "save" ? "Key saved. It will be checked when you use the provider." : command.action === "disconnect" ? "Key disconnected. Requests already authorized may finish." : "Spending limit updated."); }
    } catch (error) { if (!signal.aborted) setMessage(error instanceof Error ? error.message : "The change could not be saved."); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  return <section className="mx-auto max-w-2xl px-6 py-12">
    <a href="/" className="underline">Back to library</a>
    <h1 className="mt-6 text-3xl">Your API keys</h1>
    <p className="my-4">Connect the providers you want to use. Provider charges go to your accounts. InView encrypts saved keys and uses them on the server; saved keys cannot be revealed here.</p>
    <p className="mb-6">Use dedicated keys with provider spending limits. Disconnecting removes a saved key from InView. Revoke it at the provider if you suspect it has been exposed.</p>
    <p role="status" aria-live="polite">{message}</p>
    {!settings ? <p>Loading connections…</p> : <>
      {settings.connections.map(connection => <ConnectionForm key={connection.provider} provider={connection.provider} connected={connection.connected} stored={connection.stored} busy={busy} onChange={change} />)}
      <form className="mt-8 border-t pt-6" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void change({action:"budget",capUsd:Number(form.get("cap"))}); }}>
        <h2 className="text-xl">Spending limit</h2>
        <p className="my-2">Your BYOK usage: ${settings.budget.usedUsd.toFixed(4)}. Reserved: ${settings.budget.reservedUsd.toFixed(4)}. This cumulative limit covers new usage with your keys. Historical usage is separate. Replacing a key does not reset the limit.</p>
        <label>Total limit in USD <input key={settings.budget.capUsd} name="cap" type="number" min="0" max="1000" step="0.01" defaultValue={settings.budget.capUsd} required className="border rounded px-2 py-1" /></label>
        <button disabled={busy} className="sk-btn ml-2">Save limit</button>
        <p className="mt-2 text-sm">Set zero to pause new paid work. Provider limits remain the final control on your account’s spending.</p>
      </form>
    </>}
  </section>;
}
function ConnectionForm({provider,connected,stored,busy,onChange}:{provider:CredentialProvider;connected:boolean;stored:boolean;busy:boolean;onChange:(command:ConnectionCommand)=>Promise<void>}) {
  const input = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { const field = input.current; return () => { if (field) field.value = ""; }; }, []);
  return <section className="my-5 rounded border p-4">
    <h2 className="text-xl">{providerCatalog[provider].label} · {connected ? "Connected" : stored ? "Expired" : "Not connected"}</h2>
    <p className="my-2">{providerCatalog[provider].purpose}</p>
    <form autoComplete="off" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const apiKey = input.current!.value; input.current!.value = "";
      void onChange({action:"save",provider,apiKey,expiresAt:expiryFromDate(String(form.get("expires") || ""))});
    }}>
      <label className="block">{providerCatalog[provider].label} API key <input ref={input} type="password" required minLength={8} maxLength={4096} autoComplete="new-password" autoCapitalize="none" spellCheck={false} data-private="true" data-1p-ignore data-lpignore="true" className="my-2 block w-full rounded border px-3 py-2" /></label>
      <label>Expires on (optional, UTC) <input name="expires" type="date" className="border rounded px-2 py-1" /></label>
      <button disabled={busy} className="sk-btn ml-2">{connected ? "Replace key" : "Save key"}</button>
    </form>
    {stored && (confirm ? <div className="mt-3"><span>Disconnect this provider?</span><button disabled={busy} className="sk-btn ml-2" onClick={() => {setConfirm(false);void onChange({action:"disconnect",provider});}}>Confirm disconnect</button><button className="sk-btn" onClick={()=>setConfirm(false)}>Cancel</button></div> : <button disabled={busy} className="sk-btn mt-3" onClick={()=>setConfirm(true)}>Disconnect</button>)}
  </section>;
}
