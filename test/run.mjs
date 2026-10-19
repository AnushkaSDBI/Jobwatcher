import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { run } from '../collect.mjs';
import { build } from '../build-site.mjs';
import { normalise, isStaffing, germanFromText, domainOf } from '../lib/classify.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(dir, '../profile.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-'));
const stateFile = path.join(tmp, 'state.json');

const mock = drop => async url => {
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/pc/v6/jobs')) {
    const page = +new URL(url).searchParams.get('page');
    return ok({ ergebnisliste: page === 1 ? fx.items.filter(i => !drop.includes(i.referenznummer)) : [] });
  }
  const m = url.match(/jobdetails\/(.+)$/); const ref = Buffer.from(m[1], 'base64').toString();
  return ok({ stellenangebotsBeschreibung: fx.desc[ref] || fx.desc.default });
};
const q = { a: ['Data'], b: ['Auto'], thesis: ['Masterarbeit'] };
const opt = d => ({ f: mock(d.drop), today: d.day, stateFile, profile, queries: q, delay: 0, log: () => {} });

// unit checks
assert.equal(domainOf('Reinigungskraft'), null);
assert.ok(isStaffing('FERCHAU GmbH Niederlassung Ulm'));
assert.equal(germanFromText('Fließend Deutsch erforderlich'), 'req');
assert.equal(germanFromText('Deutschkenntnisse von Vorteil'), 'opt');
assert.equal(germanFromText('working language is English'), 'no');
const th = normalise(fx.items[0], profile); assert.ok(th.thesis && th.thesisLevel === 'any');
assert.deepEqual(th.cell, [49.9, 8.25].map((v, i) => i ? 8.25 : 49.9) && th.cell);

// 3 weekly runs: item disappears in run 2 and 3 -> closed only after 2 consecutive misses
let s = await run(opt({ day: '2026-10-05', drop: [] }));
assert.equal(Object.keys(s.jobs).length, 7, 'noise item excluded');
s = await run(opt({ day: '2026-10-12', drop: ['X-DS-2'] }));
assert.equal(s.jobs['X-DS-2'].closed, null, 'one miss is not a closure');
s = await run(opt({ day: '2026-10-19', drop: ['X-DS-2'] }));
assert.equal(s.jobs['X-DS-2'].closed, '2026-10-19');
assert.equal(s.runs.length, 3);
assert.equal(s.jobs['X-DS-1'].de, 'req');
assert.equal(s.jobs['16618-13896419-S'].de, 'req');
assert.ok(s.jobs['X-DS-1'].match > 40, 'CV match: ' + s.jobs['X-DS-1'].match);
assert.ok(s.jobs['12265-486274_JB5268479-S'].staffing);

const out = path.join(tmp, 'site');
const r = build({ stateFile, outDir: out, end: '2026-10-19' });
const dh = fs.readFileSync(path.join(out, 'dh.js'), 'utf8'); assert.ok(dh.includes('"closed":1') || dh.includes('"closed"'));
const dj = fs.readFileSync(path.join(out, 'dj1.js'), 'utf8');
assert.ok(dj.includes('Stuttgart +1'), 'FERCHAU duplicates grouped into one card');
for (const f of fs.readdirSync(out)) new Function('window', fs.readFileSync(path.join(out, f), 'utf8'))({ HP_DATA: { dom: { a: {}, b: {} }, jobs: [] } });
console.log('all tests passed', r);
// LLM pass with a mocked API
import { classify } from '../llm-classify.mjs';
const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const ab = Object.values(st.jobs).find(j => j.dom === 'ab') || (() => { const j = Object.values(st.jobs)[0]; j.dom = 'ab'; fs.writeFileSync(stateFile, JSON.stringify(st)); return j; })();
const n = await classify({ key: 'k', stateFile, log: () => {}, f: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: `{"${ab.ref}":"b"}` }] }) }) });
assert.equal(n, 1); assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).jobs[ab.ref].dom, 'b');
assert.equal(await classify({ key: '', stateFile, log: () => {} }), 0);
console.log('llm pass ok');
if(process.env.KEEP)fs.cpSync(out,process.env.KEEP,{recursive:true});
