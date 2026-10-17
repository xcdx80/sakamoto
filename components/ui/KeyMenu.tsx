"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { accountEpoch } from "@/lib/account-scope";
import {
  budgetDollars as dollars,
  fetchBudget,
  type BudgetView,
} from "@/lib/budget-client";
import { Popover, barBtn } from "./Popover";

/** The reader can inspect spending without ever handling a provider credential. */
export function KeyMenu() {
  const [budget, setBudget] = useState<BudgetView | null>(null),
    [error, setError] = useState("");
  const refresh = async () => {
    const epoch = accountEpoch();
    try {
      const data = await fetchBudget();
      if (accountEpoch() !== epoch) return;
      setBudget(data);
      setError("");
    } catch (error) {
      if (accountEpoch() !== epoch) return;
      setBudget(null);
      setError(
        error instanceof Error
          ? error.message
          : "Processing usage is unavailable.",
      );
    }
  };
  useEffect(() => {
    void refresh();
    const update = () => {
      void refresh();
    };
    window.addEventListener("sakamoto:budget", update);
    return () => window.removeEventListener("sakamoto:budget", update);
  }, []);
  return (
    <Popover
      label="Processing budget"
      tip="Processing budget"
      width={340}
      triggerClass={barBtn}
      openOn="gloss:key"
      trigger={
        <>
          <Wallet size={15} aria-hidden />
          {budget && (
            <span className="hidden sm:inline">
              {budget.paused
                ? "Processing paused"
                : dollars(budget.remainingUsd) + " left"}
            </span>
          )}
        </>
      }
    >
      {() => (
        <div>
          <p className="text-[13.5px] font-medium text-ink">
            Processing budget
          </p>
          {error && (
            <p role="status" className="mt-2 text-[12.5px] text-rubric-text">
              {error}
            </p>
          )}
          {budget && (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
                <dt>Used</dt>
                <dd className="text-right tabular-nums">
                  {dollars(budget.settledUsd)}
                </dd>
                <dt>Reserved</dt>
                <dd className="text-right tabular-nums">
                  {dollars(budget.reservedUsd)}
                </dd>
                <dt>Remaining</dt>
                <dd className="text-right tabular-nums">
                  {dollars(budget.remainingUsd)}
                </dd>
                <dt>Cumulative limit</dt>
                <dd className="text-right tabular-nums">
                  {dollars(budget.capUsd)}
                </dd>
              </dl>
              <p className="mt-3 text-[12px] leading-snug text-ink-3">
                This deployment shares one cumulative budget for paid
                processing. It does not reset monthly or include other use of
                provider keys or your Grok subscription.
              </p>
              <p className="mt-2 text-[12px] leading-snug text-ink-3">
                Paid work pauses when remaining funds cannot cover a full
                attempt. Saved reading and manual library changes stay
                available. The deployment owner can intentionally raise the
                limit to resume eligible work.
              </p>
              {budget.halted && (
                <p role="status" className="mt-2 text-[12px] text-rubric-text">
                  Processing is paused for reconciliation because a provider
                  exceeded its authorized bound. Raising the spending limit
                  alone does not clear this pause.
                </p>
              )}
              {budget.reservedUsd > 0 && (
                <p role="status" className="mt-2 text-[12px] text-rubric-text">
                  Reserved funds include running or uncertain attempts. An
                  interrupted request may have been billed; its funds remain
                  reserved until verified usage is reconciled. Retrying starts a
                  new funded attempt.
                </p>
              )}
              {budget.attempts.length > 0 && (
                <ul
                  className="mt-3 max-h-40 overflow-y-auto text-[11px] text-ink-3"
                  aria-label="Recent processing attempts"
                >
                  {budget.attempts.slice(0, 8).map((a) => (
                    <li key={a.id} className="mt-1 break-all">
                      {a.id.slice(0, 8)} · {a.status} ·{" "}
                      {dollars(a.actualUsd ?? a.reservedUsd)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 rounded-lg border border-rule px-3 py-1.5 text-[12px]"
          >
            Refresh usage
          </button>
        </div>
      )}
    </Popover>
  );
}
