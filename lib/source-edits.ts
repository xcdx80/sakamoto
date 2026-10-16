/** Editing source text creates reader-authored prose, not a new observation of the original post/PDF. */
import type { Article } from "./article";

export function derivedDocument(
  article: Article,
  source = "Reader-edited text",
): Article {
  const copy: Article = {
    ...article,
    origin: "paste",
    contentType: "document",
    source,
    blocks: article.blocks.map((block) => {
      const copy = { ...block };
      delete copy.page;
      return copy;
    }),
  };
  delete copy.pendingSource;
  delete copy.post;
  delete copy.pdfSource;
  delete copy.sourceUrl;
  delete copy.author;
  delete copy.published;
  delete copy.image;
  delete copy.dek;
  delete copy.upgrade;
  return copy;
}

/** Source-owned metadata must agree with the derived body; reader choices and internal identities survive. */
export function derivedDocumentMetadata<T extends object>(metadata: T): T {
  const copy = {
    ...metadata,
    origin: "paste",
    contentType: "document",
    source: "Reader-edited text",
  } as T & Record<string, unknown>;
  for (const field of ["sourceUrl", "author", "year", "image", "dek", "postId"])
    delete copy[field];
  return copy;
}
