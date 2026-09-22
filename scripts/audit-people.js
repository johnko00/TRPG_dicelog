#!/usr/bin/env node

/* Aggregate-only people audit for local CCFOLIA exports.
 * It intentionally never prints names, message bodies, or scenario text.
 */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../src/parser.js');
const identity = require('../src/identity.js');

function decodeHtml(value) {
  return String(value).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function documentFromHtml(html) {
  const paragraphs = Array.from(String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(match => {
    const spans = Array.from(match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
      .map(span => ({ textContent: decodeHtml(span[1].replace(/<[^>]*>/g, '')).trim() }));
    return { textContent: spans.map(span => span.textContent).join(''), querySelectorAll: s => s === 'span' ? spans : [] };
  });
  return { querySelectorAll: s => s === 'p' ? paragraphs : [] };
}
function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) fs.readdirSync(input, { withFileTypes: true }).forEach(entry => {
      if (/\.html?$/i.test(entry.name)) files.push(path.join(input, entry.name));
    });
    else if (/\.html?$/i.test(input)) files.push(input);
  }
  return files.sort();
}
function bucket(value) {
  if (value <= 0) return '0';
  if (value === 1) return '1';
  if (value <= 5) return '2-5';
  if (value <= 10) return '6-10';
  if (value <= 25) return '11-25';
  return '26+';
}

function main() {
  const files = collectFiles(process.argv.slice(2));
  if (!files.length) { console.error('No HTML files found in the supplied paths.'); process.exitCode = 2; return; }
  const rawVariants = new Map();
  const normalizedSessions = new Map();
  const sessionSpeakerCounts = new Map();
  let totalMessages = 0;
  let emptySpeakerMessages = 0;
  const heuristicIgnoredCandidates = new Set();
  let logsWithNoMessages = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const items = parser.parseCcfoliaHtml(html, { document: documentFromHtml(html) });
    totalMessages += items.length;
    if (!items.length) logsWithNoMessages += 1;
    const sessionId = path.basename(file);
    const speakers = new Set();
    for (const item of items) {
      const raw = String(item.rawSpeaker || '').trim();
      if (!raw) { emptySpeakerMessages += 1; continue; }
      const normalized = identity.normalizeSpeakerName(raw);
      speakers.add(normalized);
      if (!rawVariants.has(normalized)) rawVariants.set(normalized, new Set());
      rawVariants.get(normalized).add(raw);
      if (!normalizedSessions.has(normalized)) normalizedSessions.set(normalized, new Set());
      normalizedSessions.get(normalized).add(sessionId);
      if (/^(?:system|gm|kp|npc|bot|dicebot|システム|ＧＭ|ＫＰ|ＮＰＣ)$/i.test(normalized)) heuristicIgnoredCandidates.add(normalized);
    }
    sessionSpeakerCounts.set(sessionId, speakers.size);
  }
  const groupsWithVariants = [...rawVariants.values()].filter(set => set.size > 1).length;
  const normalizedInMultipleSessions = [...normalizedSessions.values()].filter(set => set.size > 1).length;
  const distribution = {};
  for (const count of sessionSpeakerCounts.values()) distribution[bucket(count)] = (distribution[bucket(count)] || 0) + 1;
  console.log(JSON.stringify({
    parserVersion: parser.PARSER_VERSION,
    logs: files.length,
    totalMessages,
    uniqueNormalizedSpeakers: rawVariants.size,
    uniqueRawSpeakerVariants: [...rawVariants.values()].reduce((sum, set) => sum + set.size, 0),
    normalizationGroupsWithMultipleRawVariants: groupsWithVariants,
    normalizedSpeakersAcrossMultipleLogs: normalizedInMultipleSessions,
    emptySpeakerMessages,
    heuristicIgnoredCandidateCount: heuristicIgnoredCandidates.size,
    logsWithNoMessages,
    speakerCountDistribution: distribution
  }, null, 2));
}
main();
