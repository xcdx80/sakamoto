import { indexSavedSource } from "./indexing";
import type { ProcessingHandler } from "./processing";
let installed = false;
/** Called after the job registry exists, from every bounded processing entrypoint. */
export function registerLibraryProcessingHandlers(
  register: (kind: string, handler: ProcessingHandler) => void,
) {
  if (installed || !process.env.GOOGLE_API_KEY) return;
  installed = true;
  register("indexing", indexSavedSource);
}
