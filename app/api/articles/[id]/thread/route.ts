import { requestOwner } from '@/lib/owner';
import { readAuthorThread } from '@/lib/threads';
export const runtime = 'nodejs';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requestOwner(req);
  if (!owner) return Response.json({error:'Sign in to read saved threads.'},{status:401});
  const thread = await readAuthorThread(owner,(await params).id,{limit:Number(new URL(req.url).searchParams.get('limit')) || 100});
  if (!thread) return Response.json({error:'Not found.'},{status:404});
  return Response.json(thread,{headers:{'Cache-Control':'private, no-store'}});
}
