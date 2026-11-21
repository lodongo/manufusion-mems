/**
 * Display-only UoM formatting for manufacturing BOM forms.
 *
 * The saved BOM and SKU records must continue carrying the authoritative unit code.
 * UI text and selection labels resolve that code against the same unit registry
 * used by the SKU/Product Configuration screens.
 */
export type BomDisplayUnit={code:string;label:string;symbol:string};

export function bomUomName(value:string, units:readonly BomDisplayUnit[]):string{
    if(!value)return 'Select a material';
    const key=value.trim();
    const unit=units.find(u=>u.code===key)||
        units.find(u=>u.symbol===key)||
        units.find(u=>u.symbol.toLowerCase()===key.toLowerCase())||
        units.find(u=>u.label.toLowerCase()===key.toLowerCase());
    if(!unit)return 'Unit not found in UoM master data';
    return unit.label+(unit.symbol?' ('+unit.symbol+')':'');
}
