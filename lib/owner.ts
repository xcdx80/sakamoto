import { auth } from "@clerk/nextjs/server";
import { hashToken, looksLikeToken } from "./agent";
import { tokenUser } from "./db";

/** Explicit bearer credentials never fall back to an unrelated browser session. */
export async function requestOwner(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  let owner: string | null;
  if (authorization) {
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    owner = looksLikeToken(token) ? ((await tokenUser(hashToken(token)))?.userId ?? null) : null;
  } else owner = (await auth()).userId;
  const expected = req.headers.get("x-sakamoto-owner");
  return expected && expected !== owner ? null : owner;
}
