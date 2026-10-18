/**
 * Unified governance policy evaluator (pure, tenant-agnostic core).
 * An adapter must load independently approved, effective tenant policy, resolve
 * valid FX rates and eligible employees, then enforce decisions server-side.
 * Never call this module as a replacement for legacy guards until cutover.
 */
export type ApprovalRuleType = 'minimum_level' | 'specialist';
export type ApprovalQuorum = { mode: 'any' | 'all' | 'count' | 'percent'; value?: number };
export type AuthorityRequirement = {
  stream: string;
  level: number;
  quorum: ApprovalQuorum;
  specialistKey?: string;
};
export type GovernanceRule = {
  id: string;
  mandatory: boolean;
  enabled: boolean;
  stream: string;
  type: ApprovalRuleType;
  level: number;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  specialistKey?: string;
  /** Restrict applicability to designated facts; all listed facts must match. */
  conditions?: Record<string, string | number | boolean>;
};
export type EvaluationInput = {
  amount?: number;
  currency?: string;
  facts?: Record<string, string | number | boolean>;
};
export type Evaluation = {
  requirements: AuthorityRequirement[];
  matchedRuleIds: string[];
  problems: string[];
  allowed: boolean;
};

const validLevel = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= 100;
export function quorumCount(quorum: ApprovalQuorum, eligibleCount: number): number {
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 0) throw new Error('Invalid eligible approver count');
  switch (quorum.mode) {
    case 'all': return eligibleCount;
    case 'any': return 1;
    case 'count':
      if (!Number.isSafeInteger(quorum.value) || (quorum.value ?? 0) < 1) throw new Error('Invalid fixed quorum');
      return quorum.value!;
    case 'percent':
      if (!Number.isFinite(quorum.value) || (quorum.value ?? 0) <= 0 || quorum.value! > 100) throw new Error('Invalid percentage quorum');
      return Math.ceil(eligibleCount * quorum.value! / 100);
  }
}

export function evaluateAuthority(rules: readonly GovernanceRule[], input: EvaluationInput): Evaluation {
  const problems: string[] = [];
  const matched: GovernanceRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.id || !rule.stream || !validLevel(rule.level)) {
      problems.push('Invalid authority rule configuration: ' + (rule.id || '(unnamed)'));
      continue;
    }
    if (rule.type !== 'minimum_level' && rule.type !== 'specialist') {
      problems.push('Unknown authority type: ' + rule.id);
      continue;
    }
    if (rule.type === 'specialist' && !rule.specialistKey) {
      problems.push('Specialist authority missing identifier: ' + rule.id);
      continue;
    }
    if (rule.minAmount !== undefined || rule.maxAmount !== undefined) {
      if (input.amount === undefined || !Number.isFinite(input.amount) || input.amount < 0 || !input.currency || !rule.currency || input.currency !== rule.currency) {
        problems.push('Amount or currency must be resolved before applying rule ' + rule.id);
        continue;
      }
      if ((rule.minAmount !== undefined && (!Number.isFinite(rule.minAmount) || rule.minAmount < 0)) ||
          (rule.maxAmount !== undefined && (!Number.isFinite(rule.maxAmount) || rule.maxAmount < 0)) ||
          (rule.minAmount !== undefined && rule.maxAmount !== undefined && rule.minAmount > rule.maxAmount)) {
        problems.push('Invalid amount band: ' + rule.id);
        continue;
      }
      if (rule.minAmount !== undefined && input.amount < rule.minAmount) continue;
      if (rule.maxAmount !== undefined && input.amount > rule.maxAmount) continue;
    }
    if (Object.entries(rule.conditions ?? {}).some(([key, value]) => input.facts?.[key] !== value)) continue;
    matched.push(rule);
  }
  const minimum = new Map<string, number>();
  const specialist = new Map<string, GovernanceRule>();
  for (const r of matched) {
    if (r.type === 'minimum_level') minimum.set(r.stream, Math.max(minimum.get(r.stream) ?? 0, r.level));
    else specialist.set(r.stream + ':' + r.specialistKey, r);
  }
  const requirements: AuthorityRequirement[] = [];
  for (const [stream, maxLevel] of minimum) {
    for (let level = 1; level <= maxLevel; level++) requirements.push({ stream, level, quorum: { mode: 'any' } });
  }
  for (const rule of specialist.values()) requirements.push({ stream: rule.stream, level: rule.level, specialistKey: rule.specialistKey, quorum: { mode: 'any' } });
  if (!matched.length) problems.push('No effective authority rule matches this transaction');
  return { requirements, matchedRuleIds: matched.map(x => x.id), problems, allowed: problems.length === 0 };
}
