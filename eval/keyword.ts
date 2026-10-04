// BM25 keyword search over the snapshot files (snapshots/files), for the
// keyword-search baseline. PDFs are read with pdftotext (poppler); a PDF that cannot
// be read is skipped and reported.
import {execFileSync} from 'node:child_process'
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'

export type Chunk = {id: string; file: string; text: string}
type IndexedChunk = Chunk & {terms: Map<string, number>; length: number}

const CHUNK_CHARS = 1000
const K1 = 1.2
const B = 0.75

const segmenter = new Intl.Segmenter('ja', {granularity: 'word'})

/** Lower-cased word tokens; Intl.Segmenter also splits Japanese. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const s of segmenter.segment(text.normalize('NFKC').toLowerCase())) {
    if (s.isWordLike) tokens.push(s.segment)
  }
  return tokens
}

function readText(file: string): string {
  if (file.endsWith('.pdf')) {
    return execFileSync('pdftotext', ['-layout', file, '-'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  }
  return readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '') // drop front matter
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const raw of text.replace(/[ \t]+/g, ' ').split(/\n\s*\n/)) {
    const paragraph = raw.trim()
    if (!paragraph) continue
    if (current && current.length + paragraph.length > CHUNK_CHARS) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
    while (current.length > CHUNK_CHARS * 1.5) {
      chunks.push(current.slice(0, CHUNK_CHARS))
      current = current.slice(CHUNK_CHARS)
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export class KeywordIndex {
  readonly files: number
  readonly skipped: {file: string; reason: string}[]
  private chunks: IndexedChunk[] = []
  private df = new Map<string, number>()
  private avgLength = 0

  constructor(dir: string) {
    const names = readdirSync(dir).filter((n) => /\.(md|pdf)$/.test(n)).sort()
    this.files = names.length
    this.skipped = []
    for (const name of names) {
      let text: string
      try {
        text = readText(path.join(dir, name))
      } catch (err) {
        this.skipped.push({file: name, reason: err instanceof Error ? err.message.split('\n')[0] : 'unreadable'})
        continue
      }
      if (!text.trim()) {
        this.skipped.push({file: name, reason: 'no extractable text'})
        continue
      }
      chunkText(text).forEach((chunk, i) => {
        const terms = new Map<string, number>()
        const tokens = tokenize(chunk)
        for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1)
        this.chunks.push({id: `${name}#${i}`, file: name, text: chunk, terms, length: tokens.length})
      })
    }
    for (const chunk of this.chunks) for (const t of chunk.terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
    this.avgLength = this.chunks.reduce((sum, c) => sum + c.length, 0) / Math.max(this.chunks.length, 1)
  }

  get size() {
    return this.chunks.length
  }

  search(query: string, k: number): Chunk[] {
    const n = this.chunks.length
    const terms = [...new Set(tokenize(query))]
    return this.chunks
      .map((chunk) => {
        let score = 0
        for (const t of terms) {
          const tf = chunk.terms.get(t)
          if (!tf) continue
          const df = this.df.get(t) ?? 0
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
          score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * chunk.length) / this.avgLength))
        }
        return {chunk, score}
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({chunk: {id, file, text}}) => ({id, file, text}))
  }
}
