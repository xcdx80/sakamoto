"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { motion } from "motion/react";
import { ease } from "@/components/motion/tokens";
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
          <p className="sk-eyebrow">Processing budget</p>
          {error && (
            <p role="status" className="mt-2 text-[12.5px] text-rubric-text">
              {error}
            </p>
          )}
          {budget && (
            <>
              <p className="sk-display mt-3 text-[40px] text-ink">
                {dollars(budget.remainingUsd)}
                <span className="ml-2 font-sans text-[13px] font-normal tracking-normal text-ink-3">left</span>
              </p>
              <span aria-hidden className="mt-3 block h-[3px] overflow-hidden rounded-full bg-sunk">
                <motion.span
                  className="block h-full origin-left rounded-full bg-ink"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: budget.capUsd > 0 ? Math.min(1, (budget.settledUsd + budget.reservedUsd) / budget.capUsd) : 0 }}
                  transition={{ duration: 0.9, ease: ease.out }}
                />
              </span>
              <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-b border-rule pb-3 text-[12.5px] text-ink-2">
                <dt>Used</dt>
                <dd className="text-right font-mono text-[12px] tabular-nums text-ink">
                  {dollars(budget.settledUsd)}
                </dd>
                <dt>Reserved</dt>
                <dd className="text-right font-mono text-[12px] tabular-nums text-ink">
                  {dollars(budget.reservedUsd)}
                </dd>
                <dt>Remaining</dt>
                <dd className="text-right font-mono text-[12px] tabular-nums text-ink">
                  {dollars(budget.remainingUsd)}
                </dd>
                <dt>Cumulative limit</dt>
                <dd className="text-right font-mono text-[12px] tabular-nums text-ink">
                  {dollars(budget.capUsd)}
                </dd>
              </dl>
              <p className="mt-3 text-[12px] leading-snug text-ink-3">
                Your cumulative BYOK budget covers paid processing with your keys. Historical usage is separate. It does not reset monthly or include other use of
                provider keys or your Grok subscription.
              </p>
              <p className="mt-2 text-[12px] leading-snug text-ink-3">
                Paid work pauses when remaining funds cannot cover a full
                attempt. Saved reading and manual library changes stay
                available. You can change your limit in API key settings to resume eligible work.
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
            className="sk-btn sk-btn-ghost mt-3 !min-h-[32px] !px-3.5 !text-[12.5px]"
          >
            Refresh usage
          </button>
        </div>
      )}
    </Popover>
  );
}
