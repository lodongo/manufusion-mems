/**
 * Manufacturing process dependency gate.
 *
 * Pure, fail-closed gate intended to be reused by an eventual production-order
 * stage transition endpoint against authoritative, order-scoped stage snapshots.
 * The routing preview endpoint may simulate these transitions but it never
 * records production completion or grants permission to operate equipment.
 */
export type StageRuntimeState='NOT_STARTED'|'IN_PROGRESS'|'COMPLETED';
export type StageRuntimeAction='START'|'COMPLETE';
export type StageRuntimeInput={code:string;name?:string;dependsOn?:string[]};
export type StageRuntimeGate={
 code:string;name:string;state:StageRuntimeState;
 displayState:'BLOCKED'|'READY'|'IN_PROGRESS'|'COMPLETED';
 requiredPredecessors:string[];unmetPredecessors:string[];
 canStart:boolean;canComplete:boolean;
};
const CODE=/^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const STATES=new Set<StageRuntimeState>(['NOT_STARTED','IN_PROGRESS','COMPLETED']);
const ACTIONS=new Set<StageRuntimeAction>(['START','COMPLETE']);
const fail=(message:string):never=>{throw new Error(message);};

/** Invalid, duplicate, missing, forward, cyclic or self-referential links fail
 * closed. Required predecessor completion always means ALL predecessors. */
export function routingStageGates(
 operations:StageRuntimeInput[],states:Record<string,StageRuntimeState>={},
):StageRuntimeGate[]{
 if(!Array.isArray(operations)||!operations.length||operations.length>60)
  fail('Process must have 1–60 configured stages.');
 const found=new Set<string>();
 for(const [i,stage] of operations.entries()){
  if(!stage||typeof stage.code!=='string'||!CODE.test(stage.code))
   fail('Stage '+(i+1)+' must have a valid unique code.');
  if(found.has(stage.code))fail('Duplicate process stage '+stage.code+'.');
  found.add(stage.code);
 }
 for(const key of Object.keys(states)){
  if(!found.has(key))fail('Unknown process stage status: '+key+'.');
  if(!STATES.has(states[key]))fail('Invalid process completion status for '+key+'.');
 }
 const earlier=new Set<string>();
 for(const stage of operations){
  if(stage.dependsOn!==undefined&&!Array.isArray(stage.dependsOn))
   fail('Stage '+stage.code+' has an invalid dependency list.');
  const predecessors=stage.dependsOn??[];
  if(predecessors.some(x=>typeof x!=='string'||!earlier.has(x)||x===stage.code)||
     new Set(predecessors).size!==predecessors.length)
   fail('Stage '+stage.code+' must depend only on distinct, earlier configured stages.');
  earlier.add(stage.code);
 }
 const gates=operations.map(stage=>{
  const state=states[stage.code]??'NOT_STARTED';
  const predecessors=stage.dependsOn??[];
  const unmet=predecessors.filter(code=>states[code]!=='COMPLETED');
  // An in-progress/completed dependent stage cannot be valid while any
  // prerequisite is incomplete (including if a client tries to reset it).
  if(state!=='NOT_STARTED'&&unmet.length)
   fail('Inconsistent process state: '+stage.code+' has started without completion of '+unmet.join(', ')+'.');
  return {
   code:stage.code,name:stage.name||stage.code,state,
   displayState:state==='COMPLETED'?'COMPLETED':state==='IN_PROGRESS'?'IN_PROGRESS':
    unmet.length?'BLOCKED':'READY',
   requiredPredecessors:predecessors,unmetPredecessors:unmet,
   canStart:state==='NOT_STARTED'&&!unmet.length,
   canComplete:state==='IN_PROGRESS'&&!unmet.length,
  } as StageRuntimeGate;
 });
 return gates;
}

/** Every START and COMPLETE mutation must call this against server-read
 * statuses in the SAME atomic production-order transaction. Never accept
 * client-submitted completion as evidence of a real operation. */
export function applyRoutingStageAction(
 operations:StageRuntimeInput[],states:Record<string,StageRuntimeState>,
 code:string,action:StageRuntimeAction,
):{states:Record<string,StageRuntimeState>;gates:StageRuntimeGate[]}{
 if(!ACTIONS.has(action))fail('Unsupported manufacturing stage action.');
 const gates=routingStageGates(operations,states);
 const target=gates.find(x=>x.code===code);
 if(!target)fail('Stage '+code+' is not part of the selected process route.');
 if(action==='START'&&!target.canStart)
  fail(target.unmetPredecessors.length?
   'Stage '+code+' is blocked until '+target.unmetPredecessors.join(', ')+' is completed.':
   'Stage '+code+' cannot start from '+target.state+'.');
 if(action==='COMPLETE'&&!target.canComplete)
  fail(target.unmetPredecessors.length?
   'Stage '+code+' cannot complete until '+target.unmetPredecessors.join(', ')+' is completed.':
   'Stage '+code+' must be IN_PROGRESS before completion.');
 const updated={...states,[code]:action==='START'?'IN_PROGRESS':'COMPLETED'} as Record<string,StageRuntimeState>;
 return {states:updated,gates:routingStageGates(operations,updated)};
}
