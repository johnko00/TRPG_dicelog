#!/usr/bin/env node

/*
 * Anonymous dashboard coverage audit for local CCFOLIA exports.
 * CCFOLIA HTML contains messages, while session date/image metadata lives in
 * IndexedDB. Therefore this script reports parser-derived roll coverage and
 * explicitly reports metadata that cannot be inferred from the HTML alone.
 */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');

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

function auditFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
  const rolls = items.filter(item => item.itemType === 'roll').flatMap(item => item.rollData?.rolls || [item.rollData]);
  return { messageCount: items.length, analysisJudgementRolls: rolls.filter(roll => roll.isJudgement && roll.result !== 'unknown').length, analysisExcludedRolls: 0 };
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) { console.error('Usage: node scripts/audit-dashboard.js <html-file-or-directory> [...]'); process.exitCode = 2; return; }
  const files = collectFiles(inputs);
  if (!files.length) { console.error('No HTML files found in the supplied paths.'); process.exitCode = 2; return; }
  const summaries = files.map(auditFile);
  const totals = summaries.reduce((sum, item) => { sum.messageCount += item.messageCount; sum.analysisJudgementRolls += item.analysisJudgementRolls; sum.analysisExcludedRolls += item.analysisExcludedRolls; return sum; }, { messageCount: 0, analysisJudgementRolls: 0, analysisExcludedRolls: 0 });
  console.log(JSON.stringify({ logCount: files.length, sessionTotal: files.length, dateStartWithSessionMetadata: 0, dateStartWithoutSessionMetadata: files.length, ...totals, imageSessions: { withImage: 0, withoutImage: files.length }, duplicateDateCount: 0, sameDayMaxSessionCount: 0, metadataNote: 'HTML audit cannot infer IndexedDB session.dateStart/imageAssetId; dashboard runtime reads those stores directly.', localOnly: true }, null, 2));
}

main();
