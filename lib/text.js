/** Only committed, newly appended visible assistant text is eligible. */
export function messageText(session, event) {
  if (session.header?.origin === 'subagent' || event.type !== 'assistant/message'
      || event.surfaceOp !== 'append' || event.data?.interrupted
      || event.seq < session.firstLiveSeq) return '';
  const message = event.data?.message;
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text).join('\n');
}

/** A deliberately conservative speech-oriented Markdown cleanup, not a renderer. */
export function cleanText(text, maxChars = 3000) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fence;
  const prose = [];
  for (const line of lines) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (match) { fence = match[1]; continue; }
    if (/^( {4}|\t)/.test(line) || /^\s*\[[^\]]+\]:\s*\S+/.test(line)) continue;
    prose.push(line);
  }
  const result = prose.join('\n')
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*[-|: ]{3,}\s*$/gm, '')
    .replace(/[|*_~]/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '＜').replace(/&gt;/g, '＞')
    .replace(/\s+/g, ' ').trim();
  const chars = Array.from(result);
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') + '。以下省略します。' : result;
}

/** Bound synthesis work and start playback without synthesizing a whole essay. */
export function splitText(text, limit = 180) {
  const chunks = [];
  let current = '';
  for (const character of Array.from(text)) {
    current += character;
    if (/[。！？!?\n]/u.test(character) || Array.from(current).length >= limit) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
