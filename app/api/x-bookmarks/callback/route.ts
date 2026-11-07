import { sessionOwner } from '@/lib/owner';
import { xConnectionHttp } from '@/lib/x-bookmark-http';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request){return xConnectionHttp(req,await sessionOwner(req));}
