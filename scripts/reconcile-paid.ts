/** npm run budget:reconcile -- /absolute/path/to/operator-verified-receipt.json
 * Receipt: {verified:true,id,owner,model,providerRequestId?,reference,
 * usage:{inputTokens,outputTokens,cachedInputTokens?,cacheWriteTokens?}}
 * Exa receipt instead uses model:"exa-instant",costMicros:<verified integer
 * microUSD>, with no usage field. Estimates/missing billing cannot settle it.
 * Reference identifies independently verified provider usage; an interrupted
 * HTTP response or absence from a dashboard is not proof of zero usage.
 */
import { readFile } from "node:fs/promises";
import { reconcilePaidWork } from "../lib/paid-work";
async function main() {
  const path = process.argv[2];
  if (!path || !path.startsWith("/") || process.argv.length !== 3)
    throw new Error(
      "Supply one absolute path to an operator-verified receipt.",
    );
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for durable reconciliation.");
  const receipt = JSON.parse(await readFile(path, "utf8"));
  const result = await reconcilePaidWork(receipt);
  console.log(JSON.stringify(result));
}
main().catch(() => {
  console.error(
    "Reconciliation refused or could not complete. Verify the receipt, recorded owner/model/request and database availability. No ambiguous reservation was automatically refunded.",
  );
  process.exitCode = 1;
});
