export type HrStructureNode = {
 id:string; name:string; code:string; level:string; parentId:string; status:string;
};
export const structureLevelOrder:Record<string,number>={
 root:0,group:1,corporate:1,legal_entity:2,business_unit:3,division:4,
 site:5,department:6,cost_center:7,work_center:8,equipment:9,
 asset:10,assembly:11,subassembly:12,
};
export const levelLabel=(level:string):string=>
 level==='work_center'?'Work centre':
 level==='cost_center'?'Cost centre':
 level==='legal_entity'?'Legal entity':
 (level||'Organization unit').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const compareNodes=(a:HrStructureNode,b:HrStructureNode)=>
 (structureLevelOrder[a.level]??99)-(structureLevelOrder[b.level]??99)||
 a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||
 a.code.localeCompare(b.code);
export function structureIndex(nodes:HrStructureNode[]){
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const children=new Map<string,HrStructureNode[]>();
 for(const n of nodes){
  const list=children.get(n.parentId)||[];
  list.push(n);
  children.set(n.parentId,list);
 }
 for(const list of children.values())list.sort(compareNodes);
 const sorted=nodes.slice().sort(compareNodes);
 const roots=sorted.filter(n=>!n.parentId||!byId.has(n.parentId)||n.parentId===n.id);
 const covered=new Set<string>();
 const visit=(id:string)=>{
  if(covered.has(id))return;
  covered.add(id);
  for(const child of children.get(id)||[])visit(child.id);
 };
 roots.forEach(n=>visit(n.id));
 // Bad parent links or cycles must not hide authorized records.
 for(const n of sorted)if(!covered.has(n.id)){roots.push(n);visit(n.id);}
 return {byId,children,roots};
}
export type StructureIndex=ReturnType<typeof structureIndex>;
export function structurePath(nodeId:string,index:StructureIndex):string[]{
 const path:string[]=[];
 const seen=new Set<string>();
 let current=nodeId;
 while(current&&index.byId.has(current)&&!seen.has(current)){
  seen.add(current);path.unshift(current);
  current=index.byId.get(current)?.parentId||'';
 }
 return path;
}
export function subtreeCount(nodeId:string,index:StructureIndex):number{
 const visited=new Set<string>([nodeId]);
 const visit=(id:string)=>{
  for(const child of index.children.get(id)||[]){
   if(visited.has(child.id))continue;
   visited.add(child.id);visit(child.id);
  }
 };
 visit(nodeId);
 return visited.size-1;
}
