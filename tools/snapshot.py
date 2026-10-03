"""Capture every source in seed/genten-seed.json as files for a Sanity Knowledge Base.

Usage (from the repo root, inside .venv):

    python -m tools.snapshot [--only id1,id2] [--update-sanity]

Writes, under snapshots/ (gitignored: it holds third-party content):

    files/<id>.pdf                    PDF responses, unchanged
    files/<id>.md                     HTML responses: front matter + main content
    manifest.json                     id, url, status, file, bytes, sha256, captured_at
    genten-kb-files-<YYYYMMDD>.zip    files/* with sorted entries and fixed timestamps

A source's role and curationNote are the evaluation answer key: they are dropped
when the seed is loaded and never written to any file.

--update-sanity patches only capturedAt and snapshotSha256 on each published
source-<id>, the two fields the seed never writes.
"""

import argparse
import codecs
import hashlib
import json
import logging
import os
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from charset_normalizer import from_bytes
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / 'seed' / 'genten-seed.json'
OUT = ROOT / 'snapshots'
FILES = OUT / 'files'
MANIFEST = OUT / 'manifest.json'

USER_AGENT = 'GentenSnapshot/0.1'
TIMEOUT = 30.0
MIN_INTERVAL = 1.0  # seconds between any two requests, redirects and robots.txt included
THIN_CHARS = 500  # less extracted text than this: probably a JavaScript-rendered page
ZIP_DATE_TIME = (1980, 1, 1, 0, 0, 0)  # fixed entry timestamp, so equal files give an equal zip
SANITY_API_VERSION = '2025-02-19'

# The only seed fields a snapshot may contain. role and curationNote are left out on purpose.
PUBLIC_FIELDS = ('id', 'url', 'title', 'publisher', 'publisherType', 'authority', 'language',
                 'publishedAt')
LATIN_CODECS = {'ascii', 'iso8859-1', 'cp1252'}  # decode anything, so they cannot be checked
MAX_BAD_BYTES = 0.001  # share of undecodable bytes still accepted from a declared charset


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Throttle:
    """httpx request hook: at most one request per MIN_INTERVAL, across all hosts."""

    def __init__(self, interval: float):
        self.interval = interval
        self.last = 0.0

    def __call__(self, request: httpx.Request) -> None:
        wait = self.last + self.interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()


class Robots:
    """robots.txt per origin, with urllib.robotparser's rules: 401/403 disallow
    everything, other 4xx allow everything, and an unreachable file disallows."""

    def __init__(self, client: httpx.Client):
        self.client = client
        self.parsers: dict[str, tuple[RobotFileParser, str | None]] = {}

    def check(self, url: str) -> str | None:
        """Return None if fetching is allowed, else the reason it is not."""
        parts = urlsplit(url)
        origin = f'{parts.scheme}://{parts.netloc}'
        if origin not in self.parsers:
            self.parsers[origin] = self._load(origin)
        parser, problem = self.parsers[origin]
        if parser.can_fetch(USER_AGENT, url):
            return None
        return problem or 'disallowed by robots.txt'

    def _load(self, origin: str) -> tuple[RobotFileParser, str | None]:
        parser = RobotFileParser(f'{origin}/robots.txt')
        problem = None
        try:
            response = self.client.get(f'{origin}/robots.txt')
            if response.status_code in (401, 403):
                parser.disallow_all = True
                problem = f'robots.txt returned HTTP {response.status_code}'
            elif 400 <= response.status_code < 500:
                parser.allow_all = True
            elif response.status_code >= 500:
                parser.disallow_all = True
                problem = f'robots.txt unavailable (HTTP {response.status_code})'
            else:
                parser.parse(response.text.splitlines())
        except httpx.HTTPError as err:
            parser.disallow_all = True
            problem = f'robots.txt unavailable ({type(err).__name__})'
        parser.modified()
        return parser, problem


def _declared_charsets(content_type: str, body: bytes) -> list[str]:
    """Charsets declared in the Content-Type header and in a <meta> tag, in that order."""
    labels = []
    if match := re.search(r'charset=["\']?([\w.:-]+)', content_type, re.I):
        labels.append(match.group(1))
    if match := re.search(rb'<meta[^>]+charset=["\']?([\w.:-]+)', body[:16384], re.I):
        labels.append(match.group(1).decode('ascii', 'ignore'))
    return labels


def decode_html(body: bytes, content_type: str) -> tuple[str, str]:
    """Decode an HTML body with its declared charset if that charset fits.

    A declared charset fits if it decodes with at most MAX_BAD_BYTES of invalid
    bytes (some pages embed a stray string in another encoding); those bytes are
    replaced. Japanese pages are often Shift_JIS or EUC-JP, and the header is
    sometimes missing or wrong; charset-normalizer decides in those cases.
    """
    if body.startswith(codecs.BOM_UTF8):
        return body[len(codecs.BOM_UTF8):].decode('utf-8', 'replace'), 'utf-8-sig'
    has_non_ascii = re.search(rb'[\x80-\xff]', body) is not None
    for label in _declared_charsets(content_type, body):
        try:
            codec = codecs.lookup(label).name
        except LookupError:
            continue
        if codec == 'shift_jis':
            codec = 'cp932'  # Windows superset that Japanese "Shift_JIS" pages actually use
        if has_non_ascii and codec in LATIN_CODECS:
            continue
        try:
            return body.decode(codec), codec
        except UnicodeDecodeError:
            text = body.decode(codec, 'replace')
            bad = text.count('�')
            if bad <= len(body) * MAX_BAD_BYTES:
                return text, f'{codec}, {bad} invalid bytes replaced'
    best = from_bytes(body).best()
    if best is not None:
        return str(best), f'{best.encoding} (detected)'
    return body.decode('utf-8', 'replace'), 'utf-8 (replace)'


def extract(html: str, url: str) -> tuple[str, str | None]:
    """Main content as markdown (tables kept, recall favoured), else the page's full text.
    Also returns the publication date trafilatura finds, if any."""
    content = trafilatura.extract(html, url=url, output_format='markdown', include_tables=True,
                                  favor_recall=True) or ''
    if not content.strip():
        content = trafilatura.html2txt(html) or ''
    metadata = trafilatura.extract_metadata(html, default_url=url)
    return content.strip(), (metadata.date if metadata else None)


def render_markdown(src: dict, content: str, published_at: str, captured_at: str) -> str:
    front_matter = {
        'source_url': src['url'],
        'title': src['title'],
        'publisher': src['publisher'],
        'publisher_type': src.get('publisherType'),
        'authority': src['authority'],
        'language': src['language'],
        'published_at': published_at,
        'captured_at': captured_at,
    }
    # JSON strings are valid YAML double-quoted scalars, so any title is safe.
    lines = ['---', *(f'{key}: {json.dumps(value, ensure_ascii=False)}'
                      for key, value in front_matter.items()), '---', '']
    lines += [
        f'# {src["title"]}',
        '',
        f'> Snapshot of {src["url"]}, captured {captured_at[:10]}. '
        f'Publisher: {src["publisher"]} ({src["authority"]}, {src["language"]}).',
        '',
        content,
        '',
    ]
    return '\n'.join(lines)


def snapshot(src: dict, client: httpx.Client, robots: Robots) -> dict:
    """Capture one source and return its manifest entry."""
    entry = {'id': src['id'], 'url': src['url'], 'status': 'failed', 'file': None, 'bytes': None,
             'sha256': None, 'captured_at': None, 'detail': None}
    # The latest attempt wins: drop any earlier file so files/ always matches the manifest.
    for old in FILES.glob(f'{src["id"]}.*'):
        old.unlink()

    if reason := robots.check(src['url']):
        return {**entry, 'status': 'robots-blocked', 'detail': reason}
    try:
        response = client.get(src['url'])
    except httpx.HTTPError as err:
        return {**entry, 'detail': f'{type(err).__name__}: {err}'}
    if response.status_code >= 400:
        return {**entry, 'detail': f'HTTP {response.status_code}'}

    captured_at = now_utc()
    content_type = response.headers.get('content-type', '').lower()
    body = response.content
    if 'application/pdf' in content_type or body.startswith(b'%PDF'):
        path = FILES / f'{src["id"]}.pdf'
        path.write_bytes(body)
        status, detail = 'ok', None
    elif not content_type or any(t in content_type for t in ('html', 'xml', 'text/')):
        html, encoding = decode_html(body, content_type)
        content, found_date = extract(html, str(response.url))
        published_at = src.get('publishedAt') or found_date or 'unknown'
        path = FILES / f'{src["id"]}.md'
        path.write_text(render_markdown(src, content, published_at, captured_at), encoding='utf-8')
        status = 'thin' if len(content) < THIN_CHARS else 'ok'
        detail = f'{len(content)} chars, {encoding}'
    else:
        return {**entry, 'detail': f'unsupported content type {content_type!r}'}

    data = path.read_bytes()
    return {**entry, 'status': status, 'file': f'files/{path.name}', 'bytes': len(data),
            'sha256': sha256(data), 'captured_at': captured_at, 'detail': detail}


def check_no_answer_key(seed_sources: list[dict]) -> None:
    """Fail loudly if any curation note ended up in a snapshot file."""
    notes = [s['curationNote'] for s in seed_sources if s.get('curationNote')]
    for path in FILES.glob('*.md'):
        text = path.read_text(encoding='utf-8')
        if any(note in text for note in notes) or re.search(r'^(role|curation_?note):', text, re.M | re.I):
            raise SystemExit(f'{path} contains evaluation answer-key data; refusing to continue.')


def build_zip(day: str) -> Path:
    """Zip files/* with sorted names and fixed metadata: the same files give the same bytes."""
    path = OUT / f'genten-kb-files-{day}.zip'
    tmp = path.with_suffix('.zip.tmp')
    with zipfile.ZipFile(tmp, 'w') as archive:
        for file in sorted(p for p in FILES.iterdir() if p.is_file()):
            info = zipfile.ZipInfo(file.name, date_time=ZIP_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, file.read_bytes(), compresslevel=9)
    tmp.replace(path)
    return path


def update_sanity(entries: list[dict]) -> None:
    """Patch capturedAt and snapshotSha256 (and nothing else) on published sources."""
    load_dotenv(ROOT / '.env')
    token = os.environ.get('SANITY_WRITE_TOKEN')
    if not token:
        raise SystemExit('SANITY_WRITE_TOKEN is not set in the root .env.')
    project = os.environ.get('SANITY_PROJECT_ID') or 'pro5oxe1'
    dataset = os.environ.get('SANITY_DATASET') or 'production'
    base = f'https://{project}.api.sanity.io/v{SANITY_API_VERSION}/data'
    captured = {f'source-{e["id"]}': e for e in entries if e['sha256']}

    with httpx.Client(headers={'Authorization': f'Bearer {token}'}, timeout=TIMEOUT) as api:
        response = api.post(f'{base}/query/{dataset}', json={
            'query': '*[_type == "source" && _id in $ids]._id',
            'params': {'ids': sorted(captured)},
        })
        response.raise_for_status()
        published = set(response.json()['result'])
        mutations = [
            {'patch': {'id': doc_id, 'set': {'capturedAt': entry['captured_at'],
                                              'snapshotSha256': entry['sha256']}}}
            for doc_id, entry in sorted(captured.items()) if doc_id in published
        ]
        if mutations:
            api.post(f'{base}/mutate/{dataset}', params={'visibility': 'sync'},
                     json={'mutations': mutations}).raise_for_status()
    missing = sorted(set(captured) - published)
    print(f'\nSanity: patched capturedAt and snapshotSha256 on {len(mutations)} published sources.')
    if missing:
        print(f'  No published document for: {", ".join(missing)}')


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog='python -m tools.snapshot', description=__doc__.split('\n')[0])
    parser.add_argument('--only', help='comma-separated source ids to capture (others keep their entries)')
    parser.add_argument('--update-sanity', action='store_true',
                        help='patch capturedAt and snapshotSha256 on published sources')
    args = parser.parse_args(argv)
    for name in ('trafilatura', 'htmldate', 'courlan'):
        logging.getLogger(name).setLevel(logging.ERROR)

    seed_sources = json.loads(SEED.read_text(encoding='utf-8'))['sources']
    sources = [{key: s[key] for key in PUBLIC_FIELDS if key in s} for s in seed_sources]
    seed_ids = {s['id'] for s in sources}
    if args.only:
        wanted = {i.strip() for i in args.only.split(',') if i.strip()}
        if unknown := wanted - seed_ids:
            raise SystemExit(f'Unknown source ids: {", ".join(sorted(unknown))}')
        sources = [s for s in sources if s['id'] in wanted]

    FILES.mkdir(parents=True, exist_ok=True)
    entries = {e['id']: e for e in json.loads(MANIFEST.read_text())} if MANIFEST.exists() else {}
    with httpx.Client(headers={'User-Agent': USER_AGENT}, timeout=TIMEOUT, follow_redirects=True,
                      event_hooks={'request': [Throttle(MIN_INTERVAL)]}) as client:
        robots = Robots(client)
        for n, src in enumerate(sources, 1):
            entry = snapshot(src, client, robots)
            entries[src['id']] = entry
            print(f'[{n:>2}/{len(sources)}] {entry["status"]:<14} {src["id"]}'
                  + (f'  ({entry["detail"]})' if entry['detail'] else ''))

    # Forget sources that are no longer in the seed.
    entries = {i: e for i, e in sorted(entries.items()) if i in seed_ids}
    for path in FILES.iterdir():
        if path.stem not in seed_ids:
            path.unlink()
    check_no_answer_key(seed_sources)
    MANIFEST.write_text(json.dumps(list(entries.values()), ensure_ascii=False, indent=2) + '\n',
                        encoding='utf-8')
    archive = build_zip(datetime.now(timezone.utc).strftime('%Y%m%d'))

    counts = {s: sum(e['status'] == s for e in entries.values())
              for s in ('ok', 'thin', 'failed', 'robots-blocked')}
    print('\nstatus          count')
    for status, count in counts.items():
        print(f'{status:<15} {count:>5}')
    print(f'{"total":<15} {len(entries):>5}')
    print(f'\nzip: {archive.relative_to(ROOT)}  sha256 {sha256(archive.read_bytes())}')
    for status in ('thin', 'failed', 'robots-blocked'):
        listed = [e for e in entries.values() if e['status'] == status]
        if listed:
            print(f'\n{status}:')
            for e in listed:
                print(f'  {e["id"]:<34} {e["url"]}\n  {"":<34} {e["detail"]}')

    if args.update_sanity:
        update_sanity([entries[s['id']] for s in sources if s['id'] in entries])


if __name__ == '__main__':
    if sys.version_info < (3, 11):
        raise SystemExit('Python 3.11 or newer is required.')
    main()
