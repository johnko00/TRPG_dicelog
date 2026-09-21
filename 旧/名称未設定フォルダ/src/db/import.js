// src/db/import.js

// 簡易UUID生成
const generateId = () => crypto.randomUUID();

async function saveLogToDB(db, parsedData) {
  return new Promise((resolve, reject) => {
    // 必要なストアを開く
    const transaction = db.transaction(
      ['sessions', 'sourceLogs', 'parsedItems', 'rollRecords', 'statusChanges', 'aliasMappings'],
      'readwrite'
    );

    // 11.1 取り込み時: ファイル名から仮タイトル候補を作る
    const sessionId = generateId();
    const session = {
      id: sessionId,
      title: parsedData.fileName.replace(/\.html$/i, ''),
      dateStart: new Date().toISOString().split('T')[0], // 11.2 仮の日付[cite: 1]
      dateEnd: null,
      systemHints: [], 
      sourceLogIds: [],
      imageAssetId: null,
      memo: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const sourceLogId = generateId();
    const sourceLog = {
      id: sourceLogId,
      sessionId: sessionId,
      fileName: parsedData.fileName,
      fileHash: parsedData.fileHash,
      rawHtml: parsedData.rawHtml, // 再解析のため保持[cite: 1]
      importedAt: new Date().toISOString(),
      byteSize: new Blob([parsedData.rawHtml]).size,
      channelHint: null,
      sourceType: "ccfolia-html",
      parseVersion: 1
    };

    session.sourceLogIds.push(sourceLogId);
    transaction.objectStore('sessions').add(session);
    transaction.objectStore('sourceLogs').add(sourceLog);

    const parsedItemStore = transaction.objectStore('parsedItems');
    const rollStore = transaction.objectStore('rollRecords');
    const statusStore = transaction.objectStore('statusChanges');
    const aliasStore = transaction.objectStore('aliasMappings');

    const uniqueNames = new Set();

    parsedData.parsedItems.forEach(item => {
      const parsedItemId = generateId();
      item.id = parsedItemId;
      item.sourceLogId = sourceLogId;
      item.sessionId = sessionId;
      
      uniqueNames.add(item.rawSpeaker);

      if (item.itemType === 'roll') {
        const rollId = generateId();
        item.rollId = rollId;
        rollStore.add({
          id: rollId,
          parsedItemId: parsedItemId,
          sessionId: sessionId,
          sourceLogId: sourceLogId,
          system: item.rollData.system,
          rawSpeaker: item.rawSpeaker,
          pcId: null,
          plId: null,
          rawCommand: item.body.split('＞')[0].trim(),
          skillRaw: item.rollData.skillRaw,
          skillCanonical: null,
          skillCategory: null,
          targetRaw: item.rollData.targetValue ? item.rollData.targetValue.toString() : null,
          targetValue: item.rollData.targetValue,
          rolledValue: item.rollData.rolledValue,
          result: item.rollData.result,
          resultRaw: item.body.split('＞').pop().trim(),
          bonusPenalty: null,
          difficulty: null,
          isJudgement: item.rollData.result !== 'unknown',
          isSanCheck: item.rollData.skillRaw.includes('正気度'),
          isExact1: item.rollData.rolledValue === 1,
          isExact100: item.rollData.rolledValue === 100,
          sequenceInSession: item.sequence
        });
      } else if (item.itemType === 'status') {
        const statusId = generateId();
        item.statusChangeId = statusId;
        statusStore.add({
          id: statusId,
          sessionId: sessionId,
          rawName: item.rawSpeaker,
          pcId: null,
          stat: item.statusData.stat,
          before: item.statusData.before,
          after: item.statusData.after,
          delta: item.statusData.delta,
          sequenceInSession: item.sequence,
          rawText: item.rawText
        });
      }

      parsedItemStore.add({
        id: item.id,
        sourceLogId: item.sourceLogId,
        sessionId: item.sessionId,
        sequence: item.sequence,
        channel: item.channel,
        rawSpeaker: item.rawSpeaker,
        body: item.body,
        rawText: item.rawText,
        itemType: item.itemType,
        rollId: item.rollId,
        statusChangeId: item.statusChangeId
      });
    });

    // 人物名の抽出とエイリアス候補の作成
    uniqueNames.forEach(rawName => {
      const normalized = normalizeName(rawName);
      const getReq = aliasStore.get(normalized);
      getReq.onsuccess = (e) => {
        if (!e.target.result) {
          aliasStore.add({
            rawNameNormalized: normalized,
            rawNameExamples: [rawName],
            pcId: null,
            ignored: false,
            updatedAt: new Date().toISOString()
          });
        }
      };
    });

    transaction.oncomplete = () => resolve({ sessionId, sourceLogId });
    transaction.onerror = (e) => reject(e.target.error);
  });
}