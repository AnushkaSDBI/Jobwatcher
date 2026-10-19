# jobwatch

Weekly snapshots of German job postings (Bundesagentur für Arbeit) for two domains, plus theses, with a static site on top.
Domain A: Data / BI / ML / NLP / AI. Domain B: Industry 4.0 / electrical / robotics.

## How it works
Every Monday a GitHub Action runs: tests → `collect.mjs` → `llm-classify.mjs` (optional) → `build-site.mjs` → commit `data/state.json` → deploy `site/` to GitHub Pages.
History lives in `data/state.json` (ref → first seen, last seen, closed). A posting is marked closed only after it is missing in two consecutive complete runs, because each search is capped at 500 results.

## Setup (10 minutes)
1. Create a GitHub repo, push this folder.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *weekly-collect-and-deploy* → **Run workflow** (first run takes ~30–60 min because of rate limiting).
4. Optional: add secret `ANTHROPIC_API_KEY` to let Claude (Haiku) re-classify postings that match both domains.

## Edit
- `profile.json`: your skills, drives the CV match score (keyword overlap, not a fit judgement).
- `lib/classify.mjs`: queries, domain regexes, staffing-firm list, German-required patterns.
- Local check, no network: `npm test`.

## Honest limits
- Not tested against the live API from the build sandbox (no network there). The offline test uses recorded response shapes.
- Real history, net change and closed postings only exist after ≥2 weekly runs.
- Source is the Agency job board only. LinkedIn/Indeed/StepStone block scraping; company career-page APIs (Greenhouse, Personio, SmartRecruiters) are not included.
- German-required is read from posting text for up to 300 newest postings per run; the rest fall back to a title guess until fetched in later runs.
- Staffing-firm detection is a regex list, incomplete.
- The API is unofficial-but-public. Keep the delay settings; be polite.
