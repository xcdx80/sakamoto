import { classifySavedSource } from "./classification";
import { indexSavedSource } from "./indexing";
import type { ProcessingHandler } from "./processing";
let classificationInstalled = false;
let indexingInstalled = false;
/** Called after the registry exists. Each real provider is independently optional. */
export function registerLibraryProcessingHandlers(
  register: (kind: string, handler: ProcessingHandler) => void,
) {
  if (!classificationInstalled) {
    classificationInstalled = true;
    register("classification", classifySavedSource);
  }
  if (!indexingInstalled) {
    indexingInstalled = true;
    register("indexing", indexSavedSource);
  }
}
