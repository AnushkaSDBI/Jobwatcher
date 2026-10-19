// Weekly collector for the Bundesagentur für Arbeit Jobsuche API.
// Usage: node collect.mjs   (env: SINCE_DAYS=90, MAX_DETAILS=300, ANTHROPIC_API_KEY optional)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUERIES, normalise, germanFromText, matchScore } from './lib/classify.mjs';
import { collectExternal } from './lib/ats.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
const HDR = { 'X-API-Key': 'jobboerse-jobsuche', 'User-Agent': 'jobwatch/1.0 (personal job-market research)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(f, url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await f(url, { headers: HDR });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(800 * (i + 1)); }
  }
}

// One search term -> up to 5 pages x 100 (the API's hard 500 cap per query).
export async function searchAll(f, term, sinceDays, delay = 250, extra = '') {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const u = `${API}/pc/v6/jobs?${term ? 'was=' + encodeURIComponent(term) + '&' : ''}size=100&page=${page}&veroeffentlichtseit=${sinceDays}${extra}`;
    const j = await getJson(f, u);
    const items = j.ergebnisliste || j.stellenangebote || [];
    if (page === 1 && !Array.isArray(j.ergebnisliste) && !Array.isArray(j.stellenangebote)) throw new Error('unexpected response shape, keys: ' + Object.keys(j));
    out.push(...items);
    if (items.length < 100) break;
    await sleep(delay);
  }
  return out;
}

// Employer-targeted search. The API matches the exact registered employer name ("BMW AG", not "BMW").
// <=500 postings: take them all. More: split by domain terms so the 500 cap doesn't cut anything relevant.
const EMP_TERMS = ['Data', 'Daten', 'KI', 'Machine Learning', 'Software', 'Automatisierung', 'Elektrotechnik', 'Robotik', 'Embedded', 'Masterarbeit', 'Bachelorarbeit', 'Abschlussarbeit', 'Werkstudent', 'Praktikum'];
export async function searchEmployer(f, name, sinceDays, delay = 250) {
  const extra = '&arbeitgeber=' + encodeURIComponent(name);
  const u = `${API}/pc/v6/jobs?size=1&page=1&veroeffentlichtseit=${sinceDays}${extra}`;
  const total = (await getJson(f, u)).maxErgebnisse || 0;
  if (!total) return [];
  if (total <= 500) return searchAll(f, '', sinceDays, delay, extra);
  const got = new Map();
  for (const t of EMP_TERMS) { for (const it of await searchAll(f, t, sinceDays, delay, extra)) got.set(it.referenznummer, it); await sleep(delay); }
  return [...got.values()];
}

export async function fetchDescription(f, ref) {
  const id = Buffer.from(ref).toString('base64');
  const j = await getJson(f, `${API}/pc/v4/jobdetails/${id}`, 2);
  return (j.stellenangebotsBeschreibung || '').slice(0, 20000);
}

export function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { version: 1, runs: [], jobs: {} }; }
}

export async function run({ f = fetch, today = new Date().toISOString().slice(0, 10), stateFile = path.join(ROOT, 'data/state.json'),
  profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'profile.json'), 'utf8')),
  queries = QUERIES, agencyNames = JSON.parse(fs.readFileSync(path.join(ROOT, 'agency.json'), 'utf8')).employers, companies = JSON.parse(fs.readFileSync(path.join(ROOT, 'companies.json'), 'utf8')).companies, sources = {}, sinceDays = +process.env.SINCE_DAYS || 90, maxDetails = +process.env.MAX_DETAILS || 300, delay = 250, log = console.log } = {}) {
  const state = loadState(stateFile);
  if (state.runs.some(r => r.date === today)) log(`note: a run for ${today} already exists; merging again`);
  const seen = new Map(); let raw = 0, failed = 0;
  for (const group of Object.keys(queries)) {
    for (const term of queries[group]) {
      try {
        const items = await searchAll(f, term, sinceDays, delay);
        raw += items.length;
        for (const it of items) { const j = normalise(it, profile); if (j && !seen.has(j.ref)) seen.set(j.ref, j); }
        log(`${group}/${term}: ${items.length}`);
      } catch (e) { failed++; log(`FAILED ${term}: ${e.message}`); }
      await sleep(delay);
    }
  }
  let empFailed = 0, empRaw = 0;
  for (const name of agencyNames) {
    try {
      const items = await searchEmployer(f, name, sinceDays, delay);
      raw += items.length; empRaw += items.length;
      for (const it of items) { const j = normalise(it, profile); if (j && !seen.has(j.ref)) seen.set(j.ref, j); }
      log(`employer/${name}: ${items.length}`);
    } catch (e) { empFailed++; log(`FAILED employer ${name}: ${e.message}`); }
    await sleep(delay);
  }
  if (raw === 0) throw new Error('All searches returned 0 postings: API unreachable or response format changed. Aborting without touching state.');
  failed += empFailed;
  const nq = Object.values(queries).flat().length + agencyNames.length;
  const complete = failed <= Math.floor(nq * 0.1) && seen.size > 0;
  // External sources (company career systems, aggregators). Same pipeline, lower priority than the Agency copy.
  const cityInfo = new Map();
  for (const j of [...Object.values(state.jobs), ...seen.values()]) if (j.city && j.cell && !cityInfo.has(j.city.toLowerCase())) cityInfo.set(j.city.toLowerCase(), { cell: j.cell, state: j.state });
  const key = j => (j.title + '|' + j.company + '|' + j.city).toLowerCase().replace(/\s+/g, ' ');
  const have = new Set([...seen.values()].map(key));
  const terms = ['data', 'machine learning', 'KI', 'automation', 'Elektro', 'Robotik', 'thesis'];
  const ext = await collectExternal({ f, companies, sources, terms, cities: new Set(cityInfo.keys()), known: new Set(Object.keys(state.jobs)), delay, log });
  let extKept = 0;
  const extFail = ext.failed;
  for (const it of ext.items) {
    if (it.stub) { if (state.jobs[it.referenznummer]) seen.set(it.referenznummer, state.jobs[it.referenznummer]); continue; } // already known: just mark as still open
    const j = normalise(it, profile); if (!j || seen.has(j.ref)) continue;
    const ci = cityInfo.get(j.city.toLowerCase()); if (ci) { j.cell = ci.cell; j.state = ci.state; }
    if (have.has(key(j))) continue; have.add(key(j));
    if (it.desc) { j.de = germanFromText(it.desc); j.descDone = true; const m = matchScore(profile, j.title, it.desc); j.match = m.score; j.descMatch = m.score; j.hits = m.hits; }
    if (!j.date) j.date = today;
    seen.set(j.ref, j); extKept++;
  }
  log(`external: ${ext.items.length} fetched, ${extKept} relevant and new, ${extFail}/${ext.tasks} sources failed`);
  // Merge into state.
  let added = 0;
  for (const [ref, j] of seen) {
    const old = state.jobs[ref];
    if (old) Object.assign(old, { ...j, first: old.first, de: j.de ?? old.de, descDone: j.descDone ?? old.descDone, match: old.descMatch ?? j.match, missed: 0, last: today, closed: null });
    else { state.jobs[ref] = { ...j, first: today, last: today, missed: 0, closed: null, de: j.de ?? null, descDone: !!j.descDone }; added++; }
  }
  // Closing: only after a complete run, and only after missing 2 consecutive runs
  // (the 500/query cap means a single miss can just be truncation, not a real closure).
  let closed = 0;
  if (complete) for (const j of Object.values(state.jobs)) {
    if (j.closed || seen.has(j.ref)) continue;
    j.missed = (j.missed || 0) + 1;
    if (j.missed >= 2) { j.closed = today; closed++; }
  } else log('run incomplete: skipping closure detection');
  // Descriptions: new, non-thesis-or-thesis alike, newest first, capped. Drives German-required + match score.
  const todo = Object.values(state.jobs).filter(j => !j.descDone && !j.closed && (j.src || 'ba') === 'ba').sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxDetails);
  let det = 0;
  for (const j of todo) {
    try {
      const d = await fetchDescription(f, j.ref);
      j.de = germanFromText(d); j.descDone = true; det++;
      const m = matchScore(profile, j.title, d); j.descMatch = m.score; j.match = m.score; j.hits = m.hits;
    } catch (e) { log(`detail ${j.ref}: ${e.message}`); }
    await sleep(delay);
  }
  const act = d => Object.values(state.jobs).filter(j => !j.closed && !j.thesis && j.dom.includes(d)).length;
  const actT = d => Object.values(state.jobs).filter(j => !j.closed && j.thesis && j.dom.includes(d)).length;
  state.runs = state.runs.filter(r => r.date !== today);
  state.runs.push({ date: today, raw, unique: seen.size, added, closed, complete, details: det, a: act('a'), b: act('b'), ta: actT('a'), tb: actT('b') });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  log(`done: unique=${seen.size} added=${added} closed=${closed} details=${det} complete=${complete}`);
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error(e); process.exit(1); });
}
