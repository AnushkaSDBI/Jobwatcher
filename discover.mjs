// Finds which public hiring system each company in companies.json uses, by probing likely slugs.
// Usage: node discover.mjs                 (companies without sources)
//        node discover.mjs --all           (re-probe everything)
//        node discover.mjs --only "SAP,BMW Group"
// Workday can't be guessed: add {"ats":"workday","host":"x.wd3.myworkdayjobs.com","tenant":"x","site":"External"} by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(ROOT, 'companies.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { headers: { 'User-Agent': 'jobwatch/1.0 (personal job-market research)', Accept: 'application/json' } };

export function slugsFor(name) {
  const base = name.toLowerCase().replace(/&/g, '').replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9 +-]/g, '');
  const core = base.replace(/\b(group|gruppe|ag|se|gmbh|kgaa|co|kg|deutschland|germany)\b/g, '').replace(/\s+/g, ' ').trim();
  const out = new Set([core.replace(/[ +-]/g, ''), core.replace(/ /g, '-'), base.replace(/[ +-]/g, ''), base.replace(/ /g, '-')]);
  return [...out].filter(Boolean);
}
const probes = {
  greenhouse: async (f, s) => { const j = await f(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`); const b = await f(`https://boards-api.greenhouse.io/v1/boards/${s}`).catch(() => ({})); return [(j.jobs || []).length, b.name || (j.jobs || [])[0]?.title]; },
  lever: async (f, s) => { const j = await f(`https://api.lever.co/v0/postings/${s}?mode=json`); return [Array.isArray(j) ? j.length : 0, j[0]?.text]; },
  smartrecruiters: async (f, s) => { const j = await f(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`); return [j.totalFound || 0, j.content?.[0]?.company?.name]; },
  recruitee: async (f, s) => { const j = await f(`https://${s}.recruitee.com/api/offers/`); return [(j.offers || []).length, j.offers?.[0]?.company_name]; },
  personio: async (f, s) => { const r = await fetch(`https://${s}.jobs.personio.de/xml`, H); if (!r.ok) return [0]; const t = await r.text(); return [(t.match(/<position>/g) || []).length, (t.match(/<subcompany>(?:<!\[CDATA\[)?([^<\]]*)/) || [])[1]]; }
};
async function jget(url) { const r = await fetch(url, H); if (!r.ok) throw new Error(r.status); return r.json(); }

export async function discover(name, delay = 150) {
  const found = [];
  for (const slug of slugsFor(name)) for (const [ats, p] of Object.entries(probes)) {
    try { const [n, who] = await p(jget, slug); if (n > 0) found.push({ ats, slug, openings: n, who }); } catch { /* not this system */ }
    await sleep(delay);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arg = f => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 1));
  // A slug can belong to a different company with a similar name, so matches are only candidates until accepted.
  if (process.argv.includes('--accept') || process.argv.includes('--accept-all')) {
    const list = (arg('--accept') || '').split(',').map(x => x.trim().toLowerCase());
    for (const c of data.companies) if (c.candidates?.length && (process.argv.includes('--accept-all') || list.includes(c.name.toLowerCase()))) {
      c.sources = c.candidates.map(({ ats, slug }) => ({ ats, slug })); delete c.candidates; console.log('accepted', c.name);
    }
    save(); process.exit(0);
  }
  const all = process.argv.includes('--all'); const only = arg('--only')?.split(',').map(s => s.trim().toLowerCase());
  for (const c of data.companies) {
    if (only ? !only.includes(c.name.toLowerCase()) : (!all && (c.sources.length || c.candidates))) continue;
    const f = await discover(c.name);
    if (f.length) { c.candidates = f; console.log(`${c.name}: ${f.map(x => `${x.ats}/${x.slug} (${x.openings} jobs, "${x.who || '?'}")`).join(' | ')}`); }
    else console.log(`${c.name}: not on a public hiring system`);
    save();
  }
  console.log('\nCheck the names above are really the company, then: node discover.mjs --accept "SAP,Bayer"   (or --accept-all)');
}
