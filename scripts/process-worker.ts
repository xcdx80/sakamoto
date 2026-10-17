/** Same-repository local worker. Stop with Ctrl-C; the current bounded batch is awaited before exit. */
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {runProcessingWorker} from '../lib/processing-worker';
async function main(){
 const args=process.argv.slice(2);
 if(args.includes('--help')){console.log('npm run process:worker -- --single-owner [--minutes 30] [--database-fingerprint <16 hex>]\nOr --owner <Clerk user ID>. Only one owner is processed. No X API retrieval.');return;}
 const value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--single-owner')continue;
  if(['--owner','--minutes','--database-fingerprint'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}
  throw new Error('Unknown or incomplete worker option. Use --help.');
 }
 const minutes=Number(value('--minutes')??30);if(!Number.isInteger(minutes)||minutes<1||minutes>240)throw new Error('Choose 1 to 240 minutes.');
 const url=new URL(process.env.DATABASE_URL??''),fingerprint=createHash('sha256').update(url.host+url.pathname).digest('hex').slice(0,16);
 const expected=value('--database-fingerprint');if(expected&&expected!==fingerprint)throw new Error('Worker database fingerprint differs.');
 let owner=value('--owner');
 if(args.includes('--single-owner')){
  if(owner)throw new Error('Choose --owner or --single-owner.');
  const owners=await db().query(`select distinct j.user_id from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id and a.source_revision=j.source_revision where not a.deleted and j.state in ('pending','retryable','running') limit 2`);
  if(!owners.length){console.log(JSON.stringify({state:'idle',processed:0,databaseFingerprint:fingerprint}));return;}
  if(owners.length!==1)throw new Error('Multiple accounts have pending work. Supply --owner explicitly.');owner=owners[0].user_id;
 }
 if(!owner)throw new Error('Supply --single-owner or --owner.');
 let stopped=false;const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 console.log(JSON.stringify({state:'starting',pid:process.pid,databaseFingerprint:fingerprint,concurrency:6,maxBatchJobs:48,minutes}));
 try{const result=await runProcessingWorker(owner,{minutes,stopped:()=>stopped,progress:value=>console.log(JSON.stringify(value))});console.log(JSON.stringify(result));}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
main().catch(()=>{console.error('Worker stopped or could not start. Check options, database configuration and existing worker status. Saved work and budget reservations remain durable.');process.exitCode=1;});
