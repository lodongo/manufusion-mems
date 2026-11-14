// ISO 8573-1:2010 limits. Descriptions are display-only; retain stable class codes.
const custom='Custom specification, stricter than class 1';
const particles:Record<string,string>={
 '0':custom,'1':'≤20,000 / 400 / 10 particles per m³','2':'≤400,000 / 6,000 / 100 particles per m³',
 '3':'≤90,000 (0.5–1 µm) / 1,000 (1–5 µm) per m³','4':'≤10,000 particles (1–5 µm) per m³',
 '5':'≤100,000 particles (1–5 µm) per m³','6':'Particle mass ≤5 mg/m³','7':'Particle mass >5 to 10 mg/m³','X':'Particle mass >10 mg/m³'
};
const water:Record<string,string>={
 '0':custom,'1':'Pressure dew point ≤−70 °C','2':'Pressure dew point ≤−40 °C','3':'Pressure dew point ≤−20 °C',
 '4':'Pressure dew point ≤+3 °C','5':'Pressure dew point ≤+7 °C','6':'Pressure dew point ≤+10 °C',
 '7':'Liquid water ≤0.5 g/m³','8':'Liquid water >0.5 to 5 g/m³','9':'Liquid water >5 to 10 g/m³','X':'Liquid water >10 g/m³'
};
const oil:Record<string,string>={
 '0':custom,'1':'Total oil ≤0.01 mg/m³','2':'Total oil ≤0.1 mg/m³','3':'Total oil ≤1 mg/m³','4':'Total oil ≤5 mg/m³','X':'Total oil >5 mg/m³'
};
export function utilityOptionLabel(label:string,code:string):string{
 const name=label.toLowerCase();
 if(!name.includes('iso 8573'))return code;
 const map=name.includes('particle')?particles:name.includes('water')?water:name.includes('oil')?oil:undefined;
 const value=map?.[code];
 if(!value)return code;
 const band=map===particles&&(code==='1'||code==='2')?' (0.1–0.5 / 0.5–1 / 1–5 µm)':'';
 return 'Class '+code+' — '+value+band;
}
