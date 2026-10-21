import type { ReactNode } from 'react';
import { Check, Circle, FileImage, FileSpreadsheet, FileText, Presentation, X } from 'lucide-react';
import { Badge } from '../../admin/kit';

// Shared pieces of the Documents (DOC) screens: labels, status chips, the lifecycle stepper and the Word outline
// generated from a document template.

export interface DocRow {
    documentId: string;
    title: string;
    classCode: string;
    status: string;
    revision: string;
    updatedAt: string;
    createdAt?: string;
    createdBy?: string;
    subtypeCode?: string;
    templateName?: string;
    scope?: { name?: string; level?: string };
    supersedesDocumentId?: string;
}

export interface TemplateSection { heading: string; guidance: string }
export interface DocTemplate { code: string; classCode: string; name: string; purpose: string; reviewMonths: number; signOff: string[]; sections: TemplateSection[] }
export interface ScopeNode { id: string; name: string; level: string; parentId: string }

export const CLASS_NAMES: Record<string, string> = {
    EXT: 'External reference', GOV: 'Governance', POL: 'Policy', STR: 'Strategy', OBJ: 'Objectives', FRW: 'Framework', MAN: 'Manual', PRG: 'Programme',
    PLN: 'Plan', PRO: 'Process', PRC: 'Procedure', STD: 'Internal standard', SOP: 'Standard operating procedure', WIN: 'Work instruction',
    SPC: 'Specification', GDL: 'Guideline', CHK: 'Checklist', FRM: 'Form', TMP: 'Template', REG: 'Register', REC: 'Record', RPT: 'Report',
};
export const className = (code: string) => CLASS_NAMES[code] || code;

export const LEVELS: Array<[string, string]> = [
    ['legal_entity', 'Legal entity'],
    ['site', 'Site'],
    ['department', 'Department'],
    ['cost_center', 'Cost center'],
];
export const levelName = (level: string) => LEVELS.find(([k]) => k === level)?.[1] ?? level.replace(/_/g, ' ');

const STATUS: Record<string, { label: string; tone: 'brand' | 'muted' | 'warn' | 'danger' }> = {
    draft: { label: 'Draft', tone: 'muted' },
    in_review: { label: 'In review', tone: 'warn' },
    technical_verified: { label: 'Verified · sign-off', tone: 'warn' },
    effective: { label: 'Effective', tone: 'brand' },
    superseded: { label: 'Superseded', tone: 'muted' },
    rejected: { label: 'Rejected', tone: 'danger' },
    withdrawn: { label: 'Withdrawn', tone: 'muted' },
    archived: { label: 'Archived', tone: 'muted' },
};
export const statusLabel = (s: string) => STATUS[s]?.label ?? s.replace(/_/g, ' ');
export function StatusChip({ status }: { status: string }) {
    const s = STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'muted' as const };
    return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export function FileIcon({ mime, className = 'h-5 w-5' }: { mime: string; className?: string }) {
    if (mime.startsWith('image/')) return <FileImage className={className} />;
    if (mime.includes('spreadsheet')) return <FileSpreadsheet className={className} />;
    if (mime.includes('presentation')) return <Presentation className={className} />;
    return <FileText className={className} />;
}
export const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export interface Step { key: string; label: string; state: 'done' | 'current' | 'todo' | 'blocked'; detail: string }

/** The five lifecycle steps as a compact track (fits a phone); the current step is highlighted and explained below. */
export function Stepper({ steps }: { steps: Step[] }) {
    const current = steps.find((s) => s.state === 'current' || s.state === 'blocked');
    return (
        <section className='rounded-2xl border border-line bg-panel p-3'>
            <ol className='grid grid-cols-5 gap-1' aria-label='Document lifecycle'>
                {steps.map((s, i) => (
                    <li key={s.key} className='relative flex min-w-0 flex-col items-center text-center' aria-current={s.state === 'current' ? 'step' : undefined}>
                        {i > 0 && <span aria-hidden='true' className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${s.state === 'todo' ? 'bg-line' : 'bg-brand/60'}`} />}
                        <span
                            className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${s.state === 'done' ? 'bg-brand text-onbrand' : s.state === 'current' ? 'border-2 border-brand bg-panel text-brandsoft ring-4 ring-brand/15' : s.state === 'blocked' ? 'bg-red-500 text-[#ffffff]' : 'border border-line bg-panel text-muted'}`}
                        >
                            {s.state === 'done' ? <Check className='h-4 w-4' /> : s.state === 'blocked' ? <X className='h-4 w-4' /> : i + 1}
                        </span>
                        <span className={`mt-1 line-clamp-2 text-[11px] leading-tight sm:text-xs ${s.state === 'todo' ? 'text-muted' : 'font-medium text-ink'}`}>{s.label}</span>
                        <span className='hidden text-[11px] leading-tight text-muted lg:block'>{s.detail}</span>
                        <span className='sr-only'>{s.state}</span>
                    </li>
                ))}
            </ol>
            {current && (
                <p className={`mt-2 rounded-lg px-3 py-2 text-xs lg:hidden ${current.state === 'blocked' ? 'bg-red-500/10 text-red-600' : 'bg-page text-soft'}`}>
                    <span className='font-semibold'>{current.label}:</span> {current.detail}
                </p>
            )}
        </section>
    );
}

/** Small labelled value used in detail grids; long values wrap. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-3 py-2'>
            <dt className='text-sm text-muted'>{label}</dt>
            <dd className='min-w-0 break-words text-right text-sm font-medium text-ink'>{children || '—'}</dd>
        </div>
    );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
    return (
        <div className='flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center'>
            <span className='flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brandsoft'>{icon ?? <Circle className='h-6 w-6' />}</span>
            <p className='text-sm font-semibold text-ink'>{title}</p>
            {children && <div className='max-w-md text-sm text-muted'>{children}</div>}
        </div>
    );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * The template outline as a Word document (opens in Word, Google Docs or LibreOffice). The author writes the content,
 * saves it as .docx or PDF and uploads it as the controlled source. Nothing is sent to the server.
 */
export function downloadOutline(input: { title: string; classCode: string; documentId: string; revision: string; location: string; author: string; templateName: string; sections: TemplateSection[]; signOff: string[] }) {
    const rows = [
        ['Document title', input.title],
        ['Class', `${input.classCode} — ${className(input.classCode)}`],
        ['Document ID', input.documentId],
        ['Revision', input.revision],
        ['Applies to', input.location],
        ['Prepared by', input.author],
    ];
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111}h1{font-size:18pt;margin:0 0 8pt}h2{font-size:13pt;margin:16pt 0 4pt;border-bottom:1px solid #999}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}th{background:#eee;text-align:left}.g{color:#666;font-style:italic}</style></head><body>
<h1>${esc(input.title)}</h1><table>${rows.map(([k, v]) => `<tr><th style="width:30%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
${input.sections.map((s, i) => `<h2>${i + 1}. ${esc(s.heading)}</h2><p class="g">${esc(s.guidance)}</p><p>&nbsp;</p>`).join('')}
${input.signOff.length ? `<h2>Sign-off</h2><table><tr><th>Authority</th><th>Name</th><th>Signature</th><th>Date</th></tr>${input.signOff.map((l) => `<tr><td>${esc(l)}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>` : ''}
<p class="g">Controlled document. Uncontrolled when printed unless it carries the MEMS verification QR code.</p></body></html>`;
    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${input.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'document'}-${input.templateName.replace(/\s+/g, '-')}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
