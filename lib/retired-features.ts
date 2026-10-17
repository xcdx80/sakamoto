/** Unsupported optional work stays unavailable; existing saved results remain readable. */
export const RETIRED_FEATURES = {
  speech: "Reading aloud is unavailable. The saved text remains readable.",
  covers:
    "New cover generation is unavailable. Existing saved covers remain available.",
  pdfVision:
    "PDF OCR and layout upgrades are unavailable. Use a PDF with a readable text layer or supply extracted text.",
  pdfCareful:
    "Additional PDF parsing is unavailable. Existing saved text and the original local file are unchanged.",
  key: "Personal model keys are no longer used. Answers and processing use the configured server providers and processing budget.",
} as const;
export function retiredFeature(feature: keyof typeof RETIRED_FEATURES) {
  return Response.json(
    { code: "feature_unavailable", error: RETIRED_FEATURES[feature] },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
