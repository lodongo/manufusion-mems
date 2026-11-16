# Asset master and maintenance tools catalogue — reconciliation preflight

**Baseline:** user-supplied MEMS Universal Asset Master Dictionary v2.3.0 (28 October 2026).
SHA-256: `fe62cbdc5ab22d42978de765fc57e01a3ce1232a883749bace476b531247ac9b`.
The baseline has 1,821 asset classes, 18 groups, 117 categories, 344 subcategories, 854 attribute definitions and 247 attribute profiles.
Candidate source: maintenance catalogue seed at commit `548830a6bbd28e10d909ab5fabc31abb2efe299a`, 2,796 distinct entries.

## First-pass results

| Screening result | Entries |
|---|---:|
| Same normalized name or recorded synonym | 234 |
| Possible variant of existing slash/parenthetical class | 86 |
| Other related lexical class candidate | 367 |
| No clear lexical candidate | 2,109 |
| Total | 2,796 |

The accompanying CSV includes every incoming entry, its original catalogue identifier and technical attribute labels, and up to three candidate canonical class codes. This is a **lexical preflight**, not an approved semantic crosswalk. No candidate is automatically merged. No-clear-name-match is not evidence of a new class. Scores are heuristic similarities, not probabilities.

## Engineering review of selected cases (source descriptions from v2.3.0)

| Incoming | Existing code | Proposed treatment |
|---|---|---|
| Click / dial torque wrench | TW-PWT-SPL-002 | Existing description explicitly covers click/dial calibrated wrenches. Use variant when calibrated; check manual vs powered attributes. |
| Hydraulic torque wrench | TW-PWT-SPL-001 | Existing hydraulic wrench set. Represent configured kit/individual distinction if required. |
| Digital multimeter / clamp meter | TW-TST-ELT-004 | Existing handheld meter set. Confirm individual-vs-set representation before linking. |
| Engine lathe | PM-MTL-MCH-002 | Conventional manually operated centre lathe. Retain original production-machinery classification. |
| CNC turning center | PM-MTL-MCH-001 | Existing CNC lathe / turning centre. |
| Portable magnetic drill | TW-PWT-DRL-004 | Existing magnetic base drill; confirm portable rating as specification. |
| Combine harvester | AG-FLD-TRC-003 | Existing agricultural asset, not a second workshop asset. |
| Compact tractor | AG-FLD-TRC-001 | Potential agricultural tractor subtype; confirm size/power/drive requirements. |
| Manual chain hoist | MH-LFT-HST-003 | Existing manual chain block / lever hoist; verify subtype. |
| Two-post / four-post vehicle lift | TW-WSE-AUT-001 | Existing description includes two-post, four-post, scissor lift. |
| Hand peeler | PM-FOD-RCP-002 | Do not merge: existing class is an industrial abrasive/steam/knife peeling machine. |
| Hand tube bender | PM-MTL-FRM-006 | Do not merge: existing description is CNC or hydraulic bending machinery. |
| Twist drill bit | None approved | Determine durable reusable tool vs consumable material; link materials as appropriate. |
| Open-ended spanner | None approved | Candidate missing reusable hand tool; define class under TW with sizes as attributes. |

## Architecture and release controls

- Retain the existing 18-group asset taxonomy and its live codes, including TW — Tools, Workshop & Test Equipment (61 current classes). Treat the maintenance catalogue as a reference/browse branch across existing principal functions. Do not reclassify agricultural, laboratory, process, electrical, lifting, or transport equipment under TW just because it is used for a maintenance job.
- Approve canonical links, differentiated variants, new classes, consumables/material links and exclusions individually. Add missing TW hand-tool and trade-specific subcategories only where needed, using the existing mnemonic and sequential code rules.
- Reuse attribute codes, data types, units, option lists and profiles. Assessment should capture task-relevant technical specifications and quantity/availability, not serial-number or acquisition/finance instance fields. Preserve historical assessment code and attribute data through a versioned legacy crosswalk.
- Retain all GL candidates, depreciation guidance, accounting policy separation and integration-release controls. New class proposals require the existing governance process; no automatic GL routing or capitalization.
- Do not replace the live v2.3.0 master or delete the current MNT catalogue during this review. Adopt and cut over assessment to canonical asset references only when the validated crosswalk and additions are published. All original references and adoption settings must survive the migration.

A read-only preview in MEMS Admin → Procurement → Asset Catalog can compare the currently active database version with the published maintenance catalogue and export the rows. It is not a publisher or merge action. The CSV committed with this note records the specific supplied file, not a claim about the live database version.
