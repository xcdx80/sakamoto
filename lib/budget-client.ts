"use client";

import { accountScope } from "./account-scope";
export type BudgetView = {
  scope: "deployment";
  capUsd: number;
  settledUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  paused: boolean;
  halted: boolean;
  attempts: {
    id: string;
    status: string;
    reservedUsd: number;
    actualUsd: number | null;
  }[];
};
export const budgetDollars = (n: number) =>
  "$" + n.toFixed(n > 0 && n < 0.01 ? 6 : 2);
export async function fetchBudget(): Promise<BudgetView> {
  const response = await fetch("/api/budget", {
    headers: { "X-Sakamoto-Owner": accountScope() ?? "anonymous" },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Processing usage is unavailable.",
    );
  if (
    data.scope !== "deployment" ||
    !["capUsd", "settledUsd", "reservedUsd", "remainingUsd"].every(
      (k) =>
        typeof data[k] === "number" && Number.isFinite(data[k]) && data[k] >= 0,
    ) ||
    typeof data.paused !== "boolean" ||
    typeof data.halted !== "boolean" ||
    !Array.isArray(data.attempts) ||
    !data.attempts.every(
      (a: any) =>
        typeof a.id === "string" &&
        ["reserved", "uncertain", "settled", "released"].includes(a.status) &&
        Number.isFinite(a.reservedUsd) &&
        (a.actualUsd === null || Number.isFinite(a.actualUsd)),
    )
  )
    throw new Error("Processing usage returned an invalid response.");
  return data;
}
