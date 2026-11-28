const BRACKET_PAIRS = new Map([
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['【', '】'],
  ['〔', '〕'],
  ['［', '］'],
  ['｛', '｝'],
  ['{', '}'],
  ['《', '》'],
  ['〈', '〉'],
  ['「', '」'],
  ['『', '』']
]);
const CLOSING_BRACKETS = new Set(BRACKET_PAIRS.values());

/**
 * 删除声优名中的括号内容及所有空白字符。
 * 支持嵌套和连续的多组括号。
 */
const normalizeVoiceActorName = (name) => {
  if (typeof name !== 'string') return '';

  const characters = Array.from(name);
  const removed = new Array(characters.length).fill(false);
  const stack = [];

  characters.forEach((character, index) => {
    const closing = BRACKET_PAIRS.get(character);
    if (closing) {
      stack.push({ index, closing });
      return;
    }
    if (!CLOSING_BRACKETS.has(character) || stack.length === 0) return;

    const opening = stack[stack.length - 1];
    if (opening.closing !== character) return;
    stack.pop();
    for (let i = opening.index; i <= index; i += 1) removed[i] = true;
  });

  const withoutBrackets = characters
    .filter((character, index) => !removed[index])
    .join('');
  return withoutBrackets.replace(/\s+/g, '');
};

module.exports = {
  normalizeVoiceActorName
};
