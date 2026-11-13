import { pruneCredentialStorage, rotateProviderCredentials } from "../lib/credential-lifecycle";
async function main() {
  if (process.argv[2] === "rotate") console.log(await rotateProviderCredentials());
  else if (process.argv[2] === "prune") { await pruneCredentialStorage(); console.log("Credential retention applied."); }
  else throw new Error("Use rotate or prune.");
}
main().catch(() => { console.error("Credential maintenance failed. Check database/encryption configuration; no credential details are logged."); process.exitCode=1; });
