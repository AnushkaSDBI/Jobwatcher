// Optional: ask Claude (Haiku) to confirm the domain of ambiguous postings (dom 'ab' or title-only matches).
// Runs only when ANTHROPIC_API_KEY is set. Costs ~ a few cents per week. Never changes anything without an answer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState } from './collect.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

export async function classify({ f = fetch, key = process.env.ANTHROPIC_API_KEY, stateFile = path.join(ROOT, 'data/state.json'), limit = 150, log = console.log } = {}) {
  if (!key) { log('ANTHROPIC_API_KEY not set: skipping LLM pass'); return 0; }
  const state = loadState(stateFile);
  const todo = Object.values(state.jobs).filter(j => !j.closed && !j.llm && j.dom === 'ab').slice(0, limit);
  let n = 0;
  for (let i = 0; i < todo.length; i += 25) {
    const batch = todo.slice(i, i + 25);
    const prompt = `Classify each German job posting into exactly one label:\n"a" = data science / BI / ML / NLP / AI work,\n"b" = Industry 4.0 / electrical engineering / automation / robotics,\n"x" = neither (e.g. sales, HR, unrelated).\nReply with JSON only: {"<ref>":"a|b|x",...}\n\n` + batch.map(j => `${j.ref} | ${j.title} | ${(j.roles || []).join('; ')}`).join('\n');
    const r = await f('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) { log('LLM HTTP ' + r.status); break; }
    const txt = (await r.json()).content?.[0]?.text || '{}';
    let out = {}; try { out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { continue; }
    for (const j of batch) if (['a', 'b', 'x'].includes(out[j.ref])) { j.llm = out[j.ref]; if (j.llm !== 'x') j.dom = j.llm; else j.closed = j.closed || 'irrelevant'; n++; }
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  log(`LLM pass: reclassified ${n}`);
  return n;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) classify();
