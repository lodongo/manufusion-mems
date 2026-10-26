export type RankedEducation={
 id:string;levelCode?:string;completionYear?:string;qualification?:string;
};
export type EducationLevelRank={code:string;rank:number};
export function rankEducation<T extends RankedEducation>(records:readonly T[],levels:readonly EducationLevelRank[]):Array<{record:T;originalIndex:number;rank:number}>{
 const ranks=new Map(levels.map(l=>[l.code,l.rank]));
 return records.map((record,originalIndex)=>({
  record,originalIndex,rank:ranks.get(record.levelCode||'')||0,
 })).sort((a,b)=>b.rank-a.rank||
  Number(b.record.completionYear||0)-Number(a.record.completionYear||0)||
  a.originalIndex-b.originalIndex);
}
