// src/import.js
async function calculateSHA256(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleFileUpload(file, db) {
  const fileHash = await calculateSHA256(file);
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sourceLogs'], 'readonly');
    const store = transaction.objectStore('sourceLogs');
    const index = store.index('fileHash');
    const request = index.get(fileHash);

    request.onsuccess = async (e) => {
      if (e.target.result) {
        reject(new Error('同一ファイルは既に取り込まれています。')); // 重複防止要件
        return;
      }
      const rawHtml = await file.text();
      const parsedItems = parseCcfoliaHtml(rawHtml);
      resolve({ fileName: file.name, fileHash, rawHtml, parsedItems });
    };
  });
}