/** Persisted compatibility identity. Change the version and explicitly reindex when instructions/chunks change. */
export const EMBEDDING_CONTRACT = {
  model: "gemini-embedding-2",
  dimensions: 768,
  promptVersion: "search-prefix-v1",
  chunkVersion: "block-600-overlap-80-v1",
} as const;
export const INDEX_CONTRACT =
  "gemini-embedding-2:768:search-prefix-v1:block-600-overlap-80-v1";
