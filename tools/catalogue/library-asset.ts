/** The few asset facts the MEMS asset dictionary does not hold yet. */
import { dec, text, pick } from './library';

export const ULTIMATE_VACUUM = dec('ULTIMATE_VACUUM_MBAR', 'Ultimate vacuum', 'mbar(a)', 'RATING', 'Lowest absolute pressure the pump reaches, from its nameplate or datasheet (e.g. 0.5 mbar for an oil-sealed vane pump, 33 mbar for a liquid-ring pump).', '0.5', 0);
export const ACTUATOR_OUTPUT = text('ACTUATOR_TORQUE_THRUST', 'Actuator torque / thrust', 'RATING', 'Output torque (N·m) for quarter-turn or thrust (kN) for linear actuators, with the supply (air pressure or voltage) — on the actuator nameplate.', '250 N·m at 5.5 bar', 60);
export const SAFE_GRADE = pick('SAFE_SECURITY_GRADE', 'Security grade', 'COMPLIANCE', 'EN 1143-1 grade on the plate inside the door; insurers set cash limits per grade.', ['Grade 0', 'Grade I', 'Grade II', 'Grade III', 'Grade IV', 'Grade V', 'Not certified']);
export const CABLING_CATEGORY = pick('CABLING_CATEGORY', 'Cabling category / fibre type', 'RATING', 'Printed on the cable jacket and on the certification test report.', ['Cat 5e', 'Cat 6', 'Cat 6A', 'Cat 7', 'Cat 8', 'Fibre OM3', 'Fibre OM4', 'Fibre OM5', 'Fibre OS2 (single-mode)', 'Coaxial']);
export const CABLING_LINKS = dec('CABLING_LINKS', 'Outlets / links installed', 'links', 'DIMENSION', 'Number of tested links (from the certification report).', '240', 0);
