import { Mail, Phone } from 'lucide-react';
import { FEATURE_ICON_MAP } from '../lib/icons';
import { navigate } from '../lib/route';
import { useSite } from '../lib/site';

export default function SitePage() {
    const { config } = useSite();

    return (
        <div className='min-h-screen bg-slate-950 px-6 py-10'>
            <main className='mx-auto w-full max-w-md'>
                <p className='text-sm font-medium tracking-widest text-emerald-400'>{config.brandName}</p>
                <p className='text-xs text-slate-500'>{config.platformName}</p>
                <h1 className='mt-4 text-3xl font-bold leading-tight text-white'>{config.heroTitle}</h1>
                <p className='mt-4 text-slate-300'>{config.heroDescription}</p>

                <div className='mt-8 flex flex-col gap-3'>
                    <button onClick={() => navigate('register')} className='h-12 w-full rounded-xl bg-emerald-500 font-semibold text-onbrand active:bg-emerald-400'>
                        {config.registerButtonLabel}
                    </button>
                    <button onClick={() => navigate('')} className='h-12 w-full rounded-xl border border-slate-700 font-semibold text-slate-200 active:bg-slate-800'>
                        {config.loginButtonLabel}
                    </button>
                </div>

                <section className='mt-10 grid gap-3'>
                    {config.features.map((feature, index) => {
                        const Icon = FEATURE_ICON_MAP[feature.icon] ?? FEATURE_ICON_MAP.boxes;
                        return (
                            <div key={`${feature.title}-${index}`} className='flex gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4'>
                                <Icon className='h-6 w-6 shrink-0 text-emerald-400' />
                                <div>
                                    <p className='font-medium text-white'>{feature.title}</p>
                                    <p className='text-sm text-slate-400'>{feature.text}</p>
                                </div>
                            </div>
                        );
                    })}
                </section>

                {(config.supportEmail || config.supportPhone) && (
                    <section className='mt-8 space-y-2 text-sm text-slate-300'>
                        {config.supportEmail && (
                            <a href={`mailto:${config.supportEmail}`} className='flex items-center gap-2'>
                                <Mail className='h-4 w-4 text-emerald-400' />
                                {config.supportEmail}
                            </a>
                        )}
                        {config.supportPhone && (
                            <a href={`tel:${config.supportPhone}`} className='flex items-center gap-2'>
                                <Phone className='h-4 w-4 text-emerald-400' />
                                {config.supportPhone}
                            </a>
                        )}
                    </section>
                )}

                <a href={config.companyWebsiteUrl} target='_blank' rel='noopener noreferrer' className='mt-10 block text-center text-sm text-slate-400 underline'>
                    {config.companyWebsiteLabel}
                </a>
                {config.footerText && (
                    <p className='mt-4 text-center text-xs text-slate-500'>
                        © {new Date().getFullYear()} {config.footerText}
                    </p>
                )}
            </main>
        </div>
    );
}
