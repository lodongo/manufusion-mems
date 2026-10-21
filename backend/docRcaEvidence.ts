/** Fail-closed RCA cause / effectiveness evidence gates. */
export type RcaFinding={cause:string;status:'hypothesis'|'verified';evidenceIds:string[];verificationRationale:string};
export type RcaCheck={criterion:string;result:'pass'|'fail'|'pending';evidenceIds:string[];verifiedBy:string;verifiedAt:string};
export function findingsValid(raw:unknown,registered:Set<string>):raw is RcaFinding[]{
 if(!Array.isArray(raw)||raw.length<1||raw.length>30)return false;
 return raw.every((v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const x=v as Record<string,unknown>;
  return typeof x.cause==='string'&&x.cause.trim().length>=12&&x.cause.length<=2000
   &&(x.status==='hypothesis'||x.status==='verified')
   &&Array.isArray(x.evidenceIds)&&x.evidenceIds.length>0&&x.evidenceIds.length<=20
   &&new Set(x.evidenceIds).size===x.evidenceIds.length&&x.evidenceIds.every(id=>typeof id==='string'&&registered.has(id))
   &&typeof x.verificationRationale==='string'&&x.verificationRationale.trim().length>=12&&x.verificationRationale.length<=2000;
 });
}
export function checksValid(raw:unknown,registered:Set<string>):raw is RcaCheck[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>30)return false;
 return raw.every((v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const x=v as Record<string,unknown>;
  return typeof x.criterion==='string'&&x.criterion.trim().length>=12&&x.criterion.length<=2000
   &&x.result==='pass'&&typeof x.verifiedBy==='string'&&x.verifiedBy.trim().length>=3
   &&typeof x.verifiedAt==='string'&&!Number.isNaN(Date.parse(x.verifiedAt))
   &&Array.isArray(x.evidenceIds)&&x.evidenceIds.length>0&&x.evidenceIds.length<=20
   &&new Set(x.evidenceIds).size===x.evidenceIds.length&&x.evidenceIds.every(id=>typeof id==='string'&&registered.has(id));
 });
}
