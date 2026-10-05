'use client'

import {useState, useSyncExternalStore, type FormEvent} from 'react'
import Markdown from 'react-markdown'
import exampleAnswers from '@/data/example-answers.json'
import {dayAfter, todayInTokyo} from '@/lib/dates'
import {EXAMPLE_QUESTIONS} from '@/lib/examples'
import type {Citation, ConflictKind, GentenAnswer, Rule, Verdict} from '@/lib/types'

// "Today" is only known in the browser; the server snapshot is empty so the
// statically rendered page never shows a stale build date.
const noSubscribe = () => () => {}

// Recorded answers for the example chips (npm run precompute-examples), shown without an API call.
const RECORDED = exampleAnswers as unknown as {
  generatedAt: string
  answers: {question: string; answer: GentenAnswer}[]
}
const RECORDED_ON = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'}).format(new Date(RECORDED.generatedAt))
const recordedAnswer = (question: string) => RECORDED.answers.find((a) => a.question === question)?.answer

const VERDICT_STYLES: Record<Verdict, {label: string; className: string}> = {
  yes: {label: 'Yes', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'},
  no: {label: 'No', className: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200'},
  depends: {label: 'It depends', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'},
  info: {label: 'Answer', className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'},
  abstain: {label: 'Not covered', className: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'},
}

const CONFLICT_STYLES: Record<ConflictKind, {label: string; className: string}> = {
  outdated: {label: 'Outdated', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'},
  incorrect: {label: 'Incorrect', className: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200'},
  'same-rule-different-wording': {
    label: 'Same rule, different wording',
    className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  },
}

const AUTHORITY_BADGES: Record<string, {label: string; className: string}> = {
  verified: {label: 'Verified rule', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'},
  primary: {label: 'Official', className: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200'},
  'secondary-institutional': {label: 'Institution', className: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'},
  'secondary-independent': {label: 'Independent', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'},
}

function Badge({label, className}: {label: string; className: string}) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>
}

function formatValue(rule: Rule): string {
  const {amount, unit, qualifier} = rule.value ?? {}
  const yen = (n: number) => `¥${n.toLocaleString('en-US')}`
  const main =
    amount == null
      ? ''
      : unit === 'JPY'
        ? yen(amount)
        : unit === 'JPY/year'
          ? `${yen(amount)} per year`
          : unit === 'percent'
            ? `${amount}%`
            : unit === 'years'
              ? `${amount} years`
              : String(amount)
  return [main, qualifier].filter(Boolean).join(' · ')
}

function ruleLine(rule: Rule, asOf: string): string {
  if (rule.validFrom && rule.validFrom > asOf) {
    return `Starts ${rule.validFrom}${rule.status === 'enacted-future' ? ' · enacted, not yet in force' : ''}`
  }
  if (rule.validTo && rule.validTo < asOf) return `Superseded on ${dayAfter(rule.validTo)}`
  return `In force since ${rule.validFrom ?? 'an unknown date'}${rule.validTo ? ` · until ${rule.validTo}` : ''}`
}

function SourceLink({citation}: {citation: Citation}) {
  const badge = AUTHORITY_BADGES[citation.authority]
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {citation.url ? (
        <a href={citation.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-900 dark:hover:decoration-zinc-100">
          {citation.title}
        </a>
      ) : (
        <span className="font-medium">{citation.title}</span>
      )}
      {badge && <Badge {...badge} />}
      {(citation.language === 'ja' || citation.language === 'en') && (
        <Badge label={citation.language.toUpperCase()} className="border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" />
      )}
      {citation.publisher !== 'Genten' && citation.publisher !== 'unknown' && (
        <span className="text-xs text-zinc-500">{citation.publisher}</span>
      )}
    </div>
  )
}

function AnswerView({
  result,
  recorded,
  onRunLive,
}: {
  result: GentenAnswer
  recorded: boolean
  onRunLive: () => void
}) {
  const verdict = VERDICT_STYLES[result.verdict]
  return (
    <div className="space-y-6" aria-live="polite">
      {recorded && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>
            Recorded on {RECORDED_ON} (as of {result.asOf}). Ask your own question for a live answer.
          </span>
          <button
            type="button"
            onClick={onRunLive}
            className="rounded-lg border border-amber-400 px-3 py-1 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
          >
            Run live
          </button>
        </div>
      )}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge {...verdict} />
          <span className="text-xs text-zinc-500">as of {result.asOf}</span>
        </div>
        <div className="prose-genten text-[15px] leading-relaxed">
          <Markdown>{result.answer}</Markdown>
        </div>
        {result.rule && (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <div className="font-medium">{ruleLine(result.rule, result.asOf)}</div>
            <div className="text-zinc-600 dark:text-zinc-400">
              {result.rule.title}
              {formatValue(result.rule) && <> — {formatValue(result.rule)}</>}
            </div>
          </div>
        )}
      </section>

      {result.conflicts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">What English guides get wrong</h2>
          <ul className="space-y-3">
            {result.conflicts.map((conflict, i) => (
              <li key={i} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {conflict.url ? (
                    <a href={conflict.url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
                      {conflict.sourceTitle ?? conflict.source}
                    </a>
                  ) : (
                    <span className="font-medium">{conflict.sourceTitle ?? conflict.source}</span>
                  )}
                  <Badge {...CONFLICT_STYLES[conflict.kind]} />
                </div>
                <p>“{conflict.claim}”</p>
                <p className="text-zinc-600 dark:text-zinc-400">{conflict.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.citations.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>
          <ul className="space-y-3 text-sm">
            {result.citations.map((citation) => (
              <li key={citation.ref}>
                <SourceLink citation={citation} />
                {citation.evidence && citation.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                    {citation.evidence.map((evidence) => (
                      <li key={evidence.ref}>
                        <SourceLink citation={evidence} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">How Genten found this</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
          {result.trace.map((step, i) => (
            <li key={i}>
              <code className="text-zinc-900 dark:text-zinc-100">{step.tool}</code>
              {step.inputSummary && <> — {step.inputSummary}</>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

export function GentenApp() {
  const today = useSyncExternalStore(noSubscribe, todayInTokyo, () => '')
  const [question, setQuestion] = useState('')
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GentenAnswer | null>(null)
  const [recorded, setRecorded] = useState(false)
  const [shownQuestion, setShownQuestion] = useState('')
  const asOf = pickedDate ?? today

  // Example chips show their recorded answer; "Run live" asks the same question live.
  function showExample(example: string) {
    setQuestion(example)
    const answer = recordedAnswer(example)
    if (!answer) return void ask(example)
    setError(null)
    setResult(answer)
    setRecorded(true)
    setShownQuestion(example)
  }

  async function ask(text: string) {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: text, ...(asOf ? {asOf} : {})}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? 'Something went wrong. Please try again.')
      setResult(data as GentenAnswer)
      setRecorded(false)
      setShownQuestion(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void ask(question)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Genten 原典 — Japan money rules, checked against the Japanese original
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Ask about NISA or furusato nozei. Genten answers from rules a reviewer checked against official Japanese
          sources, and points out when English guides are out of date.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(question)
          }}
          maxLength={500}
          rows={3}
          placeholder="e.g. How much can I put into tsumitate NISA each year?"
          className="w-full resize-y rounded-xl border border-zinc-300 bg-white p-3 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            <span className="mb-1 text-zinc-600 dark:text-zinc-400">As of</span>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setPickedDate(e.target.value || null)}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="ml-auto rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading ? 'Checking…' : 'Ask'}
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((example) => (
          <button
            key={example}
            type="button"
            disabled={loading}
            onClick={() => showExample(example)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-300 dark:hover:text-zinc-100"
          >
            {example}
          </button>
        ))}
      </div>

      <main className="mt-8">
        {loading && (
          <p className="animate-pulse text-sm text-zinc-500" role="status">
            Reading the knowledge base and checking the rule in force on {asOf || 'today'}…
          </p>
        )}
        {error && !loading && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200" role="alert">
            {error}
          </p>
        )}
        {result && !loading && (
          <AnswerView result={result} recorded={recorded} onRunLive={() => void ask(shownQuestion)} />
        )}
      </main>

      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        Informational only — not financial or tax advice. Rules verified against official sources by a human reviewer.
      </footer>
    </div>
  )
}
