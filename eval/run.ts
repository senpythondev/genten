/**
 * Runs the held-out questions through the three configurations, grades them, and
 * writes eval/results/<timestamp>.json and eval/REPORT.md. Calls the model directly
 * (not /api/ask), so the API rate limit does not apply. Uses API credits.
 *
 * Needs snapshots/files (python -m tools.snapshot) and pdftotext. Run from web/:
 *   npm run eval                                        full run, writes REPORT.md
 *   npm run eval -- --configs genten --only 1,7         partial run (results file only)
 *   npm run eval -- --retry-errors results/<file>.json  re-run calls that failed, rewrite REPORT.md
 *   npm run eval -- --report results/<file>.json        re-render REPORT.md, no model calls
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {modelId} from '../web/src/lib/answer'
import {CONFIGS, runConfig, type ConfigName} from './configs'
import {grade} from './grade'
import {KeywordIndex} from './keyword'
import {DEFAULT_AS_OF, QUESTIONS, type EvalQuestion} from './questions'
import {renderReport, type ResultRow, type RunInfo} from './report'

const ROOT = path.resolve(__dirname, '..')
process.loadEnvFile(path.join(ROOT, 'web/.env.local'))

// Disclosure for the report: update this if any prompt changes after seeing results.
const PROMPT_CHANGES_AFTER_RESULTS = 'none.'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function runRow(config: ConfigName, question: EvalQuestion, index: KeywordIndex): Promise<ResultRow> {
  const asOf = question.asOf ?? DEFAULT_AS_OF
  const started = Date.now()
  let row: ResultRow
  try {
    const {answer, retrieved} = await runConfig(config, question.question, asOf, index)
    row = {
      config,
      question,
      asOf,
      latencyMs: Date.now() - started,
      answer: {
        answer: answer.answer,
        verdict: answer.verdict,
        abstained: answer.abstained,
        citations: answer.citations.map(({ref, url, authority}) => ({ref, url, authority})),
        conflicts: answer.conflicts.map(({source, kind}) => ({source, kind})),
        rule: answer.rule && {ruleKey: answer.rule.ruleKey, validFrom: answer.rule.validFrom, validTo: answer.rule.validTo},
        toolCalls: answer.trace.filter((t) => t.tool.startsWith('knowledge_base')).length,
      },
      retrieved,
      grade: grade(question, answer),
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err)
    row = {
      config,
      question,
      asOf,
      latencyMs: Date.now() - started,
      error: message,
      grade: {correct: false, correctOfficial: false, checks: [{name: 'error', pass: false, detail: message}]},
    }
  }
  const mark = row.grade.correct ? (row.grade.correctOfficial ? 'PASS' : 'pass (no official)') : row.error ? 'ERROR' : 'FAIL'
  console.log(`[${config}] Q${question.id} ${mark} ${(row.latencyMs / 1000).toFixed(1)}s`)
  return row
}

const load = (file: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, file), 'utf8')) as {info: RunInfo; rows: ResultRow[]}

function writeReport(rows: ResultRow[], info: RunInfo) {
  writeFileSync(path.join(__dirname, 'REPORT.md'), renderReport(rows, info) + '\n')
  console.log('Wrote eval/REPORT.md')
}

async function main() {
  const reportFrom = arg('report')
  if (reportFrom) {
    const {info, rows} = load(reportFrom)
    writeReport(rows, info)
    return
  }

  const index = new KeywordIndex(path.join(ROOT, 'snapshots/files'))
  console.log(`Keyword index: ${index.files} files, ${index.size} chunks, ${index.skipped.length} skipped`)
  if (index.files === 0) throw new Error('snapshots/files is empty: run python -m tools.snapshot first.')

  const startedAt = new Date().toISOString()
  let rows: ResultRow[]
  let info: RunInfo
  const retryFrom = arg('retry-errors')

  if (retryFrom) {
    const previous = load(retryFrom)
    const failed = previous.rows.filter((r) => r.error)
    console.log(`Re-running ${failed.length} failed call(s) from ${retryFrom}`)
    const retried = new Map<ResultRow, ResultRow>()
    for (const r of failed) retried.set(r, await runRow(r.config, r.question, index))
    rows = previous.rows.map((r) => retried.get(r) ?? r)
    info = {...previous.info, retriedAt: startedAt, retried: failed.map((r) => `${r.config} Q${r.question.id}`)}
  } else {
    const configs = (arg('configs')?.split(',') ?? CONFIGS) as ConfigName[]
    const only = arg('only')?.split(',').map(Number)
    const questions = QUESTIONS.filter((q) => !only || only.includes(q.id))
    // Configurations run concurrently; questions run one after another within each.
    const perConfig = await Promise.all(
      configs.map(async (config) => {
        const out: ResultRow[] = []
        for (const question of questions) out.push(await runRow(config, question, index))
        return out
      }),
    )
    rows = perConfig.flat()
    info = {
      startedAt,
      model: modelId(),
      resultsFile: '',
      keyword: {files: index.files, chunks: index.size, skipped: index.skipped},
      promptChangesAfterResults: PROMPT_CHANGES_AFTER_RESULTS,
      partial: Boolean(only) || configs.length < CONFIGS.length,
    }
  }

  info.resultsFile = `results/${startedAt.replace(/[:.]/g, '-')}.json`
  mkdirSync(path.join(__dirname, 'results'), {recursive: true})
  writeFileSync(path.join(__dirname, info.resultsFile), JSON.stringify({info, rows}, null, 2) + '\n')
  console.log(`Wrote eval/${info.resultsFile}`)
  if (info.partial) console.log('Partial run: eval/REPORT.md left unchanged.')
  else writeReport(rows, info)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
