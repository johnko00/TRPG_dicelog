/* Pure analysis context, filter, dimension, and module helpers. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./identity.js'));
  else root.TRPGAnalysis = factory(root.TRPGIdentity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identity) {
  const UNGROUPED = '__ungrouped__';
  const PLAY_GROUP_STORES = ['playGroups', 'sessionPlayGroups'];
  const SUCCESS_RESULTS = ['critical', 'special', 'success', 'hard', 'extreme', 'hardSuccess', 'extremeSuccess'];
  const FAILURE_RESULTS = ['failure', 'fumble'];
  const ROLES = ['PC', 'KPC', 'GM'];
  const filterPredicates = {};

  function list(value) { return Array.isArray(value) ? value : []; }
  function uniqueStrings(value) { return [...new Set(list(value).map(item => String(item ?? '').trim()).filter(Boolean))]; }
  function cloneList(value) { return list(value).map(item => ({ ...item })); }
  function normalizeText(value) { return String(value == null ? '' : value).normalize('NFKC').trim().toLocaleLowerCase(); }

  // Date keys are compared as calendar strings. This intentionally avoids the
  // UTC conversion performed by new Date('YYYY-MM-DD').
  function dateKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const pad = number => String(number).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    const match = String(value == null ? '' : value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  }

  function normalizeAnalysisFilter(input) {
    const source = input || {};
    const range = source.dateRange || {};
    const normalized = {
      dateRange: { from: dateKey(range.from), to: dateKey(range.to) },
      plIds: uniqueStrings(source.plIds),
      pcIds: uniqueStrings(source.pcIds),
      sessionIds: uniqueStrings(source.sessionIds),
      playGroupIds: uniqueStrings(source.playGroupIds),
      roles: uniqueStrings(source.roles).map(role => role.toUpperCase()),
      systems: uniqueStrings(source.systems),
      skills: uniqueStrings(source.skills),
      skillCategories: uniqueStrings(source.skillCategories),
      judgementOnly: Boolean(source.judgementOnly)
    };
    Object.keys(source).filter(key => !Object.prototype.hasOwnProperty.call(normalized, key)).forEach(key => { normalized[key] = Array.isArray(source[key]) ? uniqueStrings(source[key]) : source[key]; });
    return normalized;
  }

  function buildSessionGroupMap(relations) {
    const map = new Map();
    list(relations).forEach(relation => {
      if (!relation?.sessionId || !relation?.playGroupId) return;
      if (!map.has(relation.sessionId)) map.set(relation.sessionId, new Set());
      map.get(relation.sessionId).add(relation.playGroupId);
    });
    return map;
  }

  function getSessionGroupIds(context, sessionId) {
    return [...(context.sessionGroupMap?.get(sessionId) || new Set())];
  }

  function resolveRoll(roll, context) {
    const resolved = identity.resolveSpeaker({
      rawSpeaker: roll.rawSpeaker,
      sessionId: roll.sessionId,
      mappings: context.mappings,
      pcs: context.pcs,
      pls: context.pls,
      sessionParticipants: context.sessionParticipants
    });
    return {
      ...roll,
      pcId: resolved.pcId || roll.pcId || null,
      plId: resolved.plId || roll.plId || null,
      role: resolved.role || roll.role || null,
      normalizedSpeaker: resolved.normalizedSpeaker,
      resolvedSpeaker: resolved,
      unresolved: !resolved.resolved,
      analysisExcluded: Boolean(roll.analysisExcluded),
      savingsExcluded: Boolean(roll.savingsExcluded)
    };
  }

  function resolveParticipant(participant, context) {
    const pc = context.pcMap.get(participant.pcId) || null;
    const pl = context.plMap.get(participant.plId || pc?.plId) || null;
    return { ...participant, pc, pl, role: participant.role || null };
  }

  function createAnalysisContext(input) {
    const source = input || {};
    const sessions = cloneList(source.sessions);
    const pcs = cloneList(source.pcs);
    const pls = cloneList(source.pls);
    const mappings = cloneList(source.mappings || source.aliasMappings);
    const sessionParticipants = cloneList(source.sessionParticipants);
    const playGroups = cloneList(source.playGroups);
    const sessionPlayGroups = cloneList(source.sessionPlayGroups);
    const overrides = cloneList(source.overrides || source.rollOverrides);
    const rawRolls = cloneList(source.rolls || source.rollRecords);
    const statusChanges = cloneList(source.statusChanges);
    const sessionMap = new Map(sessions.map(session => [session.id, session]));
    const pcMap = new Map(pcs.map(pc => [pc.id, pc]));
    const plMap = new Map(pls.map(pl => [pl.id, pl]));
    const playGroupMap = new Map(playGroups.map(group => [group.id, group]));
    const sessionGroupMap = buildSessionGroupMap(sessionPlayGroups);
    const resolvedRolls = identity.applyRollOverrides(rawRolls, overrides).map(roll => resolveRoll(roll, { mappings, pcs, pls, sessionParticipants }));
    const resolvedParticipants = sessionParticipants.map(participant => resolveParticipant(participant, { pcMap, plMap }));
    return {
      sessions, rolls: rawRolls, rawRolls, resolvedRolls, statusChanges,
      pcs, pls, mappings, aliasMappings: mappings, sessionParticipants,
      resolvedParticipants, playGroups, sessionPlayGroups, overrides,
      rollOverrides: overrides, sessionMap, pcMap, plMap, playGroupMap,
      sessionGroupMap
    };
  }

  function inDateRange(session, range) {
    const from = range?.from;
    const to = range?.to;
    if (!from && !to) return true;
    const value = dateKey(session?.dateStart);
    if (!value) return false;
    if (from && value < from) return false;
    if (to && value > to) return false;
    return true;
  }

  function matchesAny(values, selected) {
    return !selected.length || selected.some(value => values.includes(value));
  }

  function matchesGroupFilter(context, sessionId, selected) {
    if (!selected.length) return true;
    const groups = getSessionGroupIds(context, sessionId);
    return selected.some(groupId => groupId === UNGROUPED ? groups.length === 0 : groups.includes(groupId));
  }

  function matchesRollFilter(roll, filter) {
    return Object.entries(filterPredicates).every(([dimension, predicate]) => predicate(roll, filter[dimension]));
  }

  filterPredicates.plIds = (roll, values) => matchesAny([roll.plId].filter(Boolean), values || []);
  filterPredicates.pcIds = (roll, values) => matchesAny([roll.pcId].filter(Boolean), values || []);
  filterPredicates.roles = (roll, values) => matchesAny([String(roll.role || '').toUpperCase()].filter(Boolean), values || []);
  filterPredicates.systems = (roll, values) => matchesAny([String(roll.system || '')].filter(Boolean), values || []);
  filterPredicates.skills = (roll, values) => {
    const skillValues = [roll.skillRaw, roll.skillCanonical].filter(Boolean).map(normalizeText);
    return !(values || []).length || values.some(skill => skillValues.includes(normalizeText(skill)));
  };
  filterPredicates.skillCategories = (roll, values) => matchesAny([roll.skillCategory].filter(Boolean), values || []);
  filterPredicates.judgementOnly = (roll, value) => !value || Boolean(roll.isJudgement);

  function registerFilterPredicate(dimension, predicate) {
    if (!dimension || typeof predicate !== 'function') throw new TypeError('filter predicate requires a dimension and function');
    filterPredicates[dimension] = predicate;
    return predicate;
  }
  function listFilterPredicates() { return { ...filterPredicates }; }

  // Filtering always removes analysisExcluded rolls from the active analysis
  // view, while context.rawRolls keeps them available for management tools.
  function applyAnalysisFilter(context, inputFilter) {
    const source = context || createAnalysisContext();
    const filter = normalizeAnalysisFilter(inputFilter);
    const candidateSessions = source.sessions.filter(session =>
      (!filter.sessionIds.length || filter.sessionIds.includes(session.id))
      && inDateRange(session, filter.dateRange)
      && matchesGroupFilter(source, session.id, filter.playGroupIds)
    );
    const candidateSessionIds = new Set(candidateSessions.map(session => session.id));
    const resolvedRolls = list(source.resolvedRolls || source.rolls)
      .filter(roll => !roll.analysisExcluded)
      .filter(roll => candidateSessionIds.has(roll.sessionId))
      .filter(roll => matchesRollFilter(roll, filter));
    const builtInRollDimensions = new Set(['plIds', 'pcIds', 'roles', 'systems', 'skills', 'skillCategories', 'judgementOnly']);
    const customRollDimensionSelected = Object.keys(filterPredicates).some(key => !builtInRollDimensions.has(key) && (Array.isArray(filter[key]) ? filter[key].length : Boolean(filter[key])));
    const rollScoped = filter.plIds.length || filter.pcIds.length || filter.roles.length || filter.systems.length || filter.skills.length || filter.skillCategories.length || filter.judgementOnly || customRollDimensionSelected;
    const visibleSessionIds = rollScoped
      ? new Set(resolvedRolls.map(roll => roll.sessionId))
      : candidateSessionIds;
    const sessions = candidateSessions.filter(session => visibleSessionIds.has(session.id));
    const statuses = source.statusChanges.filter(status => visibleSessionIds.has(status.sessionId));
    return {
      ...source,
      filter,
      sessions,
      rolls: resolvedRolls.map(roll => ({ ...roll })),
      resolvedRolls: resolvedRolls.map(roll => ({ ...roll })),
      statusChanges: statuses.map(status => ({ ...status })),
      sessionIds: new Set(sessions.map(session => session.id))
    };
  }

  function buildAnalysisDimensions(context) {
    const source = context || createAnalysisContext();
    const activeRolls = list(source.resolvedRolls || source.rolls).filter(roll => !roll.analysisExcluded);
    const sessionRolls = new Map();
    activeRolls.forEach(roll => sessionRolls.set(roll.sessionId, (sessionRolls.get(roll.sessionId) || 0) + 1));
    const rollCounts = field => {
      const counts = new Map();
      activeRolls.forEach(roll => { const value = roll[field]; if (value) counts.set(value, (counts.get(value) || 0) + 1); });
      return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => ({ value, label: value, count }));
    };
    const pls = source.pls.map(pl => ({ ...pl, count: activeRolls.filter(roll => roll.plId === pl.id).length }));
    const pcs = source.pcs.map(pc => ({ ...pc, count: activeRolls.filter(roll => roll.pcId === pc.id).length }));
    const sessions = source.sessions.map(session => ({ ...session, count: sessionRolls.get(session.id) || 0 }));
    const groupCounts = new Map(source.playGroups.map(group => [group.id, 0]));
    let ungroupedCount = 0;
    source.sessions.forEach(session => {
      const groups = getSessionGroupIds(source, session.id);
      if (!groups.length) ungroupedCount += 1;
      groups.forEach(groupId => groupCounts.set(groupId, (groupCounts.get(groupId) || 0) + 1));
    });
    const playGroups = source.playGroups.map(group => ({ ...group, count: groupCounts.get(group.id) || 0 }));
    playGroups.push({ id: UNGROUPED, name: 'グループ未設定', color: '#64748b', count: ungroupedCount, special: true });
    const roleCounts = new Map(ROLES.map(role => [role, 0]));
    activeRolls.forEach(roll => { if (roleCounts.has(roll.role)) roleCounts.set(roll.role, roleCounts.get(roll.role) + 1); });
    const roleOptions = ROLES.map(role => ({ value: role, label: role, count: roleCounts.get(role) || 0 }));
    return {
      pls, pcs, sessions, playGroups, roles: [...ROLES], roleOptions,
      systems: rollCounts('system'), skills: rollCounts('skillRaw'), skillCategories: rollCounts('skillCategory'),
      ungroupedValue: UNGROUPED
    };
  }

  function getRolls(input) {
    if (Array.isArray(input)) return input;
    return list(input?.resolvedRolls || input?.rolls);
  }

  function calculateBasicStats(input) {
    const rolls = getRolls(input).filter(roll => !roll.analysisExcluded);
    const judgements = rolls.filter(roll => roll.isJudgement);
    const classified = judgements.filter(roll => SUCCESS_RESULTS.includes(roll.result) || FAILURE_RESULTS.includes(roll.result));
    const success = classified.filter(roll => SUCCESS_RESULTS.includes(roll.result));
    const failure = classified.filter(roll => FAILURE_RESULTS.includes(roll.result));
    const averageSamples = judgements.filter(roll => roll.rolledValue !== null && roll.rolledValue !== undefined && roll.rolledValue !== '').map(roll => Number(roll.rolledValue)).filter(Number.isFinite);
    const averageRoll = averageSamples.length ? averageSamples.reduce((sum, value) => sum + value, 0) / averageSamples.length : null;
    const sessionCount = input && !Array.isArray(input) ? new Set(list(input.sessions).map(session => session.id)).size : new Set(rolls.map(roll => roll.sessionId)).size;
    const successRate = classified.length ? success.length / classified.length : 0;
    return {
      sessionCount,
      rollCount: rolls.length,
      judgementCount: judgements.length,
      classifiedJudgementCount: classified.length,
      unknownJudgementCount: judgements.length - classified.length,
      averageRollSampleCount: averageSamples.length,
      averageRoll,
      success: success.length,
      failure: failure.length,
      critical: classified.filter(roll => roll.result === 'critical').length,
      special: classified.filter(roll => roll.result === 'special').length,
      hard: classified.filter(roll => roll.result === 'hard' || roll.result === 'hardSuccess').length,
      extreme: classified.filter(roll => roll.result === 'extreme' || roll.result === 'extremeSuccess').length,
      fumble: classified.filter(roll => roll.result === 'fumble').length,
      successRate,
      successRateNumerator: success.length,
      successRateDenominator: classified.length,
      evidence: {
        successRate: { label: '成功率', value: successRate, numerator: success.length, denominator: classified.length },
        averageRoll: { label: '平均出目', value: averageRoll, numerator: averageSamples.reduce((sum, value) => sum + value, 0), denominator: averageSamples.length }
      }
    };
  }

  function createPlayGroupRecord(values, now) {
    const source = values || {};
    const timestamp = now || new Date().toISOString();
    return { id: source.id || `play-group:${identity.stableHash(`${timestamp}:${source.name || ''}`)}`, name: String(source.name || '').trim(), color: source.color || '#ff758c', memo: source.memo || '', createdAt: source.createdAt || timestamp, updatedAt: source.updatedAt || timestamp };
  }

  function createSessionPlayGroupRecord(values, now) {
    const source = values || {};
    const timestamp = now || new Date().toISOString();
    return { id: source.id || `session-play-group:${identity.stableHash(`${source.sessionId || ''}:${source.playGroupId || ''}`)}`, sessionId: source.sessionId || null, playGroupId: source.playGroupId || null, createdAt: source.createdAt || timestamp };
  }

  function dedupeSessionPlayGroups(relations) {
    const seen = new Set();
    return list(relations).filter(relation => {
      const key = `${relation.sessionId}\u241f${relation.playGroupId}`;
      if (!relation.sessionId || !relation.playGroupId || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(relation => ({ ...relation }));
  }

  function removePlayGroupRelations(relations, playGroupId) { return list(relations).filter(relation => relation.playGroupId !== playGroupId).map(relation => ({ ...relation })); }

  function getAnalysisMigrationPlan(fromVersion, toVersion) {
    const from = Number(fromVersion) || 0;
    const to = Number(toVersion) || from;
    return { fromVersion: from, toVersion: to, addStores: from < 5 && to >= 5 ? [...PLAY_GROUP_STORES] : [], preserveStores: ['sourceLogs', 'sessions', 'parsedItems', 'rollRecords', 'statusChanges', 'aliasMappings', 'pcs', 'pls', 'sessionParticipants', 'rollOverrides', 'savingsRules', 'savingsCandidateDecisions', 'ledgerEntries'] };
  }

  const analysisModules = new Map();
  function registerAnalysisModule(module) {
    if (!module?.id || typeof module.calculate !== 'function') throw new TypeError('analysis module requires id and calculate');
    const normalized = { requiredData: [], minimumSampleSize: 0, ...module };
    analysisModules.set(normalized.id, normalized);
    return normalized;
  }
  function getAnalysisModule(id) { return analysisModules.get(id) || null; }
  function listAnalysisModules() { return [...analysisModules.values()].map(module => ({ ...module })); }
  function calculateAnalysisModule(id, context) { const module = getAnalysisModule(id); return module ? module.calculate(context) : null; }

  registerAnalysisModule({ id: 'basic', title: '基本統計', description: '判定成功率と出目の基本統計', requiredData: ['rolls', 'sessions'], minimumSampleSize: 1, calculate: calculateBasicStats });

  return {
    UNGROUPED, PLAY_GROUP_STORES, SUCCESS_RESULTS, FAILURE_RESULTS, ROLES,
    dateKey, normalizeAnalysisFilter, createAnalysisContext, applyAnalysisFilter,
    buildSessionGroupMap, getSessionGroupIds, buildAnalysisDimensions,
    calculateBasicStats, createPlayGroupRecord, createSessionPlayGroupRecord,
    dedupeSessionPlayGroups, removePlayGroupRelations, getAnalysisMigrationPlan,
    registerAnalysisModule, getAnalysisModule, listAnalysisModules, calculateAnalysisModule,
    registerFilterPredicate, listFilterPredicates
  };
});
