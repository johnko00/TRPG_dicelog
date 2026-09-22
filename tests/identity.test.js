const test = require('node:test');
const assert = require('node:assert/strict');
const identity = require('../src/identity.js');
const parser = require('../src/parser.js');

function items() {
  return [
    { sequence: 1, channel: '[main]', rawSpeaker: ' Ａ　Ｂ ', rawText: 'CCB<=50 目星 ＞ 20 ＞ 成功', itemType: 'roll', rollData: parser.parseMessage({ body: 'CCB<=50 目星 ＞ 20 ＞ 成功' }).rollData },
    { sequence: 2, channel: '[main]', rawSpeaker: 'Ａ Ｂ', rawText: '同じ文', itemType: 'message', body: '同じ文' }
  ];
}

test('speaker normalization uses NFKC and stable whitespace', () => {
  assert.equal(identity.normalizeSpeakerName(' Ａ　Ｂ  '), 'A B');
});

test('stable identity is deterministic and parser-version independent', () => {
  const first = items();
  identity.attachStableIdentity(first, { lineageId: 'lineage:test' });
  const second = items();
  identity.attachStableIdentity(second, { lineageId: 'lineage:test' });
  assert.equal(first[0].messageFingerprint, second[0].messageFingerprint);
  assert.equal(first[0].rollData.sourceKey, second[0].rollData.sourceKey);
  assert.equal(identity.buildSourceKey('lineage:test', first[0].messageFingerprint, 1, 0), first[0].rollData.sourceKey);
  const record = parser.buildRollRecord(first[0], first[0].rollData, { id: 'r', parsedItemId: 'p', sessionId: 's', sourceLogId: 'l', rollIndex: 0 });
  assert.equal(record.sourceKey, first[0].rollData.sourceKey);
  assert.equal(record.lineageId, 'lineage:test');
});

test('duplicate occurrences and Xn roll indexes produce distinct source keys', () => {
  const parsed = parser.parseMessage({ sequence: 4, rawSpeaker: 'A', body: 'X2 CCB<=50 #1 ＞ 10 ＞ 成功 #2 ＞ 20 ＞ 成功' });
  const list = [parsed, { ...parsed, sequence: 5 }];
  identity.attachStableIdentity(list, { lineageId: 'lineage:x' });
  assert.notEqual(list[0].messageOccurrence, list[1].messageOccurrence);
  const roll = parser.parseMessage({ body: 'X2 sccb<=30 #1 (1D100<=30) ＞ 31 ＞ 失敗 #2 (1D100<=30) ＞ 12 ＞ 成功' });
  identity.attachStableIdentity([roll], { lineageId: 'lineage:x' });
  assert.equal(new Set(roll.rollData.rolls.map(r => r.sourceKey)).size, roll.rollData.rolls.length);
});

test('append revision keeps existing message and roll source keys', () => {
  const lineageId = 'lineage:append';
  const makeMessage = text => ({ itemType: 'message', channel: '[main]', rawSpeaker: 'A', rawText: text, body: text });
  const oldRevision = [makeMessage('A'), makeMessage('B'), makeMessage('C')];
  const newRevision = [makeMessage('A'), makeMessage('B'), makeMessage('C'), makeMessage('D'), makeMessage('E')];
  identity.attachStableIdentity(oldRevision, { lineageId });
  identity.attachStableIdentity(newRevision, { lineageId });
  assert.deepEqual(newRevision.slice(0, 3).map(item => item.sourceMessageKey), oldRevision.map(item => item.sourceMessageKey));
  assert.equal(newRevision[3].sourceMessageKey === oldRevision[2].sourceMessageKey, false);

  const oldDuplicate = [makeMessage('same'), makeMessage('same')];
  const newDuplicate = [makeMessage('same'), makeMessage('same'), makeMessage('same')];
  identity.attachStableIdentity(oldDuplicate, { lineageId });
  identity.attachStableIdentity(newDuplicate, { lineageId });
  assert.deepEqual(newDuplicate.slice(0, 2).map(item => item.sourceMessageKey), oldDuplicate.map(item => item.sourceMessageKey));
  assert.notEqual(newDuplicate[2].sourceMessageKey, oldDuplicate[1].sourceMessageKey);

  const oldXn = parser.parseMessage({ rawSpeaker: 'A', body: 'X2 sccb<=30 正気度喪失 #1 (1D100<=30) ＞ 31 ＞ 失敗 #2 (1D100<=30) ＞ 12 ＞ 成功' });
  const newXn = parser.parseMessage({ rawSpeaker: 'A', body: 'X2 sccb<=30 正気度喪失 #1 (1D100<=30) ＞ 31 ＞ 失敗 #2 (1D100<=30) ＞ 12 ＞ 成功' });
  identity.attachStableIdentity([oldXn], { lineageId });
  identity.attachStableIdentity([newXn, makeMessage('new')], { lineageId });
  assert.deepEqual(newXn.rollData.rolls.map(roll => roll.sourceKey), oldXn.rollData.rolls.map(roll => roll.sourceKey));
});

test('id-keyed alias storage permits global and two session mappings for one normalized speaker', () => {
  const records = [
    { id: 'global-1', rawSpeakerNormalized: '探索者', scope: 'global', sessionId: null, pcId: 'pc-global' },
    { id: 'session-a', rawSpeakerNormalized: '探索者', scope: 'session', sessionId: 'session-a', pcId: 'pc-a' },
    { id: 'session-b', rawSpeakerNormalized: '探索者', scope: 'session', sessionId: 'session-b', pcId: 'pc-b' }
  ];
  const store = new Map(records.map(record => [record.id, record]));
  assert.equal(store.size, 3);
  const mappings = [...store.values()];
  assert.equal(identity.resolveSpeaker({ rawSpeaker: '探索者', sessionId: 'session-a', mappings }).pcId, 'pc-a');
  assert.equal(identity.resolveSpeaker({ rawSpeaker: '探索者', sessionId: 'session-b', mappings }).pcId, 'pc-b');
  assert.equal(identity.resolveSpeaker({ rawSpeaker: '探索者', sessionId: 'session-c', mappings }).pcId, 'pc-global');
});

function resolver(overrides = {}) {
  return identity.resolveSpeaker({
    rawSpeaker: '探索者', sessionId: 'session-a',
    mappings: [{ rawNameNormalized: '探索者', pcId: 'pc-global', scope: 'global' }, ...(overrides.mappings || [])],
    pcs: [{ id: 'pc-global', name: '全体PC', plId: 'pl-1' }, { id: 'pc-a', name: 'AのPC', plId: 'pl-1' }, { id: 'pc-b', name: 'BのPC', plId: 'pl-2' }],
    pls: [{ id: 'pl-1', name: 'PL1' }, { id: 'pl-2', name: 'PL2' }],
    sessionParticipants: overrides.sessionParticipants || []
  });
}

test('session mapping takes precedence over global mapping and falls back globally', () => {
  const session = resolver({ mappings: [{ rawNameNormalized: '探索者', rawSpeakerNormalized: '探索者', pcId: 'pc-a', scope: 'session', sessionId: 'session-a' }] });
  assert.equal(session.pcId, 'pc-a');
  assert.equal(session.mappingScope, 'session');
  const fallback = resolver();
  assert.equal(fallback.pcId, 'pc-global');
});

test('ignored and unresolved mappings remain distinguishable', () => {
  const ignored = identity.resolveSpeaker({ rawSpeaker: 'GM', mappings: [{ rawNameNormalized: 'GM', ignored: true, scope: 'global' }] });
  const unresolved = identity.resolveSpeaker({ rawSpeaker: 'NPC', mappings: [] });
  assert.equal(ignored.ignored, true);
  assert.equal(ignored.resolved, true);
  assert.equal(unresolved.resolved, false);
});

test('character mapping resolves its player and session role', () => {
  const resolved = resolver({ sessionParticipants: [{ id: 'participant', sessionId: 'session-a', pcId: 'pc-a', plId: 'pl-1', role: 'KPC', savingsExcluded: true }] });
  const withSession = identity.resolveSpeaker({
    rawSpeaker: '探索者', sessionId: 'session-a',
    mappings: [{ rawNameNormalized: '探索者', pcId: 'pc-a', scope: 'global' }],
    pcs: [{ id: 'pc-a', name: 'A', plId: 'pl-1' }], pls: [{ id: 'pl-1', name: 'PL1' }],
    sessionParticipants: [{ id: 'participant', sessionId: 'session-a', pcId: 'pc-a', plId: 'pl-1', role: 'KPC', savingsExcluded: true }]
  });
  assert.equal(resolved.sessionParticipant, null);
  assert.equal(withSession.plId, 'pl-1');
  assert.equal(withSession.role, 'KPC');
  assert.equal(withSession.sessionParticipant.savingsExcluded, true);
});

test('same speaker can map to different characters in different sessions', () => {
  const input = { rawSpeaker: '探索者', mappings: [
    { rawNameNormalized: '探索者', pcId: 'pc-a', scope: 'session', sessionId: 'a' },
    { rawNameNormalized: '探索者', pcId: 'pc-b', scope: 'session', sessionId: 'b' }
  ], pcs: [{ id: 'pc-a' }, { id: 'pc-b' }] };
  assert.equal(identity.resolveSpeaker({ ...input, sessionId: 'a' }).pcId, 'pc-a');
  assert.equal(identity.resolveSpeaker({ ...input, sessionId: 'b' }).pcId, 'pc-b');
});

test('one raw speaker can be PC in one session and KPC in another', () => {
  const base = {
    rawSpeaker: '探索者',
    mappings: [{ rawNameNormalized: '探索者', pcId: 'pc-a', scope: 'global' }],
    pcs: [{ id: 'pc-a', plId: 'pl-1' }], pls: [{ id: 'pl-1' }],
    sessionParticipants: [
      { sessionId: 'session-a', rawSpeakerNormalized: '探索者', pcId: 'pc-a', plId: 'pl-1', role: 'PC' },
      { sessionId: 'session-b', rawSpeakerNormalized: '探索者', pcId: 'pc-a', plId: 'pl-1', role: 'KPC' }
    ]
  };
  assert.equal(identity.resolveSpeaker({ ...base, sessionId: 'session-a' }).role, 'PC');
  assert.equal(identity.resolveSpeaker({ ...base, sessionId: 'session-b' }).role, 'KPC');
  const kpcRoll = { sourceKey: 'source:kpc', isJudgement: true, result: 'success' };
  assert.equal(identity.applyRollOverrides([kpcRoll], [])[0].analysisExcluded, false);
});

test('mapping changes affect resolution without changing raw speaker', () => {
  const before = resolver();
  const after = identity.resolveSpeaker({ rawSpeaker: '探索者', sessionId: 'session-a', mappings: [{ rawNameNormalized: '探索者', pcId: 'pc-a', scope: 'global' }], pcs: [{ id: 'pc-a' }] });
  assert.equal(before.rawSpeaker, after.rawSpeaker);
  assert.notEqual(before.pcId, after.pcId);
});

test('roll overrides preserve raw roll and independently control analysis and savings', () => {
  const roll = { id: 'r1', sourceKey: 'source:abc', rawCommand: 'CCB<=50', resultRaw: '成功', isJudgement: true, result: 'success', rolledValue: 20 };
  const override = identity.buildRollOverride(roll.sourceKey, { analysisExcluded: true, savingsExcluded: false, exclusionReason: 'KPC' });
  const applied = identity.applyRollOverrides([roll], [override])[0];
  assert.equal(applied.id, 'r1');
  assert.equal(applied.analysisExcluded, true);
  assert.equal(applied.savingsExcluded, false);
  assert.equal(applied.rawCommand, 'CCB<=50');
  assert.equal(applied.resultRaw, '成功');
  assert.equal(override.sourceKey, roll.sourceKey);
});

test('reparse can reapply an override by stable source key', () => {
  const old = { id: 'old', sourceKey: 'source:same', result: 'fumble' };
  const reparsed = { id: 'new', sourceKey: 'source:same', result: 'fumble' };
  const override = identity.buildRollOverride(old.sourceKey, { analysisExcluded: false, savingsExcluded: true });
  assert.equal(identity.applyRollOverrides([reparsed], [override])[0].savingsExcluded, true);
});

test('session participant savings exclusion is separate from analysis exclusion', () => {
  const participant = { role: 'KPC', savingsExcluded: true };
  const roll = identity.applyRollOverrides([{ sourceKey: 'source:kpc', isJudgement: true }], [])[0];
  assert.equal(participant.savingsExcluded, true);
  assert.equal(roll.analysisExcluded, false);
});
