import {categoryColor} from './safActivityClasses';
// One display palette for all energy metadata, not a claim about standardized physical lock colors.
const valid=(v:unknown):v is string=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const internal:Record<string,string>={'01':'Electrical','02':'Mechanical','03':'Lifting','04':'Pressure','05':'Pressure','06':'Pressure','07':'Chemicals','08':'Thermal','09':'Physical agents','10':'Specialist operations'};
const utility:Record<string,string>={'01':'Electrical','02':'Electrical','03':'Pressure','04':'Pressure','05':'Thermal','06':'Thermal','07':'Thermal','08':'Pressure','09':'Pressure','10':'Pressure','11':'Fire and explosion','12':'Fire and explosion','13':'Fire and explosion','14':'Thermal','15':'Thermal','16':'Thermal','17':'Chemicals','18':'Chemicals','19':'Chemicals','20':'Pressure','21':'Pressure','22':'Process safety','23':'Environment','24':'Pressure','25':'Specialist operations','26':'Specialist operations','27':'Thermal','28':'Electrical','29':'Mechanical','30':'Physical agents','31':'Specialist operations','32':'Chemicals','33':'Pressure'};
export function energyColor(source:Record<string,unknown>,overrides:Record<string,unknown>={}):string{
 const code=String(source.code||''),category=String(source.category||'');
 const group=code.startsWith('UTL-')?utility[code.split('-')[1]]:internal[code.split('_')[2]];
 if(valid(source.color))return source.color.toUpperCase();
 if(Object.prototype.hasOwnProperty.call(overrides,category)&&valid(overrides[category]))return String(overrides[category]).toUpperCase();
 return categoryColor(group||category,overrides);
}
