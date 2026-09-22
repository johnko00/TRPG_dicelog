#!/usr/bin/env node

/*
 * Dependency-free Phase 3 savings audit for ignored local CCFOLIA exports.
 * The report contains counts and rule-hit metadata only; it never prints
 * message bodies or speaker names.
 *
 * Usage: node scripts/audit-savings.js tests/fixtures/local
 */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');
const identity = require('../src/identity.js');
const savings = require('../src/savings.js');

function decodeHtml(value) {
  return String(value).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function stripTags(value) { return decodeHtml(String(value).replace(/<[^>]*>/g, '')); }

function documentFromHtml(html) {
  const paragraphs = Array.from(String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(match => {
    const spans = Array.from(match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
      .map(span => ({ textContent: stripTags(span[1]).trim() }));
    return { textContent: spans.map(span => span.textContent).join(' '), querySelectorAll: selector => selector === 'span' ? spans : [] };
  });
  return { querySelectorAll: selector => selector === 'p' ? paragraphs : [] };
}

function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
      if (/\.html?$/i.test(entry.name)) files.push(path.join(input, entry.name));
    }
    else if (/\.html?$/i.test(input)) files.push(input);
  }
  return files.sort();
}

function emptyCounts() {
  return { logs: 0, messages: 0, rollRecords: 0, judgementRolls: 0, nonJudgementDice: 0, status: 0, message: 0, unknown: 0,
    systems: { CoC6: 0, CoC7: 0, unknown: 0 }, results: { critical: 0, special: 0, success: 0, hard: 0, extreme: 0, failure: 0, fumble: 0, unknown: 0 },
    sanChecks: 0, multiRollMessages: 0, targetMissing: 0, judgementRolledMissing: 0, sourceKeyMissing: 0, candidateKeyDuplicates: 0,
    candidateCount: 0, sessionCandidateCount: 0, ruleHits: {}, roleCandidateCounts: { PC: 0, KPC: 0, GM: 0, unresolved: 0 }, savingsExcludedCount: 0 };
}

function add(map, key, amount = 1) { map[key] = (map[key] || 0) + amount; }

function auditFile(file, index) {
  const html = fs.readFileSync(file, 'utf8');
  const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
  const lineageId = `lineage:audit-${identity.stableHash(path.basename(file))}`;
  identity.attachStableIdentity(items, { lineageId });
  const sessionId = `session:audit-${identity.stableHash(path.basename(file))}`;
  const sourceLogId = `source:audit-${identity.stableHash(path.basename(file))}`;
  const rolls = [];
  const counts = emptyCounts();
  counts.logs = 1; counts.messages = items.length;
  for (const item of items) {
    add(counts, item.itemType);
    if (item.itemType === 'status') continue;
    if (item.itemType !== 'roll') continue;
    const values = item.rollData?.rolls || [item.rollData];
    if (values.length > 1) counts.multiRollMessages += 1;
    values.forEach((roll, rollIndex) => {
      const record = parser.buildRollRecord(item, roll, { id: `audit-roll:${index}:${item.sequence}:${rollIndex}`, parsedItemId: `audit-item:${index}:${item.sequence}`, sessionId, sourceLogId, parserVersion: parser.PARSER_VERSION, rollIndex });
      rolls.push(record);
      counts.rollRecords += 1;
      if (record.isJudgement) counts.judgementRolls += 1; else counts.nonJudgementDice += 1;
      add(counts.systems, record.system || 'unknown');
      add(counts.results, record.normalizedResult || 'unknown');
      if (record.isSanCheck) counts.sanChecks += 1;
      if (!record.sourceKey) counts.sourceKeyMissing += 1;
      if (record.isJudgement && record.targetValue == null) counts.targetMissing += 1;
      if (record.isJudgement && record.rolledValue == null) counts.judgementRolledMissing += 1;
    });
  }
  const rules = [
    { id: 'audit-judgement', name: 'judgement', amount: 500, amountMode: 'fixed', triggerType: 'roll', isEnabled: true, condition: { judgementOnly: true } },
    { id: 'audit-generic', name: 'generic-dice', amount: 100, amountMode: 'fixed', triggerType: 'roll', isEnabled: true, condition: { judgementOnly: false } },
    { id: 'audit-session', name: 'session', amount: 500, amountMode: 'fixed', triggerType: 'session', isEnabled: true, condition: {} }
  ];
  counts.savingsExcludedCount = rolls.filter(roll => roll.savingsExcluded).length;
  const candidates = savings.generateRollCandidates({ rolls, rules, mappings: [], pcs: [], pls: [], sessionParticipants: [], myPlId: null });
  const sessions = savings.generateSessionCandidates({ sessions: [{ id: sessionId }], rules, myPlId: null });
  counts.candidateCount = candidates.length; counts.sessionCandidateCount = sessions.length;
  const candidateKeys = new Set();
  candidates.forEach(candidate => { add(counts.ruleHits, candidate.ruleId); if (Object.prototype.hasOwnProperty.call(counts.roleCandidateCounts, candidate.role)) counts.roleCandidateCounts[candidate.role] += 1; else counts.roleCandidateCounts.unresolved += 1; if (candidateKeys.has(candidate.candidateKey)) counts.candidateKeyDuplicates += 1; candidateKeys.add(candidate.candidateKey); });
  return { logIndex: index, messageCount: counts.messages, rollRecords: counts.rollRecords, judgementRolls: counts.judgementRolls, nonJudgementDice: counts.nonJudgementDice, status: counts.status, message: counts.message, unknown: counts.unknown, candidateCount: counts.candidateCount, sessionCandidateCount: counts.sessionCandidateCount, sanChecks: counts.sanChecks, multiRollMessages: counts.multiRollMessages, targetMissing: counts.targetMissing, judgementRolledMissing: counts.judgementRolledMissing, sourceKeyMissing: counts.sourceKeyMissing, candidateKeyDuplicates: counts.candidateKeyDuplicates, savingsExcludedCount: counts.savingsExcludedCount, roleCandidateCounts: counts.roleCandidateCounts, ruleHits: counts.ruleHits };
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) { console.error('Usage: node scripts/audit-savings.js <html-file-or-directory> [...]'); process.exitCode = 2; return; }
  const files = collectFiles(inputs);
  if (!files.length) { console.error('No HTML files found in the supplied paths.'); process.exitCode = 2; return; }
  const logs = files.map((file, index) => auditFile(file, index + 1));
  const totals = logs.reduce((sum, log) => {
    for (const key of ['messageCount', 'rollRecords', 'judgementRolls', 'nonJudgementDice', 'status', 'message', 'unknown', 'candidateCount', 'sessionCandidateCount', 'sanChecks', 'multiRollMessages', 'targetMissing', 'judgementRolledMissing', 'sourceKeyMissing', 'candidateKeyDuplicates', 'savingsExcludedCount']) sum[key] += log[key];
    for (const [key, value] of Object.entries(log.roleCandidateCounts)) add(sum.roleCandidateCounts, key, value);
    for (const [key, value] of Object.entries(log.ruleHits)) add(sum.ruleHits, key, value);
    return sum;
  }, { logCount: logs.length, messageCount: 0, rollRecords: 0, judgementRolls: 0, nonJudgementDice: 0, status: 0, message: 0, unknown: 0, candidateCount: 0, sessionCandidateCount: 0, sanChecks: 0, multiRollMessages: 0, targetMissing: 0, judgementRolledMissing: 0, sourceKeyMissing: 0, candidateKeyDuplicates: 0, savingsExcludedCount: 0, roleCandidateCounts: { PC: 0, KPC: 0, GM: 0, unresolved: 0 }, ruleHits: {} });
  console.log(JSON.stringify({ parserVersion: parser.PARSER_VERSION, logs, totals, notes: { inputPathsAreLocalOnly: true, rulesAreSyntheticForCoverage: true, roleResolutionRequiresUserMappings: true } }, null, 2));
}

main();
