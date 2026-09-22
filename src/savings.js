/* Pure Phase 3 savings candidate and review helpers. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./identity.js'));
  else root.TRPGSavings = factory(root.TRPGIdentity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identity) {
  const RESULT_NAMES = ['critical', 'special', 'success', 'hard', 'extreme', 'hardSuccess', 'extremeSuccess', 'failure', 'fumble'];

  function normalizeRule(rule) {
    const source = rule || {};
    const condition = source.condition || {};
    const results = condition.results || condition.result || source.results || null;
    return {
      ...source,
      id: source.id || null,
      name: source.name || '無名ルール',
      type: source.type || 'saving',
      amountMode: source.amountMode || 'fixed',
      amount: Number(source.amount || 0),
      icon: source.icon || (source.type === 'expense' ? '🛒' : '✨'),
      color: source.color || null,
      category: source.category || null,
      triggerType: source.triggerType || 'roll',
      condition: {
        ...condition,
        exactRolls: Array.isArray(condition.exactRolls) ? condition.exactRolls.map(Number).filter(Number.isFinite) : null,
        rollMin: condition.rollMin == null ? null : Number(condition.rollMin),
        rollMax: condition.rollMax == null ? null : Number(condition.rollMax),
        results: Array.isArray(results) ? results : null,
        skillNames: Array.isArray(condition.skillNames) ? condition.skillNames : null,
        skillCategories: Array.isArray(condition.skillCategories) ? condition.skillCategories : null,
        judgementOnly: condition.judgementOnly == null ? source.triggerType !== 'session' && source.triggerType !== 'manual' : Boolean(condition.judgementOnly),
        targetScope: condition.targetScope || 'all',
        plIds: Array.isArray(condition.plIds) ? condition.plIds : null,
        pcIds: Array.isArray(condition.pcIds) ? condition.pcIds : null,
        roles: Array.isArray(condition.roles) ? condition.roles : null,
        myParticipation: condition.myParticipation || 'all'
      },
      isEnabled: source.isEnabled !== false,
      createdAt: source.createdAt || null,
      updatedAt: source.updatedAt || null
    };
  }

  function buildCandidateKey(context, ruleId) {
    const rule = String(ruleId);
    if (context.triggerType === 'session' || context.sessionId && !context.sourceKey) return `session:${context.sessionId}:rule:${rule}`;
    return `roll:${context.sourceKey}:rule:${rule}`;
  }

  function amountForRule(rule) {
    const normalized = normalizeRule(rule);
    return normalized.amountMode === 'fixed' ? normalized.amount : null;
  }

  function matchesRollCondition(rule, roll, resolved, myPlId) {
    const normalized = normalizeRule(rule);
    const condition = normalized.condition;
    if (!normalized.isEnabled || normalized.triggerType !== 'roll') return false;
    if (condition.judgementOnly && !roll.isJudgement) return false;
    if (condition.exactRolls?.length && !condition.exactRolls.includes(Number(roll.rolledValue))) return false;
    if (condition.rollMin != null && (roll.rolledValue == null || Number(roll.rolledValue) < condition.rollMin)) return false;
    if (condition.rollMax != null && (roll.rolledValue == null || Number(roll.rolledValue) > condition.rollMax)) return false;
    if (condition.results?.length && !condition.results.includes(roll.result) && !condition.results.includes(roll.normalizedResult)) return false;
    if (condition.skillNames?.length && !condition.skillNames.includes(roll.skillRaw)) return false;
    if (condition.plIds?.length && !condition.plIds.includes(resolved?.plId)) return false;
    if (condition.pcIds?.length && !condition.pcIds.includes(resolved?.pcId)) return false;
    if (condition.roles?.length && !condition.roles.includes(resolved?.role)) return false;
    if (condition.targetScope === 'self' && resolved?.plId !== myPlId) return false;
    if (condition.targetScope === 'specific' && !condition.pcIds?.includes(resolved?.pcId) && !condition.plIds?.includes(resolved?.plId)) return false;
    if (condition.myParticipation === 'self' && resolved?.plId !== myPlId) return false;
    if (condition.myParticipation === 'gm' && resolved?.role !== 'GM') return false;
    if (condition.myParticipation === 'pc' && !(resolved?.plId === myPlId && resolved?.role === 'PC')) return false;
    if (condition.myParticipation === 'kpc' && !(resolved?.plId === myPlId && resolved?.role === 'KPC')) return false;
    return true;
  }

  function candidateFromRoll(roll, rule, resolved) {
    const normalized = normalizeRule(rule);
    const sourceKey = roll.sourceKey || null;
    if (!sourceKey || !normalized.id) return null;
    return {
      id: `candidate:${identity.stableHash(`${sourceKey}\u241f${normalized.id}`)}`,
      candidateKey: buildCandidateKey({ sourceKey, triggerType: 'roll' }, normalized.id),
      sessionId: roll.sessionId || null,
      sourceKey,
      sourceLogId: roll.sourceLogId || null,
      ruleId: normalized.id,
      ruleNameSnapshot: normalized.name,
      ruleSnapshot: JSON.parse(JSON.stringify(normalized)),
      pcId: resolved?.pcId || null,
      pcNameSnapshot: resolved?.pc?.name || null,
      plId: resolved?.plId || null,
      plNameSnapshot: resolved?.pl?.name || null,
      role: resolved?.role || null,
      skillRaw: roll.skillRaw || null,
      targetValue: roll.targetValue == null ? null : roll.targetValue,
      rolledValue: roll.rolledValue == null ? null : roll.rolledValue,
      result: roll.result || null,
      amount: amountForRule(normalized),
      amountMode: normalized.amountMode,
      type: normalized.type,
      triggerType: 'roll',
      createdAt: new Date().toISOString()
    };
  }

  function generateRollCandidates(options) {
    const config = options || {};
    const rolls = config.rolls || [];
    const rules = (config.rules || []).map(normalizeRule).filter(rule => rule.triggerType === 'roll' && rule.isEnabled);
    const overrides = new Map((config.overrides || []).filter(item => item?.sourceKey).map(item => [item.sourceKey, item]));
    const candidates = [];
    for (const roll of rolls) {
      if (overrides.get(roll.sourceKey)?.savingsExcluded || roll.savingsExcluded) continue;
      const resolved = identity.resolveSpeaker({ rawSpeaker: roll.rawSpeaker, sessionId: roll.sessionId, mappings: config.mappings, pcs: config.pcs, pls: config.pls, sessionParticipants: config.sessionParticipants });
      if (resolved.ignored || resolved.pc?.excludedFromSavings || resolved.sessionParticipant?.savingsExcluded) continue;
      for (const rule of rules) {
        if (matchesRollCondition(rule, roll, resolved, config.myPlId)) {
          const candidate = candidateFromRoll(roll, rule, resolved);
          if (candidate) candidates.push(candidate);
        }
      }
    }
    return dedupeCandidates(candidates);
  }

  function generateSessionCandidates(options) {
    const config = options || {};
    const rules = (config.rules || []).map(normalizeRule).filter(rule => rule.triggerType === 'session' && rule.isEnabled);
    const candidates = [];
    for (const session of config.sessions || []) {
      for (const rule of rules) {
        const contexts = Array.isArray(config.sessionContexts?.[session.id])
          ? config.sessionContexts[session.id]
          : [config.sessionContexts?.[session.id] || {}];
        const condition = rule.condition;
        const matchingContext = contexts.find(context => {
          if (condition.roles?.length && !condition.roles.includes(context.role)) return false;
          if (condition.plIds?.length && !condition.plIds.includes(context.plId)) return false;
          if (condition.pcIds?.length && !condition.pcIds.includes(context.pcId)) return false;
          if (condition.myParticipation === 'self' && context.plId !== config.myPlId) return false;
          if (condition.myParticipation === 'gm' && context.role !== 'GM') return false;
          if (condition.myParticipation === 'pc' && !(context.plId === config.myPlId && context.role === 'PC')) return false;
          if (condition.myParticipation === 'kpc' && !(context.plId === config.myPlId && context.role === 'KPC')) return false;
          return true;
        });
        if (!matchingContext) continue;
        const context = matchingContext;
        const candidateKey = buildCandidateKey({ sessionId: session.id, triggerType: 'session' }, rule.id);
        candidates.push({
          id: `candidate:${identity.stableHash(candidateKey)}`,
          candidateKey,
          sessionId: session.id,
          sourceKey: null,
          sourceLogId: null,
          ruleId: rule.id,
          ruleNameSnapshot: rule.name,
          ruleSnapshot: JSON.parse(JSON.stringify(rule)),
          pcId: context.pcId || null,
          pcNameSnapshot: context.pcName || null,
          plId: context.plId || null,
          plNameSnapshot: context.plName || null,
          role: context.role || null,
          skillRaw: null,
          targetValue: null,
          rolledValue: null,
          result: null,
          amount: amountForRule(rule),
          amountMode: rule.amountMode,
          type: rule.type,
          triggerType: 'session',
          createdAt: new Date().toISOString()
        });
      }
    }
    return dedupeCandidates(candidates);
  }

  function dedupeCandidates(candidates) {
    const map = new Map();
    for (const candidate of candidates || []) if (candidate?.candidateKey && !map.has(candidate.candidateKey)) map.set(candidate.candidateKey, candidate);
    return [...map.values()];
  }

  function confirmedCandidateKeys(ledgerEntries, decisions) {
    const keys = new Set();
    for (const entry of ledgerEntries || []) for (const detail of entry.details || []) {
      if (detail.candidateKey) keys.add(detail.candidateKey);
      else if (detail.sourceKey && detail.ruleId) keys.add(buildCandidateKey({ sourceKey: detail.sourceKey, triggerType: detail.triggerType || 'roll' }, detail.ruleId));
    }
    for (const decision of decisions || []) if (decision.decision === 'accepted' && decision.candidateKey) keys.add(decision.candidateKey);
    return keys;
  }

  function pendingCandidates(candidates, ledgerEntries, decisions) {
    const finalized = confirmedCandidateKeys(ledgerEntries, decisions);
    const dismissed = new Set((decisions || []).filter(item => item.decision === 'dismissed').map(item => item.candidateKey));
    return (candidates || []).filter(candidate => !finalized.has(candidate.candidateKey) && !dismissed.has(candidate.candidateKey));
  }

  function calculateReviewTotals(items) {
    const values = items || [];
    const saving = values.filter(item => item.type !== 'expense').reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const expense = values.filter(item => item.type === 'expense').reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return { saving, expense, net: saving - expense, total: saving + expense };
  }

  function buildLedgerSnapshot(item) {
    return { ...item, confirmedAt: new Date().toISOString() };
  }

  return { RESULT_NAMES, normalizeRule, createLineageCandidateKey: buildCandidateKey, buildCandidateKey, amountForRule, matchesRollCondition, generateRollCandidates, generateSessionCandidates, dedupeCandidates, confirmedCandidateKeys, pendingCandidates, calculateReviewTotals, buildLedgerSnapshot };
});
