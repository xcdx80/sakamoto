import { sessionOwner } from "@/lib/owner";
import { adminFailuresHttp } from "@/lib/admin-failure-http";

export const runtime = "nodejs";
export async function GET(req: Request) { return adminFailuresHttp(req, await sessionOwner(req)); }
export async function POST(req: Request) { return adminFailuresHttp(req, await sessionOwner(req)); }
