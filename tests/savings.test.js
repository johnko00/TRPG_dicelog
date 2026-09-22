const test = require('node:test');
const assert = require('node:assert/strict');
const savings = require('../src/savings.js');

const pc = { id: 'pc-1', name: 'Character', plId: 'pl-me' };
const pl = { id: 'pl-me', name: 'Player' };
const base = (overrides = {}) => ({ id: 'random-roll-id', sourceKey: 'source:roll-1', sessionId: 's1', sourceLogId: 'log-1', rawSpeaker: 'Alice', isJudgement: true, rolledValue: 1, result: 'critical', normalizedResult: 'critical', skillRaw: 'Spot Hidden', ...overrides });
const rule = (overrides = {}) => {
  const { condition = {}, ...topLevel } = overrides;
  return { id: 'rule-1', name: 'Critical', type: 'saving', amountMode: 'fixed', amount: 500, triggerType: 'roll', isEnabled: true, ...topLevel, condition: { judgementOnly: true, ...condition } };
};
const context = (extra = {}) => ({ rolls: [base()], rules: [rule()], pcs: [pc], pls: [pl], mappings: [{ id: 'map-1', rawSpeakerNormalized: 'Alice', pcId: 'pc-1', plId: 'pl-me', scope: 'global' }], sessionParticipants: [{ id: 'part-1', sessionId: 's1', rawSpeakerNormalized: 'Alice', pcId: 'pc-1', plId: 'pl-me', role: 'PC', savingsExcluded: false }], myPlId: 'pl-me', ...extra });

test('exact roll, range, result and disabled rules match correctly', () => {
  assert.equal(savings.generateRollCandidates(context()).length, 1);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { exactRolls: [2] } })] })).length, 0);
  assert.equal(savings.generateRollCandidates(context({ rolls: [base({ rolledValue: 3, result: 'success' })], rules: [rule({ condition: { rollMin: 2, rollMax: 5, results: ['success'] } })] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ rolls: [base({ rolledValue: 96, result: 'failure' })], rules: [rule({ condition: { rollMin: 95, rollMax: 99 } })] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { results: ['fumble'] } })] })).length, 0);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ isEnabled: false })] })).length, 0);
});

test('fixed and input amounts are represented without guessing input', () => {
  assert.equal(savings.generateRollCandidates(context())[0].amount, 500);
  const input = savings.generateRollCandidates(context({ rules: [rule({ amountMode: 'input', amount: 0 })] }))[0];
  assert.equal(input.amount, null);
  assert.equal(input.amountMode, 'input');
});

test('my PL, all, character and role conditions use resolver data', () => {
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { targetScope: 'self' } })] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ myPlId: 'pl-other', rules: [rule({ condition: { targetScope: 'self' } })] })).length, 0);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { pcIds: ['pc-1'] } })] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { pcIds: ['pc-other'] } })] })).length, 0);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { roles: ['PC'] } })] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ rules: [rule({ condition: { roles: ['KPC'] } })] })).length, 0);
});

test('KPC is not automatically excluded and GM/KPC rules are supported', () => {
  const kpc = context({ sessionParticipants: [{ id: 'part-1', sessionId: 's1', rawSpeakerNormalized: 'Alice', pcId: 'pc-1', plId: 'pl-me', role: 'KPC', savingsExcluded: false }] });
  assert.equal(savings.generateRollCandidates(kpc).length, 1);
  assert.equal(savings.generateRollCandidates({ ...kpc, rules: [rule({ condition: { roles: ['KPC'] } })] }).length, 1);
  assert.equal(savings.generateRollCandidates({ ...kpc, rules: [rule({ condition: { roles: ['GM'] } })] }).length, 0);
});

test('roll and participant exclusions suppress candidates independently', () => {
  assert.equal(savings.generateRollCandidates(context({ overrides: [{ sourceKey: 'source:roll-1', savingsExcluded: true }] })).length, 0);
  assert.equal(savings.generateRollCandidates(context({ overrides: [{ sourceKey: 'source:roll-1', analysisExcluded: true, savingsExcluded: false }] })).length, 1);
  assert.equal(savings.generateRollCandidates(context({ sessionParticipants: [{ ...context().sessionParticipants[0], savingsExcluded: true }] })).length, 0);
});

test('candidate identity is sourceKey plus rule and ignores random roll id', () => {
  const first = savings.generateRollCandidates(context())[0];
  const second = savings.generateRollCandidates(context({ rolls: [base({ id: 'another-random-id' })] }))[0];
  assert.equal(first.candidateKey, 'roll:source:roll-1:rule:rule-1');
  assert.equal(first.candidateKey, second.candidateKey);
});

test('confirmed and dismissed candidates are not pending', () => {
  const candidates = savings.generateRollCandidates(context());
  assert.equal(savings.pendingCandidates(candidates, [], []).length, 1);
  assert.equal(savings.pendingCandidates(candidates, [{ details: [{ candidateKey: candidates[0].candidateKey }] }], []).length, 0);
  assert.equal(savings.pendingCandidates(candidates, [], [{ candidateKey: candidates[0].candidateKey, decision: 'dismissed' }]).length, 0);
  assert.equal(savings.pendingCandidates(candidates, [{ details: [{ sourceKey: candidates[0].sourceKey, ruleId: candidates[0].ruleId }] }], []).length, 0);
});

test('session rule creates one stable candidate per session and rule', () => {
  const sessions = [{ id: 's1' }, { id: 's2' }];
  const candidates = savings.generateSessionCandidates({ sessions, rules: [{ id: 'session-rule', name: 'One session', triggerType: 'session', amountMode: 'fixed', amount: 500, type: 'saving', isEnabled: true, condition: {} }] });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].candidateKey, 'session:s1:rule:session-rule');
  assert.equal(savings.dedupeCandidates([...candidates, candidates[0]]).length, 2);
  assert.equal(savings.pendingCandidates(candidates, [{ details: [{ candidateKey: candidates[0].candidateKey }] }], []).length, 1);
  const roleCandidates = savings.generateSessionCandidates({ sessions: [{ id: 's1' }], myPlId: 'pl-me', sessionContexts: { s1: [{ role: 'GM', plId: 'pl-me' }, { role: 'PC', plId: 'pl-other' }] }, rules: [{ id: 'gm-rule', name: 'GM session', triggerType: 'session', amountMode: 'fixed', amount: 500, type: 'saving', isEnabled: true, condition: { roles: ['GM'], myParticipation: 'gm' } }] });
  assert.equal(roleCandidates.length, 1);
  assert.equal(roleCandidates[0].role, 'GM');
});

test('review totals calculate savings, manual additions and expenses', () => {
  assert.deepEqual(savings.calculateReviewTotals([{ type: 'saving', amount: 500 }, { type: 'saving', amount: 100 }]), { saving: 600, expense: 0, net: 600, total: 600 });
  assert.deepEqual(savings.calculateReviewTotals([{ type: 'saving', amount: 500 }, { type: 'saving', amount: 100 }, { type: 'saving', amount: 300 }, { type: 'expense', amount: 200 }]), { saving: 900, expense: 200, net: 700, total: 1100 });
});

test('candidate provenance and ledger snapshot preserve values at confirmation time', () => {
  const candidate = savings.generateRollCandidates(context())[0];
  assert.equal(candidate.sourceKey, 'source:roll-1');
  assert.equal(candidate.ruleNameSnapshot, 'Critical');
  assert.equal(candidate.pcNameSnapshot, 'Character');
  const snapshot = savings.buildLedgerSnapshot(candidate);
  assert.equal(snapshot.amount, 500);
  assert.ok(snapshot.confirmedAt);
});
