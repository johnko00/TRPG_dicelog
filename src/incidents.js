/* Pure, derived Dice Incident Book detectors. No DOM or IndexedDB dependency. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./identity.js'));
  else root.TRPGIncidents = factory(root.TRPGIdentity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identity) {
  const SUCCESS_RESULTS = ['critical', 'special', 'success', 'hard', 'hardSuccess', 'extreme', 'extremeSuccess'];
  const FAILURE_RESULTS = ['failure', 'fumble'];
  const CLASSIFIED_RESULTS = [...SUCCESS_RESULTS, ...FAILURE_RESULTS];
  const INCIDENT_CATEGORIES = Object.freeze({ roll: 'roll', margin: 'margin', sequence: 'sequence', skill: 'skill', status: 'status' });
  const DEFAULT_INCIDENT_OPTIONS = Object.freeze({
    closeSuccessMargin: 2,
    lowTargetSuccess: 25,
    highRollSuccess: 90,
    highTargetFailure: 80,
    lowRollFailure: 10,
    successStreak: 5,
    failureStreak: 4,
    criticalStreak: 2,
    fumbleStreak: 2,
    rareSkillUsage: 3,
    sanDrop: 5,
    hpDrop: 3
  });

  function list(value) { return Array.isArray(value) ? value : []; }
  function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function resultOf(roll) {
    const result = text(roll?.result || roll?.normalizedResult).toLowerCase();
    if (result === 'hardsuccess') return 'hard';
    if (result === 'extremesuccess') return 'extreme';
    return result;
  }
  function isSuccess(result) { return SUCCESS_RESULTS.includes(result); }
  function isFailure(result) { return FAILURE_RESULTS.includes(result); }
  function isClassified(result) { return CLASSIFIED_RESULTS.includes(result); }
  function sourceKeyOf(roll) { return text(roll?.sourceKey || roll?.sourceRollKey || roll?.id || roll?.sourceMessageKey); }
  function sourceStatusKey(status) { return text(status?.id || status?.statusChangeId); }
  function sessionOf(context, sessionId) { return context?.sessionMap?.get(sessionId) || list(context?.sessions).find(item => item.id === sessionId) || null; }
  function sessionTitle(context, sessionId) { const session = sessionOf(context, sessionId); return session?.title || session?.name || session?.id || ''; }
  function sessionDate(context, sessionId) { return sessionOf(context, sessionId)?.dateStart || null; }
  function marginOf(roll) {
    if (!roll?.isJudgement) return null;
    const target = numeric(roll.targetValue), rolled = numeric(roll.rolledValue);
    return target === null || rolled === null ? null : target - rolled;
  }
  function skillKeyOf(roll) {
    return text(roll?.skillCanonical || roll?.skillRaw).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
  }
  function skillDisplayOf(roll) { return text(roll?.skillRaw || roll?.skillCanonical); }
  function orderOf(roll, fallback) {
    const value = numeric(roll?.sequenceInSession ?? roll?.sequence ?? roll?.parentSequence);
    return value === null ? fallback : value;
  }
  function identityKeyOf(roll) {
    if (roll?.pcId) return `pc:${roll.pcId}`;
    if (roll?.plId && roll?.role) return `${String(roll.role).toUpperCase()}:pl:${roll.plId}`;
    const role = text(roll?.role).toUpperCase();
    const speaker = text(roll?.normalizedSpeaker || roll?.rawSpeaker).normalize('NFKC');
    if (speaker && role) return `${role}:speaker:${speaker}`;
    if (speaker && speaker.toLowerCase() !== 'unknown') return `speaker:${speaker}`;
    return null;
  }
  function stableId(detectorId, sourceKeys, evidenceKey) {
    const keys = list(sourceKeys).map(text).filter(Boolean);
    const raw = `${detectorId}\u241f${keys.join('\u241e')}\u241f${text(evidenceKey)}`;
    return `incident:${identity.stableHash(raw)}`;
  }
  function visibleRolls(context) {
    return list(context?.resolvedRolls || context?.rolls).filter(roll => !roll.analysisExcluded);
  }
  function normalizeOptions(options) { return { ...DEFAULT_INCIDENT_OPTIONS, ...(options || {}) }; }
  function baseIncident(detectorId, category, roll, context, values) {
    const sourceKey = sourceKeyOf(roll);
    const sourceRollKeys = sourceKey ? [sourceKey] : [];
    const fields = values || {};
    const incident = {
      id: stableId(detectorId, sourceRollKeys, fields.evidenceKey),
      detectorId, category, severity: fields.severity || 'normal',
      title: fields.title || '', description: fields.description || '',
      sessionId: roll?.sessionId || fields.sessionId || null,
      sessionTitle: roll?.sessionId ? sessionTitle(context, roll.sessionId) : (fields.sessionTitle || ''),
      sessionDate: roll?.sessionId ? sessionDate(context, roll.sessionId) : (fields.sessionDate || null),
      sourceRollKeys, statusChangeIds: [],
      pcId: roll?.pcId || null, plId: roll?.plId || null, role: roll?.role || null,
      skillKey: skillKeyOf(roll) || null, skillDisplayName: skillDisplayOf(roll) || null,
      targetValue: numeric(roll?.targetValue), rolledValue: numeric(roll?.rolledValue),
      result: resultOf(roll) || null, margin: marginOf(roll),
      evidence: fields.evidence || {},
      sortKey: fields.sortKey || `${roll?.sessionId || ''}:${String(orderOf(roll, 0)).padStart(10, '0')}`
    };
    if (fields.sourceRollKeys) incident.sourceRollKeys = list(fields.sourceRollKeys).map(text).filter(Boolean);
    if (fields.statusChangeIds) incident.statusChangeIds = list(fields.statusChangeIds).map(text).filter(Boolean);
    if (fields.sessionId) incident.sessionId = fields.sessionId;
    if (fields.pcId !== undefined) incident.pcId = fields.pcId;
    if (fields.plId !== undefined) incident.plId = fields.plId;
    if (fields.role !== undefined) incident.role = fields.role;
    if (fields.skillKey !== undefined) incident.skillKey = fields.skillKey;
    if (fields.skillDisplayName !== undefined) incident.skillDisplayName = fields.skillDisplayName;
    return incident;
  }
  function normalizeDetectorResult(value, detector) {
    return list(Array.isArray(value) ? value : value ? [value] : []).map(item => {
      const sourceKeys = list(item.sourceRollKeys).map(text).filter(Boolean);
      const statusIds = list(item.statusChangeIds).map(text).filter(Boolean);
      const id = item.id || stableId(detector.id, sourceKeys.length ? sourceKeys : statusIds, item.evidenceKey);
      return { ...item, id, detectorId: item.detectorId || detector.id, category: item.category || detector.category || 'roll', sourceRollKeys: sourceKeys, statusChangeIds: statusIds, evidence: item.evidence && typeof item.evidence === 'object' ? item.evidence : {} };
    });
  }

  const detectors = new Map();
  function registerIncidentDetector(detector) {
    if (!detector?.id || typeof detector.detect !== 'function') throw new TypeError('incident detector requires id and detect');
    const normalized = { category: INCIDENT_CATEGORIES.roll, minimumSampleSize: 0, severity: 'normal', ...detector };
    detectors.set(normalized.id, normalized);
    return normalized;
  }
  function getIncidentDetector(id) { return detectors.get(id) || null; }
  function listIncidentDetectors() { return [...detectors.values()].map(detector => ({ ...detector })); }

  function singleRollDetector(id, title, category, predicate, evidence, severity) {
    return registerIncidentDetector({ id, title, category, severity: severity || 'normal', minimumSampleSize: 1, detect(context, options) {
      const rolls = visibleRolls(context);
      return rolls.filter(roll => predicate(roll, options)).map(roll => baseIncident(id, category, roll, context, { title, severity: severity || 'normal', evidence: evidence(roll, options), description: title }));
    } });
  }
  singleRollDetector('exact-1', '🎯 出目1', INCIDENT_CATEGORIES.roll, roll => Boolean(roll.isJudgement) && numeric(roll.rolledValue) === 1, roll => ({ rolledValue: numeric(roll.rolledValue), result: resultOf(roll) }), 'notable');
  singleRollDetector('exact-100', '💥 出目100', INCIDENT_CATEGORIES.roll, roll => Boolean(roll.isJudgement) && numeric(roll.rolledValue) === 100, roll => ({ rolledValue: numeric(roll.rolledValue), result: resultOf(roll) }), 'notable');
  singleRollDetector('critical', '✨ Critical', INCIDENT_CATEGORIES.roll, roll => Boolean(roll.isJudgement) && resultOf(roll) === 'critical', roll => ({ result: resultOf(roll) }), 'notable');
  singleRollDetector('fumble', '💀 Fumble', INCIDENT_CATEGORIES.roll, roll => Boolean(roll.isJudgement) && resultOf(roll) === 'fumble', roll => ({ result: resultOf(roll) }), 'notable');

  registerIncidentDetector({ id: 'close-failure', title: 'あと1だった', category: INCIDENT_CATEGORIES.margin, minimumSampleSize: 1, detect(context, options) {
    const threshold = Number(options.closeSuccessMargin);
      return visibleRolls(context).filter(roll => roll.isJudgement && resultOf(roll) === 'failure' && marginOf(roll) === -1).map(roll => baseIncident('close-failure', 'margin', roll, context, { title: 'あと1だった', evidence: { margin: -1, threshold, result: resultOf(roll) }, description: '失敗したが目標値まであと1' }));
  } });
  registerIncidentDetector({ id: 'close-success', title: 'ギリギリ成功', category: INCIDENT_CATEGORIES.margin, minimumSampleSize: 1, detect(context, options) {
    const threshold = Number(options.closeSuccessMargin);
    return visibleRolls(context).filter(roll => roll.isJudgement && ['success', 'special', 'hard', 'extreme'].includes(resultOf(roll)) && marginOf(roll) !== null && marginOf(roll) >= 0 && marginOf(roll) <= threshold).map(roll => baseIncident('close-success', 'margin', roll, context, { title: 'ギリギリ成功', evidence: { margin: marginOf(roll), threshold, result: resultOf(roll) }, description: '成功したが余裕がわずか' }));
  } });
  function thresholdDetector(id, title, predicate, evidence, severity) {
    registerIncidentDetector({ id, title, category: INCIDENT_CATEGORIES.roll, minimumSampleSize: 1, severity: severity || 'normal', detect(context, options) {
      return visibleRolls(context).filter(roll => roll.isJudgement && predicate(roll, options)).map(roll => baseIncident(id, 'roll', roll, context, { title, severity: severity || 'normal', evidence: evidence(roll, options), description: title }));
    } });
  }
  thresholdDetector('low-target-success', '低技能値を突破', (roll, o) => isSuccess(resultOf(roll)) && numeric(roll.targetValue) !== null && numeric(roll.targetValue) <= Number(o.lowTargetSuccess), (roll, o) => ({ targetValue: numeric(roll.targetValue), rolledValue: numeric(roll.rolledValue), result: resultOf(roll), threshold: Number(o.lowTargetSuccess) }), 'notable');
  thresholdDetector('high-roll-success', '高い出目で成功', (roll, o) => isSuccess(resultOf(roll)) && numeric(roll.rolledValue) !== null && numeric(roll.rolledValue) >= Number(o.highRollSuccess), (roll, o) => ({ rolledValue: numeric(roll.rolledValue), targetValue: numeric(roll.targetValue), result: resultOf(roll), threshold: Number(o.highRollSuccess) }), 'notable');
  thresholdDetector('high-target-failure', 'まさかの失敗', (roll, o) => resultOf(roll) === 'failure' && numeric(roll.targetValue) !== null && numeric(roll.targetValue) >= Number(o.highTargetFailure), (roll, o) => ({ targetValue: numeric(roll.targetValue), rolledValue: numeric(roll.rolledValue), result: resultOf(roll), threshold: Number(o.highTargetFailure) }), 'notable');
  thresholdDetector('low-roll-failure', 'その出目で失敗？', (roll, o) => resultOf(roll) === 'failure' && numeric(roll.rolledValue) !== null && numeric(roll.rolledValue) <= Number(o.lowRollFailure), (roll, o) => ({ rolledValue: numeric(roll.rolledValue), targetValue: numeric(roll.targetValue), result: resultOf(roll), threshold: Number(o.lowRollFailure) }), 'notable');

  function buildSequenceSource(context) {
    const source = context?.analysisSource || context || {};
    const rolls = visibleRolls(source);
    const allowedSessions = new Set(list(context?.sessions || source.sessions).map(session => session.id));
    const filteredKeys = new Set(visibleRolls(context).map(sourceKeyOf));
    const groups = new Map();
    rolls.forEach((roll, index) => {
      // Keep unknown judgements as separators. They must not be silently
      // removed, otherwise two distant classified rolls become a false streak.
      if (!roll.isJudgement) return;
      if (allowedSessions.size && !allowedSessions.has(roll.sessionId)) return;
      const participant = identityKeyOf(roll);
      if (!participant || !roll.sessionId) return;
      const key = `${roll.sessionId}\u241f${participant}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ roll, index, order: orderOf(roll, index) });
    });
    groups.forEach(items => items.sort((a, b) => a.order - b.order || a.index - b.index || sourceKeyOf(a.roll).localeCompare(sourceKeyOf(b.roll))));
    return { groups, filteredKeys };
  }
  function sequenceIncident(id, title, items, context, extra) {
    const rolls = items.map(item => item.roll);
    const first = rolls[0] || {};
    const sourceRollKeys = rolls.map(sourceKeyOf).filter(Boolean);
    const evidence = { ...(extra?.evidence || {}), sourceRollKeys, startSequence: orderOf(first, 0), endSequence: orderOf(rolls[rolls.length - 1], rolls.length - 1) };
    return baseIncident(id, 'sequence', first, context, { ...extra, title, sourceRollKeys, evidence, severity: extra?.severity || 'notable', sessionId: first.sessionId, sortKey: `${first.sessionId || ''}:${String(orderOf(first, 0)).padStart(10, '0')}` });
  }
  function eligibleSequenceItems(items, filteredKeys) {
    if (!filteredKeys.size) return items;
    return items.every(item => filteredKeys.has(sourceKeyOf(item.roll))) ? items : [];
  }
  function streakDetector(id, title, result, thresholdOption, context, options) {
    const { groups, filteredKeys } = buildSequenceSource(context);
    const threshold = Number(options[thresholdOption]);
    const incidents = [];
    groups.forEach(items => {
      let run = [];
      const flush = () => {
        if (run.length >= threshold) {
          const eligible = eligibleSequenceItems(run, filteredKeys);
          if (eligible.length) incidents.push(sequenceIncident(id, title.replace('{n}', String(eligible.length)), eligible, context, { severity: eligible.length >= threshold + 2 ? 'rare' : 'notable', evidence: { streakLength: eligible.length, result } }));
        }
        run = [];
      };
      items.forEach(item => { if (resultOf(item.roll) === result) run.push(item); else flush(); });
      flush();
    });
    return incidents;
  }
  registerIncidentDetector({ id: 'success-streak', title: '連続成功', category: 'sequence', minimumSampleSize: 5, detect(context, options) { return streakDetector('success-streak', '{n}連続成功', 'success-family', 'successStreak', context, options); } });
  // A result family is used by the sequence implementation while preserving exact result in evidence.
  function familyStreak(id, title, family, thresholdOption, context, options) {
    const { groups, filteredKeys } = buildSequenceSource(context);
    const threshold = Number(options[thresholdOption]);
    const incidents = [];
    groups.forEach(items => {
      let run = [];
      const belongs = roll => family === 'success-family' ? isSuccess(resultOf(roll)) : family === 'failure-family' ? isFailure(resultOf(roll)) : resultOf(roll) === family;
      const flush = () => {
        if (run.length >= threshold) {
          const eligible = eligibleSequenceItems(run, filteredKeys);
          if (eligible.length) incidents.push(sequenceIncident(id, title.replace('{n}', String(eligible.length)), eligible, context, { severity: family === 'critical' || family === 'fumble' ? 'rare' : 'notable', evidence: { streakLength: eligible.length, resultFamily: family } }));
        }
        run = [];
      };
      items.forEach(item => { if (belongs(item.roll)) run.push(item); else flush(); });
      flush();
    });
    return incidents;
  }
  detectors.get('success-streak').detect = (context, options) => familyStreak('success-streak', '{n}連続成功', 'success-family', 'successStreak', context, options);
  registerIncidentDetector({ id: 'failure-streak', title: '連続失敗', category: 'sequence', minimumSampleSize: 4, detect(context, options) { return familyStreak('failure-streak', '{n}連続失敗', 'failure-family', 'failureStreak', context, options); } });
  registerIncidentDetector({ id: 'critical-streak', title: 'Critical連続', category: 'sequence', minimumSampleSize: 2, detect(context, options) { return familyStreak('critical-streak', '{n}連続Critical', 'critical', 'criticalStreak', context, options); } });
  registerIncidentDetector({ id: 'fumble-streak', title: 'Fumble連続', category: 'sequence', minimumSampleSize: 2, detect(context, options) { return familyStreak('fumble-streak', '{n}連続Fumble', 'fumble', 'fumbleStreak', context, options); } });

  function transitionDetector(id, from, to, title) {
    registerIncidentDetector({ id, title, category: 'sequence', minimumSampleSize: 1, detect(context) {
      const { groups, filteredKeys } = buildSequenceSource(context); const results = [];
      groups.forEach(items => items.forEach((item, index) => {
        const next = items[index + 1]; if (!next || resultOf(item.roll) !== from || resultOf(next.roll) !== to) return;
        const eligible = eligibleSequenceItems([item, next], filteredKeys); if (eligible.length) results.push(sequenceIncident(id, title, eligible, context, { severity: 'rare', evidence: { from, to } }));
      }));
      return results;
    } });
  }
  transitionDetector('critical-to-fumble', 'critical', 'fumble', 'Critical → Fumble');
  transitionDetector('fumble-to-critical', 'fumble', 'critical', 'Fumble → Critical');

  function skillDetector(id, title, result, options) {
    registerIncidentDetector({ id, title, category: 'skill', minimumSampleSize: 1, detect(context, detectorOptions) {
      const source = detectorOptions?.referenceContext || context?.analysisSource || context;
      const usage = new Map();
      visibleRolls(source).filter(roll => roll.isJudgement && skillKeyOf(roll)).forEach(roll => usage.set(skillKeyOf(roll), (usage.get(skillKeyOf(roll)) || 0) + 1));
      const threshold = Number(detectorOptions.rareSkillUsage);
      return visibleRolls(context).filter(roll => roll.isJudgement && resultOf(roll) === result && skillKeyOf(roll) && (usage.get(skillKeyOf(roll)) || 0) <= threshold).map(roll => baseIncident(id, 'skill', roll, context, { title, severity: 'rare', evidence: { skillUsageCount: usage.get(skillKeyOf(roll)) || 0, rarityThreshold: threshold, result }, description: title }));
    } });
  }
  skillDetector('rare-skill-critical', '珍技能でCritical', 'critical');
  skillDetector('rare-skill-fumble', '珍技能でFumble', 'fumble');

  function statusDetector(id, title, statusName, thresholdOption) {
    registerIncidentDetector({ id, title, category: 'status', minimumSampleSize: 1, detect(context, options) {
      const threshold = Number(options[thresholdOption]);
      return list(context?.statusChanges).filter(status => text(status.statusName || status.stat).toUpperCase() === statusName).map(status => {
        const before = numeric(status.before), after = numeric(status.after), drop = before === null || after === null ? null : before - after;
        if (drop === null || drop < threshold) return null;
        const session = sessionOf(context, status.sessionId); const statusId = sourceStatusKey(status);
        const resolved = identity.resolveSpeaker({ rawSpeaker: status.rawSpeaker || status.speaker, sessionId: status.sessionId, mappings: context.mappings, pcs: context.pcs, pls: context.pls, sessionParticipants: context.sessionParticipants });
        return { id: stableId(id, [statusId], `${before}:${after}:${threshold}`), detectorId: id, category: 'status', severity: 'notable', title, description: title, sessionId: status.sessionId || null, sessionTitle: session?.title || session?.name || status.sessionId || '', sessionDate: session?.dateStart || null, sourceRollKeys: [], statusChangeIds: statusId ? [statusId] : [], pcId: status.pcId || resolved.pcId || null, plId: status.plId || resolved.plId || null, role: status.role || resolved.role || null, skillKey: null, skillDisplayName: null, targetValue: null, rolledValue: null, result: null, margin: null, evidence: { before, after, delta: after - before, drop, threshold, statusName }, sortKey: `${status.sessionId || ''}:${String(numeric(status.sequenceInSession) ?? 0).padStart(10, '0')}` };
      }).filter(Boolean);
    } });
  }
  statusDetector('san-drop', 'SANが大きく減少', 'SAN', 'sanDrop');
  statusDetector('hp-drop', 'HPが大きく減少', 'HP', 'hpDrop');

  function detectIncidents(context, options) {
    const source = context || {};
    const config = normalizeOptions(options);
    const incidents = []; const seen = new Set(); const errors = [];
    detectors.forEach(detector => {
      try {
        const sampleSize = Math.max(visibleRolls(source).length, list(source?.statusChanges).length);
        if (Number(detector.minimumSampleSize) > sampleSize) return;
        normalizeDetectorResult(detector.detect(source, config), detector).forEach(incident => { if (!seen.has(incident.id)) { seen.add(incident.id); incidents.push(incident); } });
      }
      catch (error) { errors.push({ detectorId: detector.id, message: error?.message || String(error) }); }
    });
    incidents.sort((a, b) => String(a.sortKey || '').localeCompare(String(b.sortKey || '')) || String(a.id).localeCompare(String(b.id)));
    Object.defineProperty(incidents, 'detectorErrors', { value: errors, enumerable: false });
    return incidents;
  }
  function filterIncidents(incidents, options) {
    const config = options || {}; const category = config.category && config.category !== 'all' ? config.category : null; const severity = config.severity && config.severity !== 'all' ? config.severity : null;
    return list(incidents).filter(incident => (!category || incident.category === category) && (!severity || incident.severity === severity));
  }
  function sortIncidents(incidents, order, context) {
    const listValue = list(incidents).slice(); const direction = order || 'newest';
    const dateValue = incident => String(incident.sessionDate || '');
    if (direction === 'most') {
      const counts = new Map(); listValue.forEach(item => counts.set(item.sessionId || '__unknown__', (counts.get(item.sessionId || '__unknown__') || 0) + 1));
      return listValue.sort((a, b) => (counts.get(b.sessionId || '__unknown__') || 0) - (counts.get(a.sessionId || '__unknown__') || 0) || dateValue(b).localeCompare(dateValue(a)) || String(a.id).localeCompare(String(b.id)));
    }
    return listValue.sort((a, b) => {
      const dateComparison = dateValue(a).localeCompare(dateValue(b));
      return (direction === 'oldest' ? dateComparison : -dateComparison) || String(a.sortKey || '').localeCompare(String(b.sortKey || ''));
    });
  }
  function groupIncidents(incidents) {
    const groups = new Map();
    list(incidents).forEach(incident => {
      if (incident.category === 'sequence' || incident.category === 'status' || incident.sourceRollKeys.length !== 1) { groups.set(`incident:${incident.id}`, { id: `incident:${incident.id}`, sourceRollKey: null, incidents: [incident], representative: incident }); return; }
      const key = `roll:${incident.sourceRollKeys[0]}`;
      if (!groups.has(key)) groups.set(key, { id: key, sourceRollKey: incident.sourceRollKeys[0], incidents: [], representative: incident });
      groups.get(key).incidents.push(incident);
    });
    return [...groups.values()].map(group => ({ ...group, tags: group.incidents.map(incident => incident.title), title: group.incidents.map(incident => incident.title).join(' / '), evidence: group.incidents.reduce((acc, incident) => ({ ...acc, ...incident.evidence }), {}) }));
  }
  function calculateIncidentSummary(incidents) {
    const rows = list(incidents); const max = detectorId => rows.filter(item => item.detectorId === detectorId).reduce((value, item) => Math.max(value, numeric(item.evidence?.streakLength) || 0), 0);
    const dropMax = detectorId => rows.filter(item => item.detectorId === detectorId).reduce((value, item) => Math.max(value, numeric(item.evidence?.drop) || 0), 0);
    return { totalIncidentCount: rows.length, criticalCount: rows.filter(item => item.detectorId === 'critical').length, fumbleCount: rows.filter(item => item.detectorId === 'fumble').length, exact1Count: rows.filter(item => item.detectorId === 'exact-1').length, exact100Count: rows.filter(item => item.detectorId === 'exact-100').length, successStreakMax: max('success-streak'), failureStreakMax: max('failure-streak'), sanDropMax: dropMax('san-drop'), hpDropMax: dropMax('hp-drop') };
  }
  function calculateLongestStreaks(incidents) {
    const summary = calculateIncidentSummary(incidents);
    return { successStreakMax: summary.successStreakMax, failureStreakMax: summary.failureStreakMax };
  }
  function calculateMaxStatusDrops(incidents) {
    if (!Array.isArray(incidents) && incidents && Array.isArray(incidents.statusChanges)) {
      const rows = incidents.statusChanges.map(status => {
        const before = numeric(status.before), after = numeric(status.after);
        return { statusName: text(status.statusName || status.stat).toUpperCase(), drop: before === null || after === null ? 0 : Math.max(0, before - after) };
      });
      return { sanDropMax: rows.filter(row => row.statusName === 'SAN').reduce((max, row) => Math.max(max, row.drop), 0), hpDropMax: rows.filter(row => row.statusName === 'HP').reduce((max, row) => Math.max(max, row.drop), 0) };
    }
    const summary = calculateIncidentSummary(incidents);
    return { sanDropMax: summary.sanDropMax, hpDropMax: summary.hpDropMax };
  }
  function calculateSessionIncidentSummary(incidents, context) {
    const map = new Map(); list(incidents).forEach(incident => { if (!map.has(incident.sessionId)) map.set(incident.sessionId, []); map.get(incident.sessionId).push(incident); });
    return [...map.entries()].map(([sessionId, rows]) => ({ sessionId, sessionTitle: sessionTitle(context, sessionId), sessionDate: sessionDate(context, sessionId), incidentCount: rows.length, summary: calculateIncidentSummary(rows), incidents: rows }));
  }
  function countInvalidSourceReferences(incidents, context) {
    const keys = new Set(visibleRolls(context).map(sourceKeyOf)); const statuses = new Set(list(context?.statusChanges).map(sourceStatusKey));
    return list(incidents).reduce((count, incident) => count + incident.sourceRollKeys.filter(key => !keys.has(key)).length + incident.statusChangeIds.filter(key => !statuses.has(key)).length, 0);
  }
  return { SUCCESS_RESULTS, FAILURE_RESULTS, INCIDENT_CATEGORIES, DEFAULT_INCIDENT_OPTIONS, registerIncidentDetector, getIncidentDetector, listIncidentDetectors, detectIncidents, filterIncidents, sortIncidents, groupIncidents, calculateIncidentSummary, calculateLongestStreaks, calculateMaxStatusDrops, calculateSessionIncidentSummary, countInvalidSourceReferences, calculateMargin: marginOf, sourceKeyOf, resultOf, isSuccess, isFailure };
});
