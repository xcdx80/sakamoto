/** Reader choices survive source refresh and are the only fields rebased from stale browser metadata. */
export const READER_METADATA_FIELDS = ["title", "topic", "tags", "favorite", "finishedAt", "cover"] as const;

export type ReaderMetadataField = (typeof READER_METADATA_FIELDS)[number];
