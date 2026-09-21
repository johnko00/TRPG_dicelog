// src/parser/ccfolia.js
function parseCcfoliaHtml(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const paragraphs = doc.querySelectorAll('p');
  const items = [];

  paragraphs.forEach((p, index) => {
    const spans = p.querySelectorAll('span');
    // 基本構造: [channel] [speaker] [body...][cite: 1]
    if (spans.length >= 3) {
      const item = {
        sequence: index + 1,
        channel: spans[0].textContent.trim(),
        rawSpeaker: spans[1].textContent.trim(),
        body: Array.from(spans).slice(2).map(s => s.textContent).join(' ').trim(),
        rawText: p.textContent.trim(),
        itemType: 'unknown' // 初期値はunknown[cite: 1]
      };
      items.push(analyzeMessageData(item));
    }
  });
  return items;
}