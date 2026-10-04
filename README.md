# Genten (原典)

Genten is an agent that answers foreign residents' questions about Japanese NISA and furusato nozei rules. It answers from a Sanity Context Knowledge Base, cites the official Japanese source behind each answer, and flags English-language guides that are out of date. Each rule is stored as a dated `ruleVersion` with evidence pointing at its sources. Rule versions are imported as drafts. A person checks each one against the official source and publishes it in the Studio. The Knowledge Base reads only published documents, so the agent never sees a rule that hasn't been verified. Built for the DEV Sanity Challenge (Path One).

## Layout

```
seed/genten-seed.json   topics, sources and rule versions to import
studio/                 Sanity Studio (project pro5oxe1, dataset production): schema, desk structure, seed script
web/                    Next.js app (will become the agent UI)
tools/                  Python utilities (snapshot tool)
eval/                   Python eval harness
```

## Seeding

1. Copy `.env.example` to `.env` and set `SANITY_WRITE_TOKEN` (an Editor token for project pro5oxe1).
2. Run:

   ```sh
   cd studio
   npm install
   npm run seed
   ```

The seed is idempotent. It writes only documents whose content changed, in one transaction. It writes only the fields it owns (listed in `OWNED_FIELDS` in the script), so tool-written fields such as `capturedAt` and `snapshotSha256`, and reviewers' `verification`, are never overwritten. Topics and sources are imported as published documents, and rule versions as drafts. Review the drafts under **Needs review** in the Studio (`npm run dev` in `studio/`). Once a rule version is published, the seed leaves it alone and only prints how the seed differs from it.

## Snapshots

`tools/snapshot.py` captures every source in the seed as files for a Sanity Knowledge Base ("Files" source):

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python -m tools.snapshot [--only id1,id2] [--update-sanity]
```

It respects robots.txt, sends at most one request per second as `GentenSnapshot/0.1`, and writes into `snapshots/`:
- `files/<id>.pdf`: PDFs, unchanged.
- `files/<id>.md`: the main content of HTML pages, with front matter.
- `manifest.json`: id, URL, status (`ok`, `thin`, `failed` or `robots-blocked`), file, size, SHA-256 and capture time.
- `genten-kb-files-<YYYYMMDD>.zip`: a reproducible archive of `files/` to upload.

A source's `role` and `curationNote` (the evaluation answer key) are never written to any file. `--update-sanity` sets only `capturedAt` and `snapshotSha256` on the published sources; the seed never writes those fields. `snapshots/` is gitignored because it holds third-party content.

## The Genten app

Genten answers a question about NISA or furusato nozei with the rule in force on a chosen date, its effective date, and the official Japanese source behind it. It also flags English-language guides that state an outdated or wrong rule. `web/` is a Next.js app:
- `src/lib/genten.ts` (`askGenten`) runs Claude (Vercel AI SDK) over the Sanity Context knowledge base through MCP.
- `POST /api/ask` serves the page. It allows 10 requests per 10 minutes per IP and has a kill switch.

### Run locally

```sh
ln -s ../.env web/.env.local   # once: the app reads SANITY_CONTEXT_TOKEN and ANTHROPIC_API_KEY from the root .env
cd web
npm install
npm run dev                    # http://localhost:3000
```

Useful scripts in `web/`:

```sh
npm run mcp-smoke              # check the Context MCP endpoint: list its tools, call initial_context
npm run smoke                  # run the 6 example questions through askGenten (uses API credits)
npm run build:sources          # regenerate src/data/sources.json from the seed (no role/curationNote)
npm run precompute-examples    # regenerate src/data/example-answers.json live (uses API credits)
```

### Deploy to Vercel

1. Import the repository and set **Root Directory** to `web`. The build needs nothing outside `web/`, because `src/data/sources.json` is committed.
2. Set these environment variables:

   | Variable | Required | Purpose |
   |---|---|---|
   | `SANITY_CONTEXT_TOKEN` | yes | Organization token with the Context Viewer role, for the MCP endpoint |
   | `ANTHROPIC_API_KEY` | yes | Claude API key |
   | `GENTEN_MODEL` | no | Model id (default `claude-sonnet-5-5`) |
   | `GENTEN_DISABLED` | no | `true` makes `/api/ask` return 503 (kill switch) |

3. Deploy. The tokens are used only on the server.

## Evaluation

`eval/` scores Genten against closed-book and keyword-search baselines on 25 held-out questions, with a deterministic grader. The latest results are in [eval/REPORT.md](eval/REPORT.md). To re-run it (this uses API credits, and needs `snapshots/files` and `pdftotext`):

```sh
cd web && npm run eval
```
