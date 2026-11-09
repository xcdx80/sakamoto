import { sessionOwner } from '@/lib/owner';
import { xSyncHttp } from '@/lib/x-bookmark-http';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request){return xSyncHttp(req,await sessionOwner(req));}
export async function POST(req:Request){return xSyncHttp(req,await sessionOwner(req));}
