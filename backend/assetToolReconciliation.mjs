// Read-only lexical reconciliation; never auto-merge or create an asset class from a score.
function normalizeName(s) {
 return String(s||'').toLowerCase().replace(/centre/g,'center').replace(/analyser/g,'analyzer').replace(/metre/g,'meter').replace(/mould/g,'mold').replace(/fibre/g,'fiber').replace(/tyre/g,'tire').replace(/vice/g,'vise').replace(/labeller/g,'labeler').replace(/colour/g,'color').replace(/aluminium/g,'aluminum').replace(/[–—]/g,'-').match(/[a-z0-9]+/g)?.join(' ')||'';
}
export function compareAssetTools(assets,toolsList) {
 const norm=normalizeName;
 const token=(s)=>norm(s).split(' ').filter(x=>x&&!['and','or','of','the','for','set','equipment','machine','system','unit','tool','kit'].includes(x)).map(x=>x.length>4&&x.endsWith('s')&&!x.endsWith('ss')?x.slice(0,-1):x);
 const index=new Map(),variants=new Map(),docs=[];
 const add=(map,k,c)=>{if(!k)return;if(!map.has(k))map.set(k,new Map());map.get(k).set(c.code,c);};
 for(const a of assets){
  const names=[a.name,...(a.synonyms||[])];
  for(const name of names){add(index,norm(name),a);const cleaned=name.replace(/\([^)]*\)/g,' ').trim();if(cleaned!==name)add(variants,norm(cleaned),a);
   for(const part of cleaned.split(/\s*\/\s*|\s+&\s+/)){if(part!==cleaned&&token(part).length>0)add(variants,norm(part),a);}
  }
  docs.push({a,names:names.map(n=>({norm:norm(n),tokens:[...new Set(token(n))]}))});
 }
 const df=new Map();for(const doc of docs){const t=new Set(doc.names.flatMap(n=>n.tokens));for(const x of t)df.set(x,(df.get(x)||0)+1);}
 const wt=x=>Math.log(1+(docs.length+1)/((df.get(x)||0)+1));
 const sum=ts=>ts.reduce((v,x)=>v+wt(x),0);
 const bigrams=s=>{const q=' '+s+' ',m=new Set();for(let i=0;i<q.length-1;i++)m.add(q.slice(i,i+2));return m};
 const dice=(a,b)=>{const x=bigrams(a),y=bigrams(b);let n=0;for(const z of x)if(y.has(z))n++;return 2*n/(x.size+y.size||1)};
 return toolsList.map(t=>{
  const n=norm(t.name),ts=[...new Set(token(t.name))],exact=[...(index.get(n)?.values()||[])],alias=[...(variants.get(n)?.values()||[])].filter(x=>!exact.some(y=>y.code===x.code));
  let status='NO_CLEAR_MATCH',matches=[];
  if(exact.length){status=exact.length===1?'EXACT_NAME_OR_SYNONYM':'MULTIPLE_EXACT_CANDIDATES';matches=exact.map(a=>({code:a.code,name:a.name,score:1}));}
  else if(alias.length){status='EXISTING_CLASS_VARIANT_REVIEW';matches=alias.map(a=>({code:a.code,name:a.name,score:.95}));}
  else if(ts.length){
   const ranked=[];
   for(const {a,names} of docs){
    let best=0;
    for(const v of names){
     if(!v.tokens.length)continue;
     const shared=ts.filter(x=>v.tokens.includes(x));const inter=sum(shared),union=sum([...new Set([...ts,...v.tokens])]);
     const j=inter/(union||1),cover=inter/(Math.min(sum(ts),sum(v.tokens))||1);
     if(shared.length>=2||shared.length===1&&(ts.length===1||v.tokens.length===1)&&df.get(shared[0])<40){
      const d=dice(n,v.norm);best=Math.max(best,.5*j+.25*cover+.25*d);
     }else if(v.norm.length>8&&n.length>8){const d=dice(n,v.norm);if(d>.9)best=Math.max(best,.7*d);}
    }
    if(best>=.58)ranked.push({code:a.code,name:a.name,score:Math.round(best*1000)/1000});
   }
   ranked.sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code));matches=ranked.slice(0,3);
   if(matches.length)status='RELATED_CLASS_REVIEW';
  }
  return {...t,status,matches};
 });
}
