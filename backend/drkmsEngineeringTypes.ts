/** Globally codified engineering knowledge subtypes. Each is a governed document class, not a new asset record. */
export type EngineeringDocType = {code:string;label:string;parentClass:string;source:'local'|'oem'|'either';reviewRequired:true};
export const ENGINEERING_DOC_TYPES: EngineeringDocType[] = [
  {code:'SDS',label:'Safety Data Sheet / MSDS',parentClass:'EXT',source:'either',reviewRequired:true},
  {code:'DYN-FRM',label:'Controlled dynamic digital form',parentClass:'FRM',source:'local',reviewRequired:true},
  {code:'OCR-SRC',label:'OCR transcription source record',parentClass:'REC',source:'either',reviewRequired:true},
  {
    "code": "WI-OPS",
    "label": "Operating work instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "WI-MNT",
    "label": "Maintenance work instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "WI-SAF",
    "label": "Safe work instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "WI-CLT",
    "label": "Cleaning lubrication inspection tightening routine",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "QFX",
    "label": "Quick fix and troubleshooting routine",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "JOB",
    "label": "Standard job plan",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "SET",
    "label": "Setup and changeover instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "RCA",
    "label": "Root cause analysis",
    "parentClass": "RPT",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "FRP",
    "label": "Failure investigation report",
    "parentClass": "RPT",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "BDR",
    "label": "Breakdown report",
    "parentClass": "RPT",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "OEM-SRV",
    "label": "OEM service visit report",
    "parentClass": "RPT",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-INS",
    "label": "OEM inspection report",
    "parentClass": "RPT",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-COM",
    "label": "OEM commissioning report",
    "parentClass": "RPT",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-BUL",
    "label": "OEM technical bulletin",
    "parentClass": "EXT",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-OPM",
    "label": "OEM operating manual",
    "parentClass": "MAN",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-MNT",
    "label": "OEM maintenance manual",
    "parentClass": "MAN",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-SPR",
    "label": "OEM spare parts manual",
    "parentClass": "MAN",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-CAL",
    "label": "OEM calibration manual",
    "parentClass": "MAN",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-SFT",
    "label": "OEM software documentation",
    "parentClass": "MAN",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "OEM-WAR",
    "label": "OEM warranty and compliance certificate",
    "parentClass": "REC",
    "source": "oem",
    "reviewRequired": true
  },
  {
    "code": "ENG-ELE",
    "label": "Electrical schematic",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-SLD",
    "label": "Single line diagram",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-PID",
    "label": "Piping and instrumentation diagram",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-MEC",
    "label": "Mechanical drawing",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-PNE",
    "label": "Pneumatic drawing",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-HYD",
    "label": "Hydraulic drawing",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-PLC",
    "label": "PLC program documentation",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-NET",
    "label": "Automation network topology",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-BOM",
    "label": "Equipment bill of materials",
    "parentClass": "REG",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-LUB",
    "label": "Lubrication chart",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-MOD",
    "label": "Engineering change and as-built",
    "parentClass": "REC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "ENG-DSH",
    "label": "Equipment technical data sheet",
    "parentClass": "SPC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "MNT-PM",
    "label": "Preventive maintenance standard",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "MNT-CBM",
    "label": "Condition monitoring instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "MNT-INS",
    "label": "Inspection checklist",
    "parentClass": "CHK",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "MNT-CAL",
    "label": "Calibration record",
    "parentClass": "REC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "MNT-HIS",
    "label": "Maintenance history",
    "parentClass": "REC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "SAF-LOTO",
    "label": "Lockout tagout instruction",
    "parentClass": "WIN",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "SAF-RISK",
    "label": "Activity risk assessment",
    "parentClass": "REC",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "SAF-PMT",
    "label": "Permit and isolation checklist",
    "parentClass": "CHK",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "QLT-STD",
    "label": "Quality critical parameter standard",
    "parentClass": "STD",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "TNG-OJT",
    "label": "Technical training and one point lesson",
    "parentClass": "GDL",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "TNG-ONE",
    "label": "One point lesson",
    "parentClass": "GDL",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "PRC-SVC",
    "label": "Contractor or service completion report",
    "parentClass": "RPT",
    "source": "either",
    "reviewRequired": true
  },
  {
    "code": "AST-LCM",
    "label": "Equipment lifecycle and obsolescence dossier",
    "parentClass": "REG",
    "source": "either",
    "reviewRequired": true
  }
];
export const ENGINEERING_DOC_TYPE_CODES = new Set(ENGINEERING_DOC_TYPES.map(t=>t.code));
