/** Deployment-wide cumulative paid-work authority. Never falls back to process memory. */
import { db } from "./db";

export class PaidWorkError extends Error {
  constructor(
    public code:
      | "configuration"
      | "budget_paused"
      | "duplicate_attempt"
      | "budget_unavailable"
      | "invalid_usage"
      | "input_too_large"
      | "provider_error"
      | "provider_rejected"
      | "invalid_response",
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export type PaidModel =
  | "gpt-6-luna"
  | "gemini-embedding-2"
  | "jev-latest"
  | "exa-instant";
export type PaidUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
};
export class PaidBoundExceeded extends PaidWorkError {
  constructor(public usage: PaidUsage) {
    super(
      "invalid_usage",
      "The provider reported usage above the authorized bound. Paid work is paused for reconciliation; the attempt remains reserved.",
    );
  }
}
export const PRICE_VERSION = "2026-10-16-standard-v1";
const prices = {
  "gpt-6-luna": {
    provider: "openai",
    input: 0.1,
    cached: 0.01,
    write: 0.125,
    output: 0.5,
    inputLimit: 262144,
    outputLimit: 16000,
  },
  "gemini-embedding-2": {
    provider: "google",
    input: 0.2,
    cached: 0.2,
    write: 0.2,
    output: 0,
    inputLimit: 8192,
    outputLimit: 0,
  },
  "jev-latest": {
    provider: "typesafe",
    input: 0.042,
    cached: 0.042,
    write: 0.042,
    output: 0,
    inputLimit: 64000,
    outputLimit: 32768,
  },
} as const;
function capMicros() {
  const raw = process.env.SAKAMOTO_BUDGET_USD ?? "10";
  if (
    !/^\d+(\.\d{1,6})?$/.test(raw) ||
    !Number.isSafeInteger(Math.round(Number(raw) * 1_000_000))
  )
    throw new PaidWorkError(
      "configuration",
      "The processing budget configuration needs repair.",
    );
  return Math.round(Number(raw) * 1_000_000);
}
function price(model: string) {
  if (
    !Object.hasOwn(prices, model) ||
    (process.env.SAKAMOTO_PRICE_VERSION &&
      process.env.SAKAMOTO_PRICE_VERSION !== PRICE_VERSION)
  )
    throw new PaidWorkError(
      "configuration",
      "Paid work is paused: this model has no verified price.",
    );
  return prices[model as keyof typeof prices];
}
const integer = (v: number) => Number.isSafeInteger(v) && v >= 0;
export function usageMicros(model: string, usage: PaidUsage): number {
  const p = price(model),
    read = usage.cachedInputTokens ?? 0,
    write = usage.cacheWriteTokens ?? 0;
  if (
    ![usage.inputTokens, usage.outputTokens, read, write].every(integer) ||
    read + write > usage.inputTokens
  )
    throw new PaidWorkError(
      "invalid_usage",
      "The provider returned invalid usage; its reservation is retained.",
    );
  if (usage.inputTokens > p.inputLimit || usage.outputTokens > p.outputLimit)
    throw new PaidBoundExceeded(usage);
  return Math.ceil(
    (usage.inputTokens - read - write) * p.input +
      read * p.cached +
      write * p.write +
      usage.outputTokens * p.output,
  );
}
export type PaidReservation = {
  id: string;
  model: PaidModel;
  reservedMicros: number;
};
export async function reservePaidWork(opts: {
  owner: string;
  operationId: string;
  attemptId: string;
  model: PaidModel;
  serializedInput: string;
  maxOutputTokens: number;
}): Promise<PaidReservation> {
  const { model } = opts;
  let provider: string, maximum: number;
  if (model === "exa-instant") {
    const usd = process.env.SAKAMOTO_EXA_MAX_USD;
    if (!usd || !/^\d+(\.\d{1,6})?$/.test(usd) || !(Number(usd) > 0))
      throw new PaidWorkError(
        "configuration",
        "Web search is paused: its maximum price is not configured.",
      );
    provider = "exa";
    maximum = Math.ceil(Number(usd) * 1_000_000);
    if (
      Buffer.byteLength(opts.serializedInput, "utf8") > 4096 ||
      opts.maxOutputTokens !== 0
    )
      throw new PaidWorkError(
        "input_too_large",
        "Search input is too large.",
        413,
      );
  } else {
    const p = price(model);
    provider = p.provider;
    if (!integer(opts.maxOutputTokens) || opts.maxOutputTokens > p.outputLimit)
      throw new PaidWorkError("configuration", "Paid output limit is invalid.");
    // Reserve the entire supported token envelope, not characters/4. UTF-8 bytes plus
    // ample protocol overhead bounds our serialized prompt inside that envelope.
    if (Buffer.byteLength(opts.serializedInput, "utf8") + 4096 > p.inputLimit)
      throw new PaidWorkError(
        "input_too_large",
        "This complete prompt is too large. Shorten the text or conversation.",
        413,
      );
    maximum = Math.ceil(
      p.inputLimit * Math.max(p.input, p.write) +
        opts.maxOutputTokens * p.output,
    );
  }
  if (
    !opts.owner ||
    !opts.operationId ||
    !opts.attemptId ||
    [opts.operationId, opts.attemptId].some((x) => x.length > 200) ||
    !Number.isSafeInteger(maximum) ||
    maximum <= 0
  )
    throw new PaidWorkError(
      "configuration",
      "Paid operation identity or price is invalid.",
    );
  const cap = capMicros(),
    id = crypto.randomUUID();
  let result;
  try {
    result = await db().query(
      "select reserve_paid_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) as status",
      [
        id,
        opts.owner,
        opts.operationId,
        opts.attemptId,
        provider,
        model,
        PRICE_VERSION,
        maximum,
        cap,
      ],
    );
  } catch {
    throw new PaidWorkError(
      "budget_unavailable",
      "Paid work is paused because the durable budget is unavailable. Saved reading remains available.",
    );
  }
  if (result[0]?.status === "duplicate")
    throw new PaidWorkError(
      "duplicate_attempt",
      "This paid attempt is already recorded. Check its status before intentionally starting a new attempt.",
      409,
    );
  if (result[0]?.status !== "reserved")
    throw new PaidWorkError(
      "budget_paused",
      "Paid work is paused: the remaining budget cannot cover this attempt. Reading and manual library changes remain available.",
      402,
    );
  return { id, model, reservedMicros: maximum };
}
export async function recordPaidResponse(
  reservation: PaidReservation,
  requestId: string | null,
) {
  if (requestId && /^[A-Za-z0-9._:-]{1,200}$/.test(requestId))
    await db().query(
      "update paid_attempts set provider_request_id=$2,updated_at=now() where id=$1",
      [reservation.id, requestId],
    );
}
export async function settlePaidWork(
  reservation: PaidReservation,
  actualMicros: number,
) {
  if (!integer(actualMicros))
    throw new PaidWorkError(
      "invalid_usage",
      "Invalid provider cost; reservation retained.",
    );
  const rows = await db().query(
    "select settle_paid_attempt($1,$2,false) as status",
    [reservation.id, actualMicros],
  );
  if (rows[0]?.status === "overrun")
    throw new PaidWorkError(
      "invalid_usage",
      "Provider usage exceeded its reservation. Paid work has been paused for reconciliation.",
    );
}
export async function releaseRejectedPaidWork(reservation: PaidReservation) {
  await db().query("select settle_paid_attempt($1,0,true)", [reservation.id]);
}
export async function recordPaidFailure(
  reservation: PaidReservation,
  error: unknown,
  operatorReceipt?: PaidReconciliationReceipt,
) {
  if (error instanceof PaidBoundExceeded)
    await db().query("select halt_paid_attempt($1,$2::jsonb)", [
      reservation.id,
      JSON.stringify(
        operatorReceipt ? { usage: error.usage, operatorReceipt } : error.usage,
      ),
    ]);
  else await markPaidWorkUncertain(reservation);
}
export async function markPaidWorkUncertain(reservation: PaidReservation) {
  await db().query(
    "update paid_attempts set status='uncertain',updated_at=now() where id=$1 and status='reserved'",
    [reservation.id],
  );
}
export async function budgetStatus(owner?: string) {
  const cap = capMicros();
  await db().query(
    "insert into paid_budget(id,cap_micros) values(true,$1) on conflict(id) do update set cap_micros=greatest(paid_budget.cap_micros,excluded.cap_micros)",
    [cap],
  );
  const [b] = await db().query("select * from paid_budget where id=true");
  const attempts = owner
    ? await db().query(
        "select id,operation_id,attempt_id,provider,model,provider_request_id,status,reserved_micros,actual_micros,created_at from paid_attempts where owner_id=$1 order by created_at desc limit 20",
        [owner],
      )
    : [];
  return {
    scope: "deployment",
    capUsd: Number(b.cap_micros) / 1e6,
    settledUsd: Number(b.settled_micros) / 1e6,
    reservedUsd: Number(b.reserved_micros) / 1e6,
    remainingUsd:
      Math.max(
        0,
        Number(b.cap_micros) -
          Number(b.settled_micros) -
          Number(b.reserved_micros),
      ) / 1e6,
    halted: Boolean(b.halted),
    paused:
      b.halted ||
      Number(b.settled_micros) + Number(b.reserved_micros) >=
        Number(b.cap_micros),
    attempts: attempts.map((a) => ({
      id: a.id,
      operationId: a.operation_id,
      attemptId: a.attempt_id,
      provider: a.provider,
      model: a.model,
      providerRequestId: a.provider_request_id,
      status: a.status,
      reservedUsd: Number(a.reserved_micros) / 1e6,
      actualUsd:
        a.actual_micros === null ? null : Number(a.actual_micros) / 1e6,
      createdAt: a.created_at,
    })),
  };
}
export function paidFailure(error: unknown): Response {
  return Response.json(
    {
      error:
        error instanceof PaidWorkError
          ? error.message
          : "Paid work could not finish. Check processing usage before intentionally retrying; potentially billed attempts remain reserved.",
      code: error instanceof PaidWorkError ? error.code : "provider_error",
    },
    { status: error instanceof PaidWorkError ? error.status : 502 },
  );
}

export type PaidReconciliationReceipt = {
  verified: true;
  id: string;
  owner: string;
  providerRequestId?: string;
  reference: string;
} & (
  | { model: "exa-instant"; costMicros: number; usage?: never }
  | {
      model: Exclude<PaidModel, "exa-instant">;
      usage: PaidUsage;
      costMicros?: never;
    }
);

/** Operator recovery only. Requires independently verified provider usage/cost, never a browser claim. */
export async function reconcilePaidWork(receipt: PaidReconciliationReceipt) {
  if (
    receipt.verified !== true ||
    typeof receipt.reference !== "string" ||
    receipt.reference.length < 8 ||
    receipt.reference.length > 500
  )
    throw new PaidWorkError(
      "invalid_usage",
      "A verified provider receipt and reconciliation reference are required.",
    );
  const [attempt] = await db().query(
    "select * from paid_attempts where id=$1 and owner_id=$2",
    [receipt.id, receipt.owner],
  );
  if (
    !attempt ||
    attempt.model !== receipt.model ||
    attempt.price_version !== PRICE_VERSION ||
    (attempt.provider_request_id &&
      attempt.provider_request_id !== receipt.providerRequestId)
  )
    throw new PaidWorkError(
      "invalid_usage",
      "The reconciliation receipt does not match the recorded attempt, model or provider request.",
    );
  let actual: number;
  if (receipt.model === "exa-instant") {
    if (!integer(receipt.costMicros) || Object.hasOwn(receipt, "usage"))
      throw new PaidWorkError(
        "invalid_usage",
        "Exa reconciliation requires a verified integer microUSD cost receipt, not a token estimate.",
      );
    actual = receipt.costMicros;
  } else {
    if (Object.hasOwn(receipt, "costMicros"))
      throw new PaidWorkError(
        "invalid_usage",
        "Token-priced reconciliation requires provider token usage.",
      );
    try {
      actual = usageMicros(receipt.model, receipt.usage);
    } catch (error) {
      if (error instanceof PaidBoundExceeded)
        await recordPaidFailure(
          {
            id: attempt.id,
            model: receipt.model,
            reservedMicros: Number(attempt.reserved_micros),
          },
          error,
          receipt,
        );
      throw error;
    }
  }
  const result = await db().query(
    "select settle_paid_attempt($1,$2,false,$3::jsonb) as status",
    [receipt.id, actual, JSON.stringify(receipt)],
  );
  if (result[0]?.status === "overrun")
    throw new PaidWorkError(
      "invalid_usage",
      "Verified usage exceeded its reservation; costs were recorded and paid work is halted. Investigate the bound before resuming.",
    );
  return { id: receipt.id, status: result[0]?.status, actualUsd: actual / 1e6 };
}
