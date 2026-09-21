// src/parser/dice.js
function analyzeMessageData(item) {
  const text = item.body;
  
  // ステータス変動解析 (例: SAN : 87 → 86)[cite: 1]
  const statusMatch = text.match(/(SAN|HP|MP|C)\s*:\s*(\d+)\s*(?:→|->|＞)\s*(\d+)/i);
  if (statusMatch) {
    item.itemType = 'status';
    item.statusData = {
      stat: statusMatch[1].toUpperCase(),
      before: parseInt(statusMatch[2], 10),
      after: parseInt(statusMatch[3], 10),
      delta: parseInt(statusMatch[3], 10) - parseInt(statusMatch[2], 10)
    };
    return item;
  }

  // ダイスロール解析
  if (text.includes('＞')) {
    item.itemType = 'roll';
    item.rollData = { system: 'unknown', result: 'unknown', rolledValue: null, targetValue: null, skillRaw: '' };
    
    const rollParts = text.split('＞').map(s => s.trim());
    const commandPart = rollParts[0];
    const resultPart = rollParts[rollParts.length - 1];

    // 目標値・技能名の抽出 (1D100<=70 等)[cite: 1]
    const targetMatch = commandPart.match(/\(1D100<=(\d+)\)/i);
    if (targetMatch) item.rollData.targetValue = parseInt(targetMatch[1], 10);
    
    const skillMatch = commandPart.match(/【(.*?)】|\s+([^\s\d\(\)]+)\s+\(1D100/);
    if (skillMatch) item.rollData.skillRaw = (skillMatch[1] || skillMatch[2]).trim();

    // CoC6 と CoC7 の判定分岐[cite: 1]
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

    // 採用出目の抽出 (複数の数値が出た場合は直前の値を採用)[cite: 1]
    const rolledMatch = rollParts.slice(1, -1).reverse().find(s => !isNaN(parseInt(s, 10)));
    if (rolledMatch) item.rollData.rolledValue = parseInt(rolledMatch, 10);
    
  } else {
     item.itemType = 'message';
  }

  return item;
}