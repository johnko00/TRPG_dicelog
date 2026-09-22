/* Pure analysis context, filter, dimension, and module helpers. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./identity.js'), require('./incidents.js'));
  else root.TRPGAnalysis = factory(root.TRPGIdentity, root.TRPGIncidents);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identity, incidents) {
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

  function numericValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function resultStats(rolls) {
    const listOfRolls = list(rolls);
    const judgements = listOfRolls.filter(roll => Boolean(roll.isJudgement));
    const classified = judgements.filter(roll => SUCCESS_RESULTS.includes(roll.result) || FAILURE_RESULTS.includes(roll.result));
    const success = classified.filter(roll => SUCCESS_RESULTS.includes(roll.result));
    const failure = classified.filter(roll => FAILURE_RESULTS.includes(roll.result));
    return { judgements, classified, success, failure };
  }

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
      analysisSource: source,
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
    const { judgements, classified, success, failure } = resultStats(rolls);
    const averageSamples = judgements.map(roll => numericValue(roll.rolledValue)).filter(value => value !== null);
    const averageRoll = averageSamples.length ? averageSamples.reduce((sum, value) => sum + value, 0) / averageSamples.length : null;
    const sessionCount = input && !Array.isArray(input) ? new Set(list(input.sessions).map(session => session.id)).size : new Set(rolls.map(roll => roll.sessionId)).size;
    const successRate = classified.length ? success.length / classified.length : 0;
    const critical = classified.filter(roll => roll.result === 'critical').length;
    const special = classified.filter(roll => roll.result === 'special').length;
    const hard = classified.filter(roll => roll.result === 'hard' || roll.result === 'hardSuccess').length;
    const extreme = classified.filter(roll => roll.result === 'extreme' || roll.result === 'extremeSuccess').length;
    const fumble = classified.filter(roll => roll.result === 'fumble').length;
    const numericJudgements = judgements.filter(roll => numericValue(roll.rolledValue) !== null);
    const exact1 = numericJudgements.filter(roll => numericValue(roll.rolledValue) === 1).length;
    const exact100 = numericJudgements.filter(roll => numericValue(roll.rolledValue) === 100).length;
    return {
      sessionCount,
      rollCount: rolls.length,
      totalDiceCount: rolls.length,
      judgementCount: judgements.length,
      classifiedJudgementCount: classified.length,
      unknownJudgementCount: judgements.length - classified.length,
      classifiedCount: classified.length,
      averageRollSampleCount: averageSamples.length,
      numericJudgementSampleCount: numericJudgements.length,
      averageRoll,
      success: success.length,
      failure: failure.length,
      critical,
      special,
      hard,
      extreme,
      fumble,
      exact1,
      exact100,
      exactOneCount: exact1,
      exactHundredCount: exact100,
      successRate,
      successRateNumerator: success.length,
      successRateDenominator: classified.length,
      criticalRate: classified.length ? critical / classified.length : 0,
      fumbleRate: classified.length ? fumble / classified.length : 0,
      evidence: {
        successRate: { label: '成功率', value: successRate, numerator: success.length, denominator: classified.length },
        criticalRate: { label: 'Critical率', value: classified.length ? critical / classified.length : 0, numerator: critical, denominator: classified.length },
        fumbleRate: { label: 'Fumble率', value: classified.length ? fumble / classified.length : 0, numerator: fumble, denominator: classified.length },
        averageRoll: { label: '平均出目', value: averageRoll, numerator: averageSamples.reduce((sum, value) => sum + value, 0), denominator: averageSamples.length },
        exact1: { label: '出目1', value: exact1, numerator: exact1, denominator: numericJudgements.length },
        exact100: { label: '出目100', value: exact100, numerator: exact100, denominator: numericJudgements.length }
      }
    };
  }

  function getActiveRolls(input) {
    return getRolls(input).filter(roll => !roll.analysisExcluded);
  }

  function calculateMargin(roll) {
    if (!roll || !roll.isJudgement) return null;
    const target = numericValue(roll.targetValue);
    const rolled = numericValue(roll.rolledValue);
    return target === null || rolled === null ? null : target - rolled;
  }

  function calculateRollMargin(roll) { return calculateMargin(roll); }

  function isCloseSuccess(roll, threshold) {
    const limit = numericValue(threshold) === null ? 5 : Math.max(0, Number(threshold));
    const margin = calculateMargin(roll);
    return margin !== null && margin >= 0 && margin <= limit;
  }

  function isCloseFailure(roll, threshold) {
    const limit = numericValue(threshold) === null ? 5 : Math.max(0, Number(threshold));
    const margin = calculateMargin(roll);
    return margin !== null && margin < 0 && Math.abs(margin) <= limit;
  }

  function findExactRolls(input, value) {
    const target = numericValue(value);
    if (target === null) return [];
    return getActiveRolls(input).filter(roll => roll.isJudgement && numericValue(roll.rolledValue) === target).map(roll => ({ ...roll }));
  }

  function calculateRollDistribution(input, options) {
    const config = options || {};
    const min = numericValue(config.min) === null ? 1 : Math.floor(Number(config.min));
    const max = numericValue(config.max) === null ? 100 : Math.floor(Number(config.max));
    const bucketSize = numericValue(config.bucketSize) === null ? 10 : Math.max(1, Math.floor(Number(config.bucketSize)));
    const safeMax = Math.max(min, max);
    const buckets = [];
    for (let start = min; start <= safeMax; start += bucketSize) {
      buckets.push({ min: start, max: Math.min(start + bucketSize - 1, safeMax), count: 0 });
    }
    const values = getActiveRolls(input)
      .filter(roll => roll.isJudgement)
      .map(roll => numericValue(roll.rolledValue))
      .filter(value => value !== null && value >= min && value <= safeMax);
    values.forEach(value => {
      const index = Math.min(buckets.length - 1, Math.floor((value - min) / bucketSize));
      if (index >= 0 && buckets[index]) buckets[index].count += 1;
    });
    Object.defineProperty(buckets, 'sampleCount', { value: values.length, enumerable: false });
    Object.defineProperty(buckets, 'bucketSize', { value: bucketSize, enumerable: false });
    return buckets;
  }

  function normalizeSkillKey(value) {
    return normalizeText(value).replace(/\s+/g, ' ');
  }

  function getSkillDisplayName(roll) {
    const value = roll?.skillRaw || roll?.skillCanonical || '';
    return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function sortSkillStats(rows, options) {
    const config = options || {};
    const sortBy = config.sortBy || 'usageCount';
    const descending = config.direction ? String(config.direction).toLowerCase() !== 'asc' : sortBy !== 'name' && sortBy !== 'displayName';
    const valueFor = row => {
      if (sortBy === 'usage' || sortBy === 'usageCount') return row.usageCount;
      if (sortBy === 'successRate') return row.successRate;
      if (sortBy === 'critical' || sortBy === 'criticalCount') return row.criticalCount;
      if (sortBy === 'fumble' || sortBy === 'fumbleCount') return row.fumbleCount;
      if (sortBy === 'averageRoll') return row.averageRoll === null ? -Infinity : row.averageRoll;
      return row.displayName;
    };
    return [...list(rows)].sort((a, b) => {
      const left = valueFor(a), right = valueFor(b);
      let comparison;
      if (typeof left === 'string' || typeof right === 'string') comparison = String(left).localeCompare(String(right), 'ja');
      else comparison = (Number(left) || 0) - (Number(right) || 0);
      if (comparison === 0) comparison = String(a.displayName).localeCompare(String(b.displayName), 'ja');
      return descending ? -comparison : comparison;
    });
  }

  function buildRecentSkillRecord(roll, context) {
    const session = context?.sessionMap?.get(roll.sessionId) || null;
    const pc = roll.pcId ? context?.pcMap?.get(roll.pcId) : null;
    return {
      id: roll.id || roll.sourceKey || null,
      sessionId: roll.sessionId || null,
      sessionTitle: session?.title || session?.name || null,
      sessionDate: session?.dateStart || null,
      pcId: roll.pcId || null,
      pcName: pc?.name || null,
      plId: roll.plId || null,
      role: roll.role || null,
      targetValue: numericValue(roll.targetValue),
      rolledValue: numericValue(roll.rolledValue),
      result: roll.result || 'unknown',
      sequenceInSession: roll.sequenceInSession ?? roll.sequence ?? null
    };
  }

  function calculateSkillStats(input, options) {
    const config = options || {};
    const context = Array.isArray(input) ? null : input;
    const groups = new Map();
    getActiveRolls(input).filter(roll => roll.isJudgement).forEach(roll => {
      const displayName = getSkillDisplayName(roll);
      const skillKey = normalizeSkillKey(displayName);
      if (!skillKey) return;
      if (!groups.has(skillKey)) groups.set(skillKey, { skillKey, displayName, rolls: [] });
      groups.get(skillKey).rolls.push(roll);
    });
    const recentLimit = numericValue(config.recentLimit) === null ? 5 : Math.max(0, Math.floor(Number(config.recentLimit)));
    const minimumSampleSize = numericValue(config.minimumSampleSize) === null ? 0 : Math.max(0, Math.floor(Number(config.minimumSampleSize)));
    const rows = [...groups.values()].map(group => {
      const { judgements, classified, success, failure } = resultStats(group.rolls);
      const rollSamples = judgements.map(roll => numericValue(roll.rolledValue)).filter(value => value !== null);
      const targetSamples = judgements.map(roll => numericValue(roll.targetValue)).filter(value => value !== null);
      const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      const criticalCount = classified.filter(roll => roll.result === 'critical').length;
      const fumbleCount = classified.filter(roll => roll.result === 'fumble').length;
      const row = {
        skillKey: group.skillKey,
        displayName: group.displayName,
        usageCount: judgements.length,
        classifiedCount: classified.length,
        successCount: success.length,
        failureCount: failure.length,
        successRate: classified.length ? success.length / classified.length : 0,
        criticalCount,
        fumbleCount,
        criticalRate: classified.length ? criticalCount / classified.length : 0,
        fumbleRate: classified.length ? fumbleCount / classified.length : 0,
        averageRoll: average(rollSamples),
        averageRollSampleCount: rollSamples.length,
        averageTarget: average(targetSamples),
        averageTargetSampleCount: targetSamples.length,
        closeSuccessCount: group.rolls.filter(roll => isCloseSuccess(roll, config.closeThreshold)).length,
        closeFailureCount: group.rolls.filter(roll => isCloseFailure(roll, config.closeThreshold)).length,
        recentRecords: context && recentLimit ? [...group.rolls].sort((a, b) => Number(b.sequenceInSession ?? b.sequence ?? 0) - Number(a.sequenceInSession ?? a.sequence ?? 0)).slice(0, recentLimit).map(roll => buildRecentSkillRecord(roll, context)) : []
      };
      return row;
    }).filter(row => row.classifiedCount >= minimumSampleSize);
    return sortSkillStats(rows, config);
  }

  function breakdownDimension(value) {
    const normalized = String(value || '').toLowerCase();
    return normalized === 'group' || normalized === 'playgroup' ? 'playGroup' : normalized;
  }

  function calculateBreakdown(input, dimension, options) {
    const source = Array.isArray(input) ? { rolls: input, resolvedRolls: input, sessions: [] } : (input || createAnalysisContext());
    const normalizedDimension = breakdownDimension(dimension);
    const rows = new Map();
    const sessionMap = source.sessionMap || new Map(list(source.sessions).map(session => [session.id, session]));
    const pcMap = source.pcMap || new Map(list(source.pcs).map(pc => [pc.id, pc]));
    const plMap = source.plMap || new Map(list(source.pls).map(pl => [pl.id, pl]));
    const groupMap = source.playGroupMap || new Map(list(source.playGroups).map(group => [group.id, group]));
    const add = (id, label, roll, extra) => {
      if (!id) return;
      if (!rows.has(id)) rows.set(id, { id, label: label || id, rolls: [], sessionIds: new Set(), ...extra });
      const row = rows.get(id);
      row.rolls.push(roll);
      if (roll.sessionId) row.sessionIds.add(roll.sessionId);
    };
    getActiveRolls(source).forEach(roll => {
      if (normalizedDimension === 'pl') {
        const pl = roll.plId ? plMap.get(roll.plId) : null;
        if (roll.plId) add(roll.plId, pl?.name || roll.plId, roll);
      } else if (normalizedDimension === 'pc') {
        const pc = roll.pcId ? pcMap.get(roll.pcId) : null;
        if (roll.pcId) add(roll.pcId, pc?.name || roll.pcId, roll);
      } else if (normalizedDimension === 'session') {
        const session = sessionMap.get(roll.sessionId);
        if (roll.sessionId) add(roll.sessionId, session?.title || session?.name || roll.sessionId, roll, { dateStart: session?.dateStart || null });
      } else if (normalizedDimension === 'playGroup') {
        const groupIds = getSessionGroupIds(source, roll.sessionId);
        (groupIds.length ? groupIds : [UNGROUPED]).forEach(groupId => {
          const group = groupMap.get(groupId);
          add(groupId, group?.name || (groupId === UNGROUPED ? 'グループ未設定' : groupId), roll);
        });
      } else if (normalizedDimension === 'role') {
        const role = String(roll.role || '').toUpperCase();
        if (role) add(role, role, roll);
      } else if (normalizedDimension === 'system') {
        const system = roll.system || 'unknown';
        add(system, system, roll);
      }
    });
    const sortBy = options?.sortBy || 'rollCount';
    const output = [...rows.values()].map(row => {
      const sessions = [...row.sessionIds].map(id => sessionMap.get(id)).filter(Boolean);
      const stats = calculateBasicStats({ rolls: row.rolls, sessions });
      return {
        id: row.id,
        value: row.id,
        label: row.label,
        name: row.label,
        dateStart: row.dateStart || null,
        sessionCount: stats.sessionCount,
        rollCount: stats.rollCount,
        ...stats
      };
    });
    output.sort((a, b) => {
      if (sortBy === 'successRate') return b.successRate - a.successRate || b.classifiedJudgementCount - a.classifiedJudgementCount;
      if (sortBy === 'critical') return b.critical - a.critical || a.label.localeCompare(b.label, 'ja');
      if (sortBy === 'fumble') return b.fumble - a.fumble || a.label.localeCompare(b.label, 'ja');
      if (sortBy === 'name') return a.label.localeCompare(b.label, 'ja');
      return b.rollCount - a.rollCount || a.label.localeCompare(b.label, 'ja');
    });
    return { dimension: normalizedDimension, rows: output, overall: calculateBasicStats(source) };
  }

  function mergeAnalysisFilters(base, override) {
    const normalizedBase = normalizeAnalysisFilter(base);
    const source = override || {};
    const merged = { ...normalizedBase, dateRange: { ...normalizedBase.dateRange } };
    Object.keys(source).forEach(key => {
      if (key === 'dateRange') merged.dateRange = { ...normalizedBase.dateRange, ...(source.dateRange || {}) };
      else if (Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key];
    });
    return normalizeAnalysisFilter(merged);
  }

  function compareMetric(a, b, key) {
    if (['successRate', 'criticalRate', 'fumbleRate'].includes(key)
      && (!a?.classifiedJudgementCount || !b?.classifiedJudgementCount)) return null;
    if (key === 'averageRoll' && (!a?.averageRollSampleCount || !b?.averageRollSampleCount)) return null;
    if (['exact1', 'exact100'].includes(key)
      && (!a?.numericJudgementSampleCount || !b?.numericJudgementSampleCount)) return null;
    const left = numericValue(a?.[key]);
    const right = numericValue(b?.[key]);
    return left === null || right === null ? null : left - right;
  }

  function compareAnalysisFilters(context, baseFilter, filterA, filterB, options) {
    const config = options || {};
    const threshold = numericValue(config.minimumSampleSize) === null ? 5 : Math.max(1, Math.floor(Number(config.minimumSampleSize)));
    const filterForA = mergeAnalysisFilters(baseFilter, filterA);
    const filterForB = mergeAnalysisFilters(baseFilter, filterB);
    const contextA = applyAnalysisFilter(context, filterForA);
    const contextB = applyAnalysisFilter(context, filterForB);
    const statsA = calculateBasicStats(contextA);
    const statsB = calculateBasicStats(contextB);
    const difference = {
      judgementCount: compareMetric(statsA, statsB, 'judgementCount'),
      successRate: compareMetric(statsA, statsB, 'successRate'),
      criticalRate: compareMetric(statsA, statsB, 'criticalRate'),
      fumbleRate: compareMetric(statsA, statsB, 'fumbleRate'),
      averageRoll: compareMetric(statsA, statsB, 'averageRoll'),
      exact1: compareMetric(statsA, statsB, 'exact1'),
      exact100: compareMetric(statsA, statsB, 'exact100')
    };
    const warnings = [];
    if (statsA.classifiedJudgementCount < threshold || statsB.classifiedJudgementCount < threshold) warnings.push('判定数が少ないため参考値です');
    if (!statsA.rollCount) warnings.push('比較Aのデータがありません');
    if (!statsB.rollCount) warnings.push('比較Bのデータがありません');
    return {
      baseFilter: normalizeAnalysisFilter(baseFilter),
      filterA: filterForA,
      filterB: filterForB,
      a: { filter: filterForA, context: contextA, stats: statsA },
      b: { filter: filterForB, context: contextB, stats: statsB },
      statsA,
      statsB,
      difference,
      differences: difference,
      minimumSampleSize: threshold,
      warnings,
      sampleWarning: warnings.includes('判定数が少ないため参考値です')
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
  function calculateAnalysisModule(id, context, options) { const module = getAnalysisModule(id); return module ? module.calculate(context, options) : null; }

  registerAnalysisModule({ id: 'basic', title: '基本統計', description: '判定成功率と出目の基本統計', requiredData: ['rolls', 'sessions'], minimumSampleSize: 1, calculate: calculateBasicStats });
  registerAnalysisModule({ id: 'distribution', title: '出目分布', description: 'numericな判定出目のbucket分布', requiredData: ['rolls'], minimumSampleSize: 1, calculate: calculateRollDistribution });
  registerAnalysisModule({ id: 'skills', title: '技能分析', description: '技能ごとの判定統計', requiredData: ['rolls'], minimumSampleSize: 1, calculate: calculateSkillStats });
  registerAnalysisModule({ id: 'breakdown', title: '内訳', description: 'PL/PC/session/group/role/system別統計', requiredData: ['rolls', 'sessions'], minimumSampleSize: 1, calculate: (context, options) => calculateBreakdown(context, options?.dimension || 'session', options) });
  if (incidents) {
    registerAnalysisModule({ id: 'incidents', title: '事件簿', description: '元ログから再計算するダイス事件', requiredData: ['rolls', 'statusChanges', 'sessions'], minimumSampleSize: 0, calculate: (context, options) => incidents.detectIncidents(context, options) });
  }

  return {
    UNGROUPED, PLAY_GROUP_STORES, SUCCESS_RESULTS, FAILURE_RESULTS, ROLES,
    dateKey, normalizeAnalysisFilter, createAnalysisContext, applyAnalysisFilter,
    buildSessionGroupMap, getSessionGroupIds, buildAnalysisDimensions,
    calculateBasicStats, calculateRollDistribution, normalizeSkillKey, sortSkillStats,
    calculateSkillStats, calculateMargin, calculateRollMargin, isCloseSuccess, isCloseFailure,
    findExactRolls, calculateBreakdown, mergeAnalysisFilters, compareAnalysisFilters,
    createPlayGroupRecord, createSessionPlayGroupRecord,
    dedupeSessionPlayGroups, removePlayGroupRelations, getAnalysisMigrationPlan,
    registerAnalysisModule, getAnalysisModule, listAnalysisModules, calculateAnalysisModule,
    detectIncidents: incidents?.detectIncidents,
    registerIncidentDetector: incidents?.registerIncidentDetector,
    getIncidentDetector: incidents?.getIncidentDetector,
    listIncidentDetectors: incidents?.listIncidentDetectors,
    filterIncidents: incidents?.filterIncidents,
    sortIncidents: incidents?.sortIncidents,
    groupIncidents: incidents?.groupIncidents,
    calculateIncidentSummary: incidents?.calculateIncidentSummary,
    calculateLongestStreaks: incidents?.calculateLongestStreaks,
    calculateMaxStatusDrops: incidents?.calculateMaxStatusDrops,
    calculateSessionIncidentSummary: incidents?.calculateSessionIncidentSummary,
    countInvalidSourceReferences: incidents?.countInvalidSourceReferences,
    DEFAULT_INCIDENT_OPTIONS: incidents?.DEFAULT_INCIDENT_OPTIONS,
    INCIDENT_CATEGORIES: incidents?.INCIDENT_CATEGORIES,
    registerFilterPredicate, listFilterPredicates
  };
});
