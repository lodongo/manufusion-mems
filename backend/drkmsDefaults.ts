/** Versioned MEMS global document metadata. Values are seed defaults, not tenant content. */
import type { MetaListDefault } from './defaults';

export const DOCUMENT_METADATA_LISTS: MetaListDefault[] = [
  {
    "key": "documentClasses",
    "title": "Document classifications",
    "appliesTo": "documents",
    "items": [
      {
        "code": "EXT",
        "label": "External authority",
        "description": "Law, regulation, external standard and contractual requirements",
        "categoryCode": "L0",
        "active": true
      },
      {
        "code": "GOV",
        "label": "Governance instrument",
        "description": "Charters, delegation and governance frameworks",
        "categoryCode": "L1",
        "active": true
      },
      {
        "code": "POL",
        "label": "Policy",
        "description": "Binding organizational principles and commitments",
        "categoryCode": "L1",
        "active": true
      },
      {
        "code": "STR",
        "label": "Strategy",
        "description": "Long-term priorities and direction",
        "categoryCode": "L1",
        "active": true
      },
      {
        "code": "OBJ",
        "label": "Objective and target",
        "description": "Measurable outcomes and commitments",
        "categoryCode": "L1",
        "active": true
      },
      {
        "code": "FRW",
        "label": "Management framework",
        "description": "Operating system and governance structure",
        "categoryCode": "L2",
        "active": true
      },
      {
        "code": "MAN",
        "label": "Management manual",
        "description": "Consolidated management system description",
        "categoryCode": "L2",
        "active": true
      },
      {
        "code": "PRG",
        "label": "Management program",
        "description": "Integrated sustained management arrangements",
        "categoryCode": "L2",
        "active": true
      },
      {
        "code": "PLN",
        "label": "Management plan",
        "description": "Time-bound resources, tasks and milestones",
        "categoryCode": "L2",
        "active": true
      },
      {
        "code": "PRO",
        "label": "Process",
        "description": "Inputs, outputs, interfaces and responsibilities",
        "categoryCode": "L3",
        "active": true
      },
      {
        "code": "PRC",
        "label": "Procedure",
        "description": "Mandatory flow, controls and decision responsibilities",
        "categoryCode": "L3",
        "active": true
      },
      {
        "code": "STD",
        "label": "Internal standard",
        "description": "Mandatory technical or operational requirements",
        "categoryCode": "L3",
        "active": true
      },
      {
        "code": "SOP",
        "label": "Standard operating procedure",
        "description": "Repeatable method for an operational activity",
        "categoryCode": "L4",
        "active": true
      },
      {
        "code": "WIN",
        "label": "Work instruction",
        "description": "Detailed step-by-step task execution",
        "categoryCode": "L4",
        "active": true
      },
      {
        "code": "SPC",
        "label": "Specification",
        "description": "Quantitative acceptance and design requirements",
        "categoryCode": "L4",
        "active": true
      },
      {
        "code": "GDL",
        "label": "Guideline",
        "description": "Recommended non-mandatory practices",
        "categoryCode": "L4",
        "active": true
      },
      {
        "code": "CHK",
        "label": "Checklist",
        "description": "Structured verification steps",
        "categoryCode": "L4",
        "active": true
      },
      {
        "code": "FRM",
        "label": "Form",
        "description": "Approved blank data-capture instrument",
        "categoryCode": "L5",
        "active": true
      },
      {
        "code": "TMP",
        "label": "Template",
        "description": "Controlled document creation structure",
        "categoryCode": "L5",
        "active": true
      },
      {
        "code": "REG",
        "label": "Register",
        "description": "Maintained list of structured entries",
        "categoryCode": "L5",
        "active": true
      },
      {
        "code": "REC",
        "label": "Record",
        "description": "Retained evidence of activity or result",
        "categoryCode": "L5",
        "active": true
      },
      {
        "code": "RPT",
        "label": "Report",
        "description": "Structured reporting of evidence, analysis or outcomes",
        "categoryCode": "L5",
        "active": true
      }
    ]
  },
  {
    "key": "technicalDocumentTypes",
    "title": "Technical document types",
    "appliesTo": "documents",
    "items": [
      {
        "code": "OPM",
        "label": "Operator manual",
        "description": "Parent class: MAN",
        "categoryCode": "MAN",
        "active": true
      },
      {
        "code": "TCM",
        "label": "Technical manual",
        "description": "Parent class: MAN",
        "categoryCode": "MAN",
        "active": true
      },
      {
        "code": "SVM",
        "label": "Service manual",
        "description": "Parent class: MAN",
        "categoryCode": "MAN",
        "active": true
      },
      {
        "code": "ELM",
        "label": "Electrical manual",
        "description": "Parent class: MAN",
        "categoryCode": "MAN",
        "active": true
      },
      {
        "code": "ELD",
        "label": "Electrical drawing",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "SLD",
        "label": "Single-line diagram",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "MCD",
        "label": "Mechanical drawing",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "PID",
        "label": "Piping and instrumentation drawing",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "PND",
        "label": "Pneumatic diagram",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "HYD",
        "label": "Hydraulic diagram",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "SPT",
        "label": "Spare parts catalogue",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "BOM",
        "label": "Bill of materials",
        "description": "Parent class: REG",
        "categoryCode": "REG",
        "active": true
      },
      {
        "code": "DSH",
        "label": "Technical datasheet",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "LUB",
        "label": "Lubrication chart",
        "description": "Parent class: WIN",
        "categoryCode": "WIN",
        "active": true
      },
      {
        "code": "PLC",
        "label": "PLC/automation documentation",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "NET",
        "label": "Industrial network diagram",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "CAL",
        "label": "Calibration document",
        "description": "Parent class: REC",
        "categoryCode": "REC",
        "active": true
      },
      {
        "code": "DRW",
        "label": "General engineering drawing",
        "description": "Parent class: SPC",
        "categoryCode": "SPC",
        "active": true
      },
      {
        "code": "MOD",
        "label": "Modification and as-built record",
        "description": "Parent class: REC",
        "categoryCode": "REC",
        "active": true
      },
      {
        "code": "OEM",
        "label": "OEM technical bulletin",
        "description": "Parent class: EXT",
        "categoryCode": "EXT",
        "active": true
      },
      {
        "code": "RAS",
        "label": "Risk assessment",
        "description": "Parent class: REC",
        "categoryCode": "REC",
        "active": true
      },
      {
        "code": "TNG",
        "label": "Training materials",
        "description": "Parent class: TMP",
        "categoryCode": "TMP",
        "active": true
      }
    ]
  },
  {
    "key": "documentRelationships",
    "title": "Document relationship types",
    "appliesTo": "documents",
    "items": [
      {
        "code": "REL-001",
        "label": "applies to asset",
        "description": "applies_to_asset",
        "active": true
      },
      {
        "code": "REL-002",
        "label": "applies to equipment model",
        "description": "applies_to_equipment_model",
        "active": true
      },
      {
        "code": "REL-003",
        "label": "applies to assembly",
        "description": "applies_to_assembly",
        "active": true
      },
      {
        "code": "REL-004",
        "label": "applies to subassembly",
        "description": "applies_to_subassembly",
        "active": true
      },
      {
        "code": "REL-005",
        "label": "applies to component",
        "description": "applies_to_component",
        "active": true
      },
      {
        "code": "REL-006",
        "label": "defines task",
        "description": "defines_task",
        "active": true
      },
      {
        "code": "REL-007",
        "label": "specifies material",
        "description": "specifies_material",
        "active": true
      },
      {
        "code": "REL-008",
        "label": "references drawing",
        "description": "references_drawing",
        "active": true
      },
      {
        "code": "REL-009",
        "label": "supersedes",
        "description": "supersedes",
        "active": true
      },
      {
        "code": "REL-010",
        "label": "supports risk assessment",
        "description": "supports_risk_assessment",
        "active": true
      },
      {
        "code": "REL-011",
        "label": "supports work order task",
        "description": "supports_work_order_task",
        "active": true
      },
      {
        "code": "REL-012",
        "label": "defines acceptance criteria",
        "description": "defines_acceptance_criteria",
        "active": true
      },
      {
        "code": "REL-013",
        "label": "supports competency",
        "description": "supports_competency",
        "active": true
      },
      {
        "code": "REL-014",
        "label": "implements obligation",
        "description": "implements_obligation",
        "active": true
      },
      {
        "code": "REL-015",
        "label": "modified by engineering change",
        "description": "modified_by_engineering_change",
        "active": true
      },
      {
        "code": "REL-016",
        "label": "produces record",
        "description": "produces_record",
        "active": true
      }
    ]
  },
  {
    "key": "documentMaturity",
    "title": "Document digital maturity levels",
    "appliesTo": "documents",
    "items": [
      {
        "code": "D0",
        "label": "Preserved original",
        "active": true
      },
      {
        "code": "D1",
        "label": "Searchable extracted",
        "active": true
      },
      {
        "code": "D2",
        "label": "Verified structured digital",
        "active": true
      },
      {
        "code": "D3",
        "label": "Approved executable",
        "active": true
      }
    ]
  },
  {
    "key": "documentLifecycle",
    "title": "Document lifecycle statuses",
    "appliesTo": "documents",
    "items": [
      {
        "code": "DRAFT",
        "label": "draft",
        "active": true
      },
      {
        "code": "IN_REVIEW",
        "label": "in review",
        "active": true
      },
      {
        "code": "APPROVED",
        "label": "approved",
        "active": true
      },
      {
        "code": "SCHEDULED",
        "label": "scheduled",
        "active": true
      },
      {
        "code": "EFFECTIVE",
        "label": "effective",
        "active": true
      },
      {
        "code": "SUPERSEDED",
        "label": "superseded",
        "active": true
      },
      {
        "code": "ARCHIVED",
        "label": "archived",
        "active": true
      },
      {
        "code": "DISPOSED",
        "label": "disposed",
        "active": true
      }
    ]
  }
];
