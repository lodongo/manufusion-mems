# Equipment Knowledge: PLC / IIoT / Utilities — controlled architecture

## Scope
The canonical equipment/asset record is the anchor for all knowledge. Existing DRKMS immutable revisions govern OEM manuals, electrical schematics, P&IDs, PLC backups, ladder logic, function blocks, structured text, HMI/SCADA files, industrial networks, I/O and tag lists, controller firmware configuration, utility supply schematics and connected IoT/historian mappings.

The engineering catalog now includes dedicated controlled document codes. An industrial knowledge linkage records asset, type, vendor technology, optional IEC language, version, document ID and effective revision. An independent engineer reviews the link. A technician sees only approved links to effective immutable sources, subject to organizational document access.

## Planned live integrations (not implemented)
* Read-only edge gateway: OPC UA, MQTT, historian connectors, REST/vendor interfaces; no direct user browser-to-PLC connection. Consider Modbus TCP, EtherNet/IP, PROFINET, PROFIBUS and vendor interfaces only through separately reviewed gateways.
* Tag registry: equipment and assembly, process/utility, units, engineering range, historian identifier, timestamp/timezone, quality flag, sampling interval, source gateway, data retention and freshness.
* Utilities: map each equipment feed to the AST utility catalog (electrical AC/DC, water, compressed air, steam, chilled water, nitrogen, CO2, vacuum, hydraulic and others), meter, upstream source, isolation point, nominal operating envelope, hazardous energy and LOTO reference.
* PLC changes: immutable hash/source backup, controller family/CPU, firmware, project/software version, program language, network topology, I/O revision, tested online/offline version and change-control approval.
* Retrieval: hybrid text/vector search of approved technical documents + point-in-time event windows for alarms and utility trends + past WO/WR/RCA data. AI replies cite precise page/section, program/function-block reference, trend series and timestamps.
* Continuous learning: human-validated troubleshooting outcomes can propose controlled RCA, PM and WI revisions subject to existing CoA and safety approvals.

## Non-negotiable operational security
1. AI may **read** specifically authorized evidence; it may never connect to program/write/download logic, force I/O, change interlocks, bypass LOTO, issue setpoints, actuate equipment or invoke remote commands.
2. OT credentials stay out of prompt/model contexts and client devices. Use segregated gateways, scoped access, audit logging, rate limits and cyber approvals.
3. AI must distinguish offline PLC backups from the actual running controller revision. Unverified correspondence must be flagged.
4. AI is advisory, with verified engineering source citations and uncertainty; troubleshooting safety gates remain mandatory.
5. Original DRKMS release remains the delivery critical path: finish source malware scanning, secure text extraction, OCR, immutable index and approval-to-publication E2E verification before operational AI diagnosis.

## Current implementation boundary
Typed multi-vendor industrial metadata, effective-revision linking, independent review, read-only list and equipment panel are committed; **no live PLC/IoT communication, executable PLC code analysis, utility telemetry ingestion or AI model search exists yet**.
