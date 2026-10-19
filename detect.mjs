// Works out which hiring system a company's career site runs on, from its career-page URL.
// Usage: node detect.mjs                 (every company in companies.json that has a "careers" URL and no sources)
//        node detect.mjs --only "SAP"    (one company)
//        node detect.mjs --accept "SAP,Siemens" | --accept-all
// Findings go into "candidates"; nothing is used until accepted. Reads only the public pages the career site serves.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJobPostings } from './lib/ats.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(ROOT, 'companies.json');
const UA = { headers: { 'User-Agent': 'jobwatch/1.0 (personal job-market research)', Accept: 'text/html,application/xml,application/json' }, redirect: 'follow' };
const get = async u => { const r = await fetch(u, UA); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };

export function fingerprint(html, baseUrl = '') {
  const found = [];
  const add = c => { if (!found.some(x => x.ats === c.ats && x.slug === c.slug && x.host === c.host)) found.push(c); };
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g)) add({ ats: 'workday', host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3], note: 'verify site name; see README' });
  for (const m of html.matchAll(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g)) add({ ats: 'smartrecruiters', slug: m[1] });
  for (const m of html.matchAll(/(?:boards|job-boards)\.(?:eu\.)?greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g)) add({ ats: 'greenhouse', slug: m[1] });
  for (const m of html.matchAll(/jobs\.lever\.co\/([A-Za-z0-9_-]+)/g)) add({ ats: 'lever', slug: m[1] });
  for (const m of html.matchAll(/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/g)) add({ ats: 'personio', slug: m[1] });
  for (const m of html.matchAll(/([a-z0-9-]+)\.recruitee\.com/g)) add({ ats: 'recruitee', slug: m[1] });
  const hints = [];
  if (/successfactors|jobs2web|career\d*\.successfactors/i.test(html)) hints.push('SAP SuccessFactors');
  if (/avature\.net/i.test(html)) hints.push('Avature');
  if (/phenompeople|phenom\.com/i.test(html)) hints.push('Phenom');
  if (/eightfold\.ai/i.test(html)) hints.push('Eightfold');
  if (/beamery\.com/i.test(html)) hints.push('Beamery');
  if (/taleo\.net/i.test(html)) hints.push('Oracle Taleo');
  if (/oraclecloud\.com\/hcmUI/i.test(html)) hints.push('Oracle Recruiting Cloud');
  if (/icims\.com/i.test(html)) hints.push('iCIMS');
  if (/radancy|tmpworldwide|smashfly/i.test(html)) hints.push('Radancy/Smashfly');
  return { found, hints, jsonld: parseJobPostings(html).length };
}

export async function detect(company, log = console.log) {
  const res = { found: [], hints: [], notes: [] };
  let html = '';
  try { html = await get(company.careers); } catch (e) { res.notes.push(`career page not readable: ${e.message}`); return res; }
  const fp = fingerprint(html, company.careers); res.found.push(...fp.found); res.hints.push(...fp.hints);
  if (fp.jsonld) res.notes.push('job data (JSON-LD) on this page');
  // Sitemap with job pages? Try robots.txt, then /sitemap.xml
  const origin = new URL(company.careers).origin;
  const maps = [];
  try { for (const m of (await get(origin + '/robots.txt')).matchAll(/^sitemap:\s*(\S+)/gim)) maps.push(m[1]); } catch { /* none */ }
  maps.push(origin + '/sitemap.xml');
  for (const sm of [...new Set(maps)].slice(0, 4)) {
    try {
      const x = await get(sm); const locs = [...x.matchAll(/<loc>\s*([^<\s]+)/g)].map(m => m[1]);
      const jobUrls = locs.filter(u => /job|career|stelle|position/i.test(u));
      if (jobUrls.length > 20 || /<sitemapindex/i.test(x)) {
        // check that a sample job page actually carries a JobPosting
        let sample = jobUrls.find(u => !/\.xml$/i.test(u)) || null;
        if (sample && parseJobPostings(await get(sample)).length) { res.found.push({ ats: 'jsonld', sitemap: sm, include: 'job', max: 300, note: `sitemap with job pages (e.g. ${sample})` }); break; }
        if (/<sitemapindex/i.test(x)) { const child = locs.find(u => /job/i.test(u)); if (child) { const cx = await get(child); const cu = [...cx.matchAll(/<loc>\s*([^<\s]+)/g)].map(m => m[1]).find(u => !/\.xml$/i.test(u)); if (cu && parseJobPostings(await get(cu)).length) { res.found.push({ ats: 'jsonld', sitemap: sm, include: 'job', max: 300, note: `sitemap index; job pages carry JSON-LD (e.g. ${cu})` }); break; } } }
      }
    } catch { /* try next */ }
  }
  return res;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let urls = {}; try { urls = JSON.parse(fs.readFileSync(path.join(ROOT, 'careers.json'), 'utf8')).careers; } catch { /* optional */ }
  for (const c of data.companies) c.careers ||= urls[c.name];
  const arg = f => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 1));
  if (process.argv.includes('--accept') || process.argv.includes('--accept-all')) {
    const list = (arg('--accept') || '').split(',').map(x => x.trim().toLowerCase());
    for (const c of data.companies) if (c.detected?.length && (process.argv.includes('--accept-all') || list.includes(c.name.toLowerCase()))) {
      c.sources = [...(c.sources || []), ...c.detected.map(({ note, ...rest }) => rest)]; delete c.detected; console.log('accepted', c.name);
    }
    save(); process.exit(0);
  }
  const only = arg('--only')?.split(',').map(s => s.trim().toLowerCase());
  for (const c of data.companies) {
    if (!c.careers || (only ? !only.includes(c.name.toLowerCase()) : (c.sources?.length || c.detected))) continue;
    const r = await detect(c);
    if (r.found.length) { c.detected = r.found; console.log(`${c.name}: ${r.found.map(x => x.ats + (x.slug ? '/' + x.slug : '') + (x.note ? ` (${x.note})` : '')).join(' | ')}`); }
    else console.log(`${c.name}: no readable feed found. ${r.hints.length ? 'System looks like: ' + r.hints.join(', ') + '. ' : ''}${r.notes.join('; ')}`);
    save();
  }
  console.log('\nReview, then: node detect.mjs --accept "SAP,Siemens"   (or --accept-all)');
}
