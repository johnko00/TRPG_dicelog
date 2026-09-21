/*
 * TRPG LOG & BANK parser foundation.
 *
 * This file deliberately has no DOM or IndexedDB dependency so it can be
 * exercised by Node's built-in test runner. The browser build exposes the
 * same API as window.TRPGParser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TRPGParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PARSER_VERSION = 2;
  const SUCCESS_RESULTS = ['critical', 'special', 'success', 'hardSuccess', 'extremeSuccess'];
  const FAILURE_RESULTS = ['failure', 'fumble'];

  function normalizeBody(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function evaluateTargetExpression(raw) {
    if (!raw) return null;
    const expression = String(raw).trim();
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) return null;
    // The allow-list above makes this expression safe to evaluate. Keep the
    // evaluator small because target expressions come from user-provided HTML.
    try {
      const value = Function(`"use strict"; return (${expression})`)();
      return Number.isFinite(value) ? Math.floor(value) : null;
    } catch (_) {
      return null;
    }
  }

  function extractTarget(command) {
    const match = String(command).match(/(?:CCB|CC(?:[+-]?\d+)?|1D100)\s*<=\s*([^\s(]+)/i);
    return match ? match[1] : null;
  }

  function extractSkill(command) {
    const value = String(command)
      .replace(/^\s*(?:CCB|CC(?:[+-]?\d+)?|1D100)\s*<=\s*[^\s(]+/i, '')
      .trim()
      .trim();
    const parenthesisIndex = value.indexOf('(');
    const withoutRollDetails = parenthesisIndex >= 0 ? value.slice(0, parenthesisIndex) : value;
    const withoutBonusDetails = withoutRollDetails
      .replace(/#\d+[\s\S]*$/i, '')
      .replace(/\s*ボーナス[・･]ペナルティダイス[\s\S]*$/i, '')
      .trim();
    const bracketed = withoutBonusDetails.match(/【([^】]+)】/);
    if (bracketed) return bracketed[1].trim();
    const skill = withoutBonusDetails.replace(/^\s+|\s+$/g, '').trim();
    return /^\d+[dD]\d+$/.test(skill) ? '' : skill;
  }

  function parseResult(resultRaw, system) {
    const text = String(resultRaw || '').trim();
    let normalizedResult = 'unknown';
    if (/決定的成功|クリティカル|critical/i.test(text)) normalizedResult = 'critical';
    else if (/致命的失敗|ファンブル|fumble/i.test(text)) normalizedResult = 'fumble';
    else if (/スペシャル|special/i.test(text)) normalizedResult = 'special';
    else if (/イクストリーム|extreme/i.test(text)) normalizedResult = 'extremeSuccess';
    else if (/ハード|hard/i.test(text)) normalizedResult = 'hardSuccess';
    else if (/レギュラー成功|成功|regular\s+success|success/i.test(text)) normalizedResult = 'success';
    else if (/失敗|failure|fail/i.test(text)) normalizedResult = 'failure';

    // `result` retains the short names used by the existing UI and savings
    // rules. `normalizedResult` is the stable vocabulary for new consumers.
    const result = normalizedResult === 'hardSuccess' ? 'hard'
      : normalizedResult === 'extremeSuccess' ? 'extreme'
      : normalizedResult;
    return { result, normalizedResult, nativeResult: text, system };
  }

  function extractRollValue(parts) {
    for (let index = parts.length - 2; index >= 1; index -= 1) {
      const segment = String(parts[index]).trim();
      if (/^[+-]?\d+$/.test(segment)) return parseInt(segment, 10);
      const values = segment.match(/[+-]?\d+/g);
      if (values && /,/.test(segment)) return parseInt(values[values.length - 1], 10);
    }
    return null;
  }

  function extractBonusPenalty(text, command) {
    const label = String(text).match(/ボーナス[・･]ペナルティダイス\s*\[\s*(-?\d+)\s*\]/i);
    const modifier = String(command).match(/^\s*CC([+-]?\d+)\s*<=/i);
    const modifierValue = modifier && modifier[1] ? parseInt(modifier[1], 10) : 0;
    const value = label ? parseInt(label[1], 10) : modifierValue;
    if (!label && !modifier) return null;
    return {
      value,
      count: Math.abs(value),
      type: value > 0 ? 'bonus' : value < 0 ? 'penalty' : 'none',
      raw: label ? label[0] : null
    };
  }

  function parseMultipleRolls(body, baseRollData) {
    const matches = Array.from(String(body).matchAll(/#(\d+)([\s\S]*?)(?=#\d+|$)/g));
    if (matches.length < 2) return [];
    return matches.map(match => {
      const fragment = match[2].trim();
      const parts = fragment.split('＞').map(part => part.trim()).filter(Boolean);
      const resultRaw = parts.length ? parts[parts.length - 1] : '';
      const effectiveTargetMatch = fragment.match(/\(\s*1D100\s*<=\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
      const numericFinalValue = /^[+-]?\d+$/.test(resultRaw) ? parseInt(resultRaw, 10) : null;
      const result = parseResult(resultRaw, baseRollData.system);
      return {
        ...baseRollData,
        index: parseInt(match[1], 10),
        targetValue: effectiveTargetMatch ? toNumber(effectiveTargetMatch[1]) : baseRollData.targetValue,
        rolledValue: numericFinalValue == null ? extractRollValue(parts) : numericFinalValue,
        result: result.result,
        normalizedResult: result.normalizedResult,
        nativeResult: result.nativeResult,
        resultRaw
      };
    });
  }

  function parseStatus(item, body) {
    const match = body.match(/^\s*(?:\[\s*([^\]]+?)\s*\]\s*)?(SAN|HP|MP|C)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?:→|->|＞|=>)\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (!match) return null;
    const before = Number(match[3]);
    const after = Number(match[4]);
    const statusName = match[2].toUpperCase();
    return {
      speaker: (match[1] || item.rawSpeaker || '').trim(),
      statusName,
      stat: statusName,
      before,
      after,
      delta: after - before,
      rawText: item.rawText || item.body || body
    };
  }

  function parseMessage(input) {
    const item = { ...input };
    const body = normalizeBody(item.body || item.rawText || '');
    item.body = body;
    item.rawText = item.rawText || body;
    item.parserVersion = PARSER_VERSION;

    const statusData = parseStatus(item, body);
    if (statusData) {
      item.itemType = 'status';
      item.statusData = statusData;
      return item;
    }

    const command = body.split('＞')[0].trim();
    const commandForParser = command.replace(/^\s*X\d+\s+/i, '').replace(/^S(?=CCB\s*<=)/i, '');
    const isCoc6 = /^CCB\s*<=/i.test(commandForParser);
    const coc7Match = commandForParser.match(/^CC(?:[+-]?\d+)?\s*<=/i);
    const isTargetedD100 = /^1D100\s*<=/i.test(commandForParser);
    const hasDiceCommand = /\b\d+[dD]\d+\b/.test(commandForParser);
    const hasResultSeparator = body.includes('＞');
    if (!(hasResultSeparator && (isCoc6 || coc7Match || isTargetedD100 || hasDiceCommand))) {
      item.itemType = 'message';
      return item;
    }

    const parts = body.split('＞').map(part => part.trim()).filter(Boolean);
    const resultRaw = parts.length > 1 ? parts[parts.length - 1] : '';
    const targetRaw = extractTarget(commandForParser);
    const effectiveTargetMatch = body.match(/\(\s*1D100\s*<=\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
    const targetValue = effectiveTargetMatch
      ? toNumber(effectiveTargetMatch[1])
      : evaluateTargetExpression(targetRaw);
    const system = isCoc6 ? 'CoC6' : coc7Match ? 'CoC7' : 'unknown';
    const result = parseResult(resultRaw, system);
    const numericFinalValue = /^[+-]?\d+$/.test(resultRaw) ? parseInt(resultRaw, 10) : null;
    const rollData = {
      system,
      skillRaw: extractSkill(commandForParser),
      targetRaw,
      targetValue,
      rolledValue: numericFinalValue == null ? extractRollValue(parts) : numericFinalValue,
      result: result.result,
      normalizedResult: result.normalizedResult,
      nativeResult: result.nativeResult,
      resultRaw,
      isJudgement: Boolean(isCoc6 || coc7Match || isTargetedD100),
      bonusPenalty: coc7Match ? extractBonusPenalty(body, commandForParser) : null,
      difficulty: /<=\s*[^\s(]*h\b/i.test(commandForParser) ? 'hard'
        : /<=\s*[^\s(]*e\b/i.test(commandForParser) ? 'extreme' : null
    };
    const multipleRolls = parseMultipleRolls(body, rollData);
    if (multipleRolls.length) rollData.rolls = multipleRolls;
    item.itemType = 'roll';
    item.rollData = rollData;
    return item;
  }

  function parseMessages(messages) {
    return (messages || []).map((message, index) => parseMessage({
      sequence: message.sequence == null ? index + 1 : message.sequence,
      channel: message.channel || '',
      rawSpeaker: message.rawSpeaker || '',
      body: message.body || '',
      rawText: message.rawText || message.body || ''
    }));
  }

  function parseCcfoliaHtml(htmlString) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('parseCcfoliaHtml requires a browser DOMParser; use parseMessages in Node tests.');
    }
    const doc = new DOMParser().parseFromString(String(htmlString), 'text/html');
    const messages = [];
    doc.querySelectorAll('p').forEach((p, index) => {
      const spans = p.querySelectorAll('span');
      if (spans.length < 3) return;
      messages.push({
        sequence: index + 1,
        channel: spans[0].textContent.trim(),
        rawSpeaker: spans[1].textContent.trim(),
        body: Array.from(spans).slice(2).map(span => span.textContent).join(' ').trim(),
        rawText: p.textContent.trim()
      });
    });
    return parseMessages(messages);
  }

  return {
    PARSER_VERSION,
    SUCCESS_RESULTS,
    FAILURE_RESULTS,
    evaluateTargetExpression,
    parseMessage,
    parseMessages,
    parseCcfoliaHtml
  };
});
