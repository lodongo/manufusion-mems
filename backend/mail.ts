import { storage } from './platform/sdk';
import { HttpError, getDoc, listDocs, nowIso, randomId, rateLimit, str, writeDoc, updateFields, deleteDoc, isObj } from './core';
import { orgRoute, type OrgContext } from './guards';
import { people, displayName } from './chatCommon';
import { audit } from './audit';
import { createMonitoredAction } from './actionHub';
import { sendAutoReply } from './mailPreferences';

const root = (ctx: OrgContext, uid = ctx.uid) => 'organizations/' + ctx.orgId + '/mailboxes/' + uid + '/items';
const fileRoot = (ctx: OrgContext) => 'organizations/' + ctx.orgId + '/mail_attachments';
const folderRoot = (ctx: OrgContext) => 'organizations/' + ctx.orgId + '/mail_folders/' + ctx.uid + '/items';
const identifier = /^[a-zA-Z0-9_-]{6,100}$/;
const fixedFolders = ['inbox','sent','drafts','archive','junk','deleted'];
const acceptedTypes: Record<string, { ext: string; max: number }> = {
    'image/jpeg': { ext:'jpg', max:5_000_000 },
    'image/png': { ext:'png', max:5_000_000 },
    'image/webp': { ext:'webp', max:5_000_000 },
    'application/pdf': { ext:'pdf', max:8_000_000 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext:'docx', max:8_000_000 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext:'xlsx', max:8_000_000 },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext:'pptx', max:8_000_000 },
    'text/plain': { ext:'txt', max:2_000_000 },
    'text/csv': { ext:'csv', max:2_000_000 },
};
const isMagic = (buf: Buffer, mime: string) => {
    if (mime==='image/jpeg') return buf[0]===255 && buf[1]===216 && buf[2]===255;
    if (mime==='image/png') return buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (mime==='image/webp') return buf.toString('latin1',0,4)==='RIFF' && buf.toString('latin1',8,12)==='WEBP';
    if (mime==='application/pdf') return buf.toString('latin1',0,4)==='%PDF';
    if (mime.includes('openxmlformats-officedocument')) return buf.toString('latin1',0,2)==='PK';
    return !buf.includes(0) && !buf.toString('utf8').includes('\uFFFD');
};
const asArray = (input: unknown): string[] => Array.isArray(input) ? input.map((x)=>str(x).trim().toLowerCase()).filter(Boolean) : [];
const folderFor = (value: string) => fixedFolders.includes(value) || /^f_[a-zA-Z0-9_-]{6,60}$/.test(value);
function richHtml(value: unknown): string {
    const raw = str(value);
    if (raw.length > 100_000) throw new HttpError(413, 'Email body exceeds 100 KB.');
    // Only a formatting fragment is accepted; no scripts, event handlers, embeds,
    // arbitrary CSS, remote images, or form controls can be retained.
    const allowed = new Set(['p','div','br','strong','b','em','i','u','s','strike','h1','h2','h3','h4',
        'ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','td','th','span','a','sup','sub','font']);
    return raw.replace(/<[^>]*>/g,(tag)=>{
        const m=/^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>$/i.exec(tag);
        if(!m) return '';
        const name=m[2].toLowerCase();
        if(!allowed.has(name)) return '';
        if(m[1]) return name==='font'?'</span>':'</'+name+'>';
        if(name==='br'||name==='hr')return '<'+name+'>';
        if(name==='a'){
            const match=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const href=(match?.[1]||match?.[2]||'').trim();
            if (/^https?:\/\/[^\s"'<>]+$/i.test(href)) return '<a href="'+href.replace(/&/g,'&amp;')+'" rel="noopener noreferrer" target="_blank">';
        }
        if(name==='font'){
            const face=/\bface\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const color=/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const size=/\bsize\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const rules:string[]=[];
            const family=(face?.[1]||face?.[2]||'').replace(/[^a-z ,]/gi,'').trim();
            if(/^(Arial|Calibri|Georgia|Times New Roman|Verdana|Courier New)$/i.test(family))rules.push('font-family:'+family);
            const shade=(color?.[1]||color?.[2]||'').trim();
            if(/^#[a-f0-9]{3,8}$/i.test(shade))rules.push('color:'+shade);
            const sizes:Record<string,string>={'1':'10px','2':'11px','3':'13px','4':'16px','5':'20px','6':'24px','7':'28px'};
            if(sizes[(size?.[1]||size?.[2]||'')])rules.push('font-size:'+sizes[(size?.[1]||size?.[2]||'')]);
            return rules.length?'<span style="'+rules.join(';')+'">':'<span>';
        }
        // Decorative CSS is limited to safe color / font size / align values.
        if(name==='span'||name==='p'||name==='div'){ 
            const match=/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const rules=(match?.[1]||match?.[2]||'').split(';').map(s=>s.trim()).filter(s=>
                /^(?:color|background-color)\s*:\s*(?:#[a-f0-9]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i.test(s)
                || /^font-size\s*:\s*(?:1[0-9]|2[0-8])px$/i.test(s)
                || /^font-family\s*:\s*(?:Arial|Calibri|Georgia|Times New Roman|Verdana|Courier New)$/i.test(s)
                || /^text-align\s*:\s*(left|right|center|justify)$/i.test(s));
            if(rules.length)return '<'+name+' style="'+rules.join(';')+'">';
        }
        return '<'+name+'>';
    });
}
function preview(value: string): string {
    return value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim().slice(0,260);
}
function asEmails(value: unknown, label: string): string[] {
    const emails = [...new Set(asArray(value))];
    if (emails.length > 50 || emails.some(s=> !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length>254)) {
        throw new HttpError(400, 'Check the '+label+' email addresses.');
    }
    return emails;
}
function mailFields(body: Record<string,unknown>) {
    const to=asEmails(body.to,'To'), cc=asEmails(body.cc,'Cc'), bcc=asEmails(body.bcc,'Bcc');
    const subject=str(body.subject).trim().slice(0,250);
    const html=richHtml(body.html);
    const attachmentIds=[...new Set(asArray(body.attachmentIds))];
    if(attachmentIds.length>10 || attachmentIds.some(s=>!identifier.test(s))) throw new HttpError(400,'Select up to 10 valid attachments.');
    return {to,cc,bcc,subject,html,attachmentIds,priority:str(body.priority)==='high'?'high':str(body.priority)==='low'?'low':'normal'};
}
async function listAttachments(ctx: OrgContext, ids: string[]) {
    const items=[];
    let total=0;
    for(const id of ids){
        const doc=await getDoc(fileRoot(ctx)+'/'+id);
        if(!doc || str(doc.data.ownerUid)!==ctx.uid || str(doc.data.orgId)!==ctx.orgId) throw new HttpError(403,'Attachment does not belong to your account.');
        total+=Number(doc.data.size)||0;
        if(total>15_000_000) throw new HttpError(413,'Combined attachments must be 15 MB or less.');
        items.push({id,name:str(doc.data.name),mime:str(doc.data.mime),size:Number(doc.data.size)||0,path:str(doc.data.path)});
    }
    return items;
}
async function mailView(ctx: OrgContext, doc: {id:string;data:Record<string,unknown>}, detail=false){
    const d=doc.data;
    const attachments = Array.isArray(d.attachments)?d.attachments.filter(isObj):[];
    return {
        id:doc.id, threadId:str(d.threadId), inReplyTo:str(d.inReplyTo),
        fromUid:str(d.fromUid),fromName:str(d.fromName),fromEmail:str(d.fromEmail),
        to:asArray(d.to),cc:asArray(d.cc),bcc:asArray(d.bcc),
        subject:str(d.subject),excerpt:str(d.excerpt),html:detail?str(d.html):'',
        sentAt:str(d.sentAt),updatedAt:str(d.updatedAt),folder:str(d.folder),
        read:d.read===true,starred:d.starred===true,flagged:d.flagged===true,
        action:isObj(d.action)?d.action:{},actionId:str(d.actionId),
        allowReply:d.allowReply!==false,allowReplyAll:d.allowReplyAll!==false,allowDelete:d.allowDelete!==false,
        focus:d.focus!==false,category:str(d.category),priority:str(d.priority),
        attachments:await Promise.all(attachments.map(async(a)=>{
            const path=str(a.path), valid=path.startsWith('organizations/'+ctx.orgId+'/mail_files/');
            let url='';
            if(detail&&valid) {
                const found=await storage.url([path]);
                url=found[0]?.url||'';
            }
            return {id:str(a.id),name:str(a.name),mime:str(a.mime),size:Number(a.size)||0,url};
        })),
    };
}
async function trace(ctx:OrgContext,action:string,id:string) {
    await audit([{category:'interaction',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
        target:{type:'internal_mail',id},details:'Organization-internal mail operation'}]);
}

export const mailRoutes={
    'POST /api/org/mail/people':[orgRoute('mail.people',null,async(ctx)=>{
        const members=await people(ctx);
        return {people:members.map(d=>({uid:d.id,email:str(d.data.email).toLowerCase(),name:displayName(d)}))
            .sort((a,b)=>a.name.localeCompare(b.name)),externalSendingEnabled:false};
    })],
    'POST /api/org/mail/list':[orgRoute('mail.list',null,async(ctx)=>{
        const [docs,folders]=await Promise.all([listDocs(root(ctx)),listDocs(folderRoot(ctx))]);
        const items=docs.sort((a,b)=>str(b.data.updatedAt).localeCompare(str(a.data.updatedAt))).slice(0,800);
        return {items:await Promise.all(items.map(d=>mailView(ctx,d))),folders:folders.map(d=>({id:d.id,name:str(d.data.name)}))
            .sort((a,b)=>a.name.localeCompare(b.name)),externalSendingEnabled:false};
    })],
    'POST /api/org/mail/read':[orgRoute('mail.read',null,async(ctx)=>{
        const id=str(ctx.body.id);
        if(!identifier.test(id))throw new HttpError(400,'Invalid mail ID.');
        const doc=await getDoc(root(ctx)+'/'+id);
        if(!doc) throw new HttpError(404,'Mail not found in your mailbox.');
        if(doc.data.read!==true && str(doc.data.folder)!=='drafts') await updateFields(root(ctx)+'/'+id,{read:true});
        return {item:await mailView(ctx,{...doc,data:{...doc.data,read:true}},true)};
    })],
    'POST /api/org/mail/draft':[orgRoute('mail.draft',null,async(ctx)=>{
        await rateLimit('mail-draft',ctx.uid,120,3600);
        const draftId=str(ctx.body.id)||'d_'+randomId(16);
        if(!identifier.test(draftId))throw new HttpError(400,'Invalid draft ID.');
        const existing=await getDoc(root(ctx)+'/'+draftId);
        if(existing && str(existing.data.folder)!=='drafts')throw new HttpError(409,'This message is already sent.');
        const fields=mailFields(ctx.body);
        const attachments=await listAttachments(ctx,fields.attachmentIds);
        const now=nowIso();
        const doc={
            ...fields,fromUid:ctx.uid,fromName:displayName(ctx.me),fromEmail:ctx.claims.email,
            html:fields.html,excerpt:preview(fields.html),attachments,
            folder:'drafts',sentAt:'',updatedAt:now,threadId:str(ctx.body.threadId)||draftId,
            inReplyTo:str(ctx.body.inReplyTo),read:true,starred:false,flagged:false,
            action:isObj(ctx.body.action)?ctx.body.action:{},actionId:'',
            allowReply:ctx.body.allowReply!==false,allowReplyAll:ctx.body.allowReplyAll!==false,allowDelete:ctx.body.allowDelete!==false,
            focus:true,category:'',priority:fields.priority,
        };
        await writeDoc(root(ctx)+'/'+draftId,{...existing?.data,...doc});
        await trace(ctx,'mail.draft.save',draftId);
        return {item:await mailView(ctx,{id:draftId,data:doc},true)};
    })],
    'POST /api/org/mail/send':[orgRoute('mail.send',null,async(ctx)=>{
        await rateLimit('mail-send',ctx.uid,100,3600);
        const fields=mailFields(ctx.body);
        const members=await people(ctx);
        const byEmail=new Map(members.map(d=>[str(d.data.email).toLowerCase(),d]));
        const byUid=new Map(members.map(d=>[d.id,d]));
        const action=isObj(ctx.body.action)&&ctx.body.action.enabled===true?ctx.body.action:{};
        const actionUids=[...new Set(Array.isArray(action.recipientUids)?action.recipientUids.map(str).filter(Boolean):[])];
        if(actionUids.length){
            if(actionUids.length>35||actionUids.some(uid=>uid===ctx.uid||!byUid.has(uid)))throw new HttpError(403,'Assign to 1–35 other active organization colleagues.');
            if(str(action.title).trim().length<3)throw new HttpError(400,'Enter an action title.');
            if(str(action.description).trim().length<3)throw new HttpError(400,'Provide an action description before sending.');
            const due=str(action.deadline);
            if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))))throw new HttpError(400,'Choose a valid action deadline.');
            for(const uid of actionUids){
                const email=str(byUid.get(uid)?.data.email).toLowerCase();
                fields.cc=fields.cc.filter(item=>item!==email);
                fields.bcc=fields.bcc.filter(item=>item!==email);
                if(!fields.to.includes(email))fields.to.push(email);
            }
        }
        if(isObj(ctx.body.action)&&ctx.body.action.enabled===true&&!actionUids.length)throw new HttpError(400,'Select colleagues to receive the monitored action.');
        if(!fields.to.length && !fields.cc.length && !fields.bcc.length)throw new HttpError(400,'Add at least one recipient.');
        const combined=[...new Set([...fields.to,...fields.cc,...fields.bcc])];
        if(combined.length>50)throw new HttpError(400,'Maximum 50 colleagues per message.');
        if(combined.some(e=>!byEmail.has(e)))throw new HttpError(403,'Internal mail is restricted to active colleagues in this organization. External addresses are not enabled.');
        const attachments=await listAttachments(ctx,fields.attachmentIds);
        const id=str(ctx.body.id)||'m_'+randomId(18);
        if(!identifier.test(id))throw new HttpError(400,'Invalid mail ID.');
        const existing=await getDoc(root(ctx)+'/'+id);
        if(existing && str(existing.data.folder)!=='drafts')throw new HttpError(409,'This email has already been sent.');
        const threadId=str(ctx.body.threadId);
        if(threadId && !identifier.test(threadId))throw new HttpError(400,'Invalid conversation ID.');
        const inReplyTo=str(ctx.body.inReplyTo);
        if(inReplyTo && !identifier.test(inReplyTo))throw new HttpError(400,'Invalid reply reference.');
        if(inReplyTo){
            const parent=await getDoc(root(ctx)+'/'+inReplyTo);
            if(!parent)throw new HttpError(404,'Original email is not available in your mailbox.');
            const mode=str(ctx.body.replyMode);
            if(mode!=='forward'&&parent.data.allowReply===false)throw new HttpError(403,'Replies were disabled for this email.');
            if(mode==='replyall'&&parent.data.allowReplyAll===false)throw new HttpError(403,'Reply to all was disabled for this email.');
        }
        const now=nowIso();
        const shared={
            fromUid:ctx.uid,fromName:displayName(ctx.me),fromEmail:ctx.claims.email,
            to:fields.to,cc:fields.cc,bcc:[],subject:fields.subject||'(No subject)',
            html:fields.html,excerpt:preview(fields.html),attachments,priority:fields.priority,
            threadId:threadId||id,inReplyTo,sentAt:now,updatedAt:now,
            action:actionUids.length?{enabled:true,title:str(action.title).slice(0,180),description:str(action.description).slice(0,2400),deadline:str(action.deadline),recipientUids:actionUids,photoPath:str(action.photoPath)}:{},
            actionId:'',starred:false,flagged:false,focus:true,category:'',
            allowReply:ctx.body.allowReply!==false,allowReplyAll:ctx.body.allowReplyAll!==false,allowDelete:ctx.body.allowDelete!==false,
        };
        // Message delivery copies are scoped to each verified member mailbox; never
        // return other users' mailbox documents through any route.
        for(const email of combined){
            const member=byEmail.get(email)!;
            const self=member.id===ctx.uid;
            const copyId=self?id+'_self':id;
            const target=root(ctx,member.id)+'/'+copyId;
            const copy={
                ...shared,to:fields.to,cc:fields.cc,
                bcc:fields.bcc.includes(email)?[email]:[],
                folder:'inbox',read:false,
            };
            const ok=await writeDoc(target,copy,{exists:false});
            if(!ok){
                const check=await getDoc(target);
                if(str(check?.data.fromUid)!==ctx.uid || str(check?.data.sentAt)!==now) {
                    throw new HttpError(409,'A recipient already has this message ID. Please try again.');
                }
            }
        }
        await writeDoc(root(ctx)+'/'+id,{...shared,bcc:fields.bcc,folder:'sent',read:true});
        const draftId=str(ctx.body.draftId);
        if(draftId && identifier.test(draftId)&&draftId!==id){
            const draft=await getDoc(root(ctx)+'/'+draftId);
            if(str(draft?.data.folder)==='drafts')await deleteDoc(root(ctx)+'/'+draftId);
        }
        await trace(ctx,'mail.send',id);
        let actionId='',actionWarning='';
        if(actionUids.length){
            try{
                actionId=await createMonitoredAction(ctx,{source:'email',sourceId:id,
                    title:str(action.title),description:str(action.description),deadline:str(action.deadline),
                    recipientUids:actionUids,threadId:shared.threadId,subject:shared.subject,
                    photoPath:str(action.photoPath)});
                await updateFields(root(ctx)+'/'+id,{actionId});
                for(const email of combined){const member=byEmail.get(email)!;
                    await updateFields(root(ctx,member.id)+'/'+(member.id===ctx.uid?id+'_self':id),{actionId});
                }
            }catch(error){actionWarning=error instanceof Error?error.message:'Monitored Action could not be established.';
                console.error('Email delivered, but monitored action creation failed',actionWarning);}
        }
        // Automatic replies are non-critical: a reply failure must not roll back delivered mail.
        for (const email of combined) {
            const member=byEmail.get(email)!;
            try { await sendAutoReply(ctx,member,{id,subject:shared.subject,threadId:shared.threadId}); }
            catch(error){console.error('Internal automatic reply failed',error instanceof Error?error.message:'unknown');}
        }
        return {id,threadId:shared.threadId,recipients:combined.length,delivery:'internal',actionId,actionWarning};
    })],
    'POST /api/org/mail/change':[orgRoute('mail.change',null,async(ctx)=>{
        const ids=Array.isArray(ctx.body.ids)?[...new Set(ctx.body.ids.map(str))]:[str(ctx.body.id)];
        if(!ids.length||ids.length>100||ids.some(x=>!identifier.test(x)))throw new HttpError(400,'Choose up to 100 messages.');
        const kind=str(ctx.body.action);
        if(!['read','unread','star','unstar','flag','unflag','focused','other','category','move','delete','restore','destroy'].includes(kind))throw new HttpError(400,'Choose a mailbox action.');
        const target=str(ctx.body.folder);
        if(kind==='move' && (!folderFor(target)||target==='drafts'||target==='sent'))throw new HttpError(400,'Choose a valid mail folder.');
        if(kind==='move'&&target.startsWith('f_')&&!(await getDoc(folderRoot(ctx)+'/'+target)))throw new HttpError(404,'Custom folder not found.');
        const category=str(ctx.body.category).trim().slice(0,32);
        let changed=0;
        for(const id of ids){
            const path=root(ctx)+'/'+id;
            const doc=await getDoc(path);
            if(!doc)continue;
            const old=str(doc.data.folder);
            if((kind==='delete'||kind==='destroy')&&doc.data.allowDelete===false)throw new HttpError(403,'The sender disabled recipient deletion of this message.');
            if(kind==='destroy'){if(old!=='deleted')throw new HttpError(409,'Move mail to Deleted Items before permanently deleting it.');await deleteDoc(path);changed++;continue;}
            const update:Record<string,string|boolean>={updatedAt:nowIso()};
            if(kind==='read')update.read=true;
            if(kind==='unread')update.read=false;
            if(kind==='star')update.starred=true;
            if(kind==='unstar')update.starred=false;
            if(kind==='flag')update.flagged=true;
            if(kind==='unflag')update.flagged=false;
            if(kind==='focused')update.focus=true;
            if(kind==='other')update.focus=false;
            if(kind==='category')update.category=category;
            if(kind==='move')update.folder=target;
            if(kind==='delete'){update.folder='deleted';update.previousFolder=old;}
            if(kind==='restore')update.folder=folderFor(str(doc.data.previousFolder))?str(doc.data.previousFolder):'inbox';
            await updateFields(path,update);changed++;
        }
        await trace(ctx,'mail.'+kind,ids[0]);
        return {changed};
    })],
    'POST /api/org/mail/folder':[orgRoute('mail.folder',null,async(ctx)=>{
        const action=str(ctx.body.action);
        const id=str(ctx.body.id);
        if(action==='create'){
            const name=str(ctx.body.name).trim().slice(0,50);
            if(name.length<2||fixedFolders.includes(name.toLowerCase()))throw new HttpError(400,'Name a custom folder.');
            const docs=await listDocs(folderRoot(ctx));
            if(docs.some(d=>str(d.data.name).toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Folder already exists.');
            const next='f_'+randomId(12);
            await writeDoc(folderRoot(ctx)+'/'+next,{name,createdAt:nowIso()},{exists:false});
            return {id:next,name};
        }
        if(!/^f_[a-zA-Z0-9_-]{6,60}$/.test(id))throw new HttpError(400,'Choose a custom folder.');
        const existing=await getDoc(folderRoot(ctx)+'/'+id);
        if(!existing)throw new HttpError(404,'Folder not found.');
        if(action==='rename'){
            const name=str(ctx.body.name).trim().slice(0,50);
            if(name.length<2)throw new HttpError(400,'Choose a folder name.');
            await updateFields(folderRoot(ctx)+'/'+id,{name});
            return {id,name};
        }
        if(action==='delete'){
            const items=await listDocs(root(ctx));
            for(const item of items.filter(d=>str(d.data.folder)===id))await updateFields(root(ctx)+'/'+item.id,{folder:'inbox',updatedAt:nowIso()});
            await deleteDoc(folderRoot(ctx)+'/'+id);
            return {deleted:true,movedTo:'inbox'};
        }
        throw new HttpError(400,'Choose a folder action.');
    })],
    'POST /api/org/mail/upload':[orgRoute('mail.upload',null,async(ctx)=>{
        await rateLimit('mail-upload',ctx.uid,45,3600);
        const mime=str(ctx.body.mime).toLowerCase();
        const type=acceptedTypes[mime];
        if(!type)throw new HttpError(400,'Attach a supported photo or Office document.');
        const data=str(ctx.body.data);
        if(!data||data.length>Math.ceil(type.max*4/3)+8||!/^[A-Za-z0-9+/=]+$/.test(data))throw new HttpError(413,'Attachment too large or invalid.');
        const buf=Buffer.from(data,'base64');
        if(buf.length<3||buf.length>type.max||!isMagic(buf,mime))throw new HttpError(400,'File content does not match its type.');
        const id='a_'+randomId(16);
        const name=str(ctx.body.name).split(/[\\/]/).pop()?.trim().slice(0,125)||'attachment.'+type.ext;
        const path='organizations/'+ctx.orgId+'/mail_files/'+ctx.uid+'/'+id+'.'+type.ext;
        const [ok]=await storage.write([{path,content:data,contentType:mime}]);
        if(!ok)throw new HttpError(503,'Attachment could not be stored.');
        await writeDoc(fileRoot(ctx)+'/'+id,{id,orgId:ctx.orgId,ownerUid:ctx.uid,name,size:buf.length,mime,path,uploadedAt:nowIso()});
        return {attachment:{id,name,mime,size:buf.length,url:(await storage.url([path]))[0]?.url||''}};
    })],
};
