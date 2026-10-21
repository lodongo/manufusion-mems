/** Server-rendered signed copy: verified PDF original remains immutable in storage. */
import {createHash} from 'node:crypto';
import QRCode from 'qrcode';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {storage} from './platform/sdk';
import {HttpError,getDoc,isObj,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {canAt,nodePath,scopeOf} from './access';
const ID=/^[a-f0-9]{20}$/;
const REV=/^[a-f0-9]{64}$/;
const root=(o:string,d:string)=>`organizations/${o}/drkms_documents/${d}`;
const verifiedUrl=(doc:string,proof:string)=>{
 const origin=(process.env.MEMS_PUBLIC_APP_URL??process.env.MEMS_PUBLIC_URL??'').replace(/\/$/,'');
 if(!/^https:\/\/[-a-zA-Z0-9.]+(?::[0-9]{2,5})?$/.test(origin))
  throw new HttpError(503,'Configure a trusted MEMS_PUBLIC_APP_URL before issuing signed originals.');
 return origin+'/#/verify/document/'+doc+'/'+proof;
};
export const drkmsSignedExportRoutes={
 'POST /api/org/drkms/documents/signed-copy':[
  orgRoute('drkms.documents.signed_copy','ADM.document_registry',async ctx=>{
   const documentId=str(ctx.body.documentId),fileId=str(ctx.body.fileId);
   if(!ID.test(documentId)||!ID.test(fileId))throw new HttpError(400,'Valid document and file required.');
   const path=root(ctx.orgId,documentId),doc=await getDoc(path);
   if(!doc||str(doc.data.status)!=='effective')throw new HttpError(409,'Only current effective documents can be issued as signed originals.');
   const revId=str(doc.data.effectiveRevisionId);
   if(!REV.test(revId))throw new HttpError(409,'Missing approved revision.');
   const revision=await getDoc(path+'/revisions/'+revId);
   if(!revision||revision.data.immutable!==true||str(revision.data.documentId)!==documentId||
      str(revision.data.tenantId)!==ctx.orgId)throw new HttpError(409,'Approved source revision not verified.');
   const nodeId=isObj(revision.data.scope)?str(revision.data.scope.nodeId):'';
   if(!nodeId||!canAt(ctx,'ADM.document_registry',await nodePath(ctx.orgId,nodeId),await scopeOf(ctx)))
    throw new HttpError(403,'Document is outside your authorized scope.');
   const manifest=Array.isArray(revision.data.sourceFiles)?revision.data.sourceFiles.filter(isObj):[];
   const item=manifest.find(x=>str(x.fileId)===fileId);
   if(!item||str(item.mime)!=='application/pdf')
    throw new HttpError(400,'In-place signature stamping currently supports original PDF documents only.');
   if(manifest.length!==1)throw new HttpError(409,'Multi-file documents require an explicit per-file signature assignment.');
   const proofs=Array.isArray(revision.data.signatureProofs)?revision.data.signatureProofs.filter(isObj):[];
   if(!proofs.length)throw new HttpError(409,'No approved signatories were captured for this document.');
   const original=await getDoc(path+'/files/'+fileId);
   if(!original||str(original.data.scanStatus)!=='clean'||str(original.data.availability)!=='verified'
      ||str(original.data.sha256)!==str(item.sha256)||str(original.data.mime)!==str(item.mime))
    throw new HttpError(409,'The source file does not match the approved manifest.');
   const destination=`organizations/${ctx.orgId}/drkms_signed/${documentId}/${revId}/${fileId}.pdf`;
   const index=path+'/signed_copies/'+fileId;
   const cached=await getDoc(index);
   if(cached&&str(cached.data.revisionId)===revId){
    const [signed]=await storage.url([destination]);
    if(!signed?.url)throw new HttpError(502,'Could not provide signed copy.');
    return {url:signed.url,revisionId:revId,signatures:proofs.length,alreadyIssued:true};
   }
   const sourcePath=str(original.data.storagePath);
   if(!sourcePath.startsWith(`organizations/${ctx.orgId}/drkms_quarantine/${documentId}/${fileId}.`))
    throw new HttpError(409,'Invalid approved source storage path.');
   const bytes=await storage.read(sourcePath);
   if(bytes.length>8_000_000||createHash('sha256').update(bytes).digest('hex')!==str(item.sha256))
    throw new HttpError(409,'Source PDF size or checksum changed.');
   let pdf:PDFDocument;
   try{pdf=await PDFDocument.load(bytes,{updateMetadata:false});}
   catch{throw new HttpError(409,'The source PDF could not be safely rendered.');}
   const font=await pdf.embedFont(StandardFonts.Helvetica);
   for(const proof of proofs){
    const position=proof.position;
    if(!isObj(position))throw new HttpError(409,'Invalid approved signature placement.');
    const pageNumber=Number(position.page),xP=Number(position.xPercent),yP=Number(position.yPercent),wP=Number(position.widthPercent);
    if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>pdf.getPageCount()||
       ![xP,yP,wP].every(Number.isFinite)||xP<0||yP<0||xP>90||yP>90||wP<10||xP+wP>100)
      throw new HttpError(409,'Approved signature position falls outside the original PDF.');
    const page=pdf.getPage(pageNumber-1),w=page.getWidth(),h=page.getHeight();
    const x=w*xP/100,y=h*(1-yP/100)-66,boxW=Math.max(110,w*wP/100);
    if(y<0||x+boxW>w+1)throw new HttpError(409,'Signature box is outside page bounds.');
    const code=str(proof.proof);
    if(!REV.test(code))throw new HttpError(409,'Invalid immutable signatory proof.');
    const qr=await QRCode.toBuffer(verifiedUrl(documentId,code),{width:200,margin:1,errorCorrectionLevel:'M'});
    const embedded=await pdf.embedPng(qr);
    page.drawRectangle({x,y,width:boxW,height:66,color:rgb(1,1,1),borderColor:rgb(0.15,0.35,0.65),borderWidth:0.8});
    page.drawImage(embedded,{x:x+4,y:y+8,width:48,height:48});
    const label=str(proof.label).slice(0,26),signer=str(proof.signerUid).slice(0,27);
    page.drawText('Electronically signed - MEMS',{x:x+56,y:y+48,size:8,font,color:rgb(0.05,0.25,0.45)});
    page.drawText(label,{x:x+56,y:y+35,size:8,font});
    page.drawText(signer,{x:x+56,y:y+22,size:7,font});
    page.drawText(str(proof.signedAt).slice(0,19)+' UTC',{x:x+56,y:y+10,size:7,font});
   }
   const issued=Buffer.from(await pdf.save());
   const [saved]=await storage.writeImmutable([{path:destination,content:issued.toString('base64'),contentType:'application/pdf'}]);
   if(!saved){
    const registered=await getDoc(index);
    if(!registered||str(registered.data.revisionId)!==revId)
     throw new HttpError(409,'Signed copy creation conflicted with another request.');
   }else{
    await writeDoc(index,{revisionId:revId,sourceFileId:fileId,sha256:createHash('sha256').update(issued).digest('hex'),
     sourceSha256:str(item.sha256),signatureCount:proofs.length,issuedAt:new Date().toISOString(),issuedBy:ctx.uid},{exists:false});
   }
   const [signed]=await storage.url([destination]);
   if(!signed?.url)throw new HttpError(502,'Could not create secure download link.');
   return {url:signed.url,revisionId:revId,signatures:proofs.length,alreadyIssued:false};
  }),
 ],
};
