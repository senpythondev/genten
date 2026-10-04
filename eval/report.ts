// Writes eval/REPORT.md from one run's results.
import type {GentenAnswer} from '../web/src/lib/types'
import type {ConfigName} from './configs'
import {CONFIGS, TOP_K} from './configs'
import type {Grade} from './grade'
import type {Category, EvalQuestion} from './questions'
import {DEFAULT_AS_OF} from './questions'

export type ResultRow = {
  config: ConfigName
  question: EvalQuestion
  asOf: string
  latencyMs: number
  error?: string
  // Full askGenten output. Results files before 2026-10-05 stored only answer, verdict,
  // abstained, citations (ref, url, authority), conflicts (source, kind), rule dates and toolCalls.
  answer?: GentenAnswer & {toolCalls: number}
  retrieved?: string[]
  grade: Grade
}

export type RunInfo = {
  startedAt: string
  model: string
  resultsFile: string
  keyword: {files: number; chunks: number; skipped: {file: string; reason: string}[]}
  promptChangesAfterResults: string
  partial: boolean
  retriedAt?: string
  retried?: string[]
}

const CATEGORIES: Category[] = ['current', 'premise', 'date', 'future', 'leaving', 'abstain', 'ja']

const pct = (pass: number, n: number) => (n ? `${pass}/${n} (${Math.round((100 * pass) / n)}%)` : '–')
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const clip = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function failureReason(row: ResultRow, officialOnly: boolean): string {
  if (row.error) return `error: ${row.error}`
  const failed = row.grade.checks.filter((c) => !c.pass && (officialOnly ? c.name === 'official' : c.name !== 'official'))
  return failed.map((c) => `${c.name}: ${c.detail}`).join('; ')
}

export function renderReport(rows: ResultRow[], info: RunInfo): string {
  const configs = CONFIGS.filter((c) => rows.some((r) => r.config === c))
  const byConfig = (config: ConfigName) => rows.filter((r) => r.config === config)
  const lines: string[] = []

  lines.push('# Genten evaluation', '')
  lines.push(
    `Run ${info.startedAt} · model \`${info.model}\` · default as-of ${DEFAULT_AS_OF} · raw results: \`eval/${info.resultsFile}\`${info.partial ? ' · **partial run**' : ''}`,
    '',
  )
  if (info.retriedAt) {
    lines.push(`Failed calls re-run on ${info.retriedAt}: ${info.retried?.join(', ')}.`, '')
  }

  lines.push('## Setup', '')
  lines.push(
    '- **Questions:** 25 held-out questions in 7 categories (`eval/questions.ts`). The agent prompt was not tuned on them.',
    `- **Prompt changes after seeing results:** ${info.promptChangesAfterResults}`,
    '- **Configurations.** All three use the same model, output schema, as-of date, answering rules and post-processing (shortening pass, citation mapping). Only rule 1, which says what to answer from, differs:',
    '  - **closed-book:** no retrieval.',
    `  - **keyword-search:** BM25 over \`snapshots/files\` (${info.keyword.files} files, ${info.keyword.chunks} chunks of up to ~1,000 characters). PDFs are read with \`pdftotext\`; ${
      info.keyword.skipped.length
        ? `skipped: ${info.keyword.skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`
        : 'all PDFs were readable, none skipped'
    }. The top ${TOP_K} chunks go into the prompt. Citations are the chunk file names, mapped through \`sources.json\`.`,
    '  - **genten:** `askGenten`, which works over the Sanity Context knowledge base through MCP (verified rule versions plus official sources).',
    '- **Sampling:** temperature 0 is not available. The AI SDK drops it for `claude-sonnet-5-5` ("temperature is not supported … and will be ignored"), so every call uses default sampling and results vary between runs. Each question ran once per configuration.',
    '- **Grader:** deterministic, no LLM judge (`eval/grade.ts`).',
    '  - **CORRECT:** the verdict is allowed (if specified), every yen amount is present after normalization (¥1,200,000, 1.2M, 120万円 and so on), the regex matches, and the abstain flag is right. For `ja` questions the answer must also be mostly Japanese: at least half of its letters are Japanese characters, which is stricter than merely "contains Japanese".',
    '  - **CORRECT+OFFICIAL:** CORRECT, plus a citation of an official government source or a Genten verified rule. Abstain questions have nothing to cite, so for them it equals CORRECT.',
    '',
  )

  lines.push('## Pass rates', '')
  const header = ['Category', 'n', ...configs.flatMap((c) => [`${c} CORRECT`, `${c} CORRECT+OFFICIAL`])]
  lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`)
  for (const category of [...CATEGORIES, 'all' as const]) {
    const inCategory = (r: ResultRow) => category === 'all' || r.question.category === category
    const n = byConfig(configs[0]).filter(inCategory).length
    if (!n) continue
    const cells = configs.flatMap((config) => {
      const rs = byConfig(config).filter(inCategory)
      return [pct(rs.filter((r) => r.grade.correct).length, rs.length), pct(rs.filter((r) => r.grade.correctOfficial).length, rs.length)]
    })
    const label = category === 'all' ? '**All**' : category
    lines.push(`| ${label} | ${n} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  for (const config of configs) {
    const errors = byConfig(config).filter((r) => r.error)
    if (!errors.length) continue
    const answered = byConfig(config).filter((r) => !r.error)
    lines.push(
      `**${config}: ${errors.length} question(s) got no answer because the API call failed** (${[...new Set(errors.map((r) => r.error))].join('; ')}). These count as failures in the table above. On the ${answered.length} questions it answered: CORRECT ${pct(answered.filter((r) => r.grade.correct).length, answered.length)}, CORRECT+OFFICIAL ${pct(answered.filter((r) => r.grade.correctOfficial).length, answered.length)}.`,
      '',
    )
  }

  lines.push('## Latency', '')
  lines.push('| Configuration | Average | Median | Slowest | Avg. knowledge-base tool calls |', '|---|---|---|---|---|')
  for (const config of configs) {
    const answered = byConfig(config).filter((r) => !r.error)
    if (!answered.length) continue
    const times = answered.map((r) => r.latencyMs).sort((a, b) => a - b)
    const avg = times.reduce((s, t) => s + t, 0) / times.length
    const calls = answered.map((r) => r.answer?.toolCalls ?? 0)
    const avgCalls = config === 'genten' ? (calls.reduce((s, c) => s + c, 0) / calls.length).toFixed(1) : '–'
    lines.push(`| ${config} | ${seconds(avg)} | ${seconds(times[Math.floor(times.length / 2)])} | ${seconds(times[times.length - 1])} | ${avgCalls} |`)
  }
  lines.push('', 'Wall-clock time per answered question; failed API calls are excluded. The three configurations ran concurrently.', '')

  if (rows.some((r) => r.answer?.usage)) {
    lines.push('## Tokens per question (average)', '')
    lines.push('| Configuration | Input (incl. cache) | Cache read | Cache write | Output |', '|---|---|---|---|---|')
    for (const config of configs) {
      const usages = byConfig(config).flatMap((r) => (r.answer?.usage ? [r.answer.usage] : []))
      if (!usages.length) continue
      const avg = (key: 'input' | 'cacheRead' | 'cacheWrite' | 'output') =>
        Math.round(usages.reduce((s, u) => s + u[key], 0) / usages.length).toLocaleString('en-US')
      lines.push(`| ${config} | ${avg('input')} | ${avg('cacheRead')} | ${avg('cacheWrite')} | ${avg('output')} |`)
    }
    lines.push('')
  }

  lines.push('## Failures', '')
  for (const config of configs) {
    const rs = byConfig(config)
    const errors = rs.filter((r) => r.error)
    const wrong = rs.filter((r) => !r.grade.correct && !r.error)
    const officialOnly = rs.filter((r) => r.grade.correct && !r.grade.correctOfficial)
    lines.push(`### ${config}`, '')
    if (!errors.length && !wrong.length && !officialOnly.length) lines.push('No failures.', '')
    if (errors.length) {
      lines.push(`No answer, because the API call failed (${errors.length}):`, '')
      for (const r of errors) lines.push(`- **Q${r.question.id}** [${r.question.category}] ${r.question.question}. ${r.error}`)
      lines.push('')
    }
    if (wrong.length) {
      lines.push(`CORRECT failures (${wrong.length}):`, '')
      for (const r of wrong) {
        lines.push(
          `- **Q${r.question.id}** [${r.question.category}${r.question.asOf ? `, as of ${r.question.asOf}` : ''}] ${r.question.question}`,
          `  - Reason: ${failureReason(r, false)}`,
          ...(r.answer ? [`  - Answer: "${clip(r.answer.answer)}"`] : []),
        )
      }
      lines.push('')
    }
    if (officialOnly.length) {
      if (config === 'closed-book') {
        lines.push(
          `Correct but no official citation (${officialOnly.length}): Q${officialOnly.map((r) => r.question.id).join(', Q')}. Closed-book has no sources to cite.`,
          '',
        )
      } else {
        lines.push(`Correct but no official citation (${officialOnly.length}):`, '')
        for (const r of officialOnly) {
          const cited = r.answer?.citations.map((c) => `${c.ref} (${c.authority})`).join(', ') || 'none'
          lines.push(`- **Q${r.question.id}** ${r.question.question}. Cited: ${cited}`)
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}
