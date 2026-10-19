// External source adapters. Each returns items in the same raw shape the Agency API uses,
// so lib/classify.mjs `normalise()` handles them identically. All endpoints are public JSON/XML
// feeds that employers or aggregators publish for exactly this purpose.
const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ').replace(/\s+/g, ' ').trim();
const iso = d => { try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; } };
const DE_RX = /(germany|deutschland|\bde\b|, ?de$)/i;
const mk = (src, id, title, company, city, date, url, desc, ok = true) => ok ? ({
  referenznummer: `${src}:${id}`, stellenangebotsTitel: title, firma: company, hauptberuf: '', alleBerufe: [],
  datumErsteVeroeffentlichung: date, url, src, desc: strip(desc).slice(0, 4000),
  stellenlokationen: [{ adresse: { ort: (city || '').split(',')[0].trim(), land: 'DEUTSCHLAND' } }]
}) : null;
const isDe = (txt, cities) => DE_RX.test(txt || '') || (cities && cities.has(((txt || '').split(',')[0] || '').trim().toLowerCase()));

export const ADAPTERS = {
  async greenhouse({ f, slug, name, cities }) {
    const j = await f(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return (j.jobs || []).map(x => mk('gh', `${slug}-${x.id}`, x.title, name, x.location?.name, iso(x.first_published || x.updated_at), x.absolute_url, x.content, isDe(x.location?.name, cities))).filter(Boolean);
  },
  async lever({ f, slug, name, cities }) {
    const j = await f(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return (Array.isArray(j) ? j : []).map(x => mk('lv', `${slug}-${x.id}`, x.text, name, x.categories?.location, iso(x.createdAt), x.hostedUrl, x.descriptionPlain, isDe(x.categories?.location, cities))).filter(Boolean);
  },
  async smartrecruiters({ f, slug, name }) {
    const out = [];
    for (let off = 0; off < 1000; off += 100) {
      const j = await f(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${off}&country=de`);
      for (const x of j.content || []) out.push(mk('sr', `${slug}-${x.id}`, x.name, x.company?.name || name, x.location?.city, iso(x.releasedDate), `https://jobs.smartrecruiters.com/${slug}/${x.id}`, '', true));
      if ((j.content || []).length < 100) break;
    }
    return out.filter(Boolean);
  },
  async recruitee({ f, slug, name, cities }) {
    const j = await f(`https://${slug}.recruitee.com/api/offers/`);
    return (j.offers || []).map(x => mk('rc', `${slug}-${x.id}`, x.title, name, x.city, iso(x.published_at || x.created_at), x.careers_url, x.description, x.country_code ? x.country_code === 'DE' : isDe(x.city, cities))).filter(Boolean);
  },
  async personio({ f, slug, name }) {
    const xml = await f(`https://${slug}.jobs.personio.de/xml`, 'text');
    const out = [];
    for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
      const g = t => (m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${t}>`)) || [])[1] || '';
      out.push(mk('pe', `${slug}-${g('id')}`, g('name'), name, g('office'), iso(g('createdAt')), `https://${slug}.jobs.personio.de/job/${g('id')}`, g('jobDescriptions')));
    }
    return out.filter(Boolean);
  },
  // Workday career sites: the same JSON the employer's own site calls. Config needs host, tenant, site.
  async workday({ f, host, tenant, site, name, terms, cities }) {
    const out = [], seen = new Set();
    for (const t of terms) for (let off = 0; off < 200; off += 20) {
      const j = await f(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, 'json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: off, searchText: t }) });
      for (const x of j.jobPostings || []) {
        if (seen.has(x.externalPath)) continue; seen.add(x.externalPath);
        const loc = x.locationsText || '';
        out.push(mk('wd', `${tenant}-${(x.bulletFields || [])[0] || x.externalPath}`, x.title, name, loc.replace(/^\d+ Locations?$/, ''), '', `https://${host}/${site}${x.externalPath}`, '', isDe(loc, cities) || /^\d+ locations/i.test(loc)));
      }
      if ((j.jobPostings || []).length < 20) break;
    }
    return out.filter(Boolean);
  },
  // Aggregators (not per company)
  async arbeitnow({ f }) {
    const out = [];
    for (let p = 1; p <= 5; p++) {
      const j = await f(`https://www.arbeitnow.com/api/job-board-api?page=${p}`);
      for (const x of j.data || []) out.push(mk('an', x.slug, x.title, x.company_name, x.location, iso(x.created_at * 1000), x.url, x.description));
      if (!j.links?.next) break;
    }
    return out.filter(Boolean);
  },
  async adzuna({ f, terms }) {
    const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
    if (!id || !key) return [];
    const out = [];
    for (const t of terms) for (let p = 1; p <= 5; p++) {
      const j = await f(`https://api.adzuna.com/v1/api/jobs/de/search/${p}?app_id=${id}&app_key=${key}&results_per_page=50&max_days_old=90&what=${encodeURIComponent(t)}`);
      for (const x of j.results || []) out.push(mk('az', x.id, x.title, x.company?.display_name, x.location?.display_name, iso(x.created), x.redirect_url, x.description));
      if ((j.results || []).length < 50) break;
    }
    return out.filter(Boolean);
  }
};

// ---- Generic career-site reader: sitemap -> job pages -> schema.org JobPosting (JSON-LD) ----
const hash = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); };
export function parseJobPostings(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk);
      const t = [].concat(n['@type'] || []); if (t.includes('JobPosting')) out.push(n); if (n['@graph']) walk(n['@graph']); };
    walk(j);
  }
  return out;
}
const locOf = jp => { const l = [].concat(jp.jobLocation || [])[0] || {}; const a = l.address || {}; return { city: a.addressLocality || '', country: (typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry) || '' }; };
ADAPTERS.jsonld = async function ({ f, sitemap, include, max = 300, name, cities, known = new Set(), slug }) {
  const rx = new RegExp(include || 'job', 'i');
  let urls = [];
  const loc = x => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const top = await f(sitemap, 'text');
  if (/<sitemapindex/i.test(top)) { for (const sm of loc(top).slice(0, 8)) { try { urls.push(...loc(await f(sm, 'text'))); } catch { /* skip */ } } } else urls = loc(top);
  urls = urls.filter(u => rx.test(u)).slice(0, max);
  const id = u => `jl:${slug || hash(sitemap)}-${hash(u)}`;
  const out = [];
  for (const u of urls) {
    if (known.has(id(u))) { out.push({ referenznummer: id(u), stub: true }); continue; }
    try {
      const jp = parseJobPostings(await f(u, 'text'))[0]; if (!jp) continue;
      const l = locOf(jp), de = /^(de|germany|deutschland)$/i.test(l.country) || (!l.country && cities?.has(l.city.toLowerCase()));
      const it = mk('jl', '', jp.title, name, l.city, iso(jp.datePosted), u, jp.description, de);
      if (it) { it.referenznummer = id(u); out.push(it); }
    } catch { /* page failed; try next run */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
};

// Collect from every configured source. A failing source is logged and counted, never fatal.
export async function collectExternal({ f = fetch, companies = [], sources = {}, terms = [], cities = new Set(), known = new Set(), delay = 300, log = console.log }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async (url, kind = 'json', init) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await f(url, { headers: { 'User-Agent': 'jobwatch/1.0 (personal job-market research)', Accept: 'application/json', ...(init?.headers || {}) }, method: init?.method, body: init?.body });
        if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return kind === 'text' ? await r.text() : await r.json();
      } catch (e) { if (i === 2) throw e; await sleep(500); }
    }
  };
  const items = []; let failed = 0, tasks = 0;
  const jobs = [];
  for (const c of companies) for (const s of c.sources || []) jobs.push({ label: `${c.name}/${s.ats}`, ats: s.ats, args: { ...s, name: c.name } });
  for (const k of ['arbeitnow', 'adzuna']) if (sources[k] !== false) jobs.push({ label: k, ats: k, args: {} });
  for (const t of jobs) {
    tasks++;
    try {
      const got = await ADAPTERS[t.ats]({ f: get, terms, cities, known, ...t.args });
      items.push(...got); log(`${t.label}: ${got.length}`);
    } catch (e) { failed++; log(`FAILED ${t.label}: ${e.message}`); }
    await sleep(delay);
  }
  return { items, failed, tasks };
}
