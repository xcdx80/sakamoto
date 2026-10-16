import { classifySavedSource } from "./classification";
import type { ProcessingHandler } from "./processing";
/** Called only after the registry exists; adapters depend on processing types only. */
export function registerLibraryProcessingHandlers(
  register: (kind: string, handler: ProcessingHandler) => void,
) {
  if (process.env.TYPESAFE_API_KEY)
    register("classification", classifySavedSource);
}
