/**
 * Imports ../seed/genten-seed.json into the Sanity dataset.
 *
 * - topics and sources are written as published documents (sources are citations,
 *   not claims).
 * - ruleVersions are written as drafts. A reviewer checks each one in the Studio and
 *   publishes it; Knowledge Base sources read published documents only.
 * - The seed owns only the fields in OWNED_FIELDS. Everything else (capturedAt and
 *   snapshotSha256 from the snapshot tools, verification from reviewers) is never
 *   written. A null owned field is unset; a missing one is left alone.
 * - Idempotent: each document is compared with the dataset and only changed ones are
 *   written, in a single transaction. New documents use createIfNotExists; existing
 *   ones get a patch of owned fields.
 * - Once a rule version is published, the seed never creates or patches its draft
 *   again. It prints how the seed differs from the published version instead.
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
  publishedAt?: string
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
  validFrom: string | null
  validTo: string | null
  status: string
  supersedes: string | null
  evidence: {source: string; locator: string; note: string}[]
  checkFirst: string
}

type Seed = {topics: SeedTopic[]; sources: SeedSource[]; ruleVersions: SeedRuleVersion[]}

type Doc = {_id: string; _type: string; [field: string]: unknown}

// The only fields the seed writes. Any other field belongs to tools or reviewers.
const OWNED_FIELDS: Record<string, string[]> = {
  topic: ['title', 'slug', 'area', 'summary'],
  source: [
    'title',
    'url',
    'publisher',
    'publisherType',
    'authority',
    'language',
    'topics',
    'publishedAt',
    'role',
    'curationNote',
  ],
  ruleVersion: [
    'ruleKey',
    'topic',
    'title',
    'statementEn',
    'value',
    'appliesTo',
    'validFrom',
    'validTo',
    'status',
    'supersedes',
    'evidence',
    'checkFirst',
  ],
}

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

// The to* builders keep top-level nulls: main() turns them into unsets.
function toTopic(t: SeedTopic): Doc {
  return {
    _id: `topic-${t.id}`,
    _type: 'topic',
    title: t.title,
    slug: {_type: 'slug', current: t.id},
    area: t.area,
    summary: t.summary,
  }
}

function toSource(s: SeedSource): Doc {
  return {
    _id: `source-${s.id}`,
    _type: 'source',
    title: s.title,
    url: s.url,
    publisher: s.publisher,
    publisherType: s.publisherType,
    authority: s.authority,
    language: s.language,
    topics: s.topics.map((topicId) => ({...ref(`topic-${topicId}`), _key: topicId})),
    publishedAt: s.publishedAt,
    role: s.role,
    curationNote: s.curationNote,
  }
}

function toRuleVersion(r: SeedRuleVersion): Doc {
  return {
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
  }
}

const sortKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
    : value
const canonical = (value: unknown) => JSON.stringify(value, sortKeys)

// Owned fields whose dataset value differs from the seed, ignoring key order.
// Fields the seed does not own are never compared.
function differences(
  current: SanityDocument,
  toSet: Record<string, unknown>,
  toUnset: string[],
): string[] {
  return [
    ...Object.keys(toSet).filter((field) => canonical(current[field]) !== canonical(toSet[field])),
    ...toUnset.filter((field) => current[field] !== undefined),
  ]
}

const short = (value: unknown) => {
  const text = JSON.stringify(value) ?? '(none)'
  return text.length > 90 ? `${text.slice(0, 87)}...` : text
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
    Object.keys(OWNED_FIELDS).map((type) => [
      type,
      {created: 0, updated: 0, unchanged: 0, publishedKept: 0},
    ]),
  )
  const publishedDiffs: string[] = []
  const tx = client.transaction()
  let writes = 0

  for (const doc of docs) {
    const {_id, _type, ...fields} = doc
    const notOwned = Object.keys(fields).filter((field) => !OWNED_FIELDS[_type].includes(field))
    if (notOwned.length) throw new Error(`${_id}: seed builds fields it does not own: ${notOwned}`)

    const toSet = compact(fields)
    const toUnset = Object.keys(fields).filter((field) => fields[field] === null)
    const row = tally[_type]

    // A published rule version is the reviewer's: report differences, write nothing.
    const published = _id.startsWith('drafts.') ? byId.get(_id.slice('drafts.'.length)) : undefined
    if (published) {
      row.publishedKept++
      for (const field of differences(published, toSet, toUnset)) {
        publishedDiffs.push(
          `  ${published._id} ${field}\n    published: ${short(published[field])}\n    seed:      ${short(toSet[field] ?? null)}`,
        )
      }
      continue
    }

    const current = byId.get(_id)
    if (!current) {
      row.created++
      tx.createIfNotExists({_id, _type, ...toSet})
    } else if (differences(current, toSet, toUnset).length === 0) {
      row.unchanged++
      continue
    } else {
      row.updated++
      tx.patch(_id, (patch) => (toUnset.length ? patch.set(toSet).unset(toUnset) : patch.set(toSet)))
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

  if (publishedDiffs.length > 0) {
    console.log('Published rule versions that differ from the seed (left unchanged):')
    console.log(publishedDiffs.join('\n'))
  }

  const counts = await client.fetch<Record<string, {published: number; drafts: number}>>(
    COUNTS_QUERY,
  )
  console.log('\nDataset now (GROQ, raw perspective):')
  console.table(counts)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
