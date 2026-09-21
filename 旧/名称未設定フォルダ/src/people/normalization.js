// src/people/normalization.js

/**
 * 9.3 自動正規化（候補検索のためのみ）[cite: 1]
 */
function normalizeName(rawName) {
  if (!rawName) return '';
  return rawName
    .normalize('NFKC') // Unicode NFKC[cite: 1]
    .replace(/^[\s ]+|[\s ]+$/g, '') // 前後空白除去[cite: 1]
    .replace(/[\s ]+/g, ' '); // 連続空白を1つへ、全角/半角空白の扱い統一[cite: 1]
}