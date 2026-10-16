import { storage } from '@appdeploy/sdk';
import { HttpError, isObj, nowIso, randomId, rateLimit, str } from './core';
import { orgRoute, type OrgContext } from './guards';

export interface NoteAttachment {
    id:string;path:string;name:string;mime:string;size:number;
}
const formats:Record<string,{ext:string;limit:number}>={
    'image/jpeg':{ext:'jpg',limit:5_000_000},
    'image/png':{ext:'png',limit:5_000_000},
    'image/webp':{ext:'webp',limit:5_000_000},
    'application/pdf':{ext:'pdf',limit:8_000_000},
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{ext:'docx',limit:8_000_000},
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{ext:'xlsx',limit:8_000_000},
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':{ext:'pptx',limit:8_000_000},
    'text/plain':{ext:'txt',limit:2_000_000},
    'text/csv':{ext:'csv',limit:2_000_000},
};
const prefix=(ctx:OrgContext)=>'organizations/'+ctx.orgId+'/private_notes/'+ctx.uid+'/';
const filePart=/^n_[A-Za-z0-9_-]{12,50}\.(jpg|png|webp|pdf|docx|xlsx|pptx|txt|csv)$/;
function recognized(bytes:Buffer,mime:string):boolean{
    if(mime==='image/jpeg')return bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if(mime==='image/webp')return bytes.toString('latin1',0,4)==='RIFF'&&bytes.toString('latin1',8,12)==='WEBP';
    if(mime==='application/pdf')return bytes.toString('latin1',0,4)==='%PDF';
    if(mime.includes('openxmlformats-officedocument'))return bytes.toString('latin1',0,2)==='PK';
    return !bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD');
}
export function allowedNoteAttachments(ctx:OrgContext,raw:unknown):NoteAttachment[]{
    if(!Array.isArray(raw))return [];
    if(raw.length>12)throw new HttpError(400,'Attach no more than 12 files per note.');
    const seen=new Set<string>();
    return raw.map(item=>{
        if(!isObj(item))throw new HttpError(400,'Invalid note attachment.');
        const path=str(item.path),mime=str(item.mime),name=str(item.name).slice(0,140);
        const id=str(item.id),size=Number(item.size)||0;
        if(!path.startsWith(prefix(ctx))||!filePart.test(path.slice(prefix(ctx).length))
            ||!formats[mime]||!name||!/^n_[A-Za-z0-9_-]{12,50}$/.test(id)
            ||!path.includes('/'+id+'.'+formats[mime].ext)
            ||size<1||size>formats[mime].limit||seen.has(path)){
            throw new HttpError(403,'An attachment is invalid or belongs to another employee.');
        }
        seen.add(path);
        return {id,path,mime,name,size};
    });
}
export async function publicNoteAttachmentUrls(ctx:OrgContext,raw:unknown){
    const files=allowedNoteAttachments(ctx,raw);
    return await Promise.all(files.map(async item=>{
        const [link]=await storage.url([item.path]);
        return {...item,url:link?.url||''};
    }));
}
export function sanitizedNoteHtml(input:unknown):string{
    const html=str(input);
    if(html.length>80_000)throw new HttpError(413,'Note content is too long.');
    const allowed=new Set(['p','div','br','strong','b','em','i','u','s','strike','h1','h2','h3',
        'ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','td','th','span','sup','sub','a']);
    return html.replace(/<[^>]*>/g,tag=>{
        const m=/^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>$/i.exec(tag);
        if(!m)return '';
        const name=m[2].toLowerCase();
        if(!allowed.has(name))return '';
        if(m[1])return '</'+name+'>';
        if(name==='br'||name==='hr')return '<'+name+'>';
        if(name==='a'){
            const attr=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
            const href=(attr?.[1]||attr?.[2]||'').trim();
            if(/^https:\/\/[^\s"'<>]+$/i.test(href))
                return '<a href="'+href.replace(/&/g,'&amp;')+'" rel="noopener noreferrer" target="_blank">';
        }
        return '<'+name+'>';
    });
}
export const noteFileRoutes={
    'POST /api/org/quick/note/upload':[orgRoute('quick.note.upload',null,async ctx=>{
        await rateLimit('private-note-uploads',ctx.uid,50,3600);
        const mime=str(ctx.body.mime),spec=formats[mime];
        if(!spec)throw new HttpError(400,'Attach an image, PDF, Word, Excel, PowerPoint or text document.');
        const data=str(ctx.body.data);
        if(!data||data.length>11_000_000||!/^[A-Za-z0-9+/=]+$/.test(data))throw new HttpError(413,'Attachment too large.');
        const bytes=Buffer.from(data,'base64');
        if(!bytes.length||bytes.length>spec.limit)throw new HttpError(413,'Attachment exceeds its permitted file size.');
        if(!recognized(bytes,mime))throw new HttpError(400,'File contents do not match the selected document type.');
        const id='n_'+randomId(12),path=prefix(ctx)+id+'.'+spec.ext;
        const name=str(ctx.body.name).replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,140)||'Attachment';
        const [ok]=await storage.write([{path,content:data,contentType:mime}]);
        if(!ok)throw new HttpError(502,'Could not upload the note attachment.');
        const [link]=await storage.url([path]);
        return {item:{id,path,name,mime,size:bytes.length,url:link?.url||'',uploadedAt:nowIso()}};
    })],
};
