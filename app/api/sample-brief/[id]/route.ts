import { readSampleBrief } from "@/lib/sample-reader";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const brief = await readSampleBrief((await params).id);
    if (brief) return Response.json({ brief });
    return Response.json({ error: "This example summary is unavailable." }, { status: 404 });
  } catch {
    return Response.json({ error: "Could not load this example summary. Try again." }, { status: 503 });
  }
}
