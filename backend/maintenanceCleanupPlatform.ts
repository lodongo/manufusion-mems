import {randomUUID} from 'node:crypto';
import {getDoc,HttpError,str,nowIso,type Obj} from './core';
import {commit,withLock} from './finCore';
import {clearTestModeCache,readTestMode,overrideActiveFor,testModeEnvironmentAllowed,type TestModeState} from './testModeCore';
import type {StaffContext} from './guards';

export const CLEANUP_PLATFORM_LIFETIME_MS=60*60*1000;
export const CLEANUP_PLATFORM_PHRASE='ENABLE DATABASE CLEANUP';
export const cleanupPlatformPath=(orgId:string)=>'organizations/'+orgId+'/maintenance_cleanup_platform/default';
export function cleanupPlatformActive(doc:Obj|undefined,mode:TestModeState,orgId:string,now=Date.now()){
 return !!doc&&overrideActiveFor(mode,orgId,now)&&doc.enabled===true&&doc.orgId===orgId&&doc.modeVersion===mode.version&&doc.modeEnabledAt===mode.enabledAt&&Number.isSafeInteger(doc.version)&&Number(doc.version)>0&&Date.parse(str(doc.expiresAt))>now;
}
export async function cleanupPlatformView(orgId:string,mode:TestModeState){
 const d=(await getDoc(cleanupPlatformPath(orgId)))?.data;
 return {orgId,enabled:cleanupPlatformActive(d,mode,orgId),version:Number(d?.version)||0,expiresAt:str(d?.expiresAt),enabledByEmail:str(d?.enabledByEmail),reason:str(d?.reason)};
}
export async function setPlatformCleanup(ctx:StaffContext){
 if(ctx.role!=='super_admin'||!testModeEnvironmentAllowed())throw new HttpError(403,'MEMS Super Admin in development is required.');
 const orgId=str(ctx.body.orgId),enabled=ctx.body.enabled,reason=str(ctx.body.reason).trim();
 if(!/^[A-Za-z0-9_-]{4,128}$/.test(orgId)||typeof enabled!=='boolean'||reason.length<10||reason.length>500)throw new HttpError(400,'Choose one tenant, enable or disable, and enter a reason of 10–500 characters.');
 if(enabled&&ctx.body.confirmation!==CLEANUP_PLATFORM_PHRASE)throw new HttpError(400,'Type '+CLEANUP_PLATFORM_PHRASE+' to confirm.');
 return withLock(orgId,'maintenance_operations',async()=>{
  clearTestModeCache();const mode=await readTestMode(),now=Date.now(),at=nowIso();
  if(!mode.orgIds.includes(orgId)&&enabled)throw new HttpError(403,'Choose a tenant with active Test Mode.');
  if(enabled&&!overrideActiveFor(mode,orgId,now))throw new HttpError(403,'Active Test Mode is required for this tenant.');
  const org=await getDoc('organizations/'+orgId);
  if(!org||enabled&&str(org.data.status)!=='active')throw new HttpError(409,'An active tenant is required.');
  const path=cleanupPlatformPath(orgId),prior=await getDoc(path),version=Number(prior?.data.version)||0;
  if(!Number.isInteger(ctx.body.expectedVersion)||ctx.body.expectedVersion!==version||prior&&!prior.updateTime)throw new HttpError(409,'Cleanup settings changed. Refresh and try again.');
  const expiresAt=enabled?new Date(Math.min(now+CLEANUP_PLATFORM_LIFETIME_MS,Date.parse(mode.expiresAt))).toISOString():'';
  const fields={orgId,enabled,version:version+1,modeVersion:mode.version,modeEnabledAt:mode.enabledAt,expiresAt,reason,enabledBy:enabled?ctx.uid:'',enabledByEmail:enabled?ctx.actor.email:'',updatedAt:at,updatedBy:ctx.uid};
  const receipt={action:enabled?'platform_enabled':'platform_disabled',orgId,uid:ctx.uid,email:ctx.actor.email,at,reason,expiresAt,version:version+1,modeVersion:mode.version};
  await commit([{path,fields,...(prior?{updateTime:prior.updateTime}:{exists:false})},{path:'organizations/'+orgId+'/maintenance_cleanup_authorization_audit/'+randomUUID(),fields:receipt,exists:false}]);
  return cleanupPlatformView(orgId,mode);
 });
}
