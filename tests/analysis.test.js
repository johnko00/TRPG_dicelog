const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../src/analysis.js');
const dashboard = require('../src/dashboard.js');

const sessions = [
  { id: 's-a', title: '同じ卓', dateStart: '2026-01-15' },
  { id: 's-b', title: '同じ卓', dateStart: '2026-02-15' },
  { id: 's-undated', title: '日付なし', dateStart: null }
];
const pcs = [{ id: 'pc-a', name: 'PC A', plId: 'pl-a' }, { id: 'pc-b', name: 'PC B', plId: 'pl-b' }];
const pls = [{ id: 'pl-a', name: 'PL A' }, { id: 'pl-b', name: 'PL B' }];
const mappings = [
  { id: 'map-a', rawSpeakerNormalized: 'Alice', pcId: 'pc-a', plId: 'pl-a', scope: 'global' },
  { id: 'map-b', rawSpeakerNormalized: 'Bob', pcId: 'pc-b', plId: 'pl-b', scope: 'global' }
];
const participants = [
  { id: 'part-a', sessionId: 's-a', rawSpeakerNormalized: 'Alice', pcId: 'pc-a', plId: 'pl-a', role: 'PC' },
  { id: 'part-b', sessionId: 's-a', rawSpeakerNormalized: 'Bob', pcId: 'pc-b', plId: 'pl-b', role: 'KPC' },
  { id: 'part-gm', sessionId: 's-b', rawSpeakerNormalized: 'GM', role: 'GM' }
];
function roll(id, overrides = {}) {
  return { id, sourceKey: 'source:' + id, sessionId: 's-a', rawSpeaker: 'Alice', isJudgement: true, result: 'success', system: 'CoC6', skillRaw: 'Spot Hidden', rolledValue: 20, ...overrides };
}
function makeContext(extra = {}) {
  return analysis.createAnalysisContext({
    sessions, pcs, pls, mappings, sessionParticipants: participants,
    rolls: [roll('r-a'), roll('r-b', { rawSpeaker: 'Bob', result: 'critical', rolledValue: 1 }), roll('r-c', { sessionId: 's-b', rawSpeaker: 'GM', result: 'failure', system: 'CoC7', skillRaw: 'Listen', rolledValue: 90 }), roll('r-d', { sessionId: 's-a', isJudgement: false, result: 'unknown', system: 'unknown', skillRaw: '' })],
    statusChanges: [{ id: 'status-a', sessionId: 's-a' }],
    playGroups: [{ id: 'g-a', name: 'Group A' }, { id: 'g-b', name: 'Group B' }],
    sessionPlayGroups: [{ id: 'rel-a', sessionId: 's-a', playGroupId: 'g-a' }, { id: 'rel-b', sessionId: 's-a', playGroupId: 'g-b' }],
    overrides: [],
    ...extra
  });
}

test('analysis context applies identity and keeps raw data', () => {
  const context = makeContext();
  assert.equal(context.rawRolls.length, 4);
  assert.equal(context.resolvedRolls.find(item => item.id === 'r-a').pcId, 'pc-a');
  assert.equal(context.resolvedRolls.find(item => item.id === 'r-a').plId, 'pl-a');
  assert.equal(context.resolvedRolls.find(item => item.id === 'r-a').role, 'PC');
  assert.equal(context.sessionMap.get('s-a').title, '同じ卓');
});

test('analysisExcluded is centralized while raw roll remains available', () => {
  const context = makeContext({ overrides: [{ sourceKey: 'source:r-a', analysisExcluded: true, savingsExcluded: false }] });
  assert.equal(context.rawRolls.length, 4);
  assert.equal(analysis.applyAnalysisFilter(context, {}).resolvedRolls.some(item => item.id === 'r-a'), false);
});

test('savingsExcluded alone does not remove an analysis roll', () => {
  const context = makeContext({ overrides: [{ sourceKey: 'source:r-a', analysisExcluded: false, savingsExcluded: true }] });
  assert.equal(analysis.applyAnalysisFilter(context, {}).resolvedRolls.some(item => item.id === 'r-a'), true);
});

test('nonjudgement rolls stay in filtered context but not basic judgement stats', () => {
  const context = analysis.applyAnalysisFilter(makeContext(), {});
  assert.equal(context.resolvedRolls.some(item => item.id === 'r-d'), true);
  assert.equal(analysis.calculateBasicStats(context).judgementCount, 3);
});

test('unknown judgement rolls stay in context and are outside classified stats', () => {
  const context = makeContext({ rolls: [roll('unknown', { result: 'unknown', rolledValue: 42 })] });
  const stats = analysis.calculateBasicStats(analysis.applyAnalysisFilter(context, {}));
  assert.equal(stats.judgementCount, 1);
  assert.equal(stats.classifiedJudgementCount, 0);
  assert.equal(stats.unknownJudgementCount, 1);
});

test('zero, one, and multiple group relations are represented', () => {
  const context = makeContext({ sessionPlayGroups: [{ sessionId: 's-a', playGroupId: 'g-a' }] });
  assert.deepEqual(analysis.getSessionGroupIds(context, 's-a'), ['g-a']);
  assert.deepEqual(analysis.getSessionGroupIds(context, 's-b'), []);
});

test('duplicate session-group relations are removed by helper', () => {
  const relations = analysis.dedupeSessionPlayGroups([{ sessionId: 's-a', playGroupId: 'g-a', id: '1' }, { sessionId: 's-a', playGroupId: 'g-a', id: '2' }, { sessionId: 's-a', playGroupId: 'g-b', id: '3' }]);
  assert.equal(relations.length, 2);
  assert.deepEqual(relations.map(item => item.playGroupId), ['g-a', 'g-b']);
});

test('removing a play group removes relations only', () => {
  const context = makeContext();
  const relations = analysis.removePlayGroupRelations(context.sessionPlayGroups, 'g-a');
  assert.equal(relations.length, 1);
  assert.equal(context.sessions.length, 3);
  assert.equal(context.resolvedRolls.length, 4);
});

test('ungrouped filter selects only sessions without relations', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { playGroupIds: [analysis.UNGROUPED] });
  assert.deepEqual(filtered.sessions.map(session => session.id), ['s-b', 's-undated']);
});

test('group and ungrouped filter is OR within one dimension', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { playGroupIds: ['g-a', analysis.UNGROUPED] });
  assert.deepEqual(new Set(filtered.sessions.map(session => session.id)), new Set(['s-a', 's-b', 's-undated']));
});

test('multi-group session is not treated as ungrouped', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { playGroupIds: [analysis.UNGROUPED] });
  assert.equal(filtered.sessions.some(session => session.id === 's-a'), false);
});

test('multiple selected groups are OR', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { playGroupIds: ['g-a', 'g-b'] });
  assert.equal(filtered.sessions.length, 1);
  assert.equal(filtered.sessions[0].id, 's-a');
});

test('date filter from only is inclusive and timezone safe', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { dateRange: { from: '2026-01-15' } });
  assert.deepEqual(filtered.sessions.map(session => session.id), ['s-a', 's-b']);
  assert.equal(analysis.dateKey('2026-01-15T00:30:00+09:00'), '2026-01-15');
});

test('date filter to only is inclusive', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { dateRange: { to: '2026-01-15' } });
  assert.deepEqual(filtered.sessions.map(session => session.id), ['s-a']);
});

test('date filter from and to are both inclusive', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { dateRange: { from: '2026-01-15', to: '2026-01-15' } });
  assert.deepEqual(filtered.sessions.map(session => session.id), ['s-a']);
});

test('undated session is excluded only when date filter is specified', () => {
  assert.equal(analysis.applyAnalysisFilter(makeContext(), {}).sessions.some(session => session.id === 's-undated'), true);
  assert.equal(analysis.applyAnalysisFilter(makeContext(), { dateRange: { from: '2026-01-01' } }).sessions.some(session => session.id === 's-undated'), false);
});

test('PL filter uses resolved canonical PL id', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { plIds: ['pl-b'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-b']);
});

test('PC filter uses canonical PC id despite raw alias', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { pcIds: ['pc-a'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-a', 'r-d']);
});

test('unresolved speakers remain in overall analysis', () => {
  const context = makeContext({ rolls: [roll('unresolved', { rawSpeaker: 'Unknown', pcId: null, plId: null })] });
  assert.equal(analysis.applyAnalysisFilter(context, {}).resolvedRolls.length, 1);
  assert.equal(analysis.applyAnalysisFilter(context, { pcIds: ['pc-a'] }).resolvedRolls.length, 0);
});

test('PC role filter selects PC only', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { roles: ['PC'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-a', 'r-d']);
});

test('KPC role filter selects KPC only without automatic exclusion', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { roles: ['KPC'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-b']);
});

test('GM role filter selects GM only', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { roles: ['GM'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-c']);
});

test('PC and KPC roles are OR within the role dimension', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { roles: ['PC', 'KPC'] });
  assert.deepEqual(new Set(filtered.resolvedRolls.map(rollItem => rollItem.id)), new Set(['r-a', 'r-b', 'r-d']));
});

test('analysis override false restores a previously excluded roll', () => {
  const context = makeContext({ overrides: [{ sourceKey: 'source:r-a', analysisExcluded: true }] });
  assert.equal(analysis.applyAnalysisFilter(context, {}).resolvedRolls.some(item => item.id === 'r-a'), false);
  const restored = makeContext({ overrides: [{ sourceKey: 'source:r-a', analysisExcluded: false }] });
  assert.equal(analysis.applyAnalysisFilter(restored, {}).resolvedRolls.some(item => item.id === 'r-a'), true);
});

test('CoC6 system filter', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { systems: ['CoC6'] });
  assert.deepEqual(new Set(filtered.resolvedRolls.map(rollItem => rollItem.id)), new Set(['r-a', 'r-b']));
});

test('CoC7 system filter', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { systems: ['CoC7'] });
  assert.deepEqual(filtered.resolvedRolls.map(rollItem => rollItem.id), ['r-c']);
});

test('unknown system is not guessed into CoC6 or CoC7', () => {
  const context = makeContext({ rolls: [roll('unknown-system', { system: 'unknown' })] });
  assert.deepEqual(analysis.applyAnalysisFilter(context, { systems: ['unknown'] }).resolvedRolls.map(item => item.id), ['unknown-system']);
  assert.equal(analysis.applyAnalysisFilter(context, { systems: ['CoC6'] }).resolvedRolls.length, 0);
});

test('skill filter supports raw skill names', () => {
  assert.deepEqual(analysis.applyAnalysisFilter(makeContext(), { skills: ['Spot Hidden'] }).resolvedRolls.map(item => item.id), ['r-a', 'r-b']);
});

test('skill category filter remains explicit and does not guess missing categories', () => {
  const context = makeContext({ rolls: [roll('categorized', { skillCategory: '探索' }), roll('uncategorized')] });
  assert.deepEqual(analysis.applyAnalysisFilter(context, { skillCategories: ['探索'] }).resolvedRolls.map(item => item.id), ['categorized']);
  assert.equal(analysis.applyAnalysisFilter(context, { skillCategories: ['戦闘'] }).resolvedRolls.length, 0);
});

test('sessionIds filter keeps same-title sessions independently', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { sessionIds: ['s-b'] });
  assert.deepEqual(filtered.sessions.map(session => session.id), ['s-b']);
  assert.deepEqual(filtered.resolvedRolls.map(item => item.id), ['r-c']);
});

test('judgementOnly filter removes nonjudgement rolls', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { judgementOnly: true });
  assert.equal(filtered.resolvedRolls.some(item => item.id === 'r-d'), false);
});

test('filter dimensions combine with AND', () => {
  const filtered = analysis.applyAnalysisFilter(makeContext(), { playGroupIds: ['g-a'], roles: ['KPC'] });
  assert.deepEqual(filtered.resolvedRolls.map(item => item.id), ['r-b']);
});

test('group change changes filter membership without rewriting rolls', () => {
  const before = makeContext({ sessionPlayGroups: [{ sessionId: 's-a', playGroupId: 'g-a' }] });
  const after = makeContext({ sessionPlayGroups: [{ sessionId: 's-a', playGroupId: 'g-b' }] });
  assert.equal(analysis.applyAnalysisFilter(before, { playGroupIds: ['g-a'] }).resolvedRolls.length, 3);
  assert.equal(analysis.applyAnalysisFilter(after, { playGroupIds: ['g-a'] }).resolvedRolls.length, 0);
  assert.equal(before.rawRolls[0].sessionId, after.rawRolls[0].sessionId);
});

test('changing analysis group membership does not change confirmed ledger balance', () => {
  const ledger = [{ id: 'ledger', type: 'saving', amount: 700, date: '2026-01-15', sessionId: 's-a' }];
  assert.equal(dashboard.calculateBalance(ledger), 700);
  assert.equal(dashboard.calculateBalance(ledger), 700);
});

test('applyAnalysisFilter does not mutate the source context', () => {
  const context = makeContext();
  const original = JSON.stringify(context.rawRolls);
  const filtered = analysis.applyAnalysisFilter(context, { roles: ['PC'] });
  assert.equal(JSON.stringify(context.rawRolls), original);
  assert.notEqual(filtered, context);
});

test('two filters can be applied independently to the same context', () => {
  const context = makeContext();
  const a = analysis.applyAnalysisFilter(context, { roles: ['PC'] });
  const b = analysis.applyAnalysisFilter(context, { roles: ['KPC'] });
  assert.deepEqual(a.resolvedRolls.map(item => item.id), ['r-a', 'r-d']);
  assert.deepEqual(b.resolvedRolls.map(item => item.id), ['r-b']);
});

test('critical counts as success', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'critical' })] }).success, 1));
test('special counts as success', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'special' })] }).success, 1));
test('success counts as success', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'success' })] }).success, 1));
test('hard counts as success', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'hard' })] }).success, 1));
test('extreme counts as success', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'extreme' })] }).success, 1));
test('failure counts as failure', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'failure' })] }).failure, 1));
test('fumble counts as failure', () => assert.equal(analysis.calculateBasicStats({ rolls: [roll('r', { result: 'fumble' })] }).failure, 1));

test('unknown is outside the success-rate denominator', () => {
  const stats = analysis.calculateBasicStats({ rolls: [roll('a', { result: 'success' }), roll('b', { result: 'unknown' })] });
  assert.equal(stats.classifiedJudgementCount, 1);
  assert.equal(stats.successRateDenominator, 1);
});

test('nonjudgement is outside the success-rate denominator', () => {
  const stats = analysis.calculateBasicStats({ rolls: [roll('a', { isJudgement: false, result: 'unknown' })] });
  assert.equal(stats.judgementCount, 0);
  assert.equal(stats.rollCount, 1);
});

test('average roll sample is independent from classified judgement sample', () => {
  const stats = analysis.calculateBasicStats({ rolls: [roll('a', { result: 'success', rolledValue: 20 }), roll('b', { result: 'unknown', rolledValue: 80 }), roll('c', { result: 'failure', rolledValue: null })] });
  assert.equal(stats.classifiedJudgementCount, 2);
  assert.equal(stats.averageRollSampleCount, 2);
  assert.equal(stats.averageRoll, 50);
});

test('dimensions expose PL PC session and play group counts', () => {
  const dimensions = analysis.buildAnalysisDimensions(makeContext());
  assert.ok(dimensions.pls.some(item => item.id === 'pl-a'));
  assert.ok(dimensions.pcs.some(item => item.id === 'pc-a'));
  assert.ok(dimensions.sessions.some(item => item.id === 's-a'));
  assert.ok(dimensions.playGroups.some(item => item.id === 'g-a'));
});

test('dimensions expose roles, systems, skills, and ungrouped option', () => {
  const dimensions = analysis.buildAnalysisDimensions(makeContext());
  assert.deepEqual(dimensions.roles, ['PC', 'KPC', 'GM']);
  assert.ok(dimensions.systems.some(item => item.value === 'CoC6'));
  assert.ok(dimensions.systems.some(item => item.value === 'CoC7'));
  assert.ok(dimensions.skills.some(item => item.value === 'Spot Hidden'));
  assert.equal(dimensions.ungroupedValue, analysis.UNGROUPED);
  assert.ok(dimensions.playGroups.some(item => item.id === analysis.UNGROUPED));
});

test('dimensions include status source without requiring a second database read', () => {
  const context = makeContext();
  const filtered = analysis.applyAnalysisFilter(context, { sessionIds: ['s-a'] });
  assert.deepEqual(filtered.statusChanges.map(item => item.id), ['status-a']);
});

test('play group and session relation records have stable shapes', () => {
  const group = analysis.createPlayGroupRecord({ id: 'g', name: 'Group', color: '#123456', memo: 'memo' }, '2026-01-01T00:00:00.000Z');
  const relation = analysis.createSessionPlayGroupRecord({ sessionId: 's', playGroupId: 'g' }, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(group, { id: 'g', name: 'Group', color: '#123456', memo: 'memo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(relation.sessionId, 's');
  assert.equal(relation.playGroupId, 'g');
});

test('v4 to v5 migration plan only adds group stores and preserves legacy stores', () => {
  const plan = analysis.getAnalysisMigrationPlan(4, 5);
  assert.deepEqual(plan.addStores, ['playGroups', 'sessionPlayGroups']);
  assert.ok(plan.preserveStores.includes('ledgerEntries'));
  assert.ok(plan.preserveStores.includes('rollRecords'));
});

test('migration plan is empty for an already upgraded database', () => {
  assert.deepEqual(analysis.getAnalysisMigrationPlan(5, 5).addStores, []);
});

test('basic analysis module is registered with minimum sample size', () => {
  const module = analysis.getAnalysisModule('basic');
  assert.equal(module.id, 'basic');
  assert.equal(module.minimumSampleSize, 1);
  assert.ok(analysis.listAnalysisModules().some(item => item.id === 'basic'));
});

test('custom analysis module can be registered and calculated', () => {
  analysis.registerAnalysisModule({ id: 'test-module', title: 'Test', minimumSampleSize: 2, calculate: context => ({ sessions: context.sessions.length }) });
  assert.deepEqual(analysis.calculateAnalysisModule('test-module', makeContext()), { sessions: 3 });
});

test('filter predicate registry accepts a future roll dimension', () => {
  analysis.registerFilterPredicate('diceTags', (rollItem, values) => !(values || []).length || (rollItem.diceTags || []).some(tag => values.includes(tag)));
  const context = makeContext({ rolls: [roll('tagged', { diceTags: ['featured'] }), roll('other', { diceTags: ['ordinary'] })] });
  assert.deepEqual(analysis.applyAnalysisFilter(context, { diceTags: ['featured'] }).resolvedRolls.map(item => item.id), ['tagged']);
  assert.equal(typeof analysis.listFilterPredicates().diceTags, 'function');
});

const moduleSessions = [
  { id: 'ms-a', title: '同名卓', dateStart: '2026-03-01' },
  { id: 'ms-b', title: '同名卓', dateStart: '2026-04-01' }
];
function moduleRoll(id, values = {}) {
  return {
    id,
    sourceKey: 'module:' + id,
    sessionId: 'ms-a',
    rawSpeaker: '',
    isJudgement: true,
    skillRaw: '聞き耳',
    system: 'CoC6',
    targetValue: 60,
    rolledValue: 50,
    result: 'success',
    role: 'PC',
    sequenceInSession: Number(id.replace(/\D/g, '')) || 1,
    ...values
  };
}
function moduleContext(extra = {}) {
  return analysis.createAnalysisContext({
    sessions: moduleSessions,
    rolls: [
      moduleRoll('mr1', { rolledValue: 1, result: 'critical', skillRaw: ' 聞き耳 ' }),
      moduleRoll('mr2', { rolledValue: 58, result: 'success', skillRaw: '聞き耳' }),
      moduleRoll('mr3', { rolledValue: 61, result: 'failure', skillRaw: '聞き耳', targetValue: 60 }),
      moduleRoll('mr4', { sessionId: 'ms-b', rolledValue: 100, result: 'fumble', skillRaw: '目星', role: 'KPC', system: 'CoC7' }),
      moduleRoll('mr5', { sessionId: 'ms-b', rolledValue: 'not-a-number', result: 'unknown', skillRaw: '目星', targetValue: null }),
      moduleRoll('mr6', { sessionId: 'ms-b', isJudgement: false, skillRaw: '1D6', result: 'unknown', rolledValue: 4, targetValue: null })
    ],
    pcs: [{ id: 'mpc-a', name: 'PC A', plId: 'mpl-a' }],
    pls: [{ id: 'mpl-a', name: 'PL A' }],
    mappings: [],
    sessionParticipants: [],
    playGroups: [{ id: 'mg-a', name: 'Group A' }, { id: 'mg-b', name: 'Group B' }],
    sessionPlayGroups: [{ id: 'mrel-a', sessionId: 'ms-a', playGroupId: 'mg-a' }, { id: 'mrel-b', sessionId: 'ms-a', playGroupId: 'mg-b' }],
    statusChanges: [],
    overrides: [],
    ...extra
  });
}

test('basic stats expose critical/fumble rates and exact 1/100', () => {
  const stats = analysis.calculateBasicStats(moduleContext());
  assert.equal(stats.critical, 1);
  assert.equal(stats.fumble, 1);
  assert.equal(stats.criticalRate, 1 / 4);
  assert.equal(stats.fumbleRate, 1 / 4);
  assert.equal(stats.exact1, 1);
  assert.equal(stats.exact100, 1);
  assert.equal(stats.criticalRate, stats.evidence.criticalRate.value);
});

test('roll distribution uses ten d100 buckets', () => {
  const distribution = analysis.calculateRollDistribution(moduleContext());
  assert.equal(distribution.length, 10);
  assert.deepEqual(distribution[0], { min: 1, max: 10, count: 1 });
  assert.deepEqual(distribution[5], { min: 51, max: 60, count: 1 });
  assert.deepEqual(distribution[9], { min: 91, max: 100, count: 1 });
  assert.equal(distribution.sampleCount, 4);
  assert.equal(distribution.reduce((sum, bucket) => sum + bucket.count, 0), distribution.sampleCount);
});

test('roll distribution supports a custom bucket size', () => {
  const distribution = analysis.calculateRollDistribution(moduleContext(), { min: 1, max: 100, bucketSize: 20 });
  assert.equal(distribution.length, 5);
  assert.deepEqual(distribution[0], { min: 1, max: 20, count: 1 });
  assert.deepEqual(distribution[4], { min: 81, max: 100, count: 1 });
});

test('roll distribution excludes nonnumeric and nonjudgement values', () => {
  const distribution = analysis.calculateRollDistribution(moduleContext({ rolls: [moduleRoll('numeric', { rolledValue: 20 }), moduleRoll('text', { rolledValue: 'x' }), moduleRoll('dice', { isJudgement: false, rolledValue: 20 })] }));
  assert.equal(distribution.sampleCount, 1);
  assert.equal(distribution[1].count, 1);
});

test('margin computes target minus roll without changing parser result', () => {
  const success = moduleRoll('margin-success', { targetValue: 60, rolledValue: 58, result: 'failure' });
  const failure = moduleRoll('margin-failure', { targetValue: 60, rolledValue: 61, result: 'success' });
  assert.equal(analysis.calculateMargin(success), 2);
  assert.equal(analysis.calculateRollMargin(failure), -1);
  assert.equal(success.result, 'failure');
  assert.equal(failure.result, 'success');
});

test('margin is null when target or roll is unavailable', () => {
  assert.equal(analysis.calculateMargin(moduleRoll('no-target', { targetValue: null })), null);
  assert.equal(analysis.calculateMargin(moduleRoll('no-roll', { rolledValue: null })), null);
  assert.equal(analysis.calculateMargin(moduleRoll('not-judgement', { isJudgement: false })), null);
});

test('close success and failure helpers use the configured threshold', () => {
  assert.equal(analysis.isCloseSuccess(moduleRoll('close-success', { targetValue: 60, rolledValue: 56 }), 5), true);
  assert.equal(analysis.isCloseSuccess(moduleRoll('far-success', { targetValue: 60, rolledValue: 50 }), 5), false);
  assert.equal(analysis.isCloseFailure(moduleRoll('close-failure', { targetValue: 60, rolledValue: 64 }), 5), true);
  assert.equal(analysis.isCloseFailure(moduleRoll('far-failure', { targetValue: 60, rolledValue: 70 }), 5), false);
});

test('findExactRolls returns only numeric judgement matches', () => {
  const exact = analysis.findExactRolls(moduleContext(), 1);
  assert.deepEqual(exact.map(item => item.id), ['mr1']);
  assert.equal(analysis.findExactRolls(moduleContext(), 'not-a-number').length, 0);
});

test('skill stats group normalized display variants without semantic guessing', () => {
  const rows = analysis.calculateSkillStats(moduleContext());
  const listen = rows.find(row => row.skillKey === '聞き耳');
  assert.ok(listen);
  assert.equal(listen.displayName, '聞き耳');
  assert.equal(listen.usageCount, 3);
  assert.equal(listen.classifiedCount, 3);
});

test('skill stats expose success, critical, fumble, averages, and rates', () => {
  const rows = analysis.calculateSkillStats(moduleContext());
  const listen = rows.find(row => row.skillKey === '聞き耳');
  const spot = rows.find(row => row.skillKey === '目星');
  assert.equal(listen.successCount, 2);
  assert.equal(listen.failureCount, 1);
  assert.equal(listen.successRate, 2 / 3);
  assert.equal(listen.averageRoll, (1 + 58 + 61) / 3);
  assert.equal(listen.averageTarget, 60);
  assert.equal(spot.criticalCount, 0);
  assert.equal(spot.fumbleCount, 1);
});

test('skill target and roll samples exclude null values', () => {
  const rows = analysis.calculateSkillStats(moduleContext({ rolls: [moduleRoll('a', { skillRaw: 'A', rolledValue: 10, targetValue: 50 }), moduleRoll('b', { skillRaw: 'A', rolledValue: null, targetValue: null, result: 'unknown' })] }));
  assert.equal(rows[0].averageRollSampleCount, 1);
  assert.equal(rows[0].averageTargetSampleCount, 1);
});

test('skill stats omit rolls without skill names', () => {
  const rows = analysis.calculateSkillStats(moduleContext({ rolls: [moduleRoll('named', { skillRaw: 'A' }), moduleRoll('unnamed', { skillRaw: '' })] }));
  assert.deepEqual(rows.map(row => row.skillKey), ['a']);
});

test('skill stats support sorting and minimum classified sample size', () => {
  const rows = analysis.calculateSkillStats(moduleContext(), { sortBy: 'successRate' });
  assert.equal(rows[0].displayName, '聞き耳');
  const ranked = analysis.calculateSkillStats(moduleContext(), { minimumSampleSize: 3 });
  assert.deepEqual(ranked.map(row => row.displayName), ['聞き耳']);
});

test('skill stats retain recent records with resolved metadata fields', () => {
  const context = moduleContext({ sessions: [{ id: 'ms-a', title: 'Recent', dateStart: '2026-03-01' }], rolls: [moduleRoll('r1', { skillRaw: 'A', sequenceInSession: 2 }), moduleRoll('r2', { skillRaw: 'A', sequenceInSession: 1 })] });
  const row = analysis.calculateSkillStats(context, { recentLimit: 1 })[0];
  assert.equal(row.recentRecords.length, 1);
  assert.equal(row.recentRecords[0].sessionTitle, 'Recent');
  assert.equal(row.recentRecords[0].rolledValue, 50);
});

test('PL breakdown excludes unresolved attribution and reports overall separately', () => {
  const context = moduleContext({ mappings: [{ id: 'map', rawSpeakerNormalized: '', pcId: 'mpc-a', plId: 'mpl-a', scope: 'global' }], rolls: [moduleRoll('pl', { rawSpeaker: '', skillRaw: 'A' }), moduleRoll('unresolved', { rawSpeaker: 'unknown', skillRaw: 'B' })] });
  const breakdown = analysis.calculateBreakdown(context, 'pl');
  assert.equal(breakdown.rows.length, 1);
  assert.equal(breakdown.rows[0].id, 'mpl-a');
  assert.equal(breakdown.overall.rollCount, 2);
});

test('PC breakdown uses canonical PC id after identity resolution', () => {
  const context = moduleContext({ mappings: [{ id: 'map', rawSpeakerNormalized: 'Alice', pcId: 'mpc-a', plId: 'mpl-a', scope: 'global' }], rolls: [moduleRoll('pc', { rawSpeaker: 'Alice' })] });
  const breakdown = analysis.calculateBreakdown(context, 'pc');
  assert.equal(breakdown.rows[0].id, 'mpc-a');
  assert.equal(breakdown.rows[0].label, 'PC A');
});

test('session breakdown keeps same-title sessions separate', () => {
  const context = moduleContext({ rolls: [moduleRoll('a', { sessionId: 'ms-a' }), moduleRoll('b', { sessionId: 'ms-b' })] });
  const breakdown = analysis.calculateBreakdown(context, 'session');
  assert.deepEqual(breakdown.rows.map(row => row.id).sort(), ['ms-a', 'ms-b']);
});

test('playGroup breakdown duplicates multi-group rows but not overall totals', () => {
  const context = moduleContext({ rolls: [moduleRoll('grouped', { sessionId: 'ms-a' })] });
  const breakdown = analysis.calculateBreakdown(context, 'playGroup');
  assert.deepEqual(breakdown.rows.map(row => row.id).sort(), ['mg-a', 'mg-b']);
  assert.equal(breakdown.rows.reduce((sum, row) => sum + row.rollCount, 0), 2);
  assert.equal(breakdown.overall.rollCount, 1);
});

test('ungrouped playGroup breakdown has a special row', () => {
  const context = moduleContext({ rolls: [moduleRoll('ungrouped', { sessionId: 'ms-b' })] });
  const breakdown = analysis.calculateBreakdown(context, 'group');
  assert.equal(breakdown.rows[0].id, analysis.UNGROUPED);
});

test('role and system breakdown keep KPC and unknown independent', () => {
  const context = moduleContext({ rolls: [moduleRoll('pc', { role: 'PC', system: 'CoC6' }), moduleRoll('kpc', { role: 'KPC', system: 'unknown' })] });
  assert.deepEqual(analysis.calculateBreakdown(context, 'role').rows.map(row => row.id).sort(), ['KPC', 'PC']);
  assert.deepEqual(analysis.calculateBreakdown(context, 'system').rows.map(row => row.id).sort(), ['CoC6', 'unknown']);
});

test('breakdown does not mutate source rolls', () => {
  const context = moduleContext();
  const before = JSON.stringify(context.rawRolls);
  analysis.calculateBreakdown(context, 'session');
  assert.equal(JSON.stringify(context.rawRolls), before);
});

test('comparison preserves base filter and adds A/B conditions', () => {
  const context = moduleContext();
  const comparison = analysis.compareAnalysisFilters(context, { dateRange: { from: '2026-03-01', to: '2026-03-31' } }, { roles: ['PC'] }, { roles: ['KPC'] });
  assert.deepEqual(comparison.filterA.dateRange, { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(comparison.filterA.roles, ['PC']);
  assert.deepEqual(comparison.filterB.roles, ['KPC']);
  assert.equal(comparison.statsA.judgementCount, 3);
  assert.equal(comparison.statsB.judgementCount, 0);
});

test('comparison supports group A versus group B', () => {
  const context = moduleContext({ rolls: [moduleRoll('a', { sessionId: 'ms-a' }), moduleRoll('b', { sessionId: 'ms-b' })], sessionPlayGroups: [{ sessionId: 'ms-a', playGroupId: 'mg-a' }, { sessionId: 'ms-b', playGroupId: 'mg-b' }] });
  const comparison = analysis.compareAnalysisFilters(context, {}, { playGroupIds: ['mg-a'] }, { playGroupIds: ['mg-b'] });
  assert.equal(comparison.statsA.rollCount, 1);
  assert.equal(comparison.statsB.rollCount, 1);
});

test('comparison exposes metric differences and avoids NaN for empty sides', () => {
  const context = moduleContext({ rolls: [moduleRoll('a', { role: 'PC' })] });
  const comparison = analysis.compareAnalysisFilters(context, {}, { roles: ['PC'] }, { roles: ['GM'] });
  assert.equal(comparison.difference.judgementCount, 1);
  assert.equal(comparison.difference.successRate, null);
  assert.equal(comparison.statsB.averageRoll, null);
  assert.equal(comparison.sampleWarning, true);
  assert.ok(comparison.warnings.some(message => message.includes('比較B')));
});

test('comparison supports PL, PC, session, system, and period filter dimensions', () => {
  const context = moduleContext();
  for (const pair of [
    [{ plIds: ['mpl-a'] }, { plIds: ['missing'] }],
    [{ pcIds: ['mpc-a'] }, { pcIds: ['missing'] }],
    [{ sessionIds: ['ms-a'] }, { sessionIds: ['ms-b'] }],
    [{ systems: ['CoC6'] }, { systems: ['CoC7'] }],
    [{ dateRange: { from: '2026-03-01', to: '2026-03-31' } }, { dateRange: { from: '2026-04-01', to: '2026-04-30' } }]
  ]) {
    const comparison = analysis.compareAnalysisFilters(context, {}, pair[0], pair[1]);
    assert.ok(comparison.statsA && comparison.statsB);
  }
});

test('common filtered context feeds distribution, skills, and breakdown consistently', () => {
  const context = moduleContext();
  const filtered = analysis.applyAnalysisFilter(context, { sessionIds: ['ms-a'] });
  assert.equal(analysis.calculateBasicStats(filtered).rollCount, 3);
  assert.equal(analysis.calculateRollDistribution(filtered).sampleCount, 3);
  assert.equal(analysis.calculateSkillStats(filtered).reduce((sum, row) => sum + row.usageCount, 0), 3);
  assert.equal(analysis.calculateBreakdown(filtered, 'session').rows[0].rollCount, 3);
});

test('new analysis modules are registered for distribution, skills, and breakdown', () => {
  const modules = analysis.listAnalysisModules();
  assert.ok(modules.some(item => item.id === 'distribution'));
  assert.ok(modules.some(item => item.id === 'skills'));
  assert.ok(modules.some(item => item.id === 'breakdown'));
});
