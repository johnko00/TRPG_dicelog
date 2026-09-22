const test = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../src/dashboard.js');

const sessions = [
  { id: 's1', title: 'Same title', dateStart: '2026-09-20', imageAssetId: 'image-1' },
  { id: 's2', title: 'Same title', dateStart: '2026-09-20', imageAssetId: null },
  { id: 's3', title: 'Another session', dateStart: '2026-09-25', imageAssetId: null },
  { id: 's4', title: 'No date', dateStart: null, imageAssetId: null }
];

const rolls = [
  { id: 'r1', sourceKey: 'source:r1', sessionId: 's1', isJudgement: true, rolledValue: 1, result: 'critical' },
  { id: 'r2', sourceKey: 'source:r2', sessionId: 's1', isJudgement: true, rolledValue: 100, result: 'fumble' },
  { id: 'r3', sourceKey: 'source:r3', sessionId: 's1', isJudgement: true, rolledValue: 40, result: 'success' },
  { id: 'r4', sourceKey: 'source:r4', sessionId: 's1', isJudgement: true, rolledValue: 50, result: 'unknown' },
  { id: 'r5', sourceKey: 'source:r5', sessionId: 's1', isJudgement: false, rolledValue: 1, result: 'unknown' },
  { id: 'r6', sourceKey: 'source:r6', sessionId: 's2', isJudgement: true, rolledValue: 1, result: 'critical' },
  { id: 'r7', sourceKey: 'source:r7', sessionId: 's3', isJudgement: true, rolledValue: 99, result: 'failure', analysisExcluded: true },
  { id: 'r8', sourceKey: 'source:r8', sessionId: 's3', isJudgement: true, rolledValue: 20, result: 'special', savingsExcluded: true }
];

const ledger = [
  { id: 'l1', sessionId: 's1', date: '2026-09-25', type: 'saving', amount: 1000, label: 'session saving' },
  { id: 'l2', sessionId: 's1', date: '2026-09-25', type: 'expense', amount: 300, label: 'session expense' },
  { id: 'l3', sessionId: null, date: '2026-09-25', type: 'saving', amount: 200, label: 'manual saving' },
  { id: 'l4', sessionId: null, date: '2026-09-25', type: 'saving', amount: 999, status: 'voided' }
];

test('date key parsing keeps YYYY-MM-DD in the local calendar', () => {
  assert.deepEqual(dashboard.parseDateKey('2026-09-20'), { year: 2026, month: 8, day: 20 });
  assert.equal(dashboard.toDateKey('2026-09-20'), '2026-09-20');
});

test('invalid and missing dates remain absent', () => {
  assert.equal(dashboard.toDateKey(null), null);
  assert.equal(dashboard.toDateKey('not-a-date'), null);
});

test('saving and expense balance is net', () => {
  assert.equal(dashboard.calculateBalance([{ type: 'saving', amount: 1000 }, { type: 'expense', amount: 300 }]), 700);
});

test('pending values do not affect confirmed balance', () => {
  assert.equal(dashboard.calculateBalance([{ type: 'saving', amount: 1000 }, { type: 'expense', amount: 300 }]), 700);
});

test('voided ledger entries are excluded from balance', () => {
  assert.equal(dashboard.calculateBalance([{ type: 'saving', amount: 1000 }, { type: 'saving', amount: 999, status: 'voided' }]), 1000);
});

test('session ledger uses session date for display', () => {
  assert.equal(dashboard.getLedgerDisplayDate(ledger[0], sessions), '2026-09-20');
});

test('manual ledger uses its own date', () => {
  assert.equal(dashboard.getLedgerDisplayDate(ledger[2], sessions), '2026-09-25');
});

test('missing session date falls back to ledger date', () => {
  assert.equal(dashboard.getLedgerDisplayDate({ sessionId: 's4', date: '2026-09-25', type: 'saving', amount: 1 }, sessions), '2026-09-25');
});

test('session grouping excludes sessions without dateStart', () => {
  const grouped = dashboard.groupSessionsByDate(sessions);
  assert.equal(grouped['2026-09-20'].length, 2);
  assert.equal(Object.values(grouped).flat().some(session => session.id === 's4'), false);
});

test('same-title sessions remain separate', () => {
  assert.deepEqual(dashboard.groupSessionsByDate(sessions)['2026-09-20'].map(session => session.id), ['s1', 's2']);
});

test('same-day sessions are all retained in calendar data', () => {
  const month = dashboard.buildCalendarMonth(2026, 8, { sessions, ledgerEntries: [] });
  assert.equal(month.days.find(day => day.dateKey === '2026-09-20').sessions.length, 2);
});

test('session image identity is preserved for calendar consumers', () => {
  const day = dashboard.buildCalendarMonth(2026, 8, { sessions, ledgerEntries: [] }).days.find(item => item.dateKey === '2026-09-20');
  assert.equal(day.sessions.find(session => session.id === 's1').imageAssetId, 'image-1');
});

test('monthly session count uses dateStart only', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [], ledgerEntries: [] });
  assert.equal(summary.sessionCount, 3);
});

test('monthly judgement count excludes unknown results', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls, ledgerEntries: [] });
  assert.equal(summary.judgementRolls, 5);
});

test('analysisExcluded rolls are excluded from monthly analysis', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls, ledgerEntries: [] });
  assert.equal(summary.failure, 1);
  assert.equal(summary.critical, 2);
});

test('savingsExcluded alone does not exclude analysis', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls, ledgerEntries: [] });
  assert.equal(summary.special, 1);
});

test('KPC rolls have no automatic analysis exclusion', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [{ ...rolls[0], id: 'kpc-roll', sessionId: 's2' }], ledgerEntries: [] });
  assert.equal(summary.critical, 1);
});

test('critical and fumble are counted separately', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls, ledgerEntries: [] });
  assert.equal(summary.critical, 2);
  assert.equal(summary.fumble, 1);
});

test('success-side result families are included', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [{ ...rolls[0], result: 'hard' }, { ...rolls[0], id: 'x', result: 'extreme' }, { ...rolls[0], id: 'y', result: 'special' }], ledgerEntries: [] });
  assert.equal(summary.success, 3);
});

test('failure-side result families are included', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [{ ...rolls[0], result: 'failure' }, { ...rolls[0], id: 'x', result: 'fumble' }], ledgerEntries: [] });
  assert.equal(summary.failure, 2);
});

test('nonjudgement dice are excluded from monthly judgement count', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [rolls[4]], ledgerEntries: [] });
  assert.equal(summary.judgementRolls, 0);
});

test('monthly ledger uses session display date', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 8, sessions, rolls: [], ledgerEntries: ledger });
  assert.equal(summary.saving, 1200);
  assert.equal(summary.expense, 300);
  assert.equal(summary.net, 900);
});

test('previous month has zero summary without matching data', () => {
  const summary = dashboard.calculateMonthlySummary({ year: 2026, month: 7, sessions, rolls, ledgerEntries: ledger });
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.net, 0);
});

test('calendar month has correct February length', () => {
  assert.equal(dashboard.buildCalendarMonth(2026, 1, {}).daysInMonth, 28);
});

test('calendar leap year has February 29 days', () => {
  assert.equal(dashboard.buildCalendarMonth(2024, 1, {}).daysInMonth, 29);
});

test('calendar supports 30-day months', () => {
  assert.equal(dashboard.buildCalendarMonth(2026, 3, {}).daysInMonth, 30);
});

test('calendar supports 31-day months', () => {
  assert.equal(dashboard.buildCalendarMonth(2026, 0, {}).daysInMonth, 31);
});

test('calendar exposes month leading weekday cells', () => {
  assert.equal(dashboard.buildCalendarMonth(2026, 8, {}).leadingEmptyCount, 2);
});

test('today is marked through an explicit date input', () => {
  const month = dashboard.buildCalendarMonth(2026, 8, { today: '2026-09-20' });
  assert.equal(month.days.find(day => day.dateKey === '2026-09-20').isToday, true);
});

test('ledger-only days remain calendar content', () => {
  const month = dashboard.buildCalendarMonth(2026, 8, { ledgerEntries: [{ date: '2026-09-25', type: 'saving', amount: 10 }] });
  assert.equal(month.days.find(day => day.dateKey === '2026-09-25').hasContent, true);
});

test('session-only days remain calendar content', () => {
  const month = dashboard.buildCalendarMonth(2026, 8, { sessions: [{ id: 'only', dateStart: '2026-09-10' }] });
  assert.equal(month.days.find(day => day.dateKey === '2026-09-10').hasContent, true);
});

test('pending-only session dates remain calendar content', () => {
  const month = dashboard.buildCalendarMonth(2026, 8, { sessions: [{ id: 'pending', dateStart: '2026-09-10' }], pending: [{ sessionId: 'pending', amount: 500 }] });
  const day = month.days.find(item => item.dateKey === '2026-09-10');
  assert.equal(day.pending.length, 1);
  assert.equal(day.ledger.net, 0);
});

test('pending grouping tracks known and input amounts separately', () => {
  const grouped = dashboard.groupPendingBySession([{ sessionId: 's1', amount: 600 }, { sessionId: 's1', amount: null }], sessions);
  assert.equal(grouped.s1.knownAmount, 600);
  assert.equal(grouped.s1.unpricedCount, 1);
});

test('confirmed and dismissed candidates can be supplied as pending input', () => {
  const grouped = dashboard.groupPendingBySession([{ sessionId: 's1', candidateKey: 'candidate', amount: 500 }], sessions);
  assert.equal(grouped.s1.candidates.length, 1);
});

test('session roll summary excludes nonjudgement and unknown', () => {
  const summary = dashboard.calculateSessionRollSummary('s1', rolls, []);
  assert.equal(summary.total, 3);
});

test('session roll summary counts critical and fumble', () => {
  const summary = dashboard.calculateSessionRollSummary('s1', rolls, []);
  assert.equal(summary.critical, 1);
  assert.equal(summary.fumble, 1);
});

test('session roll summary honors analysis override', () => {
  const summary = dashboard.calculateSessionRollSummary('s1', rolls, [{ sourceKey: 'source:r1', analysisExcluded: true }]);
  assert.equal(summary.critical, 0);
});

test('recent events detect exact one', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [rolls[0]], sessions, limit: 5 });
  assert.equal(events[0].kind, 'critical');
});

test('recent events detect exact one when result is ordinary', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [{ ...rolls[0], result: 'success', rolledValue: 1 }], sessions, limit: 5 });
  assert.equal(events[0].kind, 'exact1');
});

test('recent events detect exact one hundred', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [{ ...rolls[0], result: 'success', rolledValue: 100 }], sessions, limit: 5 });
  assert.equal(events[0].kind, 'exact100');
});

test('recent events detect fumble', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [rolls[1]], sessions, limit: 5 });
  assert.equal(events[0].kind, 'fumble');
});

test('recent events exclude analysisExcluded rolls', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [rolls[7]], sessions, overrides: [{ sourceKey: 'source:r8', analysisExcluded: true }], limit: 5 });
  assert.equal(events.length, 0);
});

test('recent events deduplicate the same source roll', () => {
  const events = dashboard.buildRecentDiceEvents({ rolls: [rolls[0], { ...rolls[0], id: 'duplicate' }], sessions, limit: 5 });
  assert.equal(events.length, 1);
});

test('recent events obey the maximum count', () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ ...rolls[0], id: `many-${index}`, sourceKey: `source:many-${index}` }));
  assert.equal(dashboard.buildRecentDiceEvents({ rolls: many, sessions, limit: 3 }).length, 3);
});

test('month labels distinguish current and historical months', () => {
  assert.equal(dashboard.monthLabel(2026, 8, '2026-09-22'), '今月');
  assert.equal(dashboard.monthLabel(2026, 7, '2026-09-22'), '2026年8月');
});
