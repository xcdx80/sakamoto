/** Server text-layer PDF adapter. No browser imports, key reads, OCR or external parser. */
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tidyTitle, type Article } from './article';
import type { ProcessingOutcome } from './processing';
type Extraction = {ok:true;pages:{page:number;text:string}[];totalPages:number;missingPages:number[];limited:boolean} | {ok:false;error:string};
async function extract(bytes: ArrayBuffer, deadline: number, signal: AbortSignal): Promise<Extraction> {
  return new Promise((resolve) => {
    if (signal.aborted || deadline <= Date.now()) return resolve({ok:false,error:'PDF extraction timed out. Retry or supply extracted text.'});
    const worker = new Worker(join(process.cwd(),'server/pdf-worker.mjs'), {workerData:{bytes},transferList:[bytes],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
    let settled = false;
    const finish = (result: Extraction) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort',abort); void worker.terminate().then(()=>resolve(result),()=>resolve(result)); };
    const abort = () => finish({ok:false,error:'PDF extraction timed out. Retry or supply extracted text.'});
    const configured = Number(process.env.PDF_EXTRACTION_TIMEOUT_MS);
    const budget = Number.isInteger(configured) && configured > 0 ? Math.min(configured,8_000) : 8_000;
    const timer = setTimeout(abort, Math.max(1,Math.min(budget,deadline-Date.now())));
    signal.addEventListener('abort',abort,{once:true});
    worker.once('message',finish);
    worker.once('error',()=>finish({ok:false,error:'PDF extraction worker failed. Retry or supply extracted text.'}));
    worker.once('exit',(code)=>{if (!settled) finish({ok:false,error:`PDF extraction stopped (${code}). Retry or supply extracted text.`});});
  });
}
export async function readLinkedPdf(bytes:ArrayBuffer,name:string,url:string,deadline:number,signal:AbortSignal):Promise<ProcessingOutcome> {
  if (bytes.byteLength > 25_000_000) return {state:'terminal',error:'PDF exceeds the 25 MB import limit. Supply extracted text instead.'};
  const digest = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  const result = await extract(bytes,deadline,signal);
  if (!result.ok) return {state:/timed out|worker failed|stopped/.test(result.error)?'retryable':'terminal',error:result.error};
  if (!result.pages.length) return {state:'terminal',error:result.limited?'PDF text exceeds the 1 MB extraction limit before a complete page can be retained. Supply extracted text instead.':'This PDF has no readable text layer (it may be scanned). Supply extracted text; automatic OCR is not enabled.'};
  const partial = result.limited || result.missingPages.length>0 || result.pages.length < result.totalPages;
  const pdfSource: NonNullable<Article['pdfSource']> = {extractor:'liteparse-text-2.15.1',sha256:digest,status:partial?'partial':'complete',totalPages:result.totalPages,parsedPages:result.pages.map(p=>p.page),missingPages:result.missingPages,...(result.limited?{reason:'Stopped at the 80 page or 1 MB extracted-text limit.'}:{})};
  const blocks: Article['blocks'] = result.pages.map(p=>({id:`p${p.page}-text`,type:'p',page:p.page,runs:[{text:p.text}]}));
  if (partial) blocks.unshift({id:'pdf-coverage',type:'note',runs:[{text:`Partial PDF text: ${result.pages.length} of ${result.totalPages} pages retained.${result.missingPages.length?' Unreadable pages: '+result.missingPages.join(', ')+'.':''} ${pdfSource.reason??'Some pages have no usable text layer.'} No OCR was purchased.`}]});
  return {state:'complete',article:{id:'pdf-'+crypto.randomUUID(),title:tidyTitle(name.replace(/\.pdf$/i,'')) || 'Linked PDF',source:new URL(url).hostname,sourceUrl:url,origin:'url',contentType:'document',blocks,pdfSource},canonicalUrl:url,checkpoint:{extracted:true,sha256:digest,coverage:pdfSource.status}};
}
