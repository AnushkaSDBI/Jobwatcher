// Turns data/state.json into the site's data files (same HP_DATA shape the UI already reads) + history.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATES } from './lib/classify.mjs';
import { loadState } from './collect.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86400000;
const wkIdx = (end, d) => 12 - Math.floor((Date.parse(end) - Date.parse(d)) / (7 * DAY));
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const js = o => JSON.stringify(o);

// Collapse same title+company across cities into one card with a location count.
function group(rows) {
  const g = new Map();
  for (const j of rows) {
    const k = (j.title + '|' + j.company).toLowerCase();
    const e = g.get(k);
    if (!e) g.set(k, { j, n: 1, cities: new Set([j.city]) });
    else { e.n++; e.cities.add(j.city); if (j.date > e.j.date) e.j = j; }
  }
  return [...g.values()];
}

const tuple = ({ j, n, cities }) => [j.ref, j.title, j.company, n > 1 ? `${j.city} +${cities.size - 1}` : j.city, j.date, j.flags, j.state, j.dom, j.cell,
  { m: j.match || 0, s: j.staffing ? 1 : 0, g: n, de: j.de || null, f: j.first, u: j.url || undefined, src: j.src && j.src !== 'ba' ? j.src : undefined }];

export function build({ stateFile = path.join(ROOT, 'data/state.json'), outDir = path.join(ROOT, 'site'), end } = {}) {
  const state = loadState(stateFile);
  const all = Object.values(state.jobs);
  if (!all.length) throw new Error('data/state.json has no jobs. Run `node collect.mjs` first; refusing to overwrite site data with zeros.');
  end = end || state.runs.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.parse(end) - 91 * DAY).toISOString().slice(0, 10);
  const live = all.filter(j => !j.closed);
  const dom = {};
  for (const d of ['a', 'b']) {
    const main = live.filter(j => !j.thesis && j.dom.includes(d));
    const win = main.filter(j => j.date >= cutoff && wkIdx(end, j.date) >= 0 && wkIdx(end, j.date) <= 12);
    const wk = Array(13).fill(0), st = Array(16).fill(0), titles = new Map(), cells = new Map(), comp = new Map();
    const fl = { h: 0, b: 0, v: 0, entry: 0, de: 0 };
    let geo = 0;
    for (const j of win) {
      wk[wkIdx(end, j.date)]++;
      if (j.state >= 0) st[j.state]++;
      if (j.flags & 1) fl.h++; if (j.flags & 2) fl.b++; if (j.flags & 4) fl.v++; if (j.flags & 8) fl.entry++;
      if (j.de ? j.de === 'req' : j.flags & 16) fl.de++;
      const r = j.roles?.[0]; if (r) titles.set(r, (titles.get(r) || 0) + 1);
      if (j.cell) { geo++; const k = j.cell.join(','); cells.set(k, (cells.get(k) || 0) + 1); }
      let c = comp.get(j.company); if (!c) comp.set(j.company, c = { n: 0, wk: Array(13).fill(0), city: new Map(), st: j.state, h: 0, e: 0, roles: new Map(), staff: j.staffing });
      c.n++; c.wk[wkIdx(end, j.date)]++; c.city.set(j.city, (c.city.get(j.city) || 0) + 1); if (j.flags & 1) c.h++; if (j.flags & 8) c.e++;
      if (r) c.roles.set(r, (c.roles.get(r) || 0) + 1);
    }
    const companies = top(new Map([...comp].map(([k, v]) => [k, v.n])), 150).map(([name]) => {
      const c = comp.get(name);
      return [name, c.n, c.wk, top(c.city, 1)[0]?.[0] || '', c.st, Math.round((100 * c.h) / c.n), c.e, top(c.roles, 3).map(x => x[0]), c.staff ? 1 : 0];
    });
    dom[d] = { total: win.length, wk, older: main.length - win.length, st, flags: fl, titles: top(titles, 14),
      cells: [...cells].map(([k, n]) => [...k.split(',').map(Number), n]), geoExact: geo, geoApprox: 0, noGeo: win.length - geo,
      top: {}, nCompanies: comp.size, top150share: companies.reduce((s, c) => s + c[1], 0), companies };
  }
  const rowsFor = d => group(live.filter(j => !j.thesis && j.dom.includes(d))).sort((x, y) => y.j.date.localeCompare(x.j.date)).slice(0, 400).map(tuple);
  const jobs = [...rowsFor('a'), ...rowsFor('b')];
  const th = {};
  for (const d of ['a', 'b']) {
    const t = live.filter(j => j.thesis && j.dom.includes(d));
    const wk = Array(13).fill(0); let older = 0; const cs = new Set();
    for (const j of t) { const i = wkIdx(end, j.date); if (i >= 0 && i <= 12) wk[i]++; else older++; cs.add(j.company); }
    th[d] = { total: t.length - older, wk, older, nCompanies: cs.size,
      rows: group(t).sort((x, y) => y.j.date.localeCompare(x.j.date)).slice(0, 300).map(tuple) };
  }
  // Real history: only exists from the 2nd run onwards.
  const runs = state.runs.map(r => ({ date: r.date, a: r.a, b: r.b, ta: r.ta, tb: r.tb, added: r.added, closed: r.closed, complete: r.complete }));
  const closedList = all.filter(j => j.closed && !j.thesis).sort((x, y) => y.closed.localeCompare(x.closed)).slice(0, 200)
    .map(j => [j.ref, j.title, j.company, j.city, j.first, j.closed, j.dom]);
  const meta = { asOf: end, raw: state.runs.at(-1)?.raw || 0, kept: live.length, queries: 0, windowDays: 90, runs: runs.length, generated: new Date().toISOString() };
  fs.mkdirSync(outDir, { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(outDir, f), s);
  w('d0.js', `window.HP_DATA={meta:${js(meta)},states:${js(STATES)},dom:${js(Object.fromEntries(['a', 'b'].map(d => [d, { ...dom[d], companies: undefined }])))},jobs:[]};`);
  w('dca.js', `window.HP_DATA.dom.a.companies=${js(dom.a.companies)};`);
  w('dcb.js', `window.HP_DATA.dom.b.companies=${js(dom.b.companies)};`);
  w('dj1.js', `window.HP_DATA.jobs.push.apply(window.HP_DATA.jobs,${js(jobs)});`);
  w('dt.js', `window.HP_DATA.thesis=${js(th)};`);
  w('dh.js', `window.HP_DATA.history={runs:${js(runs)},closed:${js(closedList)}};`);
  return { meta, jobs: jobs.length, runs: runs.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(build());
