import { useState } from 'react';
import { callBackend } from '../lib/backend';
type AuditReport = {
  title: string; status: string; publishable: boolean; generatedAt: string;
  period: {year:number;start:string;end:string};
  configuration: {registeredPermissionActions:number;verifiedPermissionActions:number;jobRoles:number;securityRoles:number;moduleDocuments:Array<{id:string;module:string;version:string;status:string}>};
  historicalActivity:{sampledEvents:number;outcomes:Record<string,number>;categories:Record<string,number>;periodQueryComplete:boolean;cap:number};
  limitations:string[];
};
export default function GovernanceReports() {
  const [year,setYear]=useState(String(new Date().getFullYear()));
  const [start,setStart]=useState('');
  const [end,setEnd]=useState('');
  const [report,setReport]=useState<AuditReport|null>(null);
  const [digest,setDigest]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  async function preview() {
    setLoading(true);setError('');
    try {
      const result=await callBackend<{report:AuditReport;integrityDigest:string}>('/api/org/governance/reports/preview',{year:Number(year),start,end});
      setReport(result.report);setDigest(result.integrityDigest);
    } catch(e) {setError(e instanceof Error?e.message:'Could not load governance audit report');setReport(null);}
    finally {setLoading(false);}
  }
  function exportPreview() {
    if(!report)return;
    const blob=new Blob([JSON.stringify({report,integrityDigest:digest},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`governance-audit-preview-${year}.json`;anchor.click();
    URL.revokeObjectURL(url);
  }
  return <section className='rounded-xl border border-[rgb(var(--c-border))] p-4 space-y-4'>
    <div><h2 className='font-semibold text-ink'>Audit and reports</h2><p className='text-sm text-soft'>Read-only current configuration and historical audit preview. Not yet certified or publishable.</p></div>
    <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
      <label className='text-sm text-ink'>Year<input type='number' inputMode='decimal' min='2000' max={new Date().getFullYear()} value={year} onChange={e=>setYear(e.target.value)} className='mt-1 w-full border rounded-lg bg-transparent p-3 text-base'/></label>
      <label className='text-sm text-ink'>From (optional)<input type='date' value={start} onChange={e=>setStart(e.target.value)} className='mt-1 w-full border rounded-lg bg-transparent p-3 text-base'/></label>
      <label className='text-sm text-ink'>To (optional)<input type='date' value={end} onChange={e=>setEnd(e.target.value)} className='mt-1 w-full border rounded-lg bg-transparent p-3 text-base'/></label>
    </div>
    <button disabled={loading} onClick={preview} type='button' className='rounded-lg px-4 py-3 text-white bg-[rgb(var(--c-brand))] disabled:opacity-60'>{loading?'Loading…':'Generate preview'}</button>
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    {report&&<div className='space-y-3'>
      <p className='text-sm font-semibold text-ink'>{report.title}</p>
      <div className='grid grid-cols-2 gap-2'>
        {[
          ['Permission actions',report.configuration.registeredPermissionActions],
          ['Verified actions',report.configuration.verifiedPermissionActions],
          ['Job roles',report.configuration.jobRoles],
          ['Security roles',report.configuration.securityRoles],
          ['Retrieved events',report.historicalActivity.sampledEvents],
          ['Module documents',report.configuration.moduleDocuments.length],
        ].map(([label,val])=><div key={String(label)} className='rounded-lg border p-3'><div className='text-xl font-bold text-ink'>{val}</div><div className='text-xs text-soft'>{label}</div></div>)}
      </div>
      <p role='status' className='text-sm text-soft'>{report.historicalActivity.periodQueryComplete ? 'Period query completed within its retrieval limit. Source reconciliation is still pending.' : 'Event retrieval limit reached — audit incomplete.'}</p>
      <h3 className='font-semibold text-ink'>Outcomes in retrieved events</h3>
      <div className='space-y-1'>{Object.entries(report.historicalActivity.outcomes).map(([key,value])=><p key={key} className='text-sm text-ink'>{key}: {value}</p>)}</div>
      <div role='note' className='rounded-lg border border-amber-300 p-3'><p className='font-semibold text-sm'>Data coverage limitations</p><ul className='list-disc pl-4 text-xs space-y-1 mt-2'>{report.limitations.map(l=><li key={l}>{l}</li>)}</ul></div>
      <button type='button' onClick={exportPreview} className='border rounded-lg p-3 font-semibold text-sm'>Download JSON preview (not certified)</button>
    </div>}
  </section>;
}
