import { loadLongTermMemory } from './memory.js';
function segmentMemory(text) {
    return text.split(/\n{2,}|^---$/m).filter(s => s.trim().length > 20);
}
function score(query, segment) {
    const queryTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
    const segTerms = segment.toLowerCase().split(/\W+/);
    return queryTerms.reduce((acc, term) => {
        const tf = segTerms.filter(t => t === term).length;
        return acc + tf;
    }, 0);
}
export function retrieveRelevantMemory(agentName, query, topK = 3) {
    const fullMemory = loadLongTermMemory(agentName);
    if (!fullMemory)
        return '';
    const segments = segmentMemory(fullMemory);
    const scored = segments.map(s => ({ s, score: score(query, s) }));
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.slice(0, topK).filter(x => x.score > 0).map(x => x.s);
    return relevant.join('\n\n');
}
