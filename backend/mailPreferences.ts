import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { audit } from './audit';
import { MAIL_CATEGORIES, SWIPE_ACTIONS, type MailRule } from './mailRules';
import { orgRoute, type OrgContext } from './guards';
import type { Doc } from './core';
import { displayName } from './chatCommon';

const settingsPath=(uid:string)=>'users/'+uid+'/mail_preferences/config';
const receiptPath=(uid:string,sender:string)=>'users/'+uid+'/mail_auto_last/'+sender;
const mb=(orgId:string,uid:string)=>'organizations/'+orgId+'/mailboxes/'+uid+'/items';
type Swipe=(typeof SWIPE_ACTIONS)[number];
/** Personal mailbox settings, as in Outlook: layout, compose and reply, automatic replies, rules, junk and swipe actions. */
export interface MailPreferences {
    signatureEnabled:boolean;
    signatureHtml:string;
    autoReplyEnabled:boolean;
    autoReplySubject:string;
    autoReplyHtml:string;
    /** Send automatic replies only between these times (ISO); empty = while enabled. */
    autoReplyStart:string;
    autoReplyEnd:string;
    appearance:'system'|'light'|'dark';
    focusedInbox:boolean;
    conversationView:boolean;
    readingPane:'right'|'bottom'|'off';
    density:'full'|'medium'|'compact';
    showSenderImage:boolean;
    showPreview:boolean;
    markRead:'select'|'delay'|'manual';
    markReadDelay:number;
    undoSendSeconds:number;
    swipeLeft:Swipe;
    swipeRight:Swipe;
    blockedSenders:string[];
    safeSenders:string[];
    rules:MailRule[];
}
const defaults:MailPreferences={
    signatureEnabled:false,signatureHtml:'',autoReplyEnabled:false,autoReplySubject:'Automatic reply',autoReplyHtml:'',
    autoReplyStart:'',autoReplyEnd:'',appearance:'system',focusedInbox:true,conversationView:true,readingPane:'right',density:'medium',
    showSenderImage:true,showPreview:true,markRead:'select',markReadDelay:5,undoSendSeconds:5,swipeLeft:'delete',swipeRight:'archive',
    blockedSenders:[],safeSenders:[],rules:[],
};
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pick=<T extends string>(value:unknown,options:readonly T[],fallback:T):T=>options.includes(str(value) as T)?str(value) as T:fallback;
const emails=(value:unknown):string[]=>[...new Set((Array.isArray(value)?value:[]).map(v=>str(v).trim().toLowerCase()).filter(Boolean))];
function ruleOf(raw:Record<string,unknown>):MailRule{
    return {
        id:str(raw.id),name:str(raw.name),enabled:raw.enabled!==false,
        from:str(raw.from).trim().toLowerCase(),subjectContains:str(raw.subjectContains).trim(),bodyContains:str(raw.bodyContains).trim(),
        hasAttachment:raw.hasAttachment===true,highImportance:raw.highImportance===true,sentOnlyToMe:raw.sentOnlyToMe===true,
        moveTo:str(raw.moveTo),markRead:raw.markRead===true,flag:raw.flag===true,category:str(raw.category),
        focus:pick(raw.focus,['','focused','other'] as const,''),stop:raw.stop===true,
    };
}
function normalize(d:Record<string,unknown>):MailPreferences{
    return {
        signatureEnabled:d.signatureEnabled===true,
        signatureHtml:str(d.signatureHtml),
        autoReplyEnabled:d.autoReplyEnabled===true,
        autoReplySubject:str(d.autoReplySubject)||'Automatic reply',
        autoReplyHtml:str(d.autoReplyHtml),
        autoReplyStart:str(d.autoReplyStart),autoReplyEnd:str(d.autoReplyEnd),
        appearance:pick(d.appearance,['system','light','dark'] as const,'system'),
        focusedInbox:d.focusedInbox!==false,conversationView:d.conversationView!==false,
        readingPane:pick(d.readingPane,['right','bottom','off'] as const,'right'),
        density:pick(d.density,['full','medium','compact'] as const,'medium'),
        showSenderImage:d.showSenderImage!==false,showPreview:d.showPreview!==false,
        markRead:pick(d.markRead,['select','delay','manual'] as const,'select'),
        markReadDelay:[0,1,3,5,10,15,30].includes(Number(d.markReadDelay))?Number(d.markReadDelay):5,
        undoSendSeconds:[0,5,10,15,30].includes(Number(d.undoSendSeconds))?Number(d.undoSendSeconds):5,
        swipeLeft:pick(d.swipeLeft,SWIPE_ACTIONS,'delete'),swipeRight:pick(d.swipeRight,SWIPE_ACTIONS,'archive'),
        blockedSenders:emails(d.blockedSenders),safeSenders:emails(d.safeSenders),
        rules:(Array.isArray(d.rules)?d.rules:[]).filter(isObj).map(ruleOf),
    };
}
const cleanup=(raw:unknown,max:number):string=>{
    const value=str(raw);
    if(value.length>max)throw new HttpError(400,'The text exceeds the maximum length.');
    return value;
};
const cleanHtml=(raw:unknown,max:number):string=>{
    const value=cleanup(raw,max);
    const allowed=new Set(['p','div','br','strong','b','em','i','u','s','strike','h1','h2','h3','ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','td','th','span','sup','sub','a','font']);
    return value.replace(/<[^>]*>/g,(tag)=>{
        const match=/^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>$/i.exec(tag);
        if(!match)return '';
        const name=match[2].toLowerCase();
        if(!allowed.has(name))return '';
        if(match[1])return name==='font'?'</span>':'</'+name+'>';
        if(name==='br'||name==='hr')return '<'+name+'>';
        if(name==='a'){
            const found=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[3]);
            const href=(found?.[1]||found?.[2]||'').trim();
            return /^https?:\/\/[^\s"'<>]+$/i.test(href)?'<a href="'+href.replace(/&/g,'&amp;')+'" target="_blank" rel="noopener noreferrer">':'<a>';
        }
        if(name==='font')return '<span>';
        if(name==='span'||name==='p'||name==='div'){
            const found=/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[3]);
            const accepted=(found?.[1]||found?.[2]||'').split(';').map(s=>s.trim()).filter(s=>
                /^(?:color|background-color)\s*:\s*#[a-f0-9]{3,8}$/i.test(s)
                || /^text-align\s*:\s*(left|right|center|justify)$/i.test(s)
                || /^font-size\s*:\s*(?:1[0-9]|2[0-8])px$/i.test(s)
                || /^font-family\s*:\s*(?:Arial|Calibri|Georgia|Times New Roman|Verdana|Courier New)$/i.test(s));
            return '<'+name+(accepted.length?' style="'+accepted.join(';')+'"':'')+'>';
        }
        return '<'+name+'>';
    });
};
export async function getMailPrefs(uid:string):Promise<MailPreferences>{
    const doc=await getDoc(settingsPath(uid));
    return normalize(doc?.data||{});
}
export const mailPreferenceRoutes={
    'POST /api/org/mail/preferences':[orgRoute('mail.preferences.read',null,async(ctx)=>{
        return {preferences:await getMailPrefs(ctx.uid),externalSendingEnabled:false};
    })],
    'POST /api/org/mail/preferences/save':[orgRoute('mail.preferences.save',null,async(ctx)=>{
        const before=await getMailPrefs(ctx.uid);
        const b=ctx.body;
        // Strict validation of every setting: unknown values are rejected, never silently stored.
        const bool=(key:string)=>{if(key in b&&typeof b[key]!=='boolean')throw new HttpError(400,'Invalid setting: '+key+'.');};
        ['signatureEnabled','autoReplyEnabled','focusedInbox','conversationView','showSenderImage','showPreview'].forEach(bool);
        const choice=(key:string,options:readonly (string|number)[])=>{if(key in b&&!options.includes(b[key] as string|number))throw new HttpError(400,'Invalid setting: '+key+'.');};
        choice('appearance',['system','light','dark']);choice('readingPane',['right','bottom','off']);choice('density',['full','medium','compact']);
        choice('markRead',['select','delay','manual']);choice('markReadDelay',[0,1,3,5,10,15,30]);choice('undoSendSeconds',[0,5,10,15,30]);
        choice('swipeLeft',SWIPE_ACTIONS);choice('swipeRight',SWIPE_ACTIONS);
        for(const key of ['autoReplyStart','autoReplyEnd'])if(str(b[key])&&!Number.isFinite(Date.parse(str(b[key]))))throw new HttpError(400,'Choose a valid automatic reply time.');
        const blocked=emails(b.blockedSenders??before.blockedSenders),safe=emails(b.safeSenders??before.safeSenders);
        if(blocked.length>200||safe.length>200||[...blocked,...safe].some(e=>!EMAIL.test(e)||e.length>254))throw new HttpError(400,'Sender lists take up to 200 valid email addresses.');
        if(blocked.some(e=>safe.includes(e)))throw new HttpError(400,'An address cannot be both blocked and safe.');
        if(blocked.includes(str(ctx.claims.email).toLowerCase()))throw new HttpError(400,'You cannot block your own address.');
        const rawRules=Array.isArray(b.rules)?b.rules:before.rules;
        if(rawRules.length>25)throw new HttpError(400,'Keep up to 25 rules.');
        const customFolders=new Set((await listDocs('organizations/'+ctx.orgId+'/mail_folders/'+ctx.uid+'/items')).map(d=>d.id));
        const rules=(rawRules as unknown[]).filter(isObj).map((raw,i)=>{
            const r=ruleOf(raw as Record<string,unknown>);
            r.id=/^r_[A-Za-z0-9_-]{6,40}$/.test(r.id)?r.id:'r_'+randomId(10);
            const tag='Rule '+(i+1);
            if(r.name.trim().length<2||r.name.length>80)throw new HttpError(400,tag+': name it (2–80 characters).');
            if(r.from&&!EMAIL.test(r.from))throw new HttpError(400,tag+': the sender must be an email address.');
            if(r.subjectContains.length>120||r.bodyContains.length>120)throw new HttpError(400,tag+': keep words up to 120 characters.');
            if(!(r.from||r.subjectContains||r.bodyContains||r.hasAttachment||r.highImportance||r.sentOnlyToMe))throw new HttpError(400,tag+': add at least one condition.');
            if(r.moveTo&&!['inbox','archive','junk','deleted'].includes(r.moveTo)&&!customFolders.has(r.moveTo))throw new HttpError(400,tag+': choose an existing folder.');
            if(r.category&&!(MAIL_CATEGORIES as readonly string[]).includes(r.category))throw new HttpError(400,tag+': choose a category from the list.');
            if(!(r.moveTo||r.markRead||r.flag||r.category||r.focus))throw new HttpError(400,tag+': add at least one action.');
            return r;
        });
        const preferences:MailPreferences=normalize({
            ...before,...b,
            signatureHtml:'signatureHtml' in b?cleanHtml(b.signatureHtml,16000):before.signatureHtml,
            autoReplySubject:'autoReplySubject' in b?cleanup(b.autoReplySubject,180).trim()||'Automatic reply':before.autoReplySubject,
            autoReplyHtml:'autoReplyHtml' in b?cleanHtml(b.autoReplyHtml,16000):before.autoReplyHtml,
            blockedSenders:blocked,safeSenders:safe,rules,
        });
        if(preferences.autoReplyEnabled&&!preferences.autoReplyHtml.replace(/<[^>]*>/g,' ').trim()){
            throw new HttpError(400,'Write an automatic reply before enabling it.');
        }
        if(preferences.autoReplyStart&&preferences.autoReplyEnd&&preferences.autoReplyEnd<=preferences.autoReplyStart)throw new HttpError(400,'The automatic reply end time must be after its start.');
        await writeDoc(settingsPath(ctx.uid),{...preferences,updatedAt:nowIso()});
        const changed=(Object.keys(preferences) as Array<keyof MailPreferences>).filter(k=>JSON.stringify(preferences[k])!==JSON.stringify(before[k]));
        await audit([{category:'interaction',action:'mail.preferences.save',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{type:'mail_settings',id:ctx.uid},
            details:'Changed: '+(changed.join(', ')||'nothing')+' · '+preferences.rules.length+' rules · '+preferences.blockedSenders.length+' blocked senders'}]);
        return {preferences};
    })],
};
/** Internal-only recipient automatic reply, limited to one response per sender every 24h.
 * Never invokes the send route; automatic replies cannot trigger loops.
 */
export async function sendAutoReply(ctx:OrgContext,recipient:Doc,parent:{id:string;subject:string;threadId:string}) {
    if(recipient.id===ctx.uid)return;
    const prefs=await getMailPrefs(recipient.id);
    if(!prefs.autoReplyEnabled||!prefs.autoReplyHtml.trim())return;
    // Scheduled automatic replies only run inside their time window.
    const at=nowIso();
    if((prefs.autoReplyStart&&at<prefs.autoReplyStart)||(prefs.autoReplyEnd&&at>prefs.autoReplyEnd))return;
    if(prefs.blockedSenders.includes(str(ctx.claims.email).toLowerCase()))return;
    const before=await getDoc(receiptPath(recipient.id,ctx.uid));
    const last=Date.parse(str(before?.data.at));
    if(Number.isFinite(last)&&Date.now()-last<24*3600_000)return;
    const id='oof_'+randomId(16);
    const now=nowIso();
    const body={
        fromUid:recipient.id,fromName:displayName(recipient),fromEmail:str(recipient.data.email),
        to:[ctx.claims.email],cc:[],bcc:[],subject:prefs.autoReplySubject||'Automatic reply',
        html:prefs.autoReplyHtml,excerpt:prefs.autoReplyHtml.replace(/<[^>]*>/g,' ').slice(0,260),
        attachments:[],priority:'normal',threadId:parent.threadId,
        inReplyTo:parent.id,sentAt:now,updatedAt:now,starred:false,flagged:false,focus:true,category:'',
    };
    await writeDoc(mb(ctx.orgId,ctx.uid)+'/'+id,{...body,folder:'inbox',read:false},{exists:false});
    await writeDoc(mb(ctx.orgId,recipient.id)+'/'+id,{...body,folder:'sent',read:true},{exists:false});
    await writeDoc(receiptPath(recipient.id,ctx.uid),{at:now,lastMessageId:parent.id});
}
