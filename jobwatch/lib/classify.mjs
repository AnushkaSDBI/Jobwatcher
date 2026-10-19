// Pure functions: no network, fully testable.
export const STATES = ['Baden-Württemberg','Bayern','Berlin','Brandenburg','Bremen','Hamburg','Hessen','Mecklenburg-Vorpommern','Niedersachsen','Nordrhein-Westfalen','Rheinland-Pfalz','Saarland','Sachsen','Sachsen-Anhalt','Schleswig-Holstein','Thüringen'];
const REGION = {BADEN_WUERTTEMBERG:0,BAYERN:1,BERLIN:2,BRANDENBURG:3,BREMEN:4,HAMBURG:5,HESSEN:6,MECKLENBURG_VORPOMMERN:7,NIEDERSACHSEN:8,NORDRHEIN_WESTFALEN:9,RHEINLAND_PFALZ:10,SAARLAND:11,SACHSEN:12,SACHSEN_ANHALT:13,SCHLESWIG_HOLSTEIN:14,THUERINGEN:15};
export const regionIdx = r => (r in REGION ? REGION[r] : -1);

// Search terms sent to the Agency API (was=...). Domain A = data/AI, B = Industry 4.0 / electrical / robotics.
export const QUERIES = {
  a: ['Data Scientist','Data Engineer','Data Analyst','Business Intelligence','BI Analyst','Machine Learning','NLP','Künstliche Intelligenz','KI Engineer','LLM','Generative AI','Data Warehouse','Power BI','Analytics Engineer','MLOps','Computer Vision'],
  b: ['Industrie 4.0','Automatisierungstechnik','Elektrotechnik Ingenieur','Robotik','SPS Programmierer','Mechatronik','Embedded Systems','Elektroniker Automatisierungstechnik','Leittechnik','Industrial IoT','MES','Antriebstechnik','Energietechnik Ingenieur','Prozessautomatisierung'],
  thesis: ['Masterarbeit','Bachelorarbeit','Abschlussarbeit','Master Thesis','Bachelor Thesis','Masterarbeit Data','Masterarbeit KI','Masterarbeit Elektrotechnik','Abschlussarbeit Automatisierung','Abschlussarbeit Robotik','Thesis Machine Learning','Thesis Embedded']
};

const RX_A = /\b(data\s*(scien|engin|analy|wareh|platform|architect|steward|govern)|daten(wissenschaft|analy|ingenieur|architekt|bank)|business[\s-]*intelligence|\bbi[\s-]*(analy|develop|consult|engin|entwickl|berat)|machine[\s-]*learning|\bml(ops)?\b|\bnlp\b|\bllm|generative|\bgenai|\bki\b|\bai\b|künstliche|artificial|deep[\s-]*learning|computer[\s-]*vision|analytics|power\s*bi|tableau|data-?bricks|etl|bigquery|sprachverarbeitung|reporting[\s-]*analy|statistik)/i;
const RX_B = /(industrie\s*4|industry\s*4|automatisier|automation|\bsps\b|\bplc\b|elektrotechnik|elektroniker|elektroingenieur|electrical|mechatronik|mechatronic|robot|embedded|leittechnik|\bmes\b|\bscada\b|antriebstechnik|energietechnik|prozessleittechnik|steuerungstechnik|industrial\s*iot|\biiot\b|messtechnik|regelungstechnik|\bcnc\b|leistungselektronik|power\s*electronics)/i;
export function domainOf(text) {
  const a = RX_A.test(text), b = RX_B.test(text);
  return a && b ? 'ab' : a ? 'a' : b ? 'b' : null;
}

const RX_THESIS = /(master|bachelor|abschluss|diplom)[\s-]*(arbeit|thesis)|\b(master|bachelor|final)\s+thesis|\bthesis\b|abschlussarbeit/i;
const RX_ENTRY = /(werkstudent|working student|praktik|intern\b|internship|trainee|berufseinsteiger|junior|absolvent|duales? studium|einsteiger|graduate)/i;
const RX_DE_TITLE = /\((m|w|d|f|x)[\/|](m|w|d|f|x)|m\/w\/d|w\/m\/d|d\/m\/w|\b(entwickler|ingenieur|leiter|berater|sachbearbeiter|techniker|monteur|fachkraft|mitarbeiter)/i;
export const isThesis = t => RX_THESIS.test(t);
export function thesisLevel(t) {
  const m = /master/i.test(t), b = /bachelor/i.test(t);
  return m && !b ? 'master' : b && !m ? 'bachelor' : 'any';
}

// Staffing / recruiting firms. Tagged, never silently dropped.
const RX_STAFF = /\b(ferchau|brunel|akkodis|hays|randstad|adecco|manpower|gi group|persona service|tempton|piening|timepartner|amadeus fire|michael page|robert half|hirsch|gulp|computer futures|modis|experis|expertum|dis ag|orizon|avanti|bertrandt|segula|alten|euro engineering|spirit|personalberatung|personaldienst|zeitarbeit|arbeitnehmerüberlassung|headhunt|recruit|talent|m\.e\.h\.r|nexa consulting)\b/i;
export const isStaffing = c => RX_STAFF.test(c || '');

// German-required inference from the posting text (not the title).
const DE_REQ = /(deutsch(kenntnisse)?[^.\n]{0,40}(c1|c2|b2|fließend|fliessend|verhandlungssicher|sehr gut|fundiert|muttersprach|erforderlich|voraussetzung)|(fließend|fliessend|verhandlungssicher|sehr gute?)\s+deutsch|german[^.\n]{0,40}(fluent|required|native|c1|c2|b2)|fluent[^.\n]{0,20}german|muttersprach\w*\s+deutsch|deutsch\s+(in wort und schrift|als muttersprache))/i;
const DE_OPT = /(deutschkenntnisse[^.\n]{0,30}(von vorteil|wünschenswert|nice|plus)|german[^.\n]{0,30}(plus|advantage|nice to have|is a plus))/i;
const EN_ONLY = /(working language is english|arbeitssprache[^.\n]{0,20}englisch|english[^.\n]{0,25}(is sufficient|only|ausreichend)|no german (required|needed)|keine deutschkenntnisse)/i;
// returns 'req' | 'opt' | 'no' | null (null = unknown, no description fetched)
export function germanFromText(desc) {
  if (!desc) return null;
  if (EN_ONLY.test(desc)) return 'no';
  if (DE_OPT.test(desc)) return 'opt';
  if (DE_REQ.test(desc)) return 'req';
  return /deutsch|german/i.test(desc) ? 'opt' : 'no';
}
const DE_BAND = { B1: 1, B2: 2, C1: 3 };

// Match score 0-100 against profile.skills. Title hits weigh more than body hits.
export function matchScore(profile, title, body = '') {
  const sk = profile.skills || [];
  if (!sk.length) return 0;
  const t = title.toLowerCase(), b = (body || '').toLowerCase();
  const wt = profile.weights?.title ?? 3, wb = profile.weights?.body ?? 1;
  let got = 0, hits = [];
  for (const s of sk) {
    const k = s.toLowerCase();
    if (t.includes(k)) { got += wt; hits.push(s); }
    else if (b.includes(k)) { got += wb; hits.push(s); }
  }
  const cap = Math.min(sk.length, 8) * wb + 2 * wt; // 8 body hits + 2 title hits ~ 100
  return { score: Math.min(100, Math.round((got / cap) * 100)), hits };
}

// "FERCHAU GmbH Niederlassung Ulm" -> "FERCHAU GmbH" so branches count as one employer.
export const cleanCompany = c => (c || '').replace(/[\s,\-–]+(zweigniederlassung|niederlassung|standort|werk|geschäftsstelle|branch)\b.*$/i, '').replace(/\s+/g, ' ').trim();
const sameDay = d => (d || '').slice(0, 10);
// Normalise one raw API item into our job record (or null if not relevant).
export function normalise(item, profile = {}) {
  const loc = (item.stellenlokationen || [])[0] || {};
  const adr = loc.adresse || {};
  if (adr.land && adr.land !== 'DEUTSCHLAND') return null; // API also returns Austria/Switzerland
  const title = item.stellenangebotsTitel || '';
  const company = cleanCompany(item.firma);
  const blob = [title, item.hauptberuf, ...(item.alleBerufe || [])].join(' ');
  const thesis = isThesis(title);
  const dom = domainOf(blob);
  if (!dom) return null;
  let flags = 0;
  if (item.homeofficemoeglich) flags |= 1;
  if (item.vertragsdauer === 'BEFRISTET') flags |= 2;
  if (item.arbeitszeitVollzeit) flags |= 4;
  if (thesis || RX_ENTRY.test(title)) flags |= 8;
  if (RX_DE_TITLE.test(title) && !/\b(engineer|developer|scientist|analyst|manager)\b.*\((m|f|d)/i.test(title) || /[äöüß]/i.test(title)) flags |= 16;
  const lat = loc.breite, lon = loc.laenge;
  const cell = (typeof lat === 'number' && typeof lon === 'number')
    ? [+(Math.floor(lat / 0.2) * 0.2 + 0.1).toFixed(2), +(Math.floor(lon / 0.3) * 0.3 + 0.15).toFixed(2)] : null;
  const m = matchScore(profile, title, '');
  return {
    ref: item.referenznummer, title, company,
    city: (adr.ort || '').split(',')[0].trim(), state: regionIdx(adr.region),
    date: sameDay(item.datumErsteVeroeffentlichung), flags, dom, thesis,
    thesisLevel: thesis ? thesisLevel(title) : null,
    staffing: isStaffing(company), cell, match: m.score, hits: m.hits,
    roles: (item.alleBerufe || []).slice(0, 3), type: item.stellenangebotsart || ''
  };
}
