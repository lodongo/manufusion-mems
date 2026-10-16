import { HttpError, getDoc, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import type { Doc } from './core';
import { displayName } from './chatCommon';

const settingsPath=(uid:string)=>'users/'+uid+'/mail_preferences/config';
const receiptPath=(uid:string,sender:string)=>'users/'+uid+'/mail_auto_last/'+sender;
const mb=(orgId:string,uid:string)=>'organizations/'+orgId+'/mailboxes/'+uid+'/items';
export interface MailPreferences {
    signatureEnabled:boolean;
    signatureHtml:string;
    autoReplyEnabled:boolean;
    autoReplySubject:string;
    autoReplyHtml:string;
}
const defaults:MailPreferences={
    signatureEnabled:false,signatureHtml:'',autoReplyEnabled:false,autoReplySubject:'Automatic reply',autoReplyHtml:'',
};
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
    const d=doc?.data||{};
    return {
        signatureEnabled:d.signatureEnabled===true,
        signatureHtml:str(d.signatureHtml),
        autoReplyEnabled:d.autoReplyEnabled===true,
        autoReplySubject:str(d.autoReplySubject)||'Automatic reply',
        autoReplyHtml:str(d.autoReplyHtml),
    };
}
export const mailPreferenceRoutes={
    'POST /api/org/mail/preferences':[orgRoute('mail.preferences.read',null,async(ctx)=>{
        return {preferences:await getMailPrefs(ctx.uid),externalSendingEnabled:false};
    })],
    'POST /api/org/mail/preferences/save':[orgRoute('mail.preferences.save',null,async(ctx)=>{
        const preferences:MailPreferences={
            signatureEnabled:ctx.body.signatureEnabled===true,
            signatureHtml:cleanHtml(ctx.body.signatureHtml,16000),
            autoReplyEnabled:ctx.body.autoReplyEnabled===true,
            autoReplySubject:cleanup(ctx.body.autoReplySubject,180).trim()||'Automatic reply',
            autoReplyHtml:cleanHtml(ctx.body.autoReplyHtml,16000),
        };
        if(preferences.autoReplyEnabled&&!preferences.autoReplyHtml.replace(/<[^>]*>/g,' ').trim()){
            throw new HttpError(400,'Write an automatic reply before enabling it.');
        }
        await writeDoc(settingsPath(ctx.uid),{...preferences,updatedAt:nowIso()});
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
