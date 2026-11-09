/** Wire contract shared by browser snapshot extraction and authenticated server intake. No I/O. */
export type BookmarkOrder = { postIds: string[]; observedAt: string };
export const BOOKMARK_ORDER_SCHEMA={type:'object',properties:{postIds:{type:'array',maxItems:20000,uniqueItems:true,items:{type:'string',pattern:'^[1-9][0-9]{0,23}$'},description:'Only genuinely bookmarked post IDs, in observed newest-saved-first X order.'},observedAt:{type:'string',format:'date-time'}},required:['postIds','observedAt'],additionalProperties:false};

export function bookmarkOrderOf(raw: unknown): BookmarkOrder {
 if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('Expected bookmark order.');
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['postIds','observedAt'].includes(key)) || !Array.isArray(value.postIds) || value.postIds.length>20000 || value.postIds.some(id=>typeof id!=='string'||!/^[1-9]\d{0,23}$/.test(id)) || new Set(value.postIds).size!==value.postIds.length)throw new Error('Bookmark order needs at most 20,000 distinct X post IDs.');
 if(typeof value.observedAt!=='string' || !/^\d{4}-\d\d-\d\dT/.test(value.observedAt) || !Number.isFinite(Date.parse(value.observedAt)) || Date.parse(value.observedAt)>Date.now()+60_000)throw new Error('Bookmark order needs a valid observation date.');
 return {postIds:value.postIds as string[],observedAt:new Date(value.observedAt).toISOString()};
}
