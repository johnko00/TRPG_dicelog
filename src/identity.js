/* Stable identity and people resolution helpers for TRPG LOG & BANK. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TRPGIdentity = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeIdentityText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/[\u3000\s]+/g, ' ')
      .trim();
  }

  function normalizeSpeakerName(value) {
    return normalizeIdentityText(value);
  }

  // A deterministic, dependency-free 64-bit digest. It is intentionally
  // independent of parserVersion so a reparse can recover the same identity.
  function stableHash(value) {
    const text = String(value == null ? '' : value);
    let first = 0xcbf29ce4;
    let second = 0x84222325;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code & 0xff;
      first = Math.imul(first, 0x01000193) >>> 0;
      second ^= code >>> 8;
      second = Math.imul(second, 0x01000193) >>> 0;
      first ^= second >>> 13;
      second ^= first << 7;
    }
    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
  }

  function messageFingerprint(item) {
    const channel = normalizeIdentityText(item.channel);
    const speaker = normalizeSpeakerName(item.rawSpeaker);
    const rawText = normalizeIdentityText(item.rawText || item.body);
    return stableHash([channel, speaker, rawText].join('\u241f'));
  }

  function deriveRevisionFingerprint(items) {
    return stableHash((items || []).map(item => messageFingerprint(item)).join('\u241e'));
  }

  function createLineageId() {
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : stableHash(`${Date.now()}:${Math.random()}`);
    return `lineage:${randomId}`;
  }

  // A lineage identifies a log series, not one file revision. New imports get
  // a fresh lineage; callers handling a known revision must pass lineageId.
  // deriveRevisionFingerprint is the content-based value for one revision.
  function deriveLineageId(_items, options) {
    return options?.existingLineageId || createLineageId();
  }

  function buildSourceKey(lineageId, fingerprint, occurrence, sourceRollIndex) {
    return `source:${stableHash([lineageId, fingerprint, occurrence, sourceRollIndex].join('\u241f'))}`;
  }

  function attachStableIdentity(items, options) {
    const list = Array.isArray(items) ? items : [];
    const config = options || {};
    const lineageId = config.lineageId || createLineageId();
    const occurrences = new Map();
    list.forEach(item => {
      const fingerprint = messageFingerprint(item);
      const occurrence = (occurrences.get(fingerprint) || 0) + 1;
      occurrences.set(fingerprint, occurrence);
      item.lineageId = lineageId;
      item.messageFingerprint = fingerprint;
      item.messageOccurrence = occurrence;
      item.sourceMessageKey = `message:${stableHash([lineageId, fingerprint, occurrence].join('\u241f'))}`;
      if (item.itemType !== 'roll') return;
      const rolls = item.rollData?.rolls || [item.rollData];
      rolls.forEach((roll, index) => {
        const sourceRollIndex = roll.index == null ? index : roll.index;
        roll.sourceRollIndex = sourceRollIndex;
        roll.sourceKey = buildSourceKey(lineageId, fingerprint, occurrence, sourceRollIndex);
      });
    });
    return list;
  }

  function normalizeMapping(mapping) {
    const normalized = mapping.rawSpeakerNormalized || mapping.rawNameNormalized || '';
    return { ...mapping, rawSpeakerNormalized: normalizeSpeakerName(normalized) };
  }

  function resolveSpeaker(input) {
    const value = input || {};
    const rawSpeaker = value.rawSpeaker || '';
    const normalizedSpeaker = normalizeSpeakerName(rawSpeaker);
    const mappings = (value.mappings || []).map(normalizeMapping);
    const pcs = value.pcs || [];
    const pls = value.pls || [];
    const participants = value.sessionParticipants || [];
    const sessionId = value.sessionId || null;
    const sessionMapping = mappings.find(mapping => mapping.scope === 'session'
      && mapping.sessionId === sessionId
      && mapping.rawSpeakerNormalized === normalizedSpeaker);
    const globalMapping = mappings.find(mapping => (mapping.scope || 'global') === 'global'
      && mapping.rawSpeakerNormalized === normalizedSpeaker);
    const mapping = sessionMapping || globalMapping || null;
    const pcId = mapping?.pcId || null;
    const pc = pcId ? pcs.find(character => character.id === pcId) || null : null;
    const plId = mapping?.plId || pc?.plId || null;
    const pl = plId ? pls.find(player => player.id === plId) || null : null;
    const sessionParticipant = participants.find(participant => participant.sessionId === sessionId
      && (participant.rawSpeakerNormalized === normalizedSpeaker
        || participant.pcId === pcId
        || (!pcId && participant.plId === plId))) || null;
    return {
      rawSpeaker,
      normalizedSpeaker,
      pcId,
      pc,
      plId,
      pl,
      mappingId: mapping?.id || null,
      mappingScope: mapping?.scope || null,
      sessionParticipant,
      role: sessionParticipant?.role || null,
      ignored: Boolean(mapping?.ignored),
      resolved: Boolean(mapping && (mapping.ignored || pc || pl))
    };
  }

  function buildRollOverride(sourceKey, values, existing) {
    const input = values || {};
    const prior = existing || {};
    return {
      id: prior.id || `override:${stableHash(sourceKey)}`,
      sourceKey,
      analysisExcluded: Boolean(input.analysisExcluded),
      savingsExcluded: Boolean(input.savingsExcluded),
      exclusionReason: input.exclusionReason || '',
      createdAt: prior.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function applyRollOverrides(rolls, overrides) {
    const bySourceKey = new Map((overrides || []).filter(item => item?.sourceKey).map(item => [item.sourceKey, item]));
    return (rolls || []).map(roll => ({
      ...roll,
      override: bySourceKey.get(roll.sourceKey) || null,
      analysisExcluded: Boolean(bySourceKey.get(roll.sourceKey)?.analysisExcluded),
      savingsExcluded: Boolean(bySourceKey.get(roll.sourceKey)?.savingsExcluded)
    }));
  }

  return {
    normalizeIdentityText,
    normalizeSpeakerName,
    stableHash,
    messageFingerprint,
    deriveRevisionFingerprint,
    createLineageId,
    deriveLineageId,
    buildSourceKey,
    attachStableIdentity,
    resolveSpeaker,
    buildRollOverride,
    applyRollOverrides
  };
});
