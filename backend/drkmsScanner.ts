/** Malware scan callback: only a separately provisioned scanner may release quarantine.
 * HMAC verifies scanner identity; storage bytes verify file identity.
 */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {publicRoute} from './guards';
import {HttpError,getDoc,nowIso,rateLimit,str,writeDoc} from './core';
import {storage} from './platform/sdk';
const ID=/^[a-f0-9]{20}$/;
const ORG=/^[a-zA-Z0-9_-]{3,128}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const STATUS=new Set(['clean','infected','error']);
export type ScanVerdict={orgId:string;documentId:string;fileId:string;sha256:string;verdict:string;engine:string;engineVersion:string;scannedAt:string};
export function scannerSignature(secret:string,v:ScanVerdict):string{
 return createHmac('sha256',secret).update(JSON.stringify([v.orgId,v.documentId,v.fileId,v.sha256,v.verdict,v.engine,v.engineVersion,v.scannedAt])).digest('hex');
}
export function validScannerVerdict(v:ScanVerdict,now=Date.now()):boolean{
 const t=Date.parse(v.scannedAt);
 return ORG.test(v.orgId)&&ID.test(v.documentId)&&ID.test(v.fileId)&&DIGEST.test(v.sha256)
  &&STATUS.has(v.verdict)&&/^[a-zA-Z0-9_.-]{3,100}$/.test(v.engine)
  &&/^[a-zA-Z0-9_.-]{1,80}$/.test(v.engineVersion)&&Number.isFinite(t)
  &&Math.abs(t-now)<=5*60*1000;
}
export const drkmsScannerRoutes={
 'POST /api/internal/drkms/scanner-verdict':[
  publicRoute(async(body,meta)=>{
   await rateLimit('drkms-scanner-callback',meta.ip,30,3600);
   const raw=body as Record<string,unknown>;
   const verdict:ScanVerdict={orgId:str(raw.orgId),documentId:str(raw.documentId),fileId:str(raw.fileId),
    sha256:str(raw.sha256),verdict:str(raw.verdict),engine:str(raw.engine),
    engineVersion:str(raw.engineVersion),scannedAt:str(raw.scannedAt)};
   const supplied=str(raw.signature);
   const secret=process.env.MEMS_DRKMS_SCANNER_HMAC_SECRET;
   if(!secret||secret.length<32)throw new HttpError(503,'Trusted malware scanning is not configured.');
   if(!validScannerVerdict(verdict)||!DIGEST.test(supplied))throw new HttpError(403,'Invalid scanner attestation.');
   const expected=Buffer.from(scannerSignature(secret,verdict),'hex');
   if(!timingSafeEqual(expected,Buffer.from(supplied,'hex')))throw new HttpError(403,'Scanner attestation not trusted.');
   const filePath=`organizations/${verdict.orgId}/drkms_documents/${verdict.documentId}/files/${verdict.fileId}`;
   const file=await getDoc(filePath);
   if(!file||str(file.data.tenantId)!==verdict.orgId||str(file.data.documentId)!==verdict.documentId
     ||str(file.data.sha256)!==verdict.sha256||str(file.data.scanStatus)!=='pending'
     ||str(file.data.availability)!=='quarantined')
    throw new HttpError(409,'File not pending trusted verification.');
   const path=str(file.data.storagePath);
   if(!path.startsWith(`organizations/${verdict.orgId}/drkms_quarantine/${verdict.documentId}/${verdict.fileId}.`))
    throw new HttpError(409,'Invalid quarantine storage identity.');
   const bytes=await storage.read(path);
   if(bytes.length!==Number(file.data.bytes)||createHash('sha256').update(bytes).digest('hex')!==verdict.sha256)
    throw new HttpError(409,'Quarantined bytes do not match the scan report.');
   const clean=verdict.verdict==='clean';
   const ok=await writeDoc(filePath,{...file.data,scanStatus:verdict.verdict,
    availability:clean?'verified':'quarantined',scannerEngine:verdict.engine,
    scannerVersion:verdict.engineVersion,scannedAt:verdict.scannedAt,
    scanVerifiedAt:nowIso(),scanProofDigest:createHash('sha256').update(supplied).digest('hex')},
    {updateTime:file.updateTime});
   if(!ok)throw new HttpError(409,'Scanner verdict was already committed or file changed.');
   return {accepted:true,scanStatus:verdict.verdict};
  }),
 ],
};
