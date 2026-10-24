import {HttpError,getDoc,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {withLock} from './finCore';
import {
  defaultCorporateStructure,validateCorporateStructure,
  type CorporateStructureConfig,type StructureReferences,
} from './corporateStructure';

const key=(orgId:string)=>'organizations/'+orgId+'/corporate_structure/default';
async function references(ctx:OrgContext):Promise<StructureReferences>{
  const [units,corp,positions]=await Promise.all([
    listDocs('organizations/'+ctx.orgId+'/structure'),
    getDoc('organizations/'+ctx.orgId+'/corporate_governance/default'),
    listDocs('organizations/'+ctx.orgId+'/positions'),
  ]);
  const nodes=units.map(x=>({
    id:x.id,code:str(x.data.code),name:str(x.data.name),
    parentId:str(x.data.parentId),level:str(x.data.level),status:str(x.data.status),
  }));
  const functions=Array.isArray(corp?.data.functions)?corp.data.functions.flatMap((f:unknown)=>{
    if(!f||typeof f!=='object'||Array.isArray(f))return [];
    const row=f as Record<string,unknown>;
    return [{code:str(row.code),name:str(row.name),enabled:row.enabled!==false}];
  }):[];
  const activePositions=positions.filter(x=>str(x.data.status)!=='inactive')
    .map(x=>({code:x.id,name:str(x.data.title)||x.id}));
  return {nodes,functions,positions:activePositions};
}
export const corporateStructureRoutes={
  'POST /api/org/corporate/structure/read':[orgRoute(
    'org.corporate.structure.read','ADM.structure',async ctx=>{
      const [current,refs]=await Promise.all([getDoc(key(ctx.orgId)),references(ctx)]);
      return {config:current?.data as CorporateStructureConfig||defaultCorporateStructure(),
        references:refs,saved:!!current,
        note:'Planning only. This policy does not modify access, HR, payroll, GL, budgets or intercompany balances.'};
    },
  )],
  'POST /api/org/corporate/structure/save':[orgRoute(
    'org.corporate.structure.save','ADM.structure',async ctx=>{
      const refs=await references(ctx);
      let validated:ReturnType<typeof validateCorporateStructure>;
      try{validated=validateCorporateStructure(ctx.body.config,refs);}
      catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid corporate structure configuration.');}
      return withLock(ctx.orgId,'corporate_structure_draft',async()=>{
        const previous=await getDoc(key(ctx.orgId));
        const version=Number(previous?.data.version||0);
        if(!Number.isSafeInteger(Number(ctx.body.expectedVersion))||
          Number(ctx.body.expectedVersion)!==version)
          throw new HttpError(409,'Corporate structure was changed elsewhere. Reload before saving.');
        const saved:CorporateStructureConfig={
          ...validated,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid,
        };
        await writeDoc(key(ctx.orgId),saved);
        return {ok:true,config:saved,saved:true,
          note:'Draft planning policy saved. No financial posting, security or HR employment changes have occurred.'};
      });
    },
  )],
};
