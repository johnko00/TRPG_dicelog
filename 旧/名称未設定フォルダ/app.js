const generateId = () => crypto.randomUUID();
let db;
let myPlId = localStorage.getItem('myPlId') || null;

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TRPGBankDB', 1);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('sourceLogs')) {
        const logStore = database.createObjectStore('sourceLogs', { keyPath: 'id' });
        logStore.createIndex('fileHash', 'fileHash', { unique: true });
      }
      if (!database.objectStoreNames.contains('rollRecords')) database.createObjectStore('rollRecords', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('ledgerEntries')) database.createObjectStore('ledgerEntries', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('parsedItems')) {
        const store = database.createObjectStore('parsedItems', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!database.objectStoreNames.contains('statusChanges')) database.createObjectStore('statusChanges', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('aliasMappings')) database.createObjectStore('aliasMappings', { keyPath: 'rawNameNormalized' });
      if (!database.objectStoreNames.contains('pcs')) database.createObjectStore('pcs', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('pls')) database.createObjectStore('pls', { keyPath: 'id' });
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject(e.target.error);
  });
};

function normalizeName(rawName) {
  if (!rawName) return '';
  return rawName.normalize('NFKC').replace(/^[\s ]+|[\s ]+$/g, '').replace(/[\s ]+/g, ' ');
}

function analyzeMessageData(item) {
  const text = item.body;
  const statusMatch = text.match(/(SAN|HP|MP|C)\s*:\s*(\d+)\s*(?:→|->|＞)\s*(\d+)/i);
  if (statusMatch) {
    item.itemType = 'status';
    item.statusData = { stat: statusMatch[1].toUpperCase(), before: parseInt(statusMatch[2], 10), after: parseInt(statusMatch[3], 10), delta: parseInt(statusMatch[3], 10) - parseInt(statusMatch[2], 10) };
    return item;
  }
  if (text.includes('＞')) {
    item.itemType = 'roll';
    item.rollData = { system: 'unknown', result: 'unknown', rolledValue: null, targetValue: null, skillRaw: '' };
    const rollParts = text.split('＞').map(s => s.trim());
    const commandPart = rollParts[0], resultPart = rollParts[rollParts.length - 1];
    const targetMatch = commandPart.match(/\(1D100<=(\d+)\)/i);
    if (targetMatch) item.rollData.targetValue = parseInt(targetMatch[1], 10);
    const skillMatch = commandPart.match(/【(.*?)】|\s+([^\s\d\(\)]+)\s+\(1D100/);
    if (skillMatch) item.rollData.skillRaw = (skillMatch[1] || skillMatch[2]).trim();
    
    if (commandPart.startsWith('CCB') || commandPart.startsWith('1d100') || commandPart.startsWith('1D100')) {
      item.rollData.system = 'CoC6';
      if (resultPart.includes('決定的成功') || resultPart.includes('クリティカル')) item.rollData.result = 'critical';
      else if (resultPart.includes('致命的失敗') || resultPart.includes('ファンブル')) item.rollData.result = 'fumble';
      else if (resultPart.includes('スペシャル')) item.rollData.result = 'special';
      else if (resultPart.includes('成功')) item.rollData.result = 'success';
      else if (resultPart.includes('失敗')) item.rollData.result = 'failure';
    } else if (commandPart.startsWith('CC<=')) {
      item.rollData.system = 'CoC7';
      if (resultPart.includes('クリティカル')) item.rollData.result = 'critical';
      else if (resultPart.includes('ファンブル')) item.rollData.result = 'fumble';
      else if (resultPart.includes('イクストリーム')) item.rollData.result = 'extreme';
      else if (resultPart.includes('ハード')) item.rollData.result = 'hard';
      else if (resultPart.includes('レギュラー') || resultPart.includes('成功')) item.rollData.result = 'success';
      else if (resultPart.includes('失敗')) item.rollData.result = 'failure';
    }
    const rolledMatch = rollParts.slice(1, -1).reverse().find(s => !isNaN(parseInt(s, 10)));
    if (rolledMatch) item.rollData.rolledValue = parseInt(rolledMatch, 10);
  } else { item.itemType = 'message'; }
  return item;
}

function parseCcfoliaHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const items = [];
  doc.querySelectorAll('p').forEach((p, index) => {
    const spans = p.querySelectorAll('span');
    if (spans.length >= 3) {
      items.push(analyzeMessageData({ sequence: index + 1, channel: spans[0].textContent.trim(), rawSpeaker: spans[1].textContent.trim(), body: Array.from(spans).slice(2).map(s => s.textContent).join(' ').trim(), rawText: p.textContent.trim(), itemType: 'unknown' }));
    }
  });
  return items;
}

async function handleFileUpload(file, db) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const fileHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    db.transaction(['sourceLogs'], 'readonly').objectStore('sourceLogs').index('fileHash').get(fileHash).onsuccess = async (e) => {
      if (e.target.result) return reject(new Error('同一ファイルは既に取り込まれています。'));
      const rawHtml = await file.text();
      resolve({ fileName: file.name, fileHash, rawHtml, parsedItems: parseCcfoliaHtml(rawHtml) });
    };
  });
}

async function saveLogToDB(db, parsedData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'sourceLogs', 'parsedItems', 'rollRecords', 'statusChanges', 'aliasMappings'], 'readwrite');
    const sessionId = generateId(), sourceLogId = generateId();
    
    tx.objectStore('sessions').add({ id: sessionId, title: parsedData.fileName.replace(/\.html$/i, ''), dateStart: new Date().toISOString().split('T')[0], dateEnd: null, systemHints: [], sourceLogIds: [sourceLogId], imageAssetId: null, memo: '', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    tx.objectStore('sourceLogs').add({ id: sourceLogId, sessionId, fileName: parsedData.fileName, fileHash: parsedData.fileHash, rawHtml: parsedData.rawHtml, importedAt: new Date().toISOString(), byteSize: new Blob([parsedData.rawHtml]).size, channelHint: null, sourceType: "ccfolia-html", parseVersion: 1 });

    const uniqueNames = new Set();
    parsedData.parsedItems.forEach(item => {
      item.id = generateId(); item.sourceLogId = sourceLogId; item.sessionId = sessionId;
      uniqueNames.add(item.rawSpeaker);
      if (item.itemType === 'roll') {
        item.rollId = generateId();
        tx.objectStore('rollRecords').add({ id: item.rollId, parsedItemId: item.id, sessionId, sourceLogId, system: item.rollData.system, rawSpeaker: item.rawSpeaker, pcId: null, plId: null, rawCommand: item.body.split('＞')[0].trim(), skillRaw: item.rollData.skillRaw, skillCanonical: null, skillCategory: null, targetRaw: item.rollData.targetValue ? item.rollData.targetValue.toString() : null, targetValue: item.rollData.targetValue, rolledValue: item.rollData.rolledValue, result: item.rollData.result, resultRaw: item.body.split('＞').pop().trim(), bonusPenalty: null, difficulty: null, isJudgement: item.rollData.result !== 'unknown', isSanCheck: item.rollData.skillRaw.includes('正気度'), isExact1: item.rollData.rolledValue === 1, isExact100: item.rollData.rolledValue === 100, sequenceInSession: item.sequence });
      } else if (item.itemType === 'status') {
        item.statusChangeId = generateId();
        tx.objectStore('statusChanges').add({ id: item.statusChangeId, sessionId, rawName: item.rawSpeaker, pcId: null, stat: item.statusData.stat, before: item.statusData.before, after: item.statusData.after, delta: item.statusData.delta, sequenceInSession: item.sequence, rawText: item.rawText });
      }
      tx.objectStore('parsedItems').add(item);
    });

    const aliasStore = tx.objectStore('aliasMappings');
    uniqueNames.forEach(rawName => {
      const normalized = normalizeName(rawName);
      aliasStore.get(normalized).onsuccess = (e) => {
        if (!e.target.result) aliasStore.add({ rawNameNormalized: normalized, rawNameExamples: [rawName], pcId: null, ignored: false, updatedAt: new Date().toISOString() });
      };
    });
    tx.oncomplete = () => resolve({ sessionId, sourceLogId });
    tx.onerror = (e) => reject(e.target.error);
  });
}

let currentPcList = [], currentAliasList = [], currentPlList = [];
async function loadPeopleData(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(['aliasMappings', 'pcs', 'pls'], 'readonly');
    tx.objectStore('aliasMappings').getAll().onsuccess = e => currentAliasList = e.target.result;
    tx.objectStore('pcs').getAll().onsuccess = e => currentPcList = e.target.result;
    tx.objectStore('pls').getAll().onsuccess = e => currentPlList = e.target.result;
    tx.oncomplete = () => {
      const tbody = document.getElementById('people-table-body');
      tbody.innerHTML = currentAliasList.map(alias => {
        const pc = currentPcList.find(p => p.id === alias.pcId);
        return `<tr><td>${alias.rawNameNormalized}</td><td>${pc ? '🟢 整理済み' : '🔴 未整理'}</td><td>${pc ? pc.name : '-'}</td><td>${pc && currentPlList.find(p => p.id === pc.plId)?.name || '-'}</td><td>${pc ? pc.type : '-'}</td><td><button onclick="openLinkModal('${alias.rawNameNormalized}')">紐付け</button> ${pc ? `<button onclick="openPcEdit('${pc.id}')">属性編集</button>` : ''}</td></tr>`;
      }).join('');
      resolve();
    };
  });
}

document.getElementById('btn-create-pc').addEventListener('click', () => {
  const name = prompt('新しいPC名:');
  if (name) {
    db.transaction(['pcs'], 'readwrite').objectStore('pcs').add({ id: generateId(), name, plId: null, type: "PC", excludedFromSavings: false, memo: "", imageAssetId: null }).transaction.oncomplete = () => loadPeopleData(db);
  }
});

let activeAliasName = null;
window.openLinkModal = function(aliasName) {
  activeAliasName = aliasName;
  document.getElementById('link-target-name').textContent = aliasName;
  document.getElementById('pc-select').innerHTML = '<option value="">-- 解除 --</option>' + currentPcList.map(pc => `<option value="${pc.id}">${pc.name}</option>`).join('');
  document.getElementById('link-modal').classList.remove('hidden');
};
document.getElementById('btn-save-link').addEventListener('click', () => {
  const tx = db.transaction(['aliasMappings'], 'readwrite');
  tx.objectStore('aliasMappings').get(activeAliasName).onsuccess = e => {
    if (e.target.result) { e.target.result.pcId = document.getElementById('pc-select').value || null; tx.objectStore('aliasMappings').put(e.target.result); }
  };
  tx.oncomplete = () => { document.getElementById('link-modal').classList.add('hidden'); loadPeopleData(db); };
});

let editingPcId = null;
window.openPcEdit = function(pcId) {
  db.transaction(['pcs'], 'readonly').objectStore('pcs').get(pcId).onsuccess = (e) => {
    const pc = e.target.result;
    if (!pc) return;
    editingPcId = pc.id;
    document.getElementById('edit-pc-name-display').textContent = pc.name;
    document.getElementById('edit-pc-type').value = pc.type || 'PC';
    document.getElementById('edit-pc-excluded').checked = !!pc.excludedFromSavings;
    document.getElementById('pc-edit-modal').classList.remove('hidden');
  };
};
document.getElementById('btn-save-pc-info').addEventListener('click', () => {
  const tx = db.transaction(['pcs'], 'readwrite');
  tx.objectStore('pcs').get(editingPcId).onsuccess = (e) => {
    const pc = e.target.result;
    pc.type = document.getElementById('edit-pc-type').value;
    pc.excludedFromSavings = document.getElementById('edit-pc-excluded').checked;
    tx.objectStore('pcs').put(pc);
  };
  tx.oncomplete = () => { document.getElementById('pc-edit-modal').classList.add('hidden'); loadPeopleData(db); };
});

const SUCCESS_RESULTS = ['critical', 'special', 'success', 'hard', 'extreme'], FAILURE_RESULTS = ['failure', 'fumble'];
function calculateStats(judgements) {
  let successCount = 0, critCount = 0, fumbleCount = 0, exact1Count = 0, exact100Count = 0;
  judgements.forEach(r => {
    if (SUCCESS_RESULTS.includes(r.result)) successCount++;
    if (r.result === 'critical') critCount++;
    if (r.result === 'fumble') fumbleCount++;
    if (r.isExact1) exact1Count++;
    if (r.isExact100) exact100Count++;
  });
  const t = judgements.length;
  return { total: t, successRate: t ? (successCount/t)*100 : 0, critRate: t ? (critCount/t)*100 : 0, fumbleRate: t ? (fumbleCount/t)*100 : 0, exact1Count, exact100Count, successCount };
}

async function renderOverallAnalysis(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(['rollRecords', 'sessions', 'pcs'], 'readonly');
    let rolls = [], sessions = [], pcs = [];
    tx.objectStore('rollRecords').getAll().onsuccess = e => rolls = e.target.result;
    tx.objectStore('sessions').getAll().onsuccess = e => sessions = e.target.result;
    tx.objectStore('pcs').getAll().onsuccess = e => pcs = e.target.result;
    tx.oncomplete = () => {
      const judgements = rolls.filter(r => r.isJudgement && r.result !== 'unknown');
      const stats = calculateStats(judgements);
      
      let html = `<ul><li>総セッション数: ${sessions.length}</li><li>総ダイス判定数: ${stats.total}</li><li>成功率: ${stats.successRate.toFixed(1)}% (${stats.successCount}回)</li><li>クリティカル率: ${stats.critRate.toFixed(1)}%</li><li>ファンブル率: ${stats.fumbleRate.toFixed(1)}%</li><li>出目1: ${stats.exact1Count}回 / 出目100: ${stats.exact100Count}回</li></ul>`;
      
      const pcStats = {};
      judgements.filter(r => r.pcId).forEach(r => {
        if (!pcStats[r.pcId]) pcStats[r.pcId] = { id: r.pcId, rolls: [] };
        pcStats[r.pcId].rolls.push(r);
      });
      html += `<h2 style="margin-top: 30px;">PC別 分析</h2><table><tr><th>PC名</th><th>判定数</th><th>成功率</th><th>クリ率</th><th>F率</th></tr>`;
      Object.values(pcStats).sort((a,b) => b.rolls.length - a.rolls.length).forEach(ps => {
        const s = calculateStats(ps.rolls), pc = pcs.find(p => p.id === ps.id);
        html += `<tr><td>${pc ? pc.name : '不明'}</td><td>${s.total}</td><td>${s.successRate.toFixed(1)}%</td><td>${s.critRate.toFixed(1)}%</td><td>${s.fumbleRate.toFixed(1)}%</td></tr>`;
      });
      document.getElementById('analysis-content').innerHTML = html + `</table>`;
      resolve();
    };
  });
}

const DEFAULT_RULES = [
  { id: 'rule-self-1crit', name: '自分の1クリ', amount: 500, targetType: 'self', condition: { exactRolls: [1], result: ['critical'] } },
  { id: 'rule-self-100f', name: '自分の100F', amount: 500, targetType: 'self', condition: { exactRolls: [100], result: ['fumble'] } },
  { id: 'rule-self-crit', name: '自分のクリティカル', amount: 100, targetType: 'self', condition: { result: ['critical'] } }
];

async function generateAndRenderCandidates(db, sessionId, myPlId) {
  return new Promise(resolve => {
    const tx = db.transaction(['rollRecords', 'pcs'], 'readonly');
    let rolls = [], pcs = [];
    tx.objectStore('rollRecords').getAll().onsuccess = e => rolls = e.target.result.filter(r => r.sessionId === sessionId && r.isJudgement && r.result !== 'unknown');
    tx.objectStore('pcs').getAll().onsuccess = e => pcs = e.target.result;
    tx.oncomplete = () => {
      let candidates = [];
      rolls.forEach(r => {
        const pc = pcs.find(p => p.id === r.pcId);
        if (pc && pc.excludedFromSavings) return;
        const isSelf = pc && pc.plId === myPlId;
        DEFAULT_RULES.forEach(rule => {
          if (rule.targetType === 'self' && !isSelf) return;
          if (rule.condition.exactRolls && !rule.condition.exactRolls.includes(r.rolledValue)) return;
          if (rule.condition.result && !rule.condition.result.includes(r.result)) return;
          candidates.push({ id: generateId(), sessionId, ruleNameSnapshot: rule.name, amount: rule.amount, skill: r.skillRaw, targetValue: r.targetValue, rolledValue: r.rolledValue, result: r.result, sourceLogId: r.sourceLogId, parsedItemId: r.parsedItemId });
        });
      });
      const cDiv = document.getElementById('savings-candidates-container');
      cDiv.innerHTML = `<h2 id="draft-total">候補合計: +${candidates.reduce((s,c)=>s+c.amount,0)}円</h2>`;
      const list = document.createElement('ul'); list.style.listStyle = 'none'; list.style.padding = '0';
      candidates.forEach(c => {
        list.innerHTML += `<li style="background:#333; margin:10px 0; padding:10px;"><label><input type="checkbox" checked class="candidate-check" data-amount="${c.amount}" data-id="${c.id}"> <strong>+${c.amount}円</strong> ${c.ruleNameSnapshot}</label><div style="font-size:0.9em; color:#aaa;">技能: ${c.skill} | 目標: ${c.targetValue} | 出目: ${c.rolledValue} | 結果: ${c.result}</div></li>`;
      });
      cDiv.appendChild(list);
      const btn = document.createElement('button'); btn.textContent = 'この内容で貯金として保存';
      btn.onclick = () => {
        const checkedIds = Array.from(document.querySelectorAll('.candidate-check:checked')).map(cb => cb.dataset.id);
        const valid = candidates.filter(c => checkedIds.includes(c.id));
        if (!valid.length) return alert('選択されていません');
        const total = valid.reduce((s,c)=>s+c.amount,0);
        if (!confirm(`合計 +${total}円を確定しますか？`)) return;
        db.transaction(['ledgerEntries'], 'readwrite').objectStore('ledgerEntries').add({ id: generateId(), date: new Date().toISOString().split('T')[0], type: 'saving', label: '自動計算貯金', amount: total, sessionId, details: valid, createdAt: new Date().toISOString() }).transaction.oncomplete = () => { alert('保存しました'); updateDashboardBalance(db); cDiv.innerHTML=''; };
      };
      cDiv.appendChild(btn);
      resolve();
    };
  });
}

document.getElementById('btn-add-manual').addEventListener('click', () => {
  const date = document.getElementById('manual-date').value, type = document.getElementById('manual-type').value, label = document.getElementById('manual-label').value, amount = parseInt(document.getElementById('manual-amount').value, 10);
  if (!date || !label || isNaN(amount)) return alert('正しく入力してください。');
  db.transaction(['ledgerEntries'], 'readwrite').objectStore('ledgerEntries').add({ id: generateId(), date, type, label, amount, sessionId: null, details: [], createdAt: new Date().toISOString() }).transaction.oncomplete = () => { alert('登録しました'); updateDashboardBalance(db); renderCalendar(db, new Date(date).getFullYear(), new Date(date).getMonth()); };
});

async function updateDashboardBalance(db) {
  return new Promise(resolve => {
    db.transaction(['ledgerEntries'], 'readonly').objectStore('ledgerEntries').getAll().onsuccess = e => {
      const bal = e.target.result.reduce((sum, en) => en.type === 'saving' ? sum + en.amount : sum - en.amount, 0);
      document.getElementById('total-balance').textContent = `${bal >= 0 ? '+' : ''}${bal}円`;
      resolve();
    };
  });
}

async function renderCalendar(db, targetYear, targetMonth) {
  return new Promise(resolve => {
    db.transaction(['ledgerEntries'], 'readonly').objectStore('ledgerEntries').getAll().onsuccess = e => {
      const daily = {};
      e.target.result.forEach(en => {
        const d = new Date(en.date);
        if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
          const day = d.getDate();
          if (!daily[day]) daily[day] = { saving: 0, expense: 0 };
          daily[day][en.type] += en.amount;
        }
      });
      const days = new Date(targetYear, targetMonth + 1, 0).getDate();
      let html = `<h3>${targetYear}年 ${targetMonth + 1}月</h3><table><tr><th>日</th><th>貯金</th><th>支出</th></tr>`;
      for (let i = 1; i <= days; i++) {
        const data = daily[i] || { saving: 0, expense: 0 };
        html += `<td ${data.saving || data.expense ? `style="cursor:pointer; background:#3a3a3a;" onclick="showCalendarDetail('${targetYear}-${String(targetMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}')"` : ''}><div>${i}</div><div style="font-size:0.8em; color:#4CAF50;">${data.saving ? '+'+data.saving : ''}</div><div style="font-size:0.8em; color:#f44336;">${data.expense ? '-'+data.expense : ''}</div></td>`;
        if (i % 7 === 0) html += '</tr><tr>';
      }
      document.getElementById('calendar-container').innerHTML = html + '</tr></table>';
      resolve();
    };
  });
}

window.showCalendarDetail = function(dateStr) {
  db.transaction(['ledgerEntries', 'sessions'], 'readonly').oncomplete = function(e) {
    const tx = db.transaction(['ledgerEntries', 'sessions'], 'readonly');
    let entries = [], sessions = [];
    tx.objectStore('ledgerEntries').getAll().onsuccess = ev => entries = ev.target.result.filter(x => x.date === dateStr);
    tx.objectStore('sessions').getAll().onsuccess = ev => sessions = ev.target.result;
    tx.oncomplete = () => {
      let s = 0, ex = 0, h = '<h4>貯金</h4><ul>';
      entries.filter(x=>x.type==='saving').forEach(x => { s+=x.amount; h+=`<li>${sessions.find(ss=>ss.id===x.sessionId)?.title || x.label}: +${x.amount}</li>`; });
      h += '</ul><h4>支出</h4><ul>';
      entries.filter(x=>x.type==='expense').forEach(x => { ex+=x.amount; h+=`<li>${x.label}: -${x.amount}</li>`; });
      document.getElementById('calendar-detail-date').textContent = dateStr;
      document.getElementById('calendar-detail-content').innerHTML = h + `</ul><hr><p><strong>収支: ${s-ex>=0?'+':''}${s-ex}円</strong></p>`;
      document.getElementById('calendar-detail-modal').classList.remove('hidden');
    };
  };
};

async function renderSessionList(db) {
  return new Promise(resolve => {
    const tx = db.transaction(['sessions', 'rollRecords'], 'readonly');
    let sessions = [], rolls = [];
    tx.objectStore('sessions').getAll().onsuccess = e => sessions = e.target.result;
    tx.objectStore('rollRecords').getAll().onsuccess = e => rolls = e.target.result;
    tx.oncomplete = () => {
      document.getElementById('session-table-container').innerHTML = `<table><tr><th>日付</th><th>シナリオ名</th><th>判定数</th><th>操作</th></tr>` + 
        sessions.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(s => `<tr><td>${s.dateStart||'-'}</td><td>${s.title}</td><td>${rolls.filter(r=>r.sessionId===s.id && r.isJudgement).length}</td><td><button onclick="openSessionEdit('${s.id}')">編集</button></td></tr>`).join('') + `</table>`;
      resolve();
    };
  });
}

let editingSessionId = null;
window.openSessionEdit = function(id) {
  db.transaction(['sessions'], 'readonly').objectStore('sessions').get(id).onsuccess = e => {
    const s = e.target.result; if(!s) return;
    editingSessionId = s.id; document.getElementById('edit-session-title').value = s.title; document.getElementById('edit-session-date').value = s.dateStart || '';
    const p = document.getElementById('edit-session-preview');
    if (s.imageAssetId) { p.src = s.imageAssetId; p.style.display = 'block'; } else { p.style.display = 'none'; }
    document.getElementById('session-edit-modal').classList.remove('hidden');
  };
};
document.getElementById('btn-save-session').addEventListener('click', async () => {
  const file = document.getElementById('edit-session-image').files[0];
  let dataUrl = document.getElementById('edit-session-preview').src;
  if (file) {
    dataUrl = await new Promise(res => {
      const r = new FileReader(); r.onload = ev => {
        const img = new Image(); img.onload = () => {
          const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
          let {width, height} = img; const max = 1200;
          if(width>max||height>max) { if(width>height) {height*=max/width; width=max;} else {width*=max/height; height=max;} }
          canvas.width = width; canvas.height = height; ctx.drawImage(img,0,0,width,height);
          res(canvas.toDataURL('image/jpeg', 0.8));
        }; img.src = ev.target.result;
      }; r.readAsDataURL(file);
    });
  }
  const tx = db.transaction(['sessions'], 'readwrite');
  tx.objectStore('sessions').get(editingSessionId).onsuccess = e => {
    const s = e.target.result; s.title = document.getElementById('edit-session-title').value; s.dateStart = document.getElementById('edit-session-date').value; s.imageAssetId = dataUrl.length > 100 ? dataUrl : null; tx.objectStore('sessions').put(s);
  };
  tx.oncomplete = () => { document.getElementById('session-edit-modal').classList.add('hidden'); renderSessionList(db); };
});

document.getElementById('nav-menu').addEventListener('click', e => {
  if (e.target.tagName === 'LI') {
    document.querySelectorAll('main section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(e.target.dataset.target).classList.remove('hidden');
  }
});

document.getElementById('log-upload').addEventListener('change', async e => {
  for (const file of e.target.files) {
    try {
      const { sessionId } = await saveLogToDB(db, await handleFileUpload(file, db));
      await updateDashboardBalance(db); await loadPeopleData(db); await renderSessionList(db); await renderOverallAnalysis(db);
      if (myPlId) { await generateAndRenderCandidates(db, sessionId, myPlId); document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden')); document.getElementById('savings').classList.remove('hidden'); } 
      else alert('自分のPLが未設定のため、自分の貯金ルールは判定されていません。');
    } catch (err) { alert(err.message); }
  }
});

async function renderSettings(db) {
  db.transaction(['pls'], 'readonly').objectStore('pls').getAll().onsuccess = e => {
    document.getElementById('settings').innerHTML = `<h1>設定</h1><h3>自分のPL設定</h3><select id="setting-my-pl"><option value="">-- 未設定 --</option>${e.target.result.map(pl=>`<option value="${pl.id}" ${pl.id===myPlId?'selected':''}>${pl.name}</option>`).join('')}</select> <button id="btn-save-my-pl">保存</button><hr><button id="btn-export">JSONエクスポート</button>`;
    document.getElementById('btn-save-my-pl').addEventListener('click', () => { localStorage.setItem('myPlId', myPlId = document.getElementById('setting-my-pl').value); alert('保存しました'); });
    document.getElementById('btn-export').addEventListener('click', () => {
      const stores = ['sessions', 'sourceLogs', 'parsedItems', 'rollRecords', 'statusChanges', 'aliasMappings', 'pcs', 'pls', 'ledgerEntries'], exportObj = { schemaVersion: 1, exportedAt: new Date().toISOString(), data: {} }, tx = db.transaction(stores, 'readonly');
      stores.forEach(s => tx.objectStore(s).getAll().onsuccess = ev => exportObj.data[s] = ev.target.result);
      tx.oncomplete = () => { const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj)); a.download = `backup.json`; a.click(); };
    });
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('manual-date').value = new Date().toISOString().split('T')[0];
  await initDB(); await updateDashboardBalance(db); await renderCalendar(db, new Date().getFullYear(), new Date().getMonth());
  await loadPeopleData(db); await renderSessionList(db); await renderOverallAnalysis(db); await renderSettings(db);
});