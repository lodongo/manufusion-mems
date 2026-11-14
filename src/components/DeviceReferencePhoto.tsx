import {useEffect,useRef,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Button} from '../admin/kit';
type Photo={code:string;kind:string;url:string;credit:string;license:string;licenseUrl:string;sourceUrl:string;caption:string;version:number};
const endpoint=(admin:boolean)=>admin?'/api/admin/modules/metadata/device-photo/read':'/api/org/saf/device-photo/read';
const errorText=(e:unknown)=>e instanceof Error?e.message:'Could not load photo.';
function useReference(code:string,admin:boolean,revision=0){
 const anchor=useRef<HTMLElement|null>(null);
 const [visible,setVisible]=useState(false),[photo,setPhoto]=useState<Photo|null>(null),[failure,setFailure]=useState('');
 useEffect(()=>{if(visible||!anchor.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}const obs=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);obs.disconnect();}},{rootMargin:'100px'});obs.observe(anchor.current);return()=>obs.disconnect();},[visible]);
 useEffect(()=>{if(!visible)return;let active=true;setPhoto(null);setFailure('');callBackend<Photo>(endpoint(admin),{code}).then(p=>{if(active)setPhoto(p);}).catch(e=>{if(active)setFailure(errorText(e));});return()=>{active=false;};},[visible,code,admin,revision]);
 return {anchor,photo,failure};
}
function Figure({photo,label}:{photo:Photo;label:string}){
 const [broken,setBroken]=useState(false);
 useEffect(()=>setBroken(false),[photo.url]);
 if(!photo.url||broken)return <p className='text-xs text-soft'>{broken?'Reference photo temporarily unavailable':'No verified example photo yet'}{photo.sourceUrl&&<> · <a href={photo.sourceUrl} target='_blank' rel='noreferrer' className='underline'>View source examples</a></>}</p>;
 return <figure className='my-2 w-full overflow-hidden rounded-xl border border-line bg-page'>
  <img src={photo.url} alt={'Reference example: '+label} loading='lazy' decoding='async' referrerPolicy='no-referrer' onError={()=>setBroken(true)} className='block aspect-[4/3] w-full max-h-[300px] bg-white object-contain'/>
  <figcaption className='min-w-0 break-words px-3 py-2 text-xs leading-snug text-soft'><strong>{photo.kind==='family'?'Related device example':'Reference photo'}</strong><br/>{photo.caption}<br/>{photo.credit}{photo.license&&<> · {photo.licenseUrl?<a href={photo.licenseUrl} target='_blank' rel='noreferrer' onClick={e=>e.stopPropagation()} className='underline'>{photo.license}</a>:photo.license}</>}{photo.sourceUrl&&<> · <a href={photo.sourceUrl} target='_blank' rel='noreferrer' onClick={e=>e.stopPropagation()} className='underline'>Source</a></>}<br/>Not equipment evidence.</figcaption>
 </figure>;
}
export default function DeviceReferencePhoto({code,label,admin=false}:{code:string;label:string;admin?:boolean}){
 const {anchor,photo,failure}=useReference(code,admin);
 return <div ref={el=>{anchor.current=el;}} className='block'>{photo?<Figure photo={photo} label={label}/>:failure?<span className='text-xs text-soft'>Reference photo unavailable</span>:<span className='block min-h-10 text-xs text-soft'>Example photo</span>}</div>;
}
// A single shared master photo. Resize locally and discard the full-resolution original.
async function smallJpeg(file:File){
 const objectUrl=URL.createObjectURL(file);
 try{const image=new Image();image.src=objectUrl;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw new Error('Unreadable image.');
  for(const size of [640,512,400,320]){const canvas=document.createElement('canvas'),ratio=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));const context=canvas.getContext('2d');if(!context)throw new Error('Image conversion unavailable.');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);for(const q of [.82,.72,.60,.48]){const jpeg=canvas.toDataURL('image/jpeg',q).split(',')[1];if(jpeg&&jpeg.length<=106600)return jpeg;}}
  throw new Error('Image could not be compressed to 80 KB.');
 }finally{URL.revokeObjectURL(objectUrl);}
}
export function ReferencePhotoEditor({code,label,canWrite}:{code:string;label:string;canWrite:boolean}){
 const [revision,setRevision]=useState(0),{anchor,photo,failure}=useReference(code,true,revision);
 const [jpeg,setJpeg]=useState(''),[credit,setCredit]=useState(''),[license,setLicense]=useState(''),[rights,setRights]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const save=async()=>{if(!photo||!jpeg||!rights)return;setBusy(true);setMessage('');try{await callBackend('/api/admin/modules/metadata/device-photo/save',{code,jpeg,credit,license,rightsConfirmed:rights,version:photo.version});setJpeg('');setCredit('');setLicense('');setRights(false);setRevision(r=>r+1);setMessage('Shared example photo saved.');}catch(e){setMessage(errorText(e));}finally{setBusy(false);}};
 return <section ref={el=>{anchor.current=el;}} className='space-y-2 rounded-lg border border-line p-2'><h3 className='font-semibold'>Shared master example photo</h3>{photo?<Figure photo={photo} label={label}/>:<p className='text-xs text-soft'>{failure||'Loading reference photo…'}</p>}{canWrite&&<><p className='text-xs text-soft'>One photo per type. Upload an exact, authorized reference image, not an equipment inspection photo. JPEG compressed to 80 KB max.</p><input type='file' accept='image/*' disabled={busy} aria-label='Example photo' onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setMessage('');setJpeg('');try{setJpeg(await smallJpeg(file));}catch(err){setMessage(errorText(err));}finally{setBusy(false);}}}/>{jpeg&&<><img src={'data:image/jpeg;base64,'+jpeg} alt='Replacement preview' className='aspect-[4/3] w-full max-h-[300px] rounded-lg bg-white object-contain'/><label className='block text-sm'>Photo creator / credit<input className='block w-full rounded border border-line bg-panel p-2' value={credit} maxLength={240} onChange={e=>setCredit(e.target.value)}/></label><label className='block text-sm'>License or permission details<input className='block w-full rounded border border-line bg-panel p-2' value={license} maxLength={240} onChange={e=>setLicense(e.target.value)}/></label><label className='flex gap-2 text-sm'><input type='checkbox' checked={rights} onChange={e=>setRights(e.target.checked)}/>I confirm MEMS has permission to share this photo with all organizations.</label><Button busy={busy} disabled={!photo||!rights||!credit.trim()||!license.trim()} onClick={()=>void save()}>Save reference photo</Button></>}</>}{message&&<p className='text-xs text-soft'>{message}</p>}</section>;
}
