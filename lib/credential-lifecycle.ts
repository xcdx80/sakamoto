import "server-only";
import { db } from "./db";
import { decryptCredential, encryptCredential, type CredentialRecord } from "./credential-crypto";

export async function deleteOwnerCredentials(owner: string) {
  if (!owner || owner.length > 200) throw new Error("Invalid credential owner.");
  await db().query("select delete_owner_credentials($1)", [owner]);
}
/** Idempotent, bounded pages. CAS preserves a concurrently replaced/disconnected connection. No plaintext files or logs. */
export async function rotateProviderCredentials() {
  let after = "", rotated = 0;
  for (;;) {
    const rows = await db().query("select * from provider_connections where id::text>$1 order by id::text limit 100", [after]);
    if (!rows.length) return { rotated };
    for (const raw of rows) {
      const row = raw as CredentialRecord;
      const updated = encryptCredential(row, decryptCredential(row));
      const [result] = await db().query("select rotate_provider_connection($1,$2,$3::uuid,$4,$5,$6) as changed", [row.owner_id,row.provider,row.id,row.ciphertext,updated.key_id,updated.ciphertext]);
      rotated += Number(result.changed);
      after = row.id;
    }
  }
}
export async function pruneCredentialStorage() {
  await db().query("delete from provider_connections where expires_at is not null and expires_at::timestamptz<=now()");
  await db().query("delete from credential_audit where created_at<now()-interval '30 days'");
  await db().query("delete from credential_management_limits where window_start<now()-interval '1 day'");
}
