export const POST_CONTEXT_PASSAGE_LIMIT = 20;
export const POST_WEB_CONTEXT_SLOTS = 5;
const AUTHOR_CONTEXT_SLOTS = 2;
export const POST_PINNED_SOURCE_LIMIT = POST_CONTEXT_PASSAGE_LIMIT - POST_WEB_CONTEXT_SLOTS - AUTHOR_CONTEXT_SLOTS;

export class PinnedSourceLimitError extends Error {}

export function assertPinnedSourceLimit(sourceIds: readonly string[]): void {
  if (new Set(sourceIds).size > POST_PINNED_SOURCE_LIMIT)
    throw new PinnedSourceLimitError(`Choose at most ${POST_PINNED_SOURCE_LIMIT} pinned sources so your notes and automatic research fit the writing context. Remove extra pins and try again.`);
}
