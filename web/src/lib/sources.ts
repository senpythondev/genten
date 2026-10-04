// Maps knowledge-base citations to source details, using src/data/sources.json
// (generated from the seed by scripts/build-sources.ts).
import data from '../data/sources.json'
import type {Citation, Rule, RuleValue} from './types'

type SourceRecord = {
  url: string
  title: string
  publisher: string
  publisherType: string | null
  authority: string
  language: string
}

type RuleRecord = {
  title: string
  ruleKey: string
  value: RuleValue | null
  validFrom: string | null
  validTo: string | null
  status: string
  evidence: string[]
}

const SOURCES = data.sources as Record<string, SourceRecord>
const RULES = data.rules as Record<string, RuleRecord>

const AUTHORITY_ORDER = ['primary', 'secondary-institutional', 'secondary-independent']

// Normalise a title for matching: case, dash variants and surrounding whitespace.
const normalize = (text: string) =>
  text.toLowerCase().replace(/[‐-―−–—-]/g, '-').replace(/\s+/g, ' ').trim()

const RULE_BY_TITLE = new Map(Object.entries(RULES).map(([id, rule]) => [normalize(rule.title), id]))

// Strip list numbering ("3. ") and the outline's kind suffix (" — File", " — Dataset").
function cleanRef(ref: string): string {
  return ref
    .trim()
    .replace(/^\[?\d+\]?[.)]?\s+/, '')
    .replace(/\s+[—–-]\s+(file|dataset)$/i, '')
    .trim()
}

/** The id of the Genten rule version a reference points to, if any. */
export function ruleIdForRef(ref: string): string | undefined {
  const cleaned = cleanRef(ref)
  const byId = cleaned.replace(/^drafts\./, '').replace(/^ruleVersion-/, '')
  if (RULES[byId]) return byId
  return RULE_BY_TITLE.get(normalize(cleaned))
}

function sourceIdForRef(ref: string): string | undefined {
  const stem = cleanRef(ref).replace(/^source-/, '').replace(/\.(md|pdf)$/i, '')
  return SOURCES[stem] ? stem : undefined
}

function sourceCitation(ref: string, id: string): Citation {
  const s = SOURCES[id]
  return {ref, title: s.title, url: s.url, publisher: s.publisher, authority: s.authority, language: s.language}
}

/** One knowledge-base reference as a citation. Unknown references pass through unchanged. */
export function resolveRef(ref: string): Citation {
  const sourceId = sourceIdForRef(ref)
  if (sourceId) return sourceCitation(ref, sourceId)

  const ruleId = ruleIdForRef(ref)
  if (ruleId) {
    const rule = RULES[ruleId]
    const evidence = rule.evidence
      .filter((id) => SOURCES[id])
      .map((id) => sourceCitation(`${id}`, id))
      .sort((a, b) => AUTHORITY_ORDER.indexOf(a.authority) - AUTHORITY_ORDER.indexOf(b.authority))
    return {
      ref: `ruleVersion-${ruleId}`,
      title: `Genten verified rule: ${rule.title}`,
      url: null,
      publisher: 'Genten',
      authority: 'verified',
      language: 'en',
      evidence,
    }
  }

  return {ref, title: ref, url: null, publisher: 'unknown', authority: 'unknown', language: 'unknown'}
}

/** Resolve and de-duplicate a list of references, keeping their order. */
export function resolveCitations(refs: string[]): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const ref of refs) {
    const citation = resolveRef(ref)
    if (seen.has(citation.ref)) continue
    seen.add(citation.ref)
    citations.push(citation)
  }
  return citations
}

/**
 * The version of a rule that applies on asOf: validFrom <= asOf <= validTo (or no
 * validTo). If none applies yet, the next one to start; if all have ended, the last.
 */
export function ruleVersionOn(ruleId: string, asOf: string): Rule | undefined {
  const ruleKey = RULES[ruleId]?.ruleKey
  if (!ruleKey) return undefined
  const versions = Object.values(RULES)
    .filter((r) => r.ruleKey === ruleKey)
    .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''))
  const chosen =
    versions.find((r) => (!r.validFrom || r.validFrom <= asOf) && (!r.validTo || asOf <= r.validTo)) ??
    versions.find((r) => r.validFrom && r.validFrom > asOf) ??
    versions[versions.length - 1]
  const {title, value, validFrom, validTo, status} = chosen
  return {ruleKey, title, value, validFrom, validTo, status}
}
