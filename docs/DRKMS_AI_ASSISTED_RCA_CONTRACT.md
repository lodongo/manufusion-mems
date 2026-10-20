# AI-Assisted RCA — implementation contract

The RCA Studio is a structured investigation engine; AI is a copilot, **not** an approver.

## Investigation evidence
Evidence can include work orders, condition data, alarms, photographs, audio transcription, OEM manuals, historical failures, work instructions, SOPs, historian trends, and interviews. Every piece needs tenant, asset, event time, source, original revision/hash, access scope, provenance, chain of custody, and investigator validation. Do not use cross-tenant data.

## AI modules (to implement)
1. Intake: group related events and make an evidence gap checklist; never overwrite source facts.
2. Chronology: extract a causal timeline with linked timestamped evidence and explicit uncertainty.
3. Hypothesis generation: propose failure mechanisms and competing alternative hypotheses (5 Whys, Ishikawa/fishbone, fault tree), each cited to evidence.
4. Falsification: identify what measurements, inspections, and tests would disprove hypotheses.
5. Causal verification: the investigator distinguishes confirmed root cause, contributing factors, symptoms, and unverified hypotheses.
6. Corrective action design: prioritize containment, corrective and preventive actions; propose work requests/work orders/engineering changes through existing transaction handlers with explicit authorization.
7. Effectiveness: capture acceptance criteria, monitoring window, measurements, owners and independent closure verification.
8. Knowledge release: produce reviewed RCA summary, one-point lessons, quick fixes, revised PM/job plans; submit each to the existing CoA/My Workflow. Only immutable approved versions become effective and staged against their equipment.

## AI safety boundaries
- AI-generated output remains a **candidate**, never an accepted cause, task, safety control, published document, or equipment instruction.
- Each hypothesis includes evidence IDs, limitations, and calibrated uncertainty; missing evidence means a request for investigation, not a manufactured citation.
- Prompts and retrieved evidence must be treated as untrusted input (prompt-injection resistance).
- Engineering and safety reviewers must be independent of the document author; findings about LOTO, live energy, chemicals and food safety need relevant specialist review.
- Reuse the existing asset hierarchy, MNT tasks/work orders, SAF risk assessment, PRC material catalogue, and unified CoA. Do not create new shadow registers or approval engines.
- Model outputs, tools, prompts, evidence and validation decisions require traceable versioned audit.
- RCA form schemas must be versioned and controlled, with mobile field types, conditional logic, images, signatures, calculated risk, and offline-safe save where implemented.

## Current delivered slice
- Evidence-linked typed AI hypothesis contract with candidate-only status.
- Tenant-scoped authenticated API for storing human-review-required RCA AI analyses.
- Separate scoped reviewer right and return/reject decisions with author/submitter SoD.
- No actual LLM/OCR model integration, investigator-acceptance endpoint, approved publication handler, or knowledge auto-staging has been delivered.
