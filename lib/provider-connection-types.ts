export const providerCatalog = {
  openai: { label: "OpenAI", purpose: "Reader answers, writing and review" },
  google: { label: "Google", purpose: "Library search and indexing" },
  typesafe: { label: "Typesafe", purpose: "Classification and structured writing" },
  exa: { label: "Exa", purpose: "Web search in reader answers" },
  monid: { label: "Monid", purpose: "Research for writing" },
} as const;
export type CredentialProvider = keyof typeof providerCatalog;
export const isCredentialProvider = (v: unknown): v is CredentialProvider => typeof v === "string" && Object.hasOwn(providerCatalog, v);
export type ConnectionSummary = { provider: CredentialProvider; stored: boolean; connected: boolean; updatedAt: string | null; expiresAt: string | null };
export type ConnectionSettings = { connections: ConnectionSummary[]; budget: { capUsd: number; usedUsd: number; reservedUsd: number } };
