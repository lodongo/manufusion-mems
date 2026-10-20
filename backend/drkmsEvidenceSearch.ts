/** Deterministic, bounded evidence search. No inferred facts and no LLM invocation. */
export type EvidenceHit={
 sourceType:'work_order'|'work_request'|'controlled_document';
 sourceId:string;title:string;excerpt:string;reference:string;
 revisionId?:string;score:number;
};
export function rankEvidence(query:string,entries:Omit<EvidenceHit,'score'>[],limit=30):EvidenceHit[]{
 const tokens=[...new Set(query.toLocaleLowerCase().match(/[a-z0-9]{2,}/g)??[])].slice(0,16);
 if(!tokens.length)return [];
 return entries.map(item=>{
  const title=item.title.toLocaleLowerCase(),body=item.excerpt.toLocaleLowerCase();
  const score=tokens.reduce((n,t)=>n+(title.includes(t)?4:0)+(body.includes(t)?1:0),0);
  return {...item,score};
 }).filter(item=>item.score>0)
   .sort((a,b)=>b.score-a.score||a.reference.localeCompare(b.reference))
   .slice(0,Math.max(1,Math.min(limit,50)));
}
