// Finds the exact employer names the Agency uses ("BMW AG", "Robert Bosch GmbH") for every company in companies.json,
// by trying common legal forms and keeping the ones that return postings. Adds hits to agency.json.
// Usage: node find-employers.mjs                 (all companies)
//        node find-employers.mjs --only "Siemens,Bayer"
//        node find-employers.mjs --name "Siemens Energy Global GmbH & Co. KG"   (test one exact name)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FORMS = ['', ' AG', ' SE', ' GmbH', ' GmbH & Co. KG', ' AG & Co. KGaA', ' KGaA', ' Deutschland GmbH', ' Germany GmbH', ' Group GmbH', ' Deutschland AG', ' Deutschland SE', ' & Co. KG', ' mbH', ' International GmbH'];

export function variants(name) {
  const base = name.replace(/\b(Group|Gruppe)\b/i, '').replace(/\s+/g, ' ').trim();
  return [...new Set([name, ...FORMS.map(f => base + f), ...(base.includes(' ') ? [] : FORMS.slice(1, 5).map(f => base.toUpperCase() + f)), ...(name.match(/^[A-Za-z]+ [A-Z]/) ? [] : [])])];
}
export async function count(name, f = fetch) {
  const r = await f(`${API}?arbeitgeber=${encodeURIComponent(name)}&size=1&page=1&veroeffentlichtseit=90`, { headers: { 'X-API-Key': 'jobboerse-jobsuche' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).maxErgebnisse || 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const file = path.join(ROOT, 'agency.json'); const ag = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exact = arg('--name');
  if (exact) { console.log(exact, await count(exact)); process.exit(0); }
  const companies = JSON.parse(fs.readFileSync(path.join(ROOT, 'companies.json'), 'utf8')).companies;
  const only = arg('--only')?.split(',').map(s => s.trim().toLowerCase());
  for (const c of companies) {
    if (only && !only.includes(c.name.toLowerCase())) continue;
    const hits = [];
    for (const v of variants(c.name)) {
      if (ag.employers.includes(v)) { hits.push(`${v} (already listed)`); continue; }
      try { const n = await count(v); if (n > 0) { hits.push(`${v} (${n})`); ag.employers.push(v); } } catch { /* ignore */ }
      await sleep(120);
    }
    console.log(`${c.name}: ${hits.length ? hits.join(' | ') : 'no exact employer name found'}`);
    fs.writeFileSync(file, JSON.stringify(ag, null, 1));
  }
  console.log('\nagency.json updated. Run: node collect.mjs');
}
