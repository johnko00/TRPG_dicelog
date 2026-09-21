#!/usr/bin/env node

/*
 * Audit parser output for local CCFOLIA exports.
 *
 * Usage:
 *   node scripts/audit-parser.js tests/fixtures/local
 *   node scripts/audit-parser.js session-a.html session-b.html
 *
 * This script intentionally prints counts and short command signatures only.
 * It never prints message bodies, speaker names, or scenario text.
 */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');

const RESULT_KEYS = ['critical', 'special', 'success', 'hardSuccess', 'extremeSuccess', 'failure', 'fumble'];

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ''));
}

// CCFOLIA exports use p > span[main, speaker, body]. This small adapter keeps
// the audit script dependency-free while production continues to use DOMParser.
function documentFromHtml(html) {
  const paragraphs = Array.from(String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(match => {
    const spans = Array.from(match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
      .map(span => ({ textContent: stripTags(span[1]).trim() }));
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

function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
        if (/\.(?:html?|HTML?)$/.test(entry.name)) files.push(path.join(input, entry.name));
      }
    } else if (/\.(?:html?|HTML?)$/.test(input)) {
      files.push(input);
    }
  }
  return files.sort();
}

function commandSignature(item) {
  const command = String(item.unknownCommand || item.body || '').split('＞')[0].trim();
  if (!command) return '(empty)';
  return command
    .replace(/\([^)]*\)/g, '(...)')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

function unknownCategory(item) {
  const command = String(item.unknownCommand || item.body || '').trim();
  if (/^CBR\b/i.test(command)) return 'CBR';
  if (/^choice\b/i.test(command)) return 'choice';
  if (/^res\b/i.test(command)) return 'res';
  if (/^sanc\b/i.test(command)) return 'sanc';
  if (/^DM\b/i.test(command)) return 'DM';
  if (/^D66\b/i.test(command)) return 'D66';
  if (/^(?:CC|CCB)\b/i.test(command)) return 'unsupported-CoC';
  if (/^[A-Z][A-Z0-9_-]{1,}\b/i.test(command)) return 'other-DiceBot';
  return 'other';
}

function emptySummary(file) {
  return {
    logName: path.basename(file),
    parserVersion: parser.PARSER_VERSION,
    totalMessages: 0,
    itemTypes: { roll: 0, status: 0, message: 0, unknown: 0 },
    rollCount: 0,
    judgementRollCount: 0,
    nonJudgementDiceCount: 0,
    systems: { CoC6: 0, CoC7: 0, unknown: 0 },
    results: Object.fromEntries(RESULT_KEYS.map(key => [key, 0])),
    unknownReasons: {},
    unknownCategories: {},
    suspiciousRolls: { count: 0, signatures: {} },
    statusNames: {},
    multiRollMessages: 0,
    expandedRollCount: 0,
    targetMissingCount: 0,
    rolledValueMissingCount: 0
  };
}

function addCount(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function auditFile(file) {
  const summary = emptySummary(file);
  const html = fs.readFileSync(file, 'utf8');
  const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
  summary.totalMessages = items.length;
  for (const item of items) {
    addCount(summary.itemTypes, item.itemType);
    if (item.itemType === 'status') {
      addCount(summary.statusNames, item.statusData?.statusName || 'unknown');
      continue;
    }
    if (item.itemType === 'unknown') {
      addCount(summary.unknownReasons, item.unknownReason || 'unknown');
      addCount(summary.unknownCategories, unknownCategory(item));
      continue;
    }
    if (item.itemType !== 'roll') continue;
    const rollEntries = item.rollData?.rolls || [item.rollData];
    if (rollEntries.length > 1) summary.multiRollMessages += 1;
    summary.expandedRollCount += rollEntries.length;
    for (const roll of rollEntries) {
      summary.rollCount += 1;
      addCount(summary.systems, roll.system || 'unknown');
      if (roll.isJudgement) summary.judgementRollCount += 1;
      else summary.nonJudgementDiceCount += 1;
      if (roll.normalizedResult && summary.results[roll.normalizedResult] != null) {
        summary.results[roll.normalizedResult] += 1;
      }
      if (roll.isJudgement && roll.targetValue == null) summary.targetMissingCount += 1;
      if (roll.isJudgement && roll.rolledValue == null) summary.rolledValueMissingCount += 1;
      if (roll.system === 'unknown' && roll.result === 'unknown' && roll.targetValue == null && roll.rolledValue == null) {
        summary.suspiciousRolls.count += 1;
        addCount(summary.suspiciousRolls.signatures, commandSignature(item));
      }
    }
  }
  return summary;
}

function aggregateSummaries(summaries) {
  const totals = emptySummary('ALL');
  for (const summary of summaries) {
    totals.totalMessages += summary.totalMessages;
    for (const key of Object.keys(totals.itemTypes)) totals.itemTypes[key] += summary.itemTypes[key] || 0;
    totals.rollCount += summary.rollCount;
    totals.judgementRollCount += summary.judgementRollCount;
    totals.nonJudgementDiceCount += summary.nonJudgementDiceCount;
    for (const key of Object.keys(totals.systems)) totals.systems[key] += summary.systems[key] || 0;
    for (const key of RESULT_KEYS) totals.results[key] += summary.results[key] || 0;
    for (const [key, value] of Object.entries(summary.unknownReasons)) addCount(totals.unknownReasons, key, value);
    for (const [key, value] of Object.entries(summary.unknownCategories)) addCount(totals.unknownCategories, key, value);
    for (const [key, value] of Object.entries(summary.suspiciousRolls.signatures)) addCount(totals.suspiciousRolls.signatures, key, value);
    totals.suspiciousRolls.count += summary.suspiciousRolls.count;
    for (const [key, value] of Object.entries(summary.statusNames)) addCount(totals.statusNames, key, value);
    totals.multiRollMessages += summary.multiRollMessages;
    totals.expandedRollCount += summary.expandedRollCount;
    totals.targetMissingCount += summary.targetMissingCount;
    totals.rolledValueMissingCount += summary.rolledValueMissingCount;
  }
  return totals;
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error('Usage: node scripts/audit-parser.js <html-file-or-directory> [...]');
    process.exitCode = 2;
    return;
  }
  const files = collectFiles(inputs);
  if (!files.length) {
    console.error('No HTML files found in the supplied paths.');
    process.exitCode = 2;
    return;
  }
  const summaries = files.map(auditFile);
  console.log(JSON.stringify({ files: summaries, totals: aggregateSummaries(summaries) }, null, 2));
}

main();
