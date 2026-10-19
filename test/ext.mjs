import assert from 'node:assert/strict';
import { collectExternal } from '../lib/ats.mjs';
import { normalise } from '../lib/classify.mjs';
const J = b => ({ ok: true, status: 200, json: async () => b, text: async () => b });
const routes = [
  [/boards-api\.greenhouse\.io/, () => J({ jobs: [{ id: 1, title: 'Data Engineer (m/w/d)', absolute_url: 'https://x/gh/1', location: { name: 'Berlin, Germany' }, updated_at: '2026-10-10T10:00:00Z', content: '&lt;p&gt;Python SQL&lt;/p&gt;' }, { id: 2, title: 'Data Engineer', absolute_url: 'https://x/gh/2', location: { name: 'Dublin, Ireland' }, updated_at: '2026-10-10T10:00:00Z' }] })],
  [/api\.lever\.co/, () => J([{ id: 'a', text: 'Machine Learning Engineer', hostedUrl: 'https://x/lv/a', categories: { location: 'Munich, Germany' }, createdAt: 1792000000000, descriptionPlain: 'Fließend Deutsch erforderlich' }])],
  [/api\.smartrecruiters\.com/, () => J({ content: [{ id: '9', name: 'Automatisierungstechniker', releasedDate: '2026-10-01T00:00:00Z', location: { city: 'Stuttgart' }, company: { name: 'Bosch' } }] })],
  [/recruitee\.com/, () => J({ offers: [{ id: 5, title: 'Robotics Engineer', careers_url: 'https://x/rc/5', city: 'Hamburg', country_code: 'DE', created_at: '2026-10-02' }] })],
  [/personio\.de/, () => J('<workzag-jobs><position><id>7</id><name>Data Analyst</name><office>Köln</office><createdAt>2026-10-03T00:00:00+0000</createdAt></position></workzag-jobs>')],
  [/myworkdayjobs\.com/, () => J({ jobPostings: [{ title: 'SPS Programmierer', externalPath: '/job/Munich/SPS_R1', locationsText: 'Munich, Germany', bulletFields: ['R1'] }] })],
  [/arbeitnow\.com/, () => J({ data: [{ slug: 'ds-1', title: 'Data Scientist', company_name: 'Foo GmbH', location: 'Berlin', url: 'https://x/an/1', created_at: 1791800000, description: 'Python' }], links: {} })]
];
const f = async url => { const r = routes.find(([rx]) => rx.test(url)); if (!r) throw new Error('unmocked ' + url); return r[1](); };
const companies = ['greenhouse', 'lever', 'smartrecruiters', 'recruitee', 'personio'].map(a => ({ name: a + 'Co', sources: [{ ats: a, slug: 's' }] }));
companies.push({ name: 'WDCo', sources: [{ ats: 'workday', host: 'wd.myworkdayjobs.com', tenant: 't', site: 'Ext' }] });
const r = await collectExternal({ f: async (u, k, i) => { const x = await f(u); return { ok: true, status: 200, json: async () => x.json(), text: async () => x.text() }; }, companies, sources: { adzuna: false }, terms: ['data'], delay: 0, log: () => {} });
// collectExternal wraps fetch: adapt mock to its fetch-like contract
assert.equal(r.failed, 0, 'no adapter failed');
const norm = r.items.map(i => normalise(i, { skills: ['python'] })).filter(Boolean);
const refs = norm.map(j => j.ref);
for (const p of ['gh:', 'lv:', 'sr:', 'rc:', 'pe:', 'wd:', 'an:']) assert.ok(refs.some(x => x.startsWith(p)), 'adapter ' + p);
assert.ok(!r.items.some(i => /Dublin/.test(JSON.stringify(i))) && !refs.includes('gh:s-2'), 'non-German location dropped');
assert.ok(norm.every(j => j.url || j.src === 'sr'), 'urls kept');
console.log('ext adapters ok:', refs.length, 'relevant');

// ---- generic career-site reader + detector ----
import { parseJobPostings, ADAPTERS } from '../lib/ats.mjs';
import { fingerprint } from '../detect.mjs';
const page = t => `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"${t}","datePosted":"2026-10-12","description":"<p>Python</p>","jobLocation":{"address":{"addressLocality":"München","addressCountry":"DE"}}}</script></html>`;
assert.equal(parseJobPostings(page('Data Scientist'))[0].title, 'Data Scientist');
assert.equal(parseJobPostings('<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"X"}]}</script>').length, 1);
const sm = '<urlset><url><loc>https://c.example/job/1</loc></url><url><loc>https://c.example/job/2</loc></url><url><loc>https://c.example/about</loc></url></urlset>';
const fx = async (u) => u.endsWith('sitemap.xml') ? sm : page(u.endsWith('1') ? 'Data Scientist' : 'Robotics Engineer');
const got = await ADAPTERS.jsonld({ f: fx, sitemap: 'https://c.example/sitemap.xml', slug: 'cx', name: 'CExample', known: new Set() });
assert.equal(got.length, 2); assert.ok(got.every(i => i.url && i.src === 'jl'));
const again = await ADAPTERS.jsonld({ f: fx, sitemap: 'https://c.example/sitemap.xml', slug: 'cx', name: 'CExample', known: new Set(got.map(i => i.referenznummer)) });
assert.ok(again.every(i => i.stub), 'known postings are not refetched');
const fp = fingerprint('<a href="https://bayer.wd3.myworkdayjobs.com/en-US/Bayer_Careers">x</a> <a href="https://jobs.smartrecruiters.com/Foo">y</a> successfactors', '');
assert.equal(fp.found.find(x => x.ats === 'workday').site, 'Bayer_Careers'); assert.equal(fp.found.find(x => x.ats === 'workday').tenant, 'bayer');
assert.ok(fp.found.some(x => x.ats === 'smartrecruiters' && x.slug === 'Foo') && fp.hints.includes('SAP SuccessFactors'));
console.log('jsonld + detector ok');
