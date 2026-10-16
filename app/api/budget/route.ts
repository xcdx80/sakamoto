import { requestOwner } from "@/lib/owner";
import { budgetStatus, paidFailure, PaidWorkError } from "@/lib/paid-work";
export const runtime = "nodejs";
export async function GET(req: Request) {
  let owner: string | null;
  try {
    owner = await requestOwner(req);
  } catch {
    return Response.json(
      { error: "Sign in to view processing usage." },
      { status: 401 },
    );
  }
  if (!owner)
    return Response.json(
      { error: "Sign in to view processing usage." },
      { status: 401 },
    );
  try {
    return Response.json(await budgetStatus(owner), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return paidFailure(
      new PaidWorkError(
        "budget_unavailable",
        "Processing usage is unavailable. Paid authorization pauses until the durable budget can be checked.",
      ),
    );
  }
}
