/** Industry-neutral output objects. These are labels for WHAT is counted.
 * MEMS Count units (Each, Dozen etc.) still define HOW MANY per selected time.
 * The physical SKU's production dimension handles non-count output units.
 */
export type ThroughputOutputKind='PRIMARY'|'COMMERCIAL'|'LOGISTICS'|'MEASURE'|'CUSTOM';
export type ThroughputOutput={
 code:string;name:string;group:string;kind:ThroughputOutputKind;unitCode?:string;
 description:string;
};
const def=(code:string,name:string,group:string,kind:ThroughputOutputKind,
 description:string,unitCode?:string):ThroughputOutput=>({code,name,group,kind,description,...(unitCode?{unitCode}:{})});
export const THROUGHPUT_OUTPUTS:ThroughputOutput[]=[
 ...[
 ['PRIMARY_CONTAINER','Primary physical container'],['BOTTLE','Bottle'],['CAN','Can / tin'],['JAR','Jar'],
 ['VIAL','Vial'],['AMPOULE','Ampoule'],['TUBE','Tube'],['SACHET','Sachet'],['POUCH','Pouch'],
 ['BAG','Bag'],['CUP','Cup'],['POT','Pot'],['TRAY','Tray'],['DRUM','Drum'],['BARREL','Barrel'],
 ['KEG','Keg'],['IBC','Intermediate bulk container'],['TANK','Tank'],['BIN','Bin'],
 ['SYRINGE','Syringe'],['CARTRIDGE','Cartridge'],['BLISTER','Blister card'],['DOSE','Dose'],
 ['TABLET','Tablet'],['CAPSULE','Capsule'],['CONTAINER','Container'],['PIECE','Piece'],
 ['UNIT','Unit'],['PART','Part'],['COMPONENT','Component'],['ASSEMBLY','Assembly'],
 ['DEVICE','Device'],['TYRE','Tyre'],['BRICK','Brick'],['BLOCK','Block'],['SLAB','Slab'],
 ['SHEET','Sheet'],['BOARD','Board'],['BAR','Bar'],['ROD','Rod'],['BEAM','Beam'],
 ['PIPE','Pipe'],['ROLL','Roll'],['COIL','Coil'],['REEL','Reel'],['SPOOL','Spool'],
 ['BUNDLE','Bundle'],['SET','Set'],['KIT','Kit'],['MOLDING','Moulding'],['ARTICLE','Article'],
 ['BATCH','Batch'],['LOT','Lot'],['CYCLE','Cycle'],
 ] .map(([code,name])=>def(code,name,'Primary / discrete output','PRIMARY',
    'One counted production unit, equivalent to one SKU physical primary unit.')),
 ...[
 ['CASE','Case'],['CARTON','Carton'],['BOX','Box'],['PACK','Pack'],['CRATE','Crate'],
 ['DISPLAY','Display pack'],['SHRINK_PACK','Shrink-wrapped pack'],['MULTIPACK','Multipack'],
 ] .map(([code,name])=>def(code,name,'Commercial pack output','COMMERCIAL',
    'Count commercial packages; MEMS derives their contained physical units from the selected SKU.')),
 ...[
 ['PALLET','Pallet'],['LOAD','Unit load'],['SHIPPING_UNIT','Shipping unit'],
 ] .map(([code,name])=>def(code,name,'Transport / logistics output','LOGISTICS',
    'Count logistics units; MEMS derives contained primary units from the SKU transport packaging.')),
 ...[
 ['LITRE','Litre','L'],['MILLILITRE','Millilitre','mL'],['CUBIC_METRE','Cubic metre','m3'],
 ['KILOGRAM','Kilogram','kg'],['GRAM','Gram','g'],['TONNE','Tonne','t'],
 ['METRE','Metre','m'],['CENTIMETRE','Centimetre','cm'],['MILLIMETRE','Millimetre','mm'],
 ['SQUARE_METRE','Square metre','m2'],
 ] .map(([code,name,unitCode])=>def(code,name,'Continuous / measured output','MEASURE',
    'Measure flow or produced quantity; only compatible SKU production dimensions can be converted.',unitCode)),
 def('CUSTOM_OUTPUT','Other organization-defined output','Custom output','CUSTOM',
    'Use a stated and validated number of SKU primary units per rated output.'),
];
export function throughputOutput(code:unknown):ThroughputOutput|undefined{
 return typeof code==='string'?THROUGHPUT_OUTPUTS.find(x=>x.code===code):undefined;
}
export function throughputOutputGroups(){
 return [...new Set(THROUGHPUT_OUTPUTS.map(x=>x.group))];
}
