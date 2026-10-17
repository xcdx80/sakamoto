import { auth } from "@clerk/nextjs/server";
import { hashToken, looksLikeToken } from "./agent";
import { tokenUser } from "./db";

/** The expected identity is shared by session-only credential management and library operations. */
function intendedOwner(req:Request,owner:string|null):string|null {
  const expected=req.headers.get("x-sakamoto-owner");
  return expected && expected!==owner ? null : owner;
}

/** Personal MCP credentials never grant connection credential-management privileges. */
export async function sessionOwner(req:Request):Promise<string|null> {
  if(req.headers.has("authorization"))return null;
  return intendedOwner(req,(await auth()).userId);
}

/** Explicit bearer credentials never fall back to an unrelated browser session. */
export async function requestOwner(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  let owner: string | null;
  if (authorization) {
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    owner = looksLikeToken(token) ? ((await tokenUser(hashToken(token)))?.userId ?? null) : null;
  } else owner = (await auth()).userId;
  return intendedOwner(req,owner);
}
