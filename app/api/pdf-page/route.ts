import { retiredFeature } from "@/lib/retired-features";
export const runtime = "nodejs";
/** Compatibility response for clients with an unavailable optional action. */
export function POST(_req: Request) {
  return retiredFeature("pdfVision");
}
