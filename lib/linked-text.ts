/** Deliberate text recovery of a retained failed link. Never refreshes an existing source. */
import { db } from './db';
import { wordCount, type Article } from './article';
export async function supplyLinkedText(owner:string,args:Record<string,unknown>) {
  if (typeof args.jobId!=='string' || !/^\d+$/.test(args.jobId) || typeof args.text!=='string' || !args.text.trim() || Buffer.byteLength(args.text)>1_000_000 || (args.title!==undefined && (typeof args.title!=='string' || args.title.length>500)) || Object.keys(args).some(k=>!['jobId','text','title'].includes(k))) throw new Error('Supply a job ID and up to 1 MB of extracted text.');
  const rows=await db().query('select target from processing_jobs where user_id=$1 and id=$2::bigint and kind=\'link\'',[owner,args.jobId]);
  if (!rows.length) return null;
  const url=rows[0].target;
  // Extracted source is literal text: never consume its first line as metadata or parse Markdown.
  const article:Article={
    id:'recovered-'+crypto.randomUUID(),
    title:typeof args.title==='string'&&args.title.trim()?args.title:'Recovered linked document',
    origin:'paste',sourceUrl:url,source:new URL(url).hostname,contentType:'document',
    blocks:[{id:'b1',type:'p',runs:[{text:args.text}]}],
  };
  article.pdfSource={extractor:'reader-supplied-text',status:'manual',reason:'Text supplied by the reader. Original PDF pages and completeness were not independently verified.'};
  const data={id:article.id,title:article.title,words:wordCount(article),source:article.source,sourceUrl:url,origin:'paste',contentType:'document',addedAt:Date.now(),addedVia:'Reader supplied linked text',processing:{classification:'pending',indexing:'pending'}};
  const result=await db().query('select supply_processing_text($1,$2::bigint,$3,$4::jsonb,$5::jsonb) as id',[owner,args.jobId,crypto.randomUUID(),JSON.stringify(data),JSON.stringify(article)]);
  return result[0]?.id?{itemId:result[0].id,readUrl:'/read/'+encodeURIComponent(result[0].id),provenance:'reader-supplied-text'}:null;
}
