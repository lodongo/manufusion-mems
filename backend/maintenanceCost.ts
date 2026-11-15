import {getDoc,listDocs,isObj,str,HttpError,type Doc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {entityOf,fxRate} from './finCore';
import {reconcileCost,amount,COST_CATEGORIES,type CostLine,type CostCategory} from './maintenanceCostCore';
const obj=(x:unknown)=>isObj(x)?x:{};
const rows=(x:unknown)=>Array.isArray(x)?x.filter(isObj):[];
const texts=(x:unknown)=>Array.isArray(x)?x.map(str).filter(Boolean):[];
const root=(ctx:OrgContext)=>'organizations/'+ctx.orgId;
const positive=(x:unknown)=>{const v=amount(x);return v!==null&&v>0?v:null;};
const category=(x:unknown):CostCategory|null=>COST_CATEGORIES.includes(str(x) as CostCategory)?str(x) as CostCategory:null;
const postedDate=(j:Doc)=>str(j.data.postingDate);
export async function loadMaintenanceCostSources(ctx:OrgContext){
 const [journals,issues,requirements,purchaseOrders,finRequests,logs,nodes,budgets]=await Promise.all(['fin_journal','goods_issues','procurement_requirements','procurement_orders','fin_requests','maintenance_time_bookings','structure','mnt_budgets'].map(c=>listDocs(root(ctx)+'/'+c)));
 return {journals,issues,requirements:new Map(requirements.map(r=>[r.id,r])),purchaseOrders,finRequests:new Map(finRequests.map(r=>[r.id,r])),logs,nodes:new Map(nodes.map(n=>[n.id,n])),budgets};
}
type Sources=Awaited<ReturnType<typeof loadMaintenanceCostSources>>;
export async function costForOrder(ctx:OrgContext,w:Doc,s:Sources,from='',through=''){
 const d=w.data,wo=w.id,leId=texts(d.path).find(id=>s.nodes.get(id)?.data.level==='legal_entity')||'',le=leId?await entityOf(ctx.orgId,leId):null,currency=le?.functionalCurrency||'',lines:CostLine[]=[],pending=new Set<string>(),refs=new Set<string>();
 const inPeriod=(v:string)=>!from||!through||v>=from&&v<=through;
 const add=(cat:CostCategory,cur:string,n:number|null,kind:CostLine['kind'],source:string,date='')=>{if(n===null||!cur||!Number.isFinite(n)){pending.add(cat+': source value or currency missing');return;}lines.push({category:cat,currency:cur,amount:n,kind,source,date});refs.add(source);};
 const issues=s.issues.filter(i=>i.data.workOrderId===wo),issueIds=new Set(issues.map(i=>i.id));
 for(const j of s.journals){const x=j.data,t=obj(x.trace),source=obj(x.source),id=str(source.id),cur=str(x.currency),date=postedDate(j);if(x.type==='GI_WO'&&(t.workOrderId===wo||issueIds.has(str(t.issueId))||source.kind==='goods_issue'&&issueIds.has(id)||source.kind==='goods_return'&&issueIds.has(str(source.ref)))){
  const issue=issues.find(i=>i.id===str(t.issueId)||i.id===id||i.id===str(source.ref)),cc=str(issue?.data.costCenterId)||str(d.costCenterId),accounts=new Set(rows(issue?.data.lines).map(l=>str(l.expenseGlCode)).filter(Boolean));const matched=rows(x.lines).filter(l=>l.ccId===cc&&accounts.has(str(l.glCode)));
  if(!matched.length){pending.add('materials: journal expense line could not be linked');continue;}add('materials',cur,matched.reduce((n,l)=>n+(l.side==='D'?1:-1)*(Number(l.amount)||0),0),'posted',j.id,date);
 }else if(x.type==='SVC_ACCEPT'){for(const l of rows(t.maintenanceServiceLines).filter(l=>l.workOrderId===wo)){add(l.costNatureCode==='EXTERNAL_SPECIALIST'?'specialists':'services',cur,amount(l.amount),'posted',j.id,date);}}
 else if(t.workOrderId===wo&&category(t.maintenanceCostCategory)){const cat=category(t.maintenanceCostCategory)!;const eligible=rows(x.lines).filter(l=>l.ccId===d.costCenterId&&str(l.glCode)===str(t.expenseGlCode));if(!eligible.length)pending.add(cat+': journal classification not reconciled');else add(cat,cur,eligible.reduce((n,l)=>n+(l.side==='D'?1:-1)*(Number(l.amount)||0),0),'posted',j.id,date);}
 }
 for(const i of issues){if(i.data.finance!=='live'||!str(i.data.journalId)&&Number(i.data.total)>0)pending.add('materials: an issue is not linked to a posted value');}
 const ca=obj(d.costApproval),req=s.finRequests.get(str(ca.requestId)),payload=obj(req?.data.payload),est=obj(payload.estimate),estCur=str(payload.currency);
 const approved=ca.status==='approved'&&Number(ca.version)===Number(d.assessmentTasksVersion)&&req?.data.status==='approved';
 if(approved){for(const [key,cat] of [['spares','materials'],['services','services'],['labour','labour'],['allowance','other']] as const)add(cat,estCur,amount(est[key]),'estimate',str(ca.requestId),str(ca.approvedAt));}
 else pending.add('Current approved estimate unavailable');
 const terminal=['closed','cancelled'].includes(str(d.status));
 const procurements: {id:string;currency:string;amount:number;kind:string}[]=[];
 for(const po of s.purchaseOrders){if(!['open','sent','partial','full'].includes(str(po.data.status)))continue;for(const l of rows(po.data.lines)){const req=s.requirements.get(str(l.requirementId));const source=obj(rows(req?.data.lines).find(r=>Number(r.no)===Number(l.requirementLineNo))?.maintenanceSource||req?.data.maintenanceSource);if(source.woCode!==wo)continue;
  const ordered=positive(l.quantity),price=positive(l.netUnitPrice),received=amount(l.receivedQty)??0,cur=str(po.data.currency);
  if(ordered===null||price===null||!cur){pending.add('Procurement commitment has incomplete value');continue;}
  if(received<0||received>ordered+0.001){pending.add('Procurement received quantity inconsistent');continue;}
  const outstanding=Math.max(0,ordered-received)*price;
  // Material replenishment is not consumption. Keep purchasing exposure distinct from the order's expense forecast.
  if(l.type==='service'){if(outstanding>0)add('services',cur,outstanding,'committed',po.id);if(received>0&&!s.journals.some(j=>j.data.type==='SVC_ACCEPT'&&obj(j.data.source).id===po.id&&rows(obj(j.data.trace).maintenanceServiceLines).some(x=>x.workOrderId===wo&&Number(x.purchaseOrderLineNo)===Number(l.no))))pending.add('Accepted service lacks linked accounting posting');}
  else if(outstanding>0)procurements.push({id:po.id,currency:cur,amount:outstanding,kind:'Material procurement exposure'});
 }}
 const tasks=rows(d.assessmentTasks);for(const task of tasks){const entries=s.logs.filter(l=>l.data.woCode===wo&&l.data.taskId===task.id&&l.data.classCode==='DIRECT'&&!['superseded','void'].includes(str(l.data.status)));const verified=entries.filter(l=>['approved','recorded'].includes(str(l.data.status)));if(entries.some(l=>!['approved','recorded'].includes(str(l.data.status))))pending.add('Labour has unresolved bookings');
  const hours=verified.reduce((n,l)=>{const a=Date.parse(str(l.data.start)),b=Date.parse(str(l.data.end));return n+(Number.isFinite(a)&&Number.isFinite(b)&&b>a?(b-a)/3600000:0);},0);
  const rate=positive(task.rate);if(hours>0&&approved&&rate!==null&&estCur)add('labour',estCur,hours*rate,'operational',str(ca.requestId));else if(hours>0||obj(obj(d.taskExecution)[str(task.id)]).status==='completed')pending.add('Labour: approved costing rate or individual intervals missing');
  if(obj(task.externalResource).type)pending.add('Specialist cost: reconcile to linked procurement/finance source');if(str(task.tools))pending.add('Tool hire: no separately verified charge unless posted');
 }
 if(rows(d.timeLogs).length)pending.add('Legacy reported labour is not salary cost and is not included in precise costing');
 // Historical postings remain in their original functional currency. Convert only for explicitly labelled current reference view.
 const buckets=reconcileCost(lines,terminal),reference=str(ctx.org.data.currencyCode);const byCurrency=new Map<string,{currency:string;posted:number;periodPosted:number;committed:number;estimated:number|null;operationalLabour:number;forecastKnown:number}>();
 for(const b of buckets){const a=byCurrency.get(b.currency)||{currency:b.currency,posted:0,periodPosted:0,committed:0,estimated:null,operationalLabour:0,forecastKnown:0};a.posted+=b.posted;a.committed+=b.committed;if(b.estimate!==null)a.estimated=(a.estimated??0)+b.estimate;a.operationalLabour+=b.operational;a.forecastKnown+=b.forecast??0;byCurrency.set(b.currency,a);}
 for(const l of lines.filter(l=>l.kind==='posted'&&inPeriod(l.date))){const a=byCurrency.get(l.currency);if(a)a.periodPosted+=l.amount;}
 let referencePosted=0,referenceComplete=!!reference;for(const a of byCurrency.values())try{referencePosted+=a.posted*await fxRate(a.currency,reference);}catch{referenceComplete=false;}
 const budget=s.budgets.find(b=>b.data.ccId===d.costCenterId&&b.data.period===str(d.scheduledStart).slice(0,7));
 return {code:wo,title:str(d.title),currency,legalEntityId:leId,costCenterId:str(d.costCenterId),costCenter:str(d.costCenterName)||str(d.costCenterCode),terminal,buckets,totals:[...byCurrency.values()],procurements,pending:[...pending],sources:[...refs],referenceCurrency:reference,referencePosted:referenceComplete?referencePosted:null,budget:budget?{amount:amount(budget.data.amount),currency:str(budget.data.currency),period:str(budget.data.period)}:null,coverage:'Known posted accounting costs; operational labour at the approved assessment costing rate, not payroll actual. Forecast is a known floor, using the greater of comparable approved estimate or actual + outstanding commitments; material procurement exposure excluded. Current snapshot; posted-in-period uses ledger posting date.'};
}
export const maintenanceCostRoutes={'POST /api/org/mnt/costing':[orgRoute('org.mnt.costing','MNT.view',async ctx=>{
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const b=ctx.body,scope=await scopeOf(ctx),code=str(b.code),node=str(b.node),asset=str(b.asset),group=str(b.group),legal=str(b.legalEntity),country=str(b.country),employee=str(b.employee),from=str(b.from),through=str(b.through);
 if((from||through)&&(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(through)||from>through))throw new HttpError(400,'Choose a valid reporting interval.');
 const [sources,orders]=await Promise.all([loadMaintenanceCostSources(ctx),listDocs(root(ctx)+'/work_orders')]);
 const visible=orders.filter(w=>canAt(ctx,'MNT.view',texts(w.data.path),scope)).filter(w=>{const d=w.data,p=texts(d.path),le=p.find(id=>sources.nodes.get(id)?.data.level==='legal_entity')||'',countryCode=str(obj(sources.nodes.get(le)?.data.attributes).countryCode)||str(sources.nodes.get(le)?.data.countryCode);
 return (!code||w.id===code)&&(!node||p.includes(node))&&(!asset||(str(d.assetTag)||str(d.unitId))===asset)&&(!group||d.workGroupId===group)&&(!legal||le===legal)&&(!country||countryCode===country)&&(!employee||rows(d.assignees).some(a=>a.uid===employee)||sources.logs.some(l=>l.data.woCode===w.id&&l.data.uid===employee))&&(!from||!through||str(d.createdAt).slice(0,10)<=through&&(!str(d.closedAt||d.cancelledAt)||str(d.closedAt||d.cancelledAt).slice(0,10)>=from)||sources.journals.some(j=>postedDate(j)>=from&&postedDate(j)<=through&&(obj(j.data.trace).workOrderId===w.id||rows(obj(j.data.trace).maintenanceServiceLines).some(l=>l.workOrderId===w.id))));});
 if(code&&!visible.length)throw new HttpError(403,'Work order unavailable in your scope.');
 const offset=Math.max(0,Number(b.offset)||0),limit=code?1:50,items=await Promise.all(visible.sort((a,b)=>a.id.localeCompare(b.id)).slice(offset,offset+limit).map(w=>costForOrder(ctx,w,sources,from,through)));
 return {items,total:visible.length,offset,limit,from,through,coverage:'Amounts retain their source currency. Never add different currencies; reference actual uses the current configured exchange rate, not a historical restatement. Cost figures cover the returned orders only; missing source valuation remains pending.'};
 })]};
