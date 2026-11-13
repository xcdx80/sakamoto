"use client";
import { useUser } from "@clerk/nextjs";
import { ProviderConnections } from "./ProviderConnections";
export function ProviderSettingsAccount() {
  const {user,isLoaded} = useUser();
  if (!isLoaded) return <p>Loading account…</p>;
  if (!user) return <p>Sign in to manage API keys.</p>;
  return <ProviderConnections key={user.id} owner={user.id} />;
}
