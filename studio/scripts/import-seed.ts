/**
 * Imports ../seed/genten-seed.json into the Sanity dataset.
 *
 * - topics and sources are written as published documents.
 * - ruleVersions are written as drafts. A reviewer checks each one in the Studio and
 *   publishes it; Knowledge Base sources read published documents only.
 * - Idempotent: each document is compared with the dataset and only changed ones are
 *   written, in a single transaction. A rule that a reviewer has already published is
 *   skipped, so a re-run never re-opens it as a draft.
 * - Existing documents are patched, not replaced: only the fields the seed sets are
 *   written. Fields owned by tools or reviewers (capturedAt, snapshotSha256,
 *   verification, ...) are never touched. A field removed from the seed is not unset.
 *
 * Usage (inside studio/): npm run seed
 * Needs SANITY_WRITE_TOKEN in the root .env.
 */
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {createClient, type SanityDocument} from '@sanity/client'
import {config} from 'dotenv'

const ROOT = path.resolve(__dirname, '../..')
config({path: path.join(ROOT, '.env'), quiet: true})

type SeedTopic = {id: string; title: string; area: string; summary?: string}

type SeedSource = {
  id: string
  title: string
  url: string
  publisher: string
  publisherType: string
  authority: string
  language: string
  topics: string[]
  role: string
  curationNote: string
}

type SeedRuleVersion = {
  id: string
  ruleKey: string
  topic: string
  title: string
  statementEn: string
  value: {amount: number | null; unit: string; qualifier: string | null}
  appliesTo: string
  validFrom: string
  validTo: string | null
  status: string
  supersedes: string | null
  evidence: {source: string; locator: string; note: string}[]
  checkFirst: string
}

type Seed = {topics: SeedTopic[]; sources: SeedSource[]; ruleVersions: SeedRuleVersion[]}

type Doc = {_id: string; _type: string; [field: string]: unknown}

const TYPES = ['topic', 'source', 'ruleVersion'] as const

// Paste into Vision with the "raw" perspective to see the same numbers.
const COUNTS_QUERY = `{
  "topic": {
    "published": count(*[_type == "topic" && !(_id in path("drafts.**"))]),
    "drafts": count(*[_type == "topic" && _id in path("drafts.**")])
  },
  "source": {
    "published": count(*[_type == "source" && !(_id in path("drafts.**"))]),
    "drafts": count(*[_type == "source" && _id in path("drafts.**")])
  },
  "ruleVersion": {
    "published": count(*[_type == "ruleVersion" && !(_id in path("drafts.**"))]),
    "drafts": count(*[_type == "ruleVersion" && _id in path("drafts.**")])
  }
}`

const ref = (id: string) => ({_type: 'reference', _ref: id})

// Drop null and undefined fields so optional values are absent instead of null.
function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<T>
}

function toTopic(t: SeedTopic): Doc {
  return compact({
    _id: `topic-${t.id}`,
    _type: 'topic',
    title: t.title,
    slug: {_type: 'slug', current: t.id},
    area: t.area,
    summary: t.summary,
  }) as Doc
}

function toSource(s: SeedSource): Doc {
  return compact({
    _id: `source-${s.id}`,
    _type: 'source',
    title: s.title,
    url: s.url,
    publisher: s.publisher,
    publisherType: s.publisherType,
    authority: s.authority,
    language: s.language,
    topics: s.topics.map((topicId) => ({...ref(`topic-${topicId}`), _key: topicId})),
    role: s.role,
    curationNote: s.curationNote,
  }) as Doc
}

function toRuleVersion(r: SeedRuleVersion): Doc {
  return compact({
    _id: `drafts.ruleVersion-${r.id}`,
    _type: 'ruleVersion',
    ruleKey: r.ruleKey,
    topic: ref(`topic-${r.topic}`),
    title: r.title,
    statementEn: r.statementEn,
    value: compact(r.value),
    appliesTo: r.appliesTo,
    validFrom: r.validFrom,
    validTo: r.validTo,
    status: r.status,
    supersedes: r.supersedes ? {...ref(`ruleVersion-${r.supersedes}`), _weak: true} : null,
    evidence: r.evidence.map((e, i) =>
      compact({
        _key: `evidence-${i}`,
        _type: 'evidenceItem',
        source: ref(`source-${e.source}`),
        locator: e.locator,
        note: e.note,
      }),
    ),
    checkFirst: r.checkFirst,
  }) as Doc
}

// Compare only the fields the seed sets, ignoring key order. Other fields on the
// existing document do not count as a difference.
function sameSeedFields(current: SanityDocument, next: Doc): boolean {
  const sortKeys = (_key: string, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value
  return Object.entries(next).every(
    ([field, value]) =>
      JSON.stringify(current[field], sortKeys) === JSON.stringify(value, sortKeys),
  )
}

async function main() {
  const token = process.env.SANITY_WRITE_TOKEN
  if (!token) throw new Error('SANITY_WRITE_TOKEN is not set. Add it to the root .env file.')

  const client = createClient({
    projectId: process.env.SANITY_PROJECT_ID || 'pro5oxe1',
    dataset: process.env.SANITY_DATASET || 'production',
    apiVersion: '2025-02-19',
    token,
    useCdn: false,
    perspective: 'raw',
  })

  const seed: Seed = JSON.parse(readFileSync(path.join(ROOT, 'seed/genten-seed.json'), 'utf8'))
  const docs = [
    ...seed.topics.map(toTopic),
    ...seed.sources.map(toSource),
    ...seed.ruleVersions.map(toRuleVersion),
  ]

  const publishedIds = docs.map((doc) => doc._id.replace(/^drafts\./, ''))
  const existing = await client.fetch<SanityDocument[]>('*[_id in $ids]', {
    ids: [...docs.map((doc) => doc._id), ...publishedIds],
  })
  const byId = new Map(existing.map((doc) => [doc._id, doc]))

  const tally = Object.fromEntries(
    TYPES.map((type) => [type, {created: 0, updated: 0, unchanged: 0, skippedPublished: 0}]),
  )
  const tx = client.transaction()
  let writes = 0

  for (const doc of docs) {
    const row = tally[doc._type]
    const isDraft = doc._id.startsWith('drafts.')
    if (isDraft && byId.has(doc._id.slice('drafts.'.length))) {
      row.skippedPublished++
      continue
    }
    const current = byId.get(doc._id)
    if (!current) {
      row.created++
      tx.createIfNotExists(doc)
    } else if (sameSeedFields(current, doc)) {
      row.unchanged++
      continue
    } else {
      row.updated++
      const {_id, _type, ...seedFields} = doc
      tx.patch(_id, (patch) => patch.set(seedFields))
    }
    writes++
  }

  if (writes > 0) {
    const result = await tx.commit({visibility: 'sync'})
    console.log(`Committed ${writes} document(s) in transaction ${result.transactionId}.`)
  } else {
    console.log('Nothing to write: the dataset already matches the seed.')
  }

  console.log('\nThis run:')
  console.table(tally)

  const counts = await client.fetch<Record<string, {published: number; drafts: number}>>(
    COUNTS_QUERY,
  )
  console.log('Dataset now (GROQ, raw perspective):')
  console.table(counts)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
