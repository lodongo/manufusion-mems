/** Independent DRKMS scanning worker. Deploy as a SEPARATE private Cloud Run service.
 * Cloud Run IAM must block unauthenticated invocation; this service owns no Firestore write credentials.
 */
import {createServer} from 'node:http';
import {Storage} from '@google-cloud/storage';
import {createHash,createHmac} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
const scan=promisify(execFile);
const gs=new Storage();
const bucket=process.env.MEMS_STORAGE_BUCKET??'';
const secret=process.env.MEMS_DRKMS_SCANNER_HMAC_SECRET??'';
const callback=process.env.MEMS_SCANNER_CALLBACK_URL??'';
const id=(v:string)=>/^[a-f0-9]{20}$/.test(v);
const tenant=(v:string)=>/^[a-zA-Z0-9_-]{3,128}$/.test(v);
const hex=(v:string)=>/^[a-f0-9]{64}$/.test(v);
if(!bucket||secret.length<32||!/^https:\/\/[^/]+\/api\/internal\/drkms\/scanner-verdict$/.test(callback))
 throw new Error('Scanner bucket, signing secret and HTTPS MEMS callback must be configured.');
const MAX=8_000_000;
async function inspect(body:Record<string,unknown>){
 const orgId=String(body.orgId??''),documentId=String(body.documentId??''),fileId=String(body.fileId??''),
  sha256=String(body.sha256??''),extension=String(body.extension??'');
 if(!tenant(orgId)||!id(documentId)||!id(fileId)||!hex(sha256)||!/^(pdf|png|jpg|docx|xlsx|pptx)$/.test(extension))
  throw new Error('Invalid request identifiers.');
 const path=`organizations/${orgId}/drkms_quarantine/${documentId}/${fileId}.${extension}`;
 const [metadata]=await gs.bucket(bucket).file(path).getMetadata();
 if(Number(metadata.size)>MAX||!metadata.size)throw new Error('Invalid quarantine object size.');
 const [content]=await gs.bucket(bucket).file(path).download();
 if(content.length>MAX||createHash('sha256').update(content).digest('hex')!==sha256)
  throw new Error('Source bytes or expected digest mismatch.');
 const dir=await mkdtemp(join(tmpdir(),'mems-scan-'));
 let verdict='error',engineVersion='unknown';
 try{
  const target=join(dir,'source.'+extension);
  await writeFile(target,content,{flag:'wx',mode:0o600});
  try{
   const v=await scan('clamscan',['--version'],{timeout:10000});
   engineVersion=(v.stdout.trim().split(' ')[1]??'unknown').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80)||'unknown';
   await scan('clamscan',['--no-summary','--infected',target],{timeout:120000,maxBuffer:100000});
   verdict='clean';
  }catch(err){
   const failure=err as {code?:number};
   verdict=failure.code===1?'infected':'error';
  }
 }finally{await rm(dir,{recursive:true,force:true});}
 const scannedAt=new Date().toISOString(),engine='ClamAV';
 const fields=[orgId,documentId,fileId,sha256,verdict,engine,engineVersion,scannedAt];
 const signature=createHmac('sha256',secret).update(JSON.stringify(fields)).digest('hex');
 const response=await fetch(callback,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({orgId,documentId,fileId,sha256,verdict,engine,engineVersion,scannedAt,signature}),
  signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('MEMS verdict callback rejected: HTTP '+response.status);
 return {accepted:true,verdict};
}
const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 res.setHeader('cache-control','no-store');
 if(req.method!=='POST'||req.url!=='/scan'){res.statusCode=404;res.end('{"error":"Not found"}');return;}
 let raw='';req.on('data',part=>{raw+=String(part);if(raw.length>4000)req.destroy();});
 req.on('end',async()=>{
  try{const result=await inspect(JSON.parse(raw) as Record<string,unknown>);res.end(JSON.stringify(result));}
  catch(err){console.error('scanner processing failed',err instanceof Error?err.message:'unknown');
   res.statusCode=503;res.end('{"error":"Scanner could not complete trusted verification"}');}
 });
});
server.listen(Number(process.env.PORT||8080));
