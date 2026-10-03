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
