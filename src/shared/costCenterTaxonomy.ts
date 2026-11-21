/** Shared, additive cost-center classification. Legacy category codes (especially MFG, INV and WHS) remain unchanged. */
export interface CostCenterSubcategory { code: string; label: string }
export interface CostCenterCategory { code: string; label: string; subcategories: CostCenterSubcategory[] }

// Keep each ordered subcategory's code stable; append rather than re-order entries.
const catalogue: Array<[string, string, string[]]> = [
  ["EXE", "Executive and management", ["Corporate strategy","Board and governance","Executive leadership","Regional management","Country management","Site general management","Business performance management","Risk and transformation office"]],
  ["ADM", "Administration", ["General administration","Office administration","Reception and front office","Travel and accommodation","Records and archiving","Corporate services","Secretarial services","Business continuity","Office supplies and services","Administrative shared support"]],
  ["FIN", "Finance", ["General ledger and accounting","Financial planning and analysis","Cost accounting","Treasury and cash management","Accounts payable","Accounts receivable","Taxation and compliance","Financial control and reporting","Credit management","Payroll accounting","Fixed asset accounting","Internal audit"]],
  ["HRM", "Human resources", ["HR business partnering","Recruitment and onboarding","Learning and development","Employee relations","Compensation and benefits","Payroll administration","Workforce planning","Organizational development","HR operations","Employee health and wellbeing","Performance management","Talent and succession"]],
  ["ICT", "Information technology", ["IT service desk","Infrastructure and networking","Business applications","ERP and enterprise systems","Cybersecurity","Data and analytics","Cloud and hosting","End-user computing","OT and industrial networks","Telecommunications","Software development","IT governance and architecture","Systems integration"]],
  ["MFG", "Manufacturing", ["Raw material preparation","Ingredient preparation","Water treatment for production","Simple syrup manufacturing","Final syrup and beverage blending","Batch mixing and formulation","Dissolving and homogenization","Fermentation and processing","Cooking and thermal processing","Pasteurization and sterilization","Filtration and separation","Extrusion and molding","Injection molding and preform production","Bottle blowing and forming","Filling and dispensing","Capping and sealing","Labelling and coding","Primary packaging","Secondary packaging","Case packing and wrapping","Palletizing and stretch wrapping","Assembly and fabrication","Machining and metalworking","Welding and joining","Printing and converting","Chemical processing","Pharmaceutical manufacturing","Textile and garment production","Food and beverage processing","Intermediate and work-in-progress production","Rework and repacking","Manufacturing support and line changeover","Other manufacturing operations"]],
  ["QLT", "Quality", ["Quality assurance","Quality control","Incoming material inspection","In-process inspection","Finished product inspection","Microbiology laboratory","Chemistry and analytical laboratory","Metrology and calibration","Food safety management","Quality systems and compliance","Supplier quality","Nonconformance and corrective action","Product release and certification","Sensory and consumer testing"]],
  ["MNT", "Maintenance and engineering", ["Mechanical maintenance","Electrical maintenance","Instrumentation and controls","Automation and PLC systems","Reliability engineering","Condition monitoring","Predictive maintenance","Preventive maintenance","Corrective maintenance","Maintenance planning and scheduling","Maintenance workshops","Fabrication and machine shop","Engineering design","Engineering projects support","Maintenance technical services","Maintenance stores coordination","Asset integrity and statutory inspection"]],
  ["UTL", "Utilities", ["Electricity generation and distribution","Substations and switchgear","Boilers and steam distribution","Compressed air systems","Refrigeration and chilled water","HVAC and ventilation","Raw water abstraction","Water purification and treatment","Process water supply","Wastewater treatment","Effluent and environmental systems","Gas and fuel supply","Thermal oil systems","Cooling towers and heat rejection","Solar and renewable energy","Generators and backup power","Energy management and metering","Utility network maintenance"]],
  ["INV", "Inventory", ["Raw material inventory","Ingredient inventory","Packaging material inventory","Maintenance spare parts inventory","Tools and consumables inventory","Finished goods inventory","Work-in-progress inventory","Intermediate and semi-finished inventory","Engineering stores","Chemicals and hazardous inventory","Quality quarantine inventory","Rejected and nonconforming inventory","Returns and reverse inventory","Consignment inventory","Customer-owned inventory","Supplier-managed inventory","Temperature-controlled inventory","High-value and controlled stock","Rotables and repairables inventory","Bulk and tank inventory","Scrap and obsolete inventory","Cycle counting and stocktaking","Inventory control and replenishment","Other inventory control"]],
  ["WHS", "Warehousing", ["Central warehouse","Raw materials warehouse","Packaging materials warehouse","Finished goods warehouse","Spare parts warehouse","Cold storage","Freezer storage","Hazardous material warehouse","Bonded warehouse","Bulk storage and silos","Warehouse receiving","Putaway and bin management","Picking and kitting","Cross-docking and consolidation","Warehouse dispatch","Returns and quarantine warehouse","Overflow and satellite warehouse","Automated warehouse"]],
  ["PRC", "Procurement", ["Strategic sourcing","Operational purchasing","Capital expenditure sourcing","Indirect procurement","Direct material procurement","Service procurement","Supplier qualification","Supplier performance management","Tendering and contract management","Purchase order management","Procurement governance and compliance","Import procurement and customs"]],
  ["LOG", "Logistics and distribution", ["Inbound logistics","Outbound logistics","Distribution center operations","Order fulfillment","Transportation planning","Fleet dispatch","Last-mile delivery","Freight forwarding","Import and export logistics","Customs clearance","Reverse logistics","Route optimization","Logistics control tower","Third-party logistics coordination"]],
  ["SAL", "Sales", ["Key account management","Field sales","Wholesale sales","Retail sales","Institutional sales","E-commerce sales","Channel and distributor management","Sales operations","Sales planning and forecasting","Revenue operations","Sales enablement"]],
  ["MKT", "Marketing", ["Brand management","Consumer insights","Advertising and media","Digital marketing","Trade marketing","Promotions and activation","Product marketing","Public relations","Market research","Events and sponsorship"]],
  ["CSV", "Customer service", ["Customer contact center","Customer complaints","Technical customer support","After-sales service","Warranty and returns","Customer success","Customer experience","Customer onboarding","Service operations"]],
  ["RND", "Research and development", ["Product research","Product development","Process development","New product introduction","Packaging innovation","Pilot plant and trials","Technology and innovation","Analytical development","Research laboratory","Product validation","Regulatory product development"]],
  ["HSE", "Health, safety and environment", ["Occupational safety","Occupational health","Environmental management","Fire safety and emergency response","Process safety","Industrial hygiene","Permit-to-work administration","Hazard and risk assessment","Waste management","Sustainability and ESG","Incident investigation","Safety training and culture","Environmental monitoring","Regulatory compliance"]],
  ["FAC", "Facilities", ["Buildings maintenance","Cleaning and sanitation","Site grounds and landscaping","Catering and canteen","Property management","Civil works and repairs","Access and building services","Facilities utilities","Waste collection","Pest control","Accommodation and camp services","Office facilities"]],
  ["AGR", "Agriculture and sourcing", ["Crop production","Livestock production","Aquaculture","Irrigation management","Agricultural mechanization","Harvesting operations","Post-harvest handling","Agro-input management","Farm laboratory","Agricultural extension","Commodity sourcing","Field collection and aggregation"]],
  ["PRJ", "Projects", ["Project management office","Capital project execution","Construction project management","Engineering project delivery","Project controls and scheduling","Project procurement","Commissioning and startup","Turnaround and shutdown projects","Infrastructure projects","Digital transformation projects","Project assurance and handover"]],
  ["SSC", "Shared services", ["Shared finance services","Shared HR services","Shared IT services","Shared procurement services","Shared administration","Document services","Master data management","Business process services","Enterprise reporting","Regional service center"]],
  ["LGL", "Legal and compliance", ["Legal advisory","Corporate legal","Contracts and agreements","Regulatory compliance","Litigation management","Ethics and compliance","Company secretarial","Intellectual property","Data privacy and governance"]],
  ["SEC", "Security", ["Physical security","Site access control","Control room and surveillance","Asset protection","Investigations and loss prevention","Journey and travel security","Industrial security","Emergency security response","Security systems management"]],
  ["RET", "Retail and branch operations", ["Retail store operations","Point-of-sale operations","Merchandising","Retail inventory control","Customer fulfillment","Store support and supervision","Franchise operations","Branch administration","Storefront services"]],
  ["HLT", "Healthcare and clinical services", ["Clinical care","Outpatient services","Inpatient services","Pharmacy operations","Diagnostic imaging","Clinical laboratory","Theatre and surgical services","Sterilization services","Patient administration","Medical equipment management"]],
  ["EDU", "Education and training", ["Academic administration","Teaching and instruction","Vocational training","Laboratory instruction","Student services","Library services","Examinations and assessment","Curriculum development","Learning technology","Training center operations"]],
  ["HSP", "Hospitality and accommodation", ["Hotel front office","Housekeeping","Food and beverage service","Kitchen and food production","Conference and banqueting","Guest services","Laundry and linen","Recreation and leisure","Property hospitality operations"]],
  ["CON", "Construction and infrastructure", ["Civil construction","Structural construction","Mechanical installation","Electrical installation","Piping and fabrication","Building services installation","Earthworks and excavation","Road and rail construction","Construction equipment operations","Site supervision"]],
  ["FLE", "Fleet and transport operations", ["Vehicle operations","Fleet maintenance","Transport scheduling","Heavy equipment fleet","Passenger transport","Fuel management","Tire and vehicle service","Fleet compliance and safety","Vehicle telematics"]],
  ["ENR", "Energy and natural resources", ["Power generation","Power transmission","Oil and gas operations","Mining and mineral processing","Renewable energy operations","Exploration and surveying","Drilling and extraction","Energy storage","Resource processing"]],
  ["WST", "Waste, recycling and circularity", ["Solid waste operations","Recycling and material recovery","Industrial effluent services","Hazardous waste handling","Resource recovery","Waste logistics","Environmental remediation","Circular packaging recovery"]],
];

export const COST_CENTER_CATEGORIES: CostCenterCategory[] = catalogue.map(([code, label, names]) => ({
    code, label,
    subcategories: [...names.map((name, index) => ({ code: `${code}-${String(index + 1).padStart(3, '0')}`, label: name })),
        { code: `${code}-OTHER`, label: 'Other / general ' + label.toLowerCase() }],
}));

export function costCenterSubcategories(categoryCode: string): CostCenterSubcategory[] {
    return COST_CENTER_CATEGORIES.find((category) => category.code === categoryCode)?.subcategories
        ?? [{ code: 'GENERAL', label: 'General / other' }];
}

export function costCenterCategoryLabel(code: string): string {
    return COST_CENTER_CATEGORIES.find((category) => category.code === code)?.label ?? code;
}

export function costCenterSubcategoryLabel(categoryCode: string, code: string): string {
    return costCenterSubcategories(categoryCode).find((subcategory) => subcategory.code === code)?.label ?? code;
}

/**
 * Read the canonical multi-selection, including cost centers saved before it existed.
 * The singular costSubcategory field is retained as a legacy primary alias.
 */
export function selectedCostCenterSubcategories(
    attributes: { costSubcategories?: unknown; costSubcategory?: unknown } | null | undefined,
): string[] {
    const multi = Array.isArray(attributes?.costSubcategories)
        ? attributes.costSubcategories
        : typeof attributes?.costSubcategory === 'string' && attributes.costSubcategory
            ? [attributes.costSubcategory] : [];
    return [...new Set(multi.filter((code): code is string =>
        typeof code === 'string' && code.trim().length > 0))];
}

export function costCenterSubcategoriesLabel(
    categoryCode: string,
    attributes: { costSubcategories?: unknown; costSubcategory?: unknown } | null | undefined,
): string {
    const selected = selectedCostCenterSubcategories(attributes);
    return selected.length
        ? selected.map((code) => costCenterSubcategoryLabel(categoryCode, code)).join(' · ')
        : 'Not yet classified (legacy record)';
}
