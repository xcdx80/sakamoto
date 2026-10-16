import { classifySavedSource } from "./classification";
import { indexSavedSource } from "./indexing";
import type { ProcessingHandler } from "./processing";
let classificationInstalled = false;
let indexingInstalled = false;
/** Called after the registry exists. Each real provider is independently optional. */
export function registerLibraryProcessingHandlers(
  register: (kind: string, handler: ProcessingHandler) => void,
) {
  if (!classificationInstalled && process.env.TYPESAFE_API_KEY) {
    classificationInstalled = true;
    register("classification", classifySavedSource);
  }
  if (!indexingInstalled && process.env.GOOGLE_API_KEY) {
    indexingInstalled = true;
    register("indexing", indexSavedSource);
  }
}
