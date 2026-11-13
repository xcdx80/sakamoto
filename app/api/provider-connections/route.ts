import { sessionOwner } from "@/lib/owner";
import { providerConnectionsHttp } from "@/lib/provider-connections-http";
export const runtime = "nodejs";
export async function GET(req: Request) { return providerConnectionsHttp(req, await sessionOwner(req)); }
export async function POST(req: Request) { return providerConnectionsHttp(req, await sessionOwner(req)); }
