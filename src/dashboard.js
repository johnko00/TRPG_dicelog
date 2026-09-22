/* Pure dashboard, calendar, ledger-date, and recent-dice helpers. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./identity.js'));
  else root.TRPGDashboard = factory(root.TRPGIdentity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identity) {
  const SUCCESS_RESULTS = ['critical', 'special', 'success', 'hard', 'extreme', 'hardSuccess', 'extremeSuccess'];
  const FAILURE_RESULTS = ['failure', 'fumble'];

  function pad(value) { return String(value).padStart(2, '0'); }

  // Parse YYYY-MM-DD as a calendar date in the local calendar. Avoiding
  // new Date('YYYY-MM-DD') prevents UTC conversion from moving a day.
  function parseDateKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return { year: value.getFullYear(), month: value.getMonth(), day: value.getDate() };
    const text = String(value == null ? '' : value);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
    }
    return null;
  }

  function toDateKey(value) {
    const parts = parseDateKey(value);
    return parts ? `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}` : null;
  }

  function monthKey(year, month) { return `${year}-${pad(month + 1)}`; }

  function inMonth(dateKey, year, month) {
    const parts = parseDateKey(dateKey);
    return Boolean(parts && parts.year === year && parts.month === month);
  }

  function findSession(sessions, sessionId) { return (sessions || []).find(session => session.id === sessionId) || null; }

  function isVoidedLedger(entry) { return Boolean(entry?.voidedAt || entry?.status === 'voided'); }

  function getLedgerDisplayDate(entry, sessions) {
    if (!entry || isVoidedLedger(entry)) return null;
    const session = entry.sessionId ? findSession(sessions, entry.sessionId) : null;
    return session?.dateStart ? toDateKey(session.dateStart) : toDateKey(entry.date);
  }

  function calculateBalance(entries) {
    return (entries || []).filter(entry => !isVoidedLedger(entry)).reduce((balance, entry) => {
      const amount = Number(entry.amount) || 0;
      return balance + (entry.type === 'expense' ? -amount : amount);
    }, 0);
  }

  function groupSessionsByDate(sessions) {
    const grouped = {};
    (sessions || []).forEach(session => {
      const dateKey = toDateKey(session.dateStart);
      if (!dateKey) return;
      (grouped[dateKey] ||= []).push(session);
    });
    Object.values(grouped).forEach(list => list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))));
    return grouped;
  }

  function groupLedgerByDisplayDate(entries, sessions) {
    const grouped = {};
    (entries || []).forEach(entry => {
      const dateKey = getLedgerDisplayDate(entry, sessions);
      if (!dateKey) return;
      const day = grouped[dateKey] ||= { saving: 0, expense: 0, net: 0, entries: [] };
      const amount = Number(entry.amount) || 0;
      if (entry.type === 'expense') { day.expense += amount; day.net -= amount; }
      else { day.saving += amount; day.net += amount; }
      day.entries.push(entry);
    });
    return grouped;
  }

  function calculateSessionRollSummary(sessionId, rolls, overrides) {
    const resolved = identity.applyRollOverrides(rolls || [], overrides || []);
    const summary = { total: 0, success: 0, failure: 0, critical: 0, special: 0, hard: 0, extreme: 0, fumble: 0 };
    resolved.filter(roll => roll.sessionId === sessionId && roll.isJudgement && !roll.analysisExcluded && roll.result !== 'unknown').forEach(roll => {
      summary.total += 1;
      const result = roll.result || roll.normalizedResult;
      if (SUCCESS_RESULTS.includes(result)) { summary.success += 1; if (result === 'critical') summary.critical += 1; if (result === 'special') summary.special += 1; if (result === 'hard' || result === 'hardSuccess') summary.hard += 1; if (result === 'extreme' || result === 'extremeSuccess') summary.extreme += 1; }
      if (FAILURE_RESULTS.includes(result)) { summary.failure += 1; if (result === 'fumble') summary.fumble += 1; }
    });
    return summary;
  }

  function calculateMonthlySummary(options) {
    const config = options || {};
    const year = Number(config.year);
    const month = Number(config.month);
    const datedSessions = (config.sessions || []).filter(session => inMonth(session.dateStart, year, month));
    const sessionIds = new Set(datedSessions.map(session => session.id));
    const resolvedRolls = identity.applyRollOverrides(config.rolls || [], config.overrides || []);
    const rollSummary = { judgementRolls: 0, success: 0, failure: 0, critical: 0, special: 0, hard: 0, extreme: 0, fumble: 0 };
    resolvedRolls.filter(roll => sessionIds.has(roll.sessionId) && roll.isJudgement && !roll.analysisExcluded && roll.result !== 'unknown').forEach(roll => {
      rollSummary.judgementRolls += 1;
      const result = roll.result || roll.normalizedResult;
      if (SUCCESS_RESULTS.includes(result)) { rollSummary.success += 1; if (result === 'critical') rollSummary.critical += 1; if (result === 'special') rollSummary.special += 1; if (result === 'hard' || result === 'hardSuccess') rollSummary.hard += 1; if (result === 'extreme' || result === 'extremeSuccess') rollSummary.extreme += 1; }
      if (FAILURE_RESULTS.includes(result)) { rollSummary.failure += 1; if (result === 'fumble') rollSummary.fumble += 1; }
    });
    const ledger = groupLedgerByDisplayDate(config.ledgerEntries || [], config.sessions || []);
    const monthlyLedger = Object.entries(ledger).filter(([dateKey]) => inMonth(dateKey, year, month)).reduce((sum, [, day]) => ({ saving: sum.saving + day.saving, expense: sum.expense + day.expense, net: sum.net + day.net }), { saving: 0, expense: 0, net: 0 });
    return { year, month, monthKey: monthKey(year, month), sessionCount: datedSessions.length, ...rollSummary, ...monthlyLedger };
  }

  function buildCalendarMonth(year, month, options) {
    const config = options || {};
    const sessionsByDate = groupSessionsByDate(config.sessions || []);
    const ledgerByDate = groupLedgerByDisplayDate(config.ledgerEntries || [], config.sessions || []);
    const pendingBySession = config.pendingBySession || groupPendingBySession(config.pending || [], config.sessions || []);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingEmptyCount = new Date(year, month, 1).getDay();
    const todayKey = toDateKey(config.today || new Date());
    const days = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`;
      const daySessions = sessionsByDate[dateKey] || [];
      const dayLedger = ledgerByDate[dateKey] || { saving: 0, expense: 0, net: 0, entries: [] };
      const pending = daySessions.flatMap(session => pendingBySession[session.id] || []);
      days.push({ day, dateKey, sessions: daySessions, ledger: dayLedger, pending, isToday: dateKey === todayKey, hasContent: daySessions.length > 0 || dayLedger.entries.length > 0 || pending.length > 0 });
    }
    return { year, month, monthKey: monthKey(year, month), leadingEmptyCount, daysInMonth, days, todayKey };
  }

  function groupPendingBySession(pending, sessions) {
    const grouped = {};
    (pending || []).forEach(candidate => {
      const session = findSession(sessions, candidate.sessionId);
      const item = grouped[candidate.sessionId] ||= { sessionId: candidate.sessionId, session, candidates: [], knownAmount: 0, unpricedCount: 0 };
      item.candidates.push(candidate);
      if (candidate.amount == null) item.unpricedCount += 1;
      else item.knownAmount += Number(candidate.amount) || 0;
    });
    return grouped;
  }

  function buildRecentDiceEvents(options) {
    const config = options || {};
    const sessions = config.sessions || [];
    const resolved = identity.applyRollOverrides(config.rolls || [], config.overrides || []);
    const seen = new Set();
    const events = [];
    resolved.forEach(roll => {
      if (!roll.isJudgement || roll.analysisExcluded || roll.result === 'unknown') return;
      const identityKey = roll.sourceKey || roll.id;
      if (!identityKey || seen.has(identityKey)) return;
      let kind = null;
      if (roll.result === 'critical') kind = 'critical';
      else if (roll.result === 'fumble') kind = 'fumble';
      else if (Number(roll.rolledValue) === 1) kind = 'exact1';
      else if (Number(roll.rolledValue) === 100) kind = 'exact100';
      if (!kind) return;
      seen.add(identityKey);
      const session = findSession(sessions, roll.sessionId);
      const dateKey = toDateKey(session?.dateStart || roll.createdAt) || '9999-99-99';
      events.push({ id: identityKey, kind, dateKey, sessionId: roll.sessionId || null, session, rawSpeaker: roll.rawSpeaker || '', skillRaw: roll.skillRaw || '', rolledValue: roll.rolledValue, result: roll.result, roll });
    });
    events.sort((a, b) => `${b.dateKey}:${b.roll.sequenceInSession || 0}`.localeCompare(`${a.dateKey}:${a.roll.sequenceInSession || 0}`));
    return events.slice(0, Math.max(0, Number(config.limit) || 5));
  }

  function monthLabel(year, month, now) {
    const current = parseDateKey(now || new Date());
    return current && current.year === year && current.month === month ? '今月' : `${year}年${month + 1}月`;
  }

  return { SUCCESS_RESULTS, FAILURE_RESULTS, parseDateKey, toDateKey, monthKey, getLedgerDisplayDate, calculateBalance, groupSessionsByDate, groupLedgerByDisplayDate, calculateSessionRollSummary, calculateMonthlySummary, buildCalendarMonth, groupPendingBySession, buildRecentDiceEvents, monthLabel };
});
