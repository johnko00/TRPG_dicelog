const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');

const fixturePath = path.join(__dirname, 'fixtures', 'representative-messages.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const parsed = parser.parseMessages(fixture);
const htmlFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'anonymous-ccfolia.html'), 'utf8');

function decodeFixtureText(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// Node intentionally has no DOM dependency in this project. This tiny adapter
// models only the document/span methods used by extractMessagesFromDocument.
function fixtureDocumentFromHtml(html) {
  const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(match => {
    const spans = Array.from(match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
      .map(span => ({ textContent: decodeFixtureText(span[1]) }));
    return {
      textContent: spans.map(span => span.textContent).join(''),
      querySelectorAll(selector) {
        return selector === 'span' ? spans : [];
      }
    };
  });
  return {
    querySelectorAll(selector) {
      return selector === 'p' ? paragraphs : [];
    }
  };
}

test('fixture parses without dropping messages and carries parserVersion', () => {
  assert.equal(parsed.length, fixture.length);
  assert.ok(parsed.every(item => item.parserVersion === parser.PARSER_VERSION));
  assert.deepEqual(parsed.at(-1).itemType, 'message');
  assert.equal(parsed.at(-1).rawSpeaker, '探索者A');
});

test('anonymous CCFOLIA HTML flows through extraction and parsing', () => {
  const items = parser.parseCcfoliaHtml(htmlFixture, { document: fixtureDocumentFromHtml(htmlFixture) });
  assert.equal(items.length, 3);
  assert.equal(items[0].channel, '[main]');
  assert.equal(items[0].rawSpeaker, '探索者A');
  assert.equal(items[0].itemType, 'roll');
  assert.equal(items[0].rollData.rolledValue, 19);
  assert.equal(items[1].itemType, 'status');
  assert.equal(items[2].itemType, 'message');
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

test('CoC7 selected value uses the final adopted-value segment', () => {
  const bonus = parser.parseMessage({ body: 'CC1<=50 目星 (1D100<=50) ボーナス・ペナルティダイス[1] ＞ 44, 54 ＞ 44 ＞ レギュラー成功' });
  const penalty = parser.parseMessage({ body: 'CC-1<=50 目星 (1D100<=50) ボーナス・ペナルティダイス[-1] ＞ 3, 93 ＞ 93 ＞ 失敗' });
  const reversedCandidates = parser.parseMessage({ body: 'CC1<=50 目星 (1D100<=50) ボーナス・ペナルティダイス[1] ＞ 54, 44 ＞ 54 ＞ レギュラー成功' });
  assert.equal(bonus.rollData.rolledValue, 44);
  assert.equal(penalty.rollData.rolledValue, 93);
  assert.equal(reversedCandidates.rollData.rolledValue, 54);
});

test('parseResult prioritizes critical and normalizes each result label', () => {
  assert.equal(parser.parseResult('決定的成功/スペシャル', 'CoC6').normalizedResult, 'critical');
  assert.equal(parser.parseResult('レギュラー成功', 'CoC7').normalizedResult, 'success');
  assert.equal(parser.parseResult('ハード成功', 'CoC7').normalizedResult, 'hardSuccess');
  assert.equal(parser.parseResult('イクストリーム成功', 'CoC7').normalizedResult, 'extremeSuccess');
  assert.equal(parser.parseResult('失敗', 'CoC7').normalizedResult, 'failure');
  assert.equal(parser.parseResult('ファンブル', 'CoC7').normalizedResult, 'fumble');
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

test('unsupported dice-like commands remain unknown and preserve source fields', () => {
  for (const body of [
    'CBR<=50 (1D100<=50) ＞ 12 ＞ 成功',
    'choice[成功,失敗] ＞ 成功',
    'res 1d100 ＞ 42',
    'DM<=30 ＞ 18 ＞ 成功'
  ]) {
    const item = parser.parseMessage({ sequence: 7, channel: '[other]', rawSpeaker: '探索者A', body, rawText: `raw:${body}` });
    assert.equal(item.itemType, 'unknown');
    assert.equal(item.rawText, `raw:${body}`);
    assert.equal(item.rawSpeaker, '探索者A');
    assert.equal(item.channel, '[other]');
    assert.equal(item.sequence, 7);
    assert.equal(item.parserVersion, parser.PARSER_VERSION);
  }
  assert.equal(parser.parseMessage({ body: '普通の会話 ＞ これは会話です' }).itemType, 'message');
});

test('dice notation embedded in narrative text is not treated as a roll command', () => {
  const item = parser.parseMessage({ body: 'ナレーション内に 1d3 という表記がある ＞ 続きの文章' });
  assert.equal(item.itemType, 'message');
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

test('roll record builder keeps parsed item and source ordering for every roll', () => {
  const item = parser.parseMessage({ sequence: 12, rawSpeaker: '探索者A', body: 'X3 sccb<=30 正気度喪失 #1 (1D100<=30) ＞ 31 ＞ 失敗 #2 (1D100<=30) ＞ 12 ＞ 成功' });
  const records = item.rollData.rolls.map((rollData, rollIndex) => parser.buildRollRecord(item, rollData, {
    id: `roll-${rollIndex}`,
    parsedItemId: 'parsed-1',
    sessionId: 'session-1',
    sourceLogId: 'source-1',
    rollIndex
  }));
  assert.deepEqual(records.map(record => [record.parsedItemId, record.rollIndex, record.sourceRollIndex, record.parentSequence, record.sequenceInSession]), [
    ['parsed-1', 0, 1, 12, 12],
    ['parsed-1', 1, 2, 12, 12]
  ]);
});

test('status record builder contains all IndexedDB fields', () => {
  const item = parsed[14];
  const record = parser.buildStatusChangeRecord(item, {
    id: 'status-1',
    parsedItemId: 'parsed-1',
    sessionId: 'session-1',
    sourceLogId: 'source-1'
  });
  assert.deepEqual(record, {
    id: 'status-1',
    parsedItemId: 'parsed-1',
    sessionId: 'session-1',
    sourceLogId: 'source-1',
    parserVersion: parser.PARSER_VERSION,
    rawSpeaker: 'system',
    speaker: '真壁 凌',
    statusName: 'SAN',
    stat: 'SAN',
    before: 87,
    after: 86,
    delta: -1,
    rawText: '[ 真壁 凌 ] SAN : 87 → 86',
    sequenceInSession: 15
  });
});

test('secret prefixes are retained while parsing generic and judgement rolls', () => {
  const generic = parser.parseMessage({ body: 'S1D10 (1D10) ＞ 7' });
  const bareGeneric = parser.parseMessage({ body: 'D10 (D10) ＞ 5' });
  const judgement = parser.parseMessage({ body: 'SCC<=50 目星 (1D100<=50) ＞ 30 ＞ 成功' });
  assert.equal(generic.itemType, 'roll');
  assert.equal(generic.isSecret, true);
  assert.equal(generic.rollData.isSecret, true);
  assert.equal(generic.rollData.isJudgement, false);
  assert.equal(generic.rollData.rolledValue, 7);
  assert.equal(bareGeneric.itemType, 'roll');
  assert.equal(bareGeneric.rollData.isJudgement, false);
  assert.equal(bareGeneric.rollData.rolledValue, 5);
  assert.equal(judgement.itemType, 'roll');
  assert.equal(judgement.rollData.isSecret, true);
  assert.equal(judgement.rollData.system, 'CoC7');
  assert.equal(judgement.rollData.targetValue, 50);
  assert.equal(judgement.rollData.rolledValue, 30);
  assert.equal(judgement.rollData.normalizedResult, 'success');
});

test('RESB/SRESB and CBRB preserve safe judgement fields without guessing system', () => {
  const res = parser.parseMessage({ body: 'RES(STR-DEX) (1D100<=50) ＞ 40 ＞ 成功' });
  const resb = parser.parseMessage({ body: 'RESB(STR-DEX) (1D100<=50) ＞ 40 ＞ 成功' });
  const secretResb = parser.parseMessage({ body: 'SRESB(STR-DEX) (1D100<=50) ＞ 40 ＞ 成功' });
  const cbrb = parser.parseMessage({ body: 'CBRB(50,40) (1D100<=50,1D100<=40) ＞ 40 [成功,失敗] ＞ 成功' });
  for (const item of [res, resb, secretResb, cbrb]) {
    assert.equal(item.itemType, 'roll');
    assert.equal(item.rollData.system, 'unknown');
    assert.equal(item.rollData.isJudgement, true);
    assert.equal(item.rollData.rolledValue, 40);
    assert.equal(item.rollData.normalizedResult, 'success');
  }
  assert.equal(resb.rollData.targetRaw, '50');
  assert.equal(resb.rollData.targetValue, 50);
  assert.equal(res.rollData.targetValue, 50);
  assert.equal(secretResb.rollData.isSecret, true);
  assert.equal(cbrb.rollData.targetValue, null);
});

test('unsupported DiceBot commands become unknown without capturing narrative text', () => {
  const x6 = parser.parseMessage({ body: 'X6{2D6+4}' });
  const secretChoice = parser.parseMessage({ body: 'SCHOICE[A,B] (choice[A,B]) ＞ A' });
  const bmr = parser.parseMessage({ body: 'BMR(foo) ＞ 1' });
  const narrative = parser.parseMessage({ body: '本文中に 1d3 と SCC という文字がある ＞ 会話' });
  assert.equal(x6.itemType, 'unknown');
  assert.equal(x6.unknownReason, 'unparsed-dice-message');
  assert.equal(secretChoice.itemType, 'unknown');
  assert.equal(secretChoice.isSecret, true);
  assert.equal(bmr.itemType, 'unknown');
  assert.equal(narrative.itemType, 'message');
});

test('SANC remains unknown when the fixture has no safe adopted roll value', () => {
  const item = parser.parseMessage({ body: 'SANC ＜ 1D100/1D10' });
  assert.equal(item.itemType, 'unknown');
  assert.equal(item.unknownReason, 'unsupported-dice-command');
  assert.equal(item.rawText, 'SANC ＜ 1D100/1D10');
});

test('secret roll flag is persisted into roll records', () => {
  const item = parser.parseMessage({ sequence: 4, body: 'S1D6 (1D6) ＞ 3' });
  const record = parser.buildRollRecord(item, item.rollData, {
    id: 'roll-secret',
    parsedItemId: 'parsed-secret',
    sessionId: 'session-secret',
    sourceLogId: 'source-secret'
  });
  assert.equal(record.isSecret, true);
  assert.equal(record.parsedItemId, 'parsed-secret');
});
