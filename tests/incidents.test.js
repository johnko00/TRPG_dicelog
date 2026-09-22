const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../src/analysis.js');

const sessions = [
  { id: 's1', title: 'Session one', dateStart: '2026-01-01' },
  { id: 's2', title: 'Session two', dateStart: '2026-02-01' }
];
const pcs = [{ id: 'p1', name: 'PC one', plId: 'l1' }, { id: 'p2', name: 'PC two', plId: 'l2' }];
const pls = [{ id: 'l1', name: 'PL one' }, { id: 'l2', name: 'PL two' }];
const participants = [{ sessionId: 's1', rawSpeakerNormalized: 'Alice', pcId: 'p1', plId: 'l1', role: 'PC' }, { sessionId: 's1', rawSpeakerNormalized: 'Bob', pcId: 'p2', plId: 'l2', role: 'KPC' }];
const mappings = [{ rawSpeakerNormalized: 'Alice', pcId: 'p1', plId: 'l1', scope: 'global' }, { rawSpeakerNormalized: 'Bob', pcId: 'p2', plId: 'l2', scope: 'global' }];

function roll(id, overrides = {}) {
  return { id, sourceKey: `source:${id}`, sessionId: 's1', rawSpeaker: 'Alice', pcId: 'p1', plId: 'l1', role: 'PC', sequenceInSession: Number(String(id).replace(/\D/g, '')) || 1, isJudgement: true, result: 'success', normalizedResult: 'success', targetValue: 50, rolledValue: 25, skillRaw: 'Spot Hidden', system: 'CoC6', ...overrides };
}
function context(overrides = {}) {
  return analysis.createAnalysisContext({ sessions, pcs, pls, mappings, sessionParticipants: participants, rolls: [], statusChanges: [], playGroups: [], sessionPlayGroups: [], overrides: [], ...overrides });
}
function incidentsFor(rolls, extra = {}) {
  const filtered = analysis.applyAnalysisFilter(context({ rolls, ...extra }), extra.filter || {});
  return analysis.detectIncidents(filtered, extra.options || {});
}
function detector(rows, id) { return rows.filter(item => item.detectorId === id); }

test('registry exposes the incidents module and default thresholds', () => {
  assert.equal(analysis.getAnalysisModule('incidents').id, 'incidents');
  assert.equal(analysis.DEFAULT_INCIDENT_OPTIONS.successStreak, 5);
  assert.ok(analysis.listIncidentDetectors().length >= 20);
});
test('exact 1 and exact 100 require judgement rolls', () => {
  const rows = incidentsFor([roll('r1', { rolledValue: 1 }), roll('r2', { rolledValue: 100 }), roll('r3', { isJudgement: false, rolledValue: 1 })]);
  assert.equal(detector(rows, 'exact-1').length, 1); assert.equal(detector(rows, 'exact-100').length, 1);
});
test('critical and fumble detectors use parser result', () => {
  const rows = incidentsFor([roll('r1', { result: 'critical' }), roll('r2', { result: 'fumble' }), roll('r3', { result: 'success', rolledValue: 1 })]);
  assert.equal(detector(rows, 'critical').length, 1); assert.equal(detector(rows, 'fumble').length, 1);
});
test('exact one and critical can coexist and group into one card', () => {
  const rows = incidentsFor([roll('r1', { rolledValue: 1, result: 'critical' })]);
  const group = analysis.groupIncidents(rows).find(item => item.sourceRollKey === 'source:r1');
  assert.deepEqual(new Set(group.tags), new Set(['🎯 出目1', '✨ Critical', '珍技能でCritical']));
});
test('analysisExcluded is omitted while savingsExcluded remains', () => {
  const rows = incidentsFor([roll('r1', { analysisExcluded: true }), roll('r2', { savingsExcluded: true, rolledValue: 1 })]);
  assert.equal(rows.some(item => item.sourceRollKeys.includes('source:r1')), false);
  assert.equal(rows.some(item => item.sourceRollKeys.includes('source:r2')), true);
});
test('failure margin -1 creates close failure only', () => {
  const rows = incidentsFor([roll('r1', { result: 'failure', targetValue: 50, rolledValue: 51 })]);
  assert.equal(detector(rows, 'close-failure').length, 1); assert.equal(detector(rows, 'close-success').length, 0);
});
test('success margin 0 and +2 are close successes, +3 is not', () => {
  const rows = incidentsFor([roll('r1', { targetValue: 50, rolledValue: 50 }), roll('r2', { targetValue: 50, rolledValue: 48, sequenceInSession: 2 }), roll('r3', { targetValue: 50, rolledValue: 47, sequenceInSession: 3 })]);
  assert.equal(detector(rows, 'close-success').length, 2);
});
test('margin alone never changes result family', () => {
  const rows = incidentsFor([roll('r1', { result: 'failure', targetValue: 50, rolledValue: 50 }), roll('r2', { result: 'success', targetValue: 50, rolledValue: 51, sequenceInSession: 2 })]);
  assert.equal(detector(rows, 'close-failure').length, 0); assert.equal(detector(rows, 'close-success').length, 0);
});
test('null target does not create margin incidents', () => assert.equal(incidentsFor([roll('r1', { targetValue: null, rolledValue: 51, result: 'failure' })]).filter(item => item.category === 'margin').length, 0));
test('low target success threshold is inclusive', () => {
  const rows = incidentsFor([roll('r1', { targetValue: 25 }), roll('r2', { targetValue: 26, sequenceInSession: 2 })]);
  assert.equal(detector(rows, 'low-target-success').length, 1);
});
test('high roll success threshold is inclusive', () => {
  const rows = incidentsFor([roll('r1', { rolledValue: 90 }), roll('r2', { rolledValue: 89, sequenceInSession: 2 })]);
  assert.equal(detector(rows, 'high-roll-success').length, 1);
});
test('high target failure and low roll failure thresholds are inclusive', () => {
  const rows = incidentsFor([roll('r1', { result: 'failure', targetValue: 80 }), roll('r2', { result: 'failure', rolledValue: 10, sequenceInSession: 2 })]);
  assert.equal(detector(rows, 'high-target-failure').length, 1); assert.equal(detector(rows, 'low-roll-failure').length, 1);
});
test('seven successes produce one maximal success streak', () => {
  const rows = incidentsFor(Array.from({ length: 7 }, (_, i) => roll(`r${i + 1}`, { sequenceInSession: i + 1 })));
  assert.deepEqual(detector(rows, 'success-streak').map(item => item.evidence.streakLength), [7]);
  assert.equal(detector(rows, 'success-streak')[0].sourceRollKeys.length, 7);
});
test('four successes are below default streak threshold', () => assert.equal(detector(incidentsFor(Array.from({ length: 4 }, (_, i) => roll(`r${i + 1}`, { sequenceInSession: i + 1 }))), 'success-streak').length, 0));
test('failure cuts a success streak and unknown judgement also cuts it', () => {
  const rows = incidentsFor([roll('r1'), roll('r2', { sequenceInSession: 2 }), roll('r3', { result: 'failure', sequenceInSession: 3 }), ...Array.from({ length: 5 }, (_, i) => roll(`r${i + 4}`, { sequenceInSession: i + 4 }))]);
  assert.equal(detector(rows, 'success-streak').length, 1);
  const unknown = incidentsFor([roll('r1'), roll('r2', { sequenceInSession: 2 }), roll('r3', { result: 'unknown', normalizedResult: 'unknown', sequenceInSession: 3 }), ...Array.from({ length: 5 }, (_, i) => roll(`r${i + 4}`, { sequenceInSession: i + 4 }))]);
  assert.equal(detector(unknown, 'success-streak').length, 1);
});
test('four failures produce one maximal failure streak', () => {
  const rows = incidentsFor(Array.from({ length: 4 }, (_, i) => roll(`r${i + 1}`, { result: 'failure', sequenceInSession: i + 1 })));
  assert.equal(detector(rows, 'failure-streak').length, 1);
});
test('critical and fumble streak detectors use their own thresholds', () => {
  const critical = incidentsFor([roll('r1', { result: 'critical' }), roll('r2', { result: 'critical', sequenceInSession: 2 })]);
  const fumble = incidentsFor([roll('r1', { result: 'fumble' }), roll('r2', { result: 'fumble', sequenceInSession: 2 })]);
  assert.equal(detector(critical, 'critical-streak').length, 1); assert.equal(detector(fumble, 'fumble-streak').length, 1);
});
test('critical to fumble and reverse transitions are incidents', () => {
  const rows = incidentsFor([roll('r1', { result: 'critical' }), roll('r2', { result: 'fumble', sequenceInSession: 2 }), roll('r3', { result: 'critical', sequenceInSession: 3 })]);
  assert.equal(detector(rows, 'critical-to-fumble').length, 1); assert.equal(detector(rows, 'fumble-to-critical').length, 1);
});
test('sequence is session scoped', () => {
  const rows = incidentsFor(Array.from({ length: 5 }, (_, i) => roll(`r${i + 1}`, { sessionId: i === 4 ? 's2' : 's1', sequenceInSession: i + 1 })));
  assert.equal(detector(rows, 'success-streak').length, 0);
});
test('participant sequence does not mix PCs', () => {
  const rows = incidentsFor(Array.from({ length: 5 }, (_, i) => roll(`r${i + 1}`, { rawSpeaker: i % 2 ? 'Bob' : 'Alice', pcId: i % 2 ? 'p2' : 'p1', plId: i % 2 ? 'l2' : 'l1', role: i % 2 ? 'KPC' : 'PC', sequenceInSession: i + 1 })));
  assert.equal(detector(rows, 'success-streak').length, 0);
});
test('unresolved speakers with different stable names are not merged', () => {
  const rows = incidentsFor(Array.from({ length: 5 }, (_, i) => roll(`r${i + 1}`, { rawSpeaker: `Speaker ${i}`, pcId: null, plId: null, role: null, sequenceInSession: i + 1 })));
  assert.equal(detector(rows, 'success-streak').length, 0);
});
test('sequence keeps source roll order and source keys', () => {
  const rows = incidentsFor(Array.from({ length: 5 }, (_, i) => roll(`r${i + 1}`, { sequenceInSession: i + 1 })));
  assert.deepEqual(detector(rows, 'success-streak')[0].evidence.sourceRollKeys, ['source:r1', 'source:r2', 'source:r3', 'source:r4', 'source:r5']);
});
test('analysis filter does not make separated rolls falsely adjacent', () => {
  const rows = [roll('r1', { skillRaw: 'A', sequenceInSession: 1 }), roll('r2', { result: 'failure', skillRaw: 'B', sequenceInSession: 2 }), ...Array.from({ length: 4 }, (_, i) => roll(`r${i + 3}`, { skillRaw: 'A', sequenceInSession: i + 3 }))];
  const filtered = analysis.applyAnalysisFilter(context({ rolls: rows }), { skills: ['A'] });
  assert.equal(detector(analysis.detectIncidents(filtered), 'success-streak').length, 0);
});
test('analysisExcluded rolls are removed from sequences', () => {
  const rows = Array.from({ length: 5 }, (_, i) => roll(`r${i + 1}`, { analysisExcluded: i === 2, sequenceInSession: i + 1 }));
  assert.equal(detector(incidentsFor(rows), 'success-streak').length, 0);
});
test('rare skill uses full reference context, not only display subset', () => {
  const rolls = [roll('r1', { skillRaw: 'Rare', result: 'critical' }), roll('r2', { skillRaw: 'Rare', sequenceInSession: 2 }), roll('r3', { skillRaw: 'Rare', sequenceInSession: 3 }), roll('r4', { skillRaw: 'Rare', sequenceInSession: 4 })];
  const filtered = analysis.applyAnalysisFilter(context({ rolls }), { skills: ['Rare'] });
  assert.equal(detector(analysis.detectIncidents(filtered), 'rare-skill-critical').length, 0);
  assert.equal(detector(analysis.detectIncidents(filtered, { rareSkillUsage: 4 }), 'rare-skill-critical').length, 1);
});
test('skill without a name is not rare skill', () => assert.equal(incidentsFor([roll('r1', { skillRaw: '', result: 'critical' })]).filter(item => item.category === 'skill').length, 0));
test('status SAN and HP drops use numeric thresholds', () => {
  const rows = incidentsFor([], { statusChanges: [{ id: 'san1', sessionId: 's1', statusName: 'SAN', before: 87, after: 82 }, { id: 'hp1', sessionId: 's1', statusName: 'HP', before: 10, after: 7 }] });
  assert.equal(detector(rows, 'san-drop').length, 1); assert.equal(detector(rows, 'hp-drop').length, 1);
});
test('small drops, recovery, and nonnumeric status are ignored', () => {
  const rows = incidentsFor([], { statusChanges: [{ id: 'san1', sessionId: 's1', statusName: 'SAN', before: 87, after: 83 }, { id: 'san2', sessionId: 's1', statusName: 'SAN', before: 70, after: 75 }, { id: 'hp1', sessionId: 's1', statusName: 'HP', before: 'x', after: 1 }] });
  assert.equal(rows.filter(item => item.category === 'status').length, 0);
});
test('status evidence retains before after delta and trace id', () => {
  const item = detector(incidentsFor([], { statusChanges: [{ id: 'san1', sessionId: 's1', statusName: 'SAN', before: 87, after: 79 }] }), 'san-drop')[0];
  assert.deepEqual(item.statusChangeIds, ['san1']); assert.equal(item.evidence.drop, 8); assert.equal(item.evidence.before, 87); assert.equal(item.evidence.after, 79);
});
test('summary reports counts and maxima', () => {
  const rows = incidentsFor([roll('r1', { rolledValue: 1, result: 'critical' }), ...Array.from({ length: 5 }, (_, i) => roll(`r${i + 2}`, { sequenceInSession: i + 2 }))], { statusChanges: [{ id: 'san1', sessionId: 's1', statusName: 'SAN', before: 90, after: 80 }] });
  const summary = analysis.calculateIncidentSummary(rows);
  assert.equal(summary.exact1Count, 1); assert.equal(summary.criticalCount, 1); assert.equal(summary.successStreakMax, 6); assert.equal(summary.sanDropMax, 10);
});
test('deterministic ID is stable across detection runs', () => {
  const rolls = [roll('r1', { result: 'critical' })];
  assert.equal(incidentsFor(rolls)[0].id, incidentsFor(rolls)[0].id);
});
test('duplicate detector output is deduplicated by deterministic id', () => {
  const id = 'custom-dedupe'; analysis.registerIncidentDetector({ id, category: 'roll', detect: ctx => [{ detectorId: id, sourceRollKeys: ['source:r1'], title: 'x' }, { detectorId: id, sourceRollKeys: ['source:r1'], title: 'x' }] });
  const rows = incidentsFor([roll('r1')]); assert.equal(rows.filter(item => item.detectorId === id).length, 1);
});
test('custom detector can be registered and retrieved', () => {
  const detectorId = 'custom-test'; const registered = analysis.registerIncidentDetector({ id: detectorId, category: 'roll', detect: () => [] });
  assert.equal(analysis.getIncidentDetector(detectorId).id, registered.id); assert.ok(analysis.listIncidentDetectors().some(item => item.id === detectorId));
});
test('detector exception is isolated and reported on result metadata', () => {
  const detectorId = 'custom-error'; analysis.registerIncidentDetector({ id: detectorId, detect: () => { throw new Error('expected'); } });
  const rows = incidentsFor([]); assert.ok(rows.detectorErrors.some(error => error.detectorId === detectorId));
});
test('grouping leaves sequence and status incidents as separate cards', () => {
  const rows = incidentsFor([roll('r1', { result: 'critical' }), roll('r2', { result: 'critical', sequenceInSession: 2 })], { statusChanges: [{ id: 'san1', sessionId: 's1', statusName: 'SAN', before: 20, after: 10 }] });
  const groups = analysis.groupIncidents(rows); assert.ok(groups.some(group => group.representative.category === 'sequence')); assert.ok(groups.some(group => group.representative.category === 'status'));
});
test('category and severity filters are display filters', () => {
  const rows = incidentsFor([roll('r1', { result: 'critical', rolledValue: 1 })]);
  assert.ok(analysis.filterIncidents(rows, { category: 'roll' }).every(item => item.category === 'roll'));
  assert.ok(analysis.filterIncidents(rows, { severity: 'notable' }).every(item => item.severity === 'notable'));
});
test('session summaries retain same-title sessions by id', () => {
  const rows = incidentsFor([roll('r1', { result: 'critical' })]); const summaries = analysis.calculateSessionIncidentSummary(rows, context({ rolls: [roll('r1', { result: 'critical' })] }));
  const summary = summaries.find(item => item.sessionId === 's1');
  assert.equal(summary.sessionId, 's1'); assert.equal(summary.incidentCount, rows.filter(item => item.sessionId === 's1').length);
});
test('invalid source reference helper catches missing roll and status keys', () => {
  const ctx = context({ rolls: [roll('r1')], statusChanges: [{ id: 's1', sessionId: 's1' }] });
  assert.equal(analysis.countInvalidSourceReferences([{ sourceRollKeys: ['missing'], statusChangeIds: ['none'] }], ctx), 2);
});
