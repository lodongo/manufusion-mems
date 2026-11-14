type NativePort={postMessage:(data:string)=>void;onmessage:((event:{data:string})=>void)|null};
type Result='saved'|'cancelled'|'requested';
export const PDF_MIME='application/pdf';
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export async function saveReportFile(blob:Blob,filename:string):Promise<Result>{
 if(!blob.size||!((blob.type===PDF_MIME&&filename.endsWith('.pdf'))||(blob.type===XLSX_MIME&&filename.endsWith('.xlsx'))))throw Error('Invalid report file.');
 const native=(window as Window & {memsFileDownload?:NativePort}).memsFileDownload;
 if(native&&typeof native.postMessage==='function'){
  if(blob.size>16*1024*1024)throw Error('This report exceeds the 16 MB mobile limit. Use a browser or filter the report.');
  const b64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not prepare report.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(blob);});
  return new Promise<Result>((resolve,reject)=>{
   const id=crypto.randomUUID(),timeout=window.setTimeout(()=>{native.onmessage=null;reject(Error('No save confirmation received. Check Files or try again.'));},300000);
   native.onmessage=(event)=>{try{const result=JSON.parse(event.data);if(result.id!==id)return;window.clearTimeout(timeout);native.onmessage=null;if(result.status==='saved'||result.status==='cancelled')resolve(result.status);else reject(Error(result.error||'The Android file could not be saved.'));}catch{window.clearTimeout(timeout);native.onmessage=null;reject(Error('Invalid Android save response.'));}};
   try{native.postMessage(JSON.stringify({id,filename,mime:blob.type,base64:b64}));}catch(e){window.clearTimeout(timeout);native.onmessage=null;reject(e);}
  });
 }
 // Old Android wrapper has no native save or blob download handler.
 if(/Android/i.test(navigator.userAgent)&&/;\s*wv\b|Version\/4\.0/i.test(navigator.userAgent))throw Error('Install the updated MEMS development APK to save files, or open the MEMS development site in Chrome and download there.');
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.rel='noopener';document.body.appendChild(anchor);anchor.click();anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),120000);return 'requested';
}
