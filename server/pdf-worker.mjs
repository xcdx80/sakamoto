/** Node-only text extraction. Terminating this worker interrupts synchronous WASM too. */
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import init, { LiteParse } from '@llamaindex/liteparse-wasm';
let parser, session;
try {
  const wasm = await readFile(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url));
  await init({module_or_path:wasm});
  parser = new LiteParse({ocrEnabled:false,outputFormat:'json',extractBlocks:true,imageMode:'off',quiet:true,maxPages:80});
  session = await parser.openBatchSession(new Uint8Array(workerData.bytes),1);
  const pages = [], missingPages = []; let size = 0, limited = false;
  for (let batch = await session.nextBatch(); batch; batch = await session.nextBatch()) {
    for (const page of batch.result.pages) {
      const text = page.text.trim();
      // Empty/garbled text is never represented as a successful text-layer reading.
      if (!text || (text.match(/[\ufffd\ue000-\uf8ff]/g)?.length ?? 0) > 3) {missingPages.push(page.pageNum); continue;}
      size += Buffer.byteLength(text);
      if (size > 1_000_000) { limited = true; break; }
      pages.push({page:page.pageNum,text});
    }
    for (const error of batch.result.pageErrors ?? []) {
      const page = error.pageNum ?? error.pageNumber;
      if (Number.isInteger(page)) missingPages.push(page);
    }
    if (limited) break;
  }
  parentPort.postMessage({ok:true,pages,totalPages:session.totalPages,missingPages:[...new Set(missingPages)],limited:limited || session.totalPages > 80});
} catch (error) {
  parentPort.postMessage({ok:false,error:/password|encrypt/i.test(String(error)) ? 'This PDF is encrypted or password protected. Supply extracted text or an unlocked source.' : 'The PDF text layer could not be read. Supply extracted text instead.'});
} finally { session?.free(); parser?.free(); }
