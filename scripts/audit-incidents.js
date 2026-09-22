#!/usr/bin/env node

/* Anonymous incident audit. It never prints local file names, names, skills, or log text. */
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
function finite(value, seen) {
  if (typeof value === 'number') return Number.isFinite(value) ? 0 : 1;
  if (!value || typeof value !== 'object') return 0;
  const visited = seen || new Set(); if (visited.has(value)) return 0; visited.add(value);
  return Object.values(value).reduce((sum, item) => sum + finite(item, visited), 0);
}
function auditFile(file, index) {
  const html = fs.readFileSync(file, 'utf8');
  const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
  identity.attachStableIdentity(items, { lineageId: `incident-audit:${index}` });
  const sessionId = `incident-audit-session:${index}`;
  const rolls = []; const statusChanges = [];
  items.forEach((item, itemIndex) => {
    const parsedItemId = item.id || `audit-item:${index}:${itemIndex}`;
    if (item.itemType === 'roll') {
      const sourceRolls = item.rollData?.rolls || [item.rollData];
      sourceRolls.forEach((roll, rollIndex) => rolls.push(parser.buildRollRecord(item, roll, { id: `audit-roll:${index}:${rollIndex}`, parsedItemId, sessionId, sourceLogId: `audit-log:${index}`, rollIndex })));
    }
    if (item.itemType === 'status') statusChanges.push(parser.buildStatusChangeRecord(item, { id: `audit-status:${index}:${itemIndex}`, parsedItemId, sessionId, sourceLogId: `audit-log:${index}` }));
  });
  const context = analysis.createAnalysisContext({ sessions: [{ id: sessionId, title: '', dateStart: null }], rolls, pcs: [], pls: [], mappings: [], sessionParticipants: [], playGroups: [], sessionPlayGroups: [], overrides: [], statusChanges });
  const filtered = analysis.applyAnalysisFilter(context, {});
  const incidents = analysis.detectIncidents(filtered, {});
  const by = key => incidents.reduce((map, item) => { const value = item[key] || 'unknown'; map[value] = (map[value] || 0) + 1; return map; }, {});
  const summary = analysis.calculateIncidentSummary(incidents);
  const duplicateIds = incidents.length - new Set(incidents.map(item => item.id)).size;
  return {
    messageCount: items.length, rollCount: rolls.length, incidentCount: incidents.length,
    detectorCounts: by('detectorId'), categoryCounts: by('category'), severityCounts: by('severity'),
    exact1Count: summary.exact1Count, exact100Count: summary.exact100Count,
    criticalCount: summary.criticalCount, fumbleCount: summary.fumbleCount,
    successStreakCount: incidents.filter(item => item.detectorId === 'success-streak').length,
    failureStreakCount: incidents.filter(item => item.detectorId === 'failure-streak').length,
    rareSkillIncidentCount: incidents.filter(item => item.category === 'skill').length,
    sanDropCount: incidents.filter(item => item.detectorId === 'san-drop').length,
    hpDropCount: incidents.filter(item => item.detectorId === 'hp-drop').length,
    maxSuccessStreak: summary.successStreakMax, maxFailureStreak: summary.failureStreakMax,
    maxSanDrop: summary.sanDropMax, maxHpDrop: summary.hpDropMax,
    duplicateIncidentIdCount: duplicateIds,
    invalidSourceReferenceCount: analysis.countInvalidSourceReferences(incidents, filtered),
    nanOrInfinityCount: finite(incidents),
    negativeCount: Object.values(summary).filter(value => typeof value === 'number' && value < 0).length
  };
}
function mergeMap(target, value) { Object.entries(value || {}).forEach(([key, count]) => { target[key] = (target[key] || 0) + count; }); }
function main() {
  const inputs = process.argv.slice(2); if (!inputs.length) { console.error('Usage: node scripts/audit-incidents.js <html-file-or-directory> [...]'); process.exitCode = 2; return; }
  const files = collectFiles(inputs); if (!files.length) { console.error('No HTML files found in the supplied paths.'); process.exitCode = 2; return; }
  const summaries = files.map(auditFile);
  const total = { logCount: files.length, messageCount: 0, rollCount: 0, incidentCount: 0, detectorCounts: {}, categoryCounts: {}, severityCounts: {}, exact1Count: 0, exact100Count: 0, criticalCount: 0, fumbleCount: 0, successStreakCount: 0, failureStreakCount: 0, rareSkillIncidentCount: 0, sanDropCount: 0, hpDropCount: 0, maxSuccessStreak: 0, maxFailureStreak: 0, maxSanDrop: 0, maxHpDrop: 0, duplicateIncidentIdCount: 0, invalidSourceReferenceCount: 0, nanOrInfinityCount: 0, negativeCount: 0 };
  summaries.forEach(summary => Object.entries(summary).forEach(([key, value]) => { if (key.endsWith('Counts') && ['detectorCounts', 'categoryCounts', 'severityCounts'].includes(key)) mergeMap(total[key], value); else if (['maxSuccessStreak', 'maxFailureStreak', 'maxSanDrop', 'maxHpDrop'].includes(key)) total[key] = Math.max(total[key], value); else if (typeof value === 'number') total[key] += value; }));
  console.log(JSON.stringify({ ...total, metadataNote: 'Anonymous derived incident audit. Names, skills, scenario text, and file names are never printed.', localOnly: true }, null, 2));
}
main();
