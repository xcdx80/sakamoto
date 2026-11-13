import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CredentialRecord = { owner_id: string; provider: string; id: string; expires_at: string | null; key_id: string; ciphertext: string };
function configuration() {
  try {
    const keys = JSON.parse(process.env.PROVIDER_CREDENTIAL_KEYS ?? "");
    const active = process.env.PROVIDER_CREDENTIAL_ACTIVE_KEY ?? "";
    const context = process.env.PROVIDER_CREDENTIAL_CONTEXT ?? "";
    if (!context || !/^[\w-]{1,64}$/.test(active) || !keys || typeof keys !== "object" || Array.isArray(keys)) throw 0;
    const ring = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(keys)) {
      if (!/^[\w-]{1,64}$/.test(id) || typeof value !== "string") throw 0;
      const bytes = Buffer.from(value, "base64");
      if (bytes.length !== 32 || bytes.toString("base64") !== value) throw 0;
      ring.set(id, bytes);
    }
    if (!ring.has(active)) throw 0;
    return { ring, active, context };
  } catch { throw new Error("Credential encryption is unavailable."); }
}
function aad(row: Omit<CredentialRecord, "ciphertext">, context: string) {
  return Buffer.from(JSON.stringify(["sakamoto-credential-v1", context, row.owner_id, row.provider, row.id, row.key_id, row.expires_at]));
}
export function encryptCredential(row: Omit<CredentialRecord, "ciphertext" | "key_id">, plaintext: string): CredentialRecord {
  const config = configuration(), record = { ...row, key_id: config.active };
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.ring.get(config.active)!, nonce);
  cipher.setAAD(aad(record, config.context));
  const bytes = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ...record, ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64") };
}
export function decryptCredential(row: CredentialRecord): string {
  try {
    const config = configuration(), key = config.ring.get(row.key_id);
    const bytes = Buffer.from(row.ciphertext, "base64");
    if (!key || bytes.length < 29 || bytes.toString("base64") !== row.ciphertext) throw 0;
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(aad(row, config.context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch { throw new Error("Credential decryption is unavailable."); }
}
