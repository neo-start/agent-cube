import { loadLongTermMemory } from './memory.js';

function segmentMemory(text: string): string[] {
  return text.split(/\n{2,}|^---$/m).filter(s => s.trim().length > 20);
}

// Tokenize text: splits on whitespace for Latin, individual characters for CJK
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  // Extract Latin words
  const latinWords = lower.match(/[a-z0-9_]+/g);
  if (latinWords) tokens.push(...latinWords);
  // Extract CJK characters individually (each char is a token)
  const cjkChars = lower.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (cjkChars) tokens.push(...cjkChars);
  return tokens;
}

// Bigram generation for CJK: pairs of adjacent characters improve matching
function cjkBigrams(text: string): string[] {
  const chars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (!chars || chars.length < 2) return [];
  const bigrams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
  }
  return bigrams;
}

function score(query: string, segment: string): number {
  const queryTokens = tokenize(query);
  const segTokens = new Set(tokenize(segment));
  // Unigram matches
  let s = queryTokens.reduce((acc, term) => acc + (segTokens.has(term) ? 1 : 0), 0);
  // CJK bigram matches (weighted higher for precision)
  const queryBigrams = cjkBigrams(query);
  if (queryBigrams.length > 0) {
    const segBigrams = new Set(cjkBigrams(segment));
    s += queryBigrams.reduce((acc, bg) => acc + (segBigrams.has(bg) ? 2 : 0), 0);
  }
  return s;
}

export function retrieveRelevantMemory(agentName: string, query: string, topK = 3): string {
  const fullMemory = loadLongTermMemory(agentName);
  if (!fullMemory) return '';
  const segments = segmentMemory(fullMemory);
  const scored = segments.map(s => ({ s, score: score(query, s) }));
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.slice(0, topK).filter(x => x.score > 0).map(x => x.s);
  return relevant.join('\n\n');
}
