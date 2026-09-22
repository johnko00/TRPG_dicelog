#!/usr/bin/env node

/* Anonymous analysis-foundation audit for local CCFOLIA exports. */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');
const identity = require('../src/identity.js');
const analysis = require('../src/analysis.js');

function decodeHtml(value) {
  return String(value).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function stripTags(value) { return decodeHtml(String(value).replace(/<[^>]*>/g, '')); }

function documentFromHtml(html) {
  const paragraphs = Array.from(String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(match => {
    const spans = Array.from(match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)).map(span => ({ textContent: stripTags(span[1]).trim() }));
    return { textContent: spans.map(span => span.textContent).join(' '), querySelectorAll: selector => selector === 'span' ? spans : [] };
  });
  return { querySelectorAll: selector => selector === 'p' ? paragraphs : [] };
}

function collectFiles(inputs) {
  const files = [];
  inputs.forEach(input => {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) fs.readdirSync(input, { withFileTypes: true }).forEach(entry => { if (/\.html?$/i.test(entry.name)) files.push(path.join(input, entry.name)); });
    else if (/\.html?$/i.test(input)) files.push(input);
  });
  return files.sort();
}

function auditFile(file, index) {
  const html = fs.readFileSync(file, 'utf8');
  const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
  identity.attachStableIdentity(items, { lineageId: `audit:${index}` });
  const sessionId = `audit-session:${index}`;
  const rolls = [];
  items.filter(item => item.itemType === 'roll').forEach(item => {
    const sourceRolls = item.rollData?.rolls || [item.rollData];
    sourceRolls.forEach((roll, rollIndex) => rolls.push(parser.buildRollRecord(item, roll, { id: `audit-roll:${index}:${rollIndex}`, parsedItemId: item.id || `audit-item:${index}`, sessionId, sourceLogId: `audit-log:${index}`, rollIndex })));
  });
  const context = analysis.createAnalysisContext({ sessions: [{ id: sessionId, dateStart: null }], rolls, pcs: [], pls: [], mappings: [], sessionParticipants: [], playGroups: [], sessionPlayGroups: [], overrides: [], statusChanges: [] });
  const filtered = analysis.applyAnalysisFilter(context, {});
  const stats = analysis.calculateBasicStats(filtered);
  const systemCounts = {};
  rolls.forEach(roll => { const system = roll.system || 'unknown'; systemCounts[system] = (systemCounts[system] || 0) + 1; });
  return {
    messageCount: items.length,
    rollCount: rolls.length,
    analysisTargetRollCount: filtered.resolvedRolls.length,
    analysisExcludedCount: rolls.filter(roll => roll.analysisExcluded).length,
    judgementCount: stats.judgementCount,
    classifiedJudgementCount: stats.classifiedJudgementCount,
    unknownJudgementCount: stats.unknownJudgementCount,
    systemCounts,
    roleResolvedCount: rolls.filter(roll => roll.role).length,
    roleUnresolvedCount: rolls.filter(roll => !roll.role).length,
    pcResolvedCount: rolls.filter(roll => roll.pcId).length,
    pcUnresolvedCount: rolls.filter(roll => !roll.pcId).length,
    plResolvedCount: rolls.filter(roll => roll.plId).length,
    plUnresolvedCount: rolls.filter(roll => !roll.plId).length,
    groupConfiguredSessionCount: 0,
    groupUngroupedSessionCount: 1
  };
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) { console.error('Usage: node scripts/audit-analysis.js <html-file-or-directory> [...]'); process.exitCode = 2; return; }
  const files = collectFiles(inputs);
  if (!files.length) { console.error('No HTML files found in the supplied paths.'); process.exitCode = 2; return; }
  const summaries = files.map(auditFile);
  const total = { logCount: files.length, messageCount: 0, rollCount: 0, analysisTargetRollCount: 0, analysisExcludedCount: 0, judgementCount: 0, classifiedJudgementCount: 0, unknownJudgementCount: 0, systemCounts: {}, roleResolvedCount: 0, roleUnresolvedCount: 0, pcResolvedCount: 0, pcUnresolvedCount: 0, plResolvedCount: 0, plUnresolvedCount: 0, groupConfiguredSessionCount: 0, groupUngroupedSessionCount: 0 };
  summaries.forEach(summary => Object.entries(summary).forEach(([key, value]) => {
    if (key === 'systemCounts') Object.entries(value).forEach(([system, count]) => { total.systemCounts[system] = (total.systemCounts[system] || 0) + count; });
    else if (key !== 'messageCount' && key !== 'rollCount' && key !== 'analysisTargetRollCount' && key !== 'analysisExcludedCount' && key !== 'judgementCount' && key !== 'classifiedJudgementCount' && key !== 'unknownJudgementCount' && key !== 'roleResolvedCount' && key !== 'roleUnresolvedCount' && key !== 'pcResolvedCount' && key !== 'pcUnresolvedCount' && key !== 'plResolvedCount' && key !== 'plUnresolvedCount' && key !== 'groupConfiguredSessionCount' && key !== 'groupUngroupedSessionCount') return;
    else total[key] += value;
  }));
  console.log(JSON.stringify({ ...total, metadataNote: 'This audit uses anonymous parser output only. Real names, scenario text, and file names are never printed.', localOnly: true }, null, 2));
}

main();
