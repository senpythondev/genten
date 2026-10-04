// Shapes returned by askGenten and POST /api/ask. Safe to import from client components.

export type Verdict = 'yes' | 'no' | 'depends' | 'info' | 'abstain'

export type ConflictKind = 'outdated' | 'incorrect' | 'same-rule-different-wording'

export type RuleValue = {amount?: number | null; unit?: string | null; qualifier?: string | null}

export type Rule = {
  ruleKey: string
  title: string
  value: RuleValue | null
  validFrom: string | null
  validTo: string | null
  status: string
}

// authority: primary | secondary-institutional | secondary-independent for documents,
// "verified" for a Genten rule version, "unknown" for a reference that could not be mapped.
export type Citation = {
  ref: string
  title: string
  url: string | null
  publisher: string
  authority: string
  language: string
  evidence?: Citation[] // for a Genten rule version: the sources it was verified against
}

export type Conflict = {
  claim: string
  source: string
  kind: ConflictKind
  note: string
  sourceTitle?: string
  url?: string | null
}

export type TraceStep = {tool: string; inputSummary: string}

export type GentenAnswer = {
  answer: string
  verdict: Verdict
  rule?: Rule
  asOf: string
  citations: Citation[]
  conflicts: Conflict[]
  abstained: boolean
  trace: TraceStep[]
}
