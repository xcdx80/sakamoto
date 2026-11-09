import {db} from './db';

/** Resolve source-bound X link work from this reader's saved posts, without fetching or copying content. */
export async function reconcileSavedPostLinks(owner:string,limit=48):Promise<number>{
 if(!owner||!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('Choose a reader and at most 1000 saved-post link tasks.');
 const [result]=await db().query('select resolve_saved_post_links($1,$2) as resolved',[owner,limit]);
 return Number(result.resolved);
}
