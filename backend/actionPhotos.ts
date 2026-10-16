import { storage } from './platform/sdk';
import { HttpError, nowIso, randomId, rateLimit, str } from './core';
import { orgRoute, type OrgContext } from './guards';
import { detectImage } from './branding';

const root = (ctx:OrgContext) => 'organizations/'+ctx.orgId+'/action_photos/';
const idPattern = /^[A-Za-z0-9_-]{8,42}\.(jpg|png)$/;
export function validateActionPhoto(ctx:OrgContext, value:unknown):string {
    const path=str(value);
    if(!path)return '';
    const expected=root(ctx)+ctx.uid+'/';
    if(!path.startsWith(expected) || !idPattern.test(path.slice(expected.length))){
        throw new HttpError(403,'Choose a photo that you uploaded to your own MEMS action.');
    }
    return path;
}
export async function actionPhotoUrl(ctx:OrgContext,value:unknown):Promise<string>{
    const path=str(value);
    if(!path.startsWith(root(ctx)))return '';
    const rest=path.slice(root(ctx).length);
    if(!/^[A-Za-z0-9_-]{6,128}\/[A-Za-z0-9_-]{8,42}\.(jpg|png)$/.test(rest))return '';
    const [result]=await storage.url([path]);
    return result?.url||'';
}
export const actionPhotoRoutes={
    'POST /api/org/actions/photo':[orgRoute('actions.photo',null,async ctx=>{
        await rateLimit('action-photo-upload',ctx.uid,40,3600);
        const data=str(ctx.body.data);
        if(!data || data.length>2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)){
            throw new HttpError(413,'Action photo must be under 1.5 MB.');
        }
        const binary=Buffer.from(data,'base64');
        if(!binary.length || binary.length>1_500_000){
            throw new HttpError(413,'Action photo must be under 1.5 MB.');
        }
        const image=detectImage(binary);
        if(!image)throw new HttpError(400,'Use a JPEG or PNG photo.');
        const path=root(ctx)+ctx.uid+'/'+randomId(12)+'.'+image.ext;
        const [saved]=await storage.write([{path,content:data,contentType:image.contentType}]);
        if(!saved)throw new HttpError(502,'Unable to save action photo.');
        return {path,url:await actionPhotoUrl(ctx,path),uploadedAt:nowIso()};
    })],
};
