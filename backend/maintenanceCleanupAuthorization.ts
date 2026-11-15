import {createHash, randomBytes} from 'node:crypto';
import {getDoc, HttpError, str, nowIso, type Obj, type Doc} from './core';
import {commit, withLock, type Write} from './finCore';
import {clearTestModeCache, readTestMode, overrideActiveFor, testModeEnvironmentAllowed} from './testModeCore';
import type {OrgContext} from './guards';

export const CLEANUP_LIFETIME_MS=60*60*1000;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const grantPath=(ctx:OrgContext)=>'organizations/'+ctx.orgId+'/maintenance_cleanup_authorizations/'+digest(ctx.uid);
const orgReceipt=(ctx:OrgContext)=>'organizations/'+ctx.orgId+'/maintenance_cleanup_authorization_audit/';
const tokenOf=(ctx:OrgContext)=>str(ctx.body.cleanupToken);
const validToken=(s:string)=>/^[a-f0-9]{64}$/.test(s);
export function cleanupEligible(ctx:Pick<OrgContext,'role'|'testMode'>){return ctx.role==='org_super_admin'&&ctx.testMode===true&&testModeEnvironmentAllowed();}
/** Pure policy for tests. Verified auth_time, not the refreshing ID token's iat, identifies the login. */
export function cleanupGrantValid(g:Obj, input:{uid:string;orgId:string;authTime?:number;token:string;modeVersion:number;modeEnabledAt:string;now:number}):boolean{
 return validToken(input.token)&&Number.isInteger(input.authTime)&&g.enabled===true&&g.uid===input.uid&&g.orgId===input.orgId&&g.authTime===input.authTime&&g.tokenHash===digest(input.token)&&g.modeVersion===input.modeVersion&&g.modeEnabledAt===input.modeEnabledAt&&Number.isFinite(Date.parse(str(g.expiresAt)))&&Date.parse(str(g.expiresAt))>input.now;
}
async function currentGrant(ctx:OrgContext):Promise<Doc|null>{
 if(!cleanupEligible(ctx)||!validToken(tokenOf(ctx)))return null;
 clearTestModeCache();const mode=await readTestMode();const now=Date.now();
 if(!overrideActiveFor(mode,ctx.orgId,now))return null;
 const grant=await getDoc(grantPath(ctx));
 return grant&&cleanupGrantValid(grant.data,{uid:ctx.uid,orgId:ctx.orgId,authTime:ctx.claims.authTime,token:tokenOf(ctx),modeVersion:mode.version,modeEnabledAt:mode.enabledAt,now:Date.now()})?grant:null;
}
export async function cleanupAuthorizationStatus(ctx:OrgContext){
 const grant=await currentGrant(ctx);
 return {eligible:cleanupEligible(ctx),enabled:!!grant,expiresAt:str(grant?.data.expiresAt)};
}
export async function setCleanupAuthorization(ctx:OrgContext){
 if(ctx.role!=='org_super_admin'||!testModeEnvironmentAllowed())throw new HttpError(403,'Organization Super Admin in development is required.');
 if(ctx.body.enabled!==true&&ctx.body.enabled!==false)throw new HttpError(400,'Choose enable or disable.');
 return withLock(ctx.orgId,'maintenance_operations',async()=>{
  const path=grantPath(ctx),prior=await getDoc(path),at=nowIso();
  if(ctx.body.enabled===false){
   // Only the session which owns this grant may revoke it; a stale tab cannot revoke a newer session.
   if(prior?.data.enabled===true&&validToken(tokenOf(ctx))&&prior.data.tokenHash===digest(tokenOf(ctx))&&prior.data.authTime===ctx.claims.authTime){
    if(!prior.updateTime)throw new HttpError(409,'Refresh before disabling cleanup.');
    await commit([{path,fields:{enabled:false,revokedAt:at},mask:['enabled','revokedAt'],updateTime:prior.updateTime},{path:orgReceipt(ctx)+randomBytes(16).toString('hex'),fields:{action:'disabled',uid:ctx.uid,at,orgId:ctx.orgId},exists:false}]);
   }
   return {enabled:false,expiresAt:''};
  }
  if(!cleanupEligible(ctx)||!Number.isInteger(ctx.claims.authTime))throw new HttpError(403,'Active Test Mode and a verified login session are required.');
  if(ctx.body.confirm!=='ENABLE CLEANUP')throw new HttpError(400,'Type ENABLE CLEANUP to authorize permanent deletion.');
  clearTestModeCache();const mode=await readTestMode();const now=Date.now();
  if(!overrideActiveFor(mode,ctx.orgId,now))throw new HttpError(403,'Test Mode is no longer active.');
  const token=randomBytes(32).toString('hex'),expiresAt=new Date(Math.min(now+CLEANUP_LIFETIME_MS,Date.parse(mode.expiresAt))).toISOString();
  if(prior&&!prior.updateTime)throw new HttpError(409,'Refresh before enabling cleanup.');
  await commit([{path,fields:{uid:ctx.uid,orgId:ctx.orgId,enabled:true,tokenHash:digest(token),authTime:ctx.claims.authTime!,modeVersion:mode.version,modeEnabledAt:mode.enabledAt,enabledAt:at,expiresAt},...(prior?{updateTime:prior.updateTime}:{exists:false})},{path:orgReceipt(ctx)+randomBytes(16).toString('hex'),fields:{action:'enabled',uid:ctx.uid,orgId:ctx.orgId,at,expiresAt,modeVersion:mode.version},exists:false}]);
  return {enabled:true,expiresAt,cleanupToken:token};
 });
}
export async function requireCleanupAuthorization(ctx:OrgContext):Promise<Doc>{
 if(ctx.role!=='org_super_admin')throw new HttpError(403,'Organization Super Admin is required for permanent cleanup.');
 const grant=await currentGrant(ctx);
 if(!grant||!grant.updateTime)throw new HttpError(403,'Enable Database Cleanup separately in active development Test Mode. Authorization expires after 60 minutes or logout.');
 return grant;
}
/** Include the grant revision in the atomic purge so a simultaneous revoke invalidates the write. */
export function cleanupUseWrite(ctx:OrgContext,grant:Doc):Write{
 return {path:grantPath(ctx),fields:{lastUsedAt:nowIso()},mask:['lastUsedAt'],updateTime:grant.updateTime!};
}
