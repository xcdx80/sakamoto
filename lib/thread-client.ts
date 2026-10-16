import { accountEpoch, accountScope } from './account-scope';
import type { AuthorThread } from './threads';

/** Account-bound transport; a response from a previous account is never published to the reader. */
export async function fetchAuthorThread(itemId: string, signal: AbortSignal): Promise<AuthorThread | null> {
  const owner = accountScope(), epoch = accountEpoch();
  if (!owner) return null;
  const response = await fetch(`/api/articles/${encodeURIComponent(itemId)}/thread`, { headers: { 'X-Sakamoto-Owner': owner }, cache: 'no-store', signal });
  if (!response.ok) return null;
  const thread = await response.json() as AuthorThread;
  return accountEpoch() === epoch && accountScope() === owner ? thread : null;
}
