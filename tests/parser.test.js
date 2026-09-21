const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');

const fixturePath = path.join(__dirname, 'fixtures', 'representative-messages.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const parsed = parser.parseMessages(fixture);

test('fixture parses without dropping messages and carries parserVersion', () => {
  assert.equal(parsed.length, fixture.length);
  assert.ok(parsed.every(item => item.parserVersion === parser.PARSER_VERSION));
  assert.deepEqual(parsed.at(-1).itemType, 'message');
  assert.equal(parsed.at(-1).rawSpeaker, '探索者A');
});

test('CoC6 success/special/critical/fumble and raw/effective targets', () => {
  const [success, special, critical, fumble, formula, division] = parsed;
  assert.equal(success.rollData.result, 'success');
  assert.equal(special.rollData.normalizedResult, 'special');
  assert.equal(critical.rollData.normalizedResult, 'critical');
  assert.equal(fumble.rollData.normalizedResult, 'fumble');
  assert.equal(formula.rollData.targetRaw, '14*5');
  assert.equal(formula.rollData.targetValue, 70);
  assert.equal(division.rollData.targetRaw, '45/2');
  assert.equal(division.rollData.targetValue, 22);
});

test('CoC7 regular, bonus, penalty, hard and extreme keep the selected roll', () => {
  const [regular, regular2, bonus, penalty, hard, extreme] = parsed.slice(6, 12);
  assert.equal(regular.rollData.system, 'CoC7');
  assert.equal(regular.rollData.rolledValue, 71);
  assert.equal(regular2.rollData.normalizedResult, 'success');
  assert.equal(bonus.rollData.bonusPenalty.value, 1);
  assert.equal(bonus.rollData.rolledValue, 44);
  assert.equal(penalty.rollData.bonusPenalty.type, 'penalty');
  assert.equal(penalty.rollData.rolledValue, 93);
  assert.equal(hard.rollData.difficulty, 'hard');
  assert.equal(hard.rollData.targetValue, 25);
  assert.equal(extreme.rollData.difficulty, 'extreme');
  assert.equal(extreme.rollData.targetValue, 10);
});

test('SAN judgement and plain dice are separated for analysis', () => {
  const san = parsed[12].rollData;
  const plain = parsed[13].rollData;
  assert.equal(san.isJudgement, true);
  assert.equal(san.skillRaw, '正気度ロール');
  assert.equal(plain.rolledValue, 17);
  assert.equal(plain.result, 'unknown');
  assert.equal(plain.isJudgement, false);
});

test('status changes retain speaker, stat, before, after and delta', () => {
  const [san, hp, mp] = parsed.slice(14, 17).map(item => item.statusData);
  assert.deepEqual(san, { speaker: '真壁 凌', statusName: 'SAN', stat: 'SAN', before: 87, after: 86, delta: -1, rawText: '[ 真壁 凌 ] SAN : 87 → 86' });
  assert.equal(hp.delta, -1);
  assert.equal(mp.delta, 2);
});

test('success-rate inputs exclude non-judgement dice and unknown results', () => {
  const judgementItems = parsed.filter(item => item.itemType === 'roll' && item.rollData.isJudgement);
  const nonJudgement = parsed.filter(item => item.itemType === 'roll' && !item.rollData.isJudgement);
  assert.equal(nonJudgement.length, 1);
  assert.ok(judgementItems.every(item => item.rollData.normalizedResult !== 'unknown'));
  assert.ok(nonJudgement.every(item => item.rollData.normalizedResult === 'unknown'));
});

test('safe target expression evaluator rejects executable input', () => {
  assert.equal(parser.evaluateTargetExpression('14*5'), 70);
  assert.equal(parser.evaluateTargetExpression('45/2'), 22);
  assert.equal(parser.evaluateTargetExpression('globalThis.process'), null);
});

test('X5 style messages expose multiple roll records without losing the source item', () => {
  const item = parser.parseMessage({
    rawSpeaker: '探索者A',
    body: 'X5 sccb<=30 正気度喪失\n#1 (1D100<=30) ＞ 31 ＞ 失敗\n#2 (1D100<=30) ＞ 12 ＞ 成功\n#3 (1D100<=30) ＞ 1 ＞ 成功'
  });
  assert.equal(item.itemType, 'roll');
  assert.equal(item.rollData.rolls.length, 3);
  assert.equal(item.rollData.rolls[0].rolledValue, 31);
  assert.equal(item.rollData.rolls[1].normalizedResult, 'success');
  assert.equal(item.rollData.rolls[2].rolledValue, 1);
  assert.equal(item.rollData.skillRaw, '正気度喪失');
});
