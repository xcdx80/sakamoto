import type { FailureAction, AdminFailures } from "./admin-failures";

/** Account assertion protects a dashboard left open during an account switch. */
export async function submitFailureAction(owner: string, command: FailureAction): Promise<{ changed: number; failures: AdminFailures }> {
  const response = await fetch("/api/admin/failures", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "x-sakamoto-owner": owner }, body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("The action could not complete. Refresh the dashboard before trying again.");
  return response.json();
}
