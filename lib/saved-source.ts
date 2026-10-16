/** Read the exact structured post retained by intake, without credentials, excerpts or reader annotations. */
import { articleDoc,db } from './db';
export async function readSavedSource(owner:string,args:Record<string,unknown>) {
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['itemId','revision'].includes(k)))throw new Error('Read a saved source by itemId and optional revision only.');
 if(typeof args.itemId!=='string'||!args.itemId.trim()||args.itemId.length>200||args.itemId.includes('\0'))throw new Error('itemId must be nonempty text of at most 200 characters.');
 if(args.revision!==undefined&&(!Number.isSafeInteger(args.revision)||Number(args.revision)<1||Number(args.revision)>2147483647))throw new Error('revision must be a positive32-bit source revision.');
 const itemId=args.itemId,revision=args.revision as number|undefined;
 const missing={status:'not_found' as const,itemId};
 // articleDoc's historical revision interface also supports retained annotations. Explicitly require
 // an active current item here, so this source-comparison tool cannot read a removed source.
 const active=await articleDoc(owner,itemId) as Record<string,unknown>|null;
 if(!active)return missing;
 const doc=revision===undefined||revision===active.sourceRevision?active:await articleDoc(owner,itemId,revision) as Record<string,unknown>|null;
 if(!doc)return missing;
 if(!doc.post||typeof doc.post!=='object'||Array.isArray(doc.post)||typeof (doc.post as Record<string,unknown>).fullText!=='string')return {status:'unsupported' as const,itemId,sourceRevision:doc.sourceRevision,notice:'Only saved structured X posts and context posts support exact bookmark-source comparison.'};
 const result={status:'found' as const,itemId,sourceRevision:doc.sourceRevision,post:doc.post};
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>2000000)return {status:'too_large' as const,itemId,sourceRevision:doc.sourceRevision,notice:'This legacy source exceeds the 2 MB source-response bound. No text was truncated or substituted.'};
 // A final eligibility read excludes a deletion that happened during source loading/serialization.
 const eligible=await db().query('select id from articles where user_id=$1 and id=$2 and not deleted and doc is not null',[owner,itemId]);
 return eligible.length?result:missing;
}
