import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
type Result={authentic:boolean;title?:string;revision?:string;signerUid?:string;label?:string;signedAt?:string;currentStatus?:string;isCurrent?:boolean};
export default function DocumentSignatureVerification({documentId,proof}:{documentId:string;proof:string}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;callBackend<Result>('/api/org/drkms/signatures/verify',{documentId,proof})
  .then(v=>{if(active)setResult(v)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Verification unsuccessful.')})
  .finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[documentId,proof]);
 return <main className='mx-auto max-w-lg space-y-4 p-4'>
  <h1 className='text-xl font-semibold'>MEMS document signature authentication</h1>
  <p className='text-sm text-slate-400'>Verified against an immutable published document and the authenticated organization's records. A genuine signature does not imply the document remains effective.</p>
  {loading&&<p>Checking signature…</p>}
  {error&&<p role='alert' className='rounded-lg border border-red-700 p-3 text-sm text-red-300'>{error}</p>}
  {result&&<div className='space-y-2 rounded-xl border border-slate-700 p-4'>
   <p className={result.authentic?'font-semibold text-green-300':'font-semibold text-red-300'}>{result.authentic?'Signature record authentic':'Signature could not be authenticated'}</p>
   {result.authentic&&<>
    <p className='text-sm'>{result.title} · Revision {result.revision}</p>
    <p className='text-sm'>Authority: {result.label} · User: {result.signerUid}</p>
    <p className='text-sm'>Signed at: {result.signedAt}</p>
    <p className='text-sm'>Current document status: {result.currentStatus} · {result.isCurrent?'Currently effective':'Not the currently effective revision'}</p>
   </>}
  </div>}
  <button type='button' className='min-h-11 rounded-lg border border-slate-600 px-4 text-sm' onClick={()=>navigate('organization_home')}>Back to MEMS</button>
 </main>;
}
