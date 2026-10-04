/**
 * Builds src/data/sources.json from seed/genten-seed.json, so the agent can turn
 * the knowledge base's citations (file names such as "fsa-nisa-know.md" and rule
 * version titles or ids) into links.
 *
 * Only an allowlist of fields is copied. role and curationNote (the evaluation
 * answer key) and checkFirst (reviewer notes) never reach the web app.
 *
 * Run from web/: npm run build:sources
 */
import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'

const SEED = path.resolve(__dirname, '../../seed/genten-seed.json')
const OUT = path.resolve(__dirname, '../src/data/sources.json')

const SOURCE_FIELDS = ['url', 'title', 'publisher', 'publisherType', 'authority', 'language'] as const
const RULE_FIELDS = ['title', 'ruleKey', 'value', 'validFrom', 'validTo', 'status'] as const

type SeedRecord = Record<string, unknown> & {id: string}

const pick = (record: SeedRecord, fields: readonly string[]) =>
  Object.fromEntries(fields.map((field) => [field, record[field] ?? null]))

const seed = JSON.parse(readFileSync(SEED, 'utf8')) as {
  sources: SeedRecord[]
  ruleVersions: (SeedRecord & {evidence: {source: string}[]})[]
}

const data = {
  generatedFrom: 'seed/genten-seed.json',
  sources: Object.fromEntries(seed.sources.map((s) => [s.id, pick(s, SOURCE_FIELDS)])),
  rules: Object.fromEntries(
    seed.ruleVersions.map((r) => [
      r.id,
      {...pick(r, RULE_FIELDS), evidence: [...new Set(r.evidence.map((e) => e.source))]},
    ]),
  ),
}

const json = JSON.stringify(data, null, 2) + '\n'
const notes = seed.sources.map((s) => s.curationNote).filter((n): n is string => typeof n === 'string')
if (/"(role|curationNote|checkFirst)"/.test(json) || notes.some((note) => json.includes(note))) {
  throw new Error('sources.json would contain internal curation data; refusing to write it.')
}
writeFileSync(OUT, json)
console.log(
  `Wrote ${path.relative(process.cwd(), OUT)}: ${seed.sources.length} sources, ${seed.ruleVersions.length} rule versions.`,
)
