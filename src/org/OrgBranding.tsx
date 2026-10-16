import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { BRAND_PRESETS, BRAND_SWATCHES, buildBrandTheme } from '../lib/brandTheme';
import type { OrgBranding as Branding } from '../types';
import { Alert, Field } from '../components/ui';
import BrandPreview from '../components/BrandPreview';
import { prepareFile } from '../apply/files';
import { Button, Card, PageTitle, Spinner, useLoad } from '../admin/kit';

export default function OrgBranding({ onSaved }: { onSaved: (branding: Branding) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ name: string; branding: Branding | null }>('/api/org/branding/get'));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load branding.'}</Alert>;
    return <BrandingForm name={data.name} initial={data.branding} onSaved={onSaved} />;
}

function BrandingForm({ name, initial, onSaved }: { name: string; initial: Branding | null; onSaved: (branding: Branding) => void }) {
    const [f, setF] = useState({
        displayName: initial?.displayName || name.slice(0, 40),
        slogan: initial?.slogan ?? '',
        preset: initial?.preset || 'emerald',
        brandColor: initial?.brandColor || '#10b981',
    });
    const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? '');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const theme = buildBrandTheme(f.preset, f.brandColor);

    const uploadLogo = async (file?: File) => {
        if (!file) return;
        setBusy('logo');
        setError('');
        setInfo('');
        try {
            const prepared = await prepareFile(file, true, { logo: true });
            const res = await callBackend<{ branding: Branding }>('/api/org/branding/logo', { data: prepared.data });
            setLogoUrl(res.branding.logoUrl);
            onSaved(res.branding);
            setInfo('Logo updated.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy('');
        }
    };

    const save = async () => {
        setBusy('save');
        setError('');
        setInfo('');
        try {
            const res = await callBackend<{ branding: Branding }>('/api/org/branding/save', { branding: f });
            onSaved(res.branding);
            setInfo('Branding saved. Everyone in your organization now sees it.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy('');
        }
    };

    return (
        <div className='space-y-4'>
            <PageTitle title='Branding' subtitle='Your logo, name, slogan and colours, shown to everyone in your organization' />
            {initial?.logoNeedsReview && <Alert tone='warn'>The previous logo reference could not be verified as belonging to this organization. Please upload your own logo to restore it.</Alert>}
            <Card className='flex items-center gap-4'>
                <label className='relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-600 bg-slate-950'>
                    {logoUrl ? <img src={logoUrl} alt='Logo' className='h-full w-full object-contain p-1' /> : <Building2 className='h-8 w-8 text-slate-500' />}
                    {busy === 'logo' && <span className='absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white'>Uploading...</span>}
                    <input type='file' className='hidden' accept='image/png,image/jpeg' onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <div className='text-sm text-slate-300'>
                    <p className='font-medium text-white'>Logo</p>
                    <p className='text-xs text-slate-500'>Tap to change. PNG with a transparent background works best.</p>
                </div>
            </Card>
            <Card className='space-y-4'>
                <Field id='ob-name' label='Brand name' maxLength={40} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
                <Field id='ob-slogan' label='Slogan' maxLength={120} value={f.slogan} onChange={(e) => setF({ ...f, slogan: e.target.value })} />
            </Card>
            <Card className='space-y-3'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Theme</p>
                <div className='grid grid-cols-2 gap-2'>
                    {BRAND_PRESETS.map((p) => (
                        <button key={p.key} type='button' onClick={() => setF({ ...f, preset: p.key })} className={`flex items-center gap-2 rounded-xl border p-2 text-left text-sm ${f.preset === p.key ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-slate-700 text-slate-300'}`}>
                            <span className='flex h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-slate-700'>
                                <span className='flex-1' style={{ background: p.theme.page }} />
                                <span className='flex-1' style={{ background: p.theme.panel }} />
                            </span>
                            {p.label}
                        </button>
                    ))}
                </div>
                <p className='pt-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>Brand colour</p>
                <div className='flex flex-wrap gap-2'>
                    {BRAND_SWATCHES.map((c) => (
                        <button key={c} type='button' aria-label={`Colour ${c}`} onClick={() => setF({ ...f, brandColor: c })} className={`h-9 w-9 rounded-full border-2 ${f.brandColor.toLowerCase() === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />
                    ))}
                    <label className='flex h-9 items-center gap-2 rounded-full border border-slate-700 pl-1 pr-3 text-xs text-slate-300'>
                        <input type='color' value={f.brandColor} onChange={(e) => setF({ ...f, brandColor: e.target.value })} className='h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent' aria-label='Custom colour' />
                        Custom
                    </label>
                </div>
            </Card>
            <BrandPreview name={f.displayName} slogan={f.slogan} logoUrl={logoUrl} theme={theme} />
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            <Button className='w-full' busy={busy === 'save'} disabled={!!busy} onClick={save}>
                Save branding
            </Button>
        </div>
    );
}
