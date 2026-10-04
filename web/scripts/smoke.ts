/**
 * Runs the example questions through askGenten and prints, for each: verdict, rule,
 * citation URLs, conflicts and token usage, then a summary table. Calls the model (uses API credits).
 *
 * Run from web/: npm run smoke [-- 1,3]   (optional 1-based question numbers)
 */
import {countWords} from '../src/lib/answer'
import {EXAMPLE_QUESTIONS} from '../src/lib/examples'
import {askGenten} from '../src/lib/genten'
import type {Citation, Rule} from '../src/lib/types'

process.loadEnvFile('.env.local')

const formatRule = (rule?: Rule) =>
  rule
    ? `${rule.ruleKey} · ${rule.status} · ${rule.validFrom ?? '?'}–${rule.validTo ?? 'now'} · ` +
      `${rule.value?.amount ?? ''} ${rule.value?.unit ?? ''}`.trim()
    : '(none)'

const citationLines = (citations: Citation[]) =>
  citations.flatMap((c) =>
    c.evidence
      ? [`  [verified rule] ${c.title}`, ...c.evidence.map((e) => `      ${e.authority.padEnd(24)} ${e.url}`)]
      : [`  ${c.authority.padEnd(28)} ${c.url ?? `(no url) ${c.ref}`}`],
  )

async function main() {
  const picked = process.argv[2]?.split(',').map((n) => Number(n) - 1)
  const questions = EXAMPLE_QUESTIONS.map((q, i) => ({q, i})).filter(({i}) => !picked || picked.includes(i))
  const rows: string[] = []

  for (const {q, i} of questions) {
    const started = Date.now()
    console.log(`\n=== ${i + 1}. ${q}`)
    try {
      const a = await askGenten({question: q})
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      const words = countWords(a.answer)
      const toolCalls = a.trace.filter((t) => t.tool.startsWith('knowledge_base')).length
      console.log(`verdict: ${a.verdict}${a.abstained ? ' (abstained)' : ''}   asOf: ${a.asOf}   ${seconds}s`)
      console.log(`rule:    ${formatRule(a.rule)}`)
      console.log(`answer (${words} words):\n  ${a.answer.replace(/\n/g, '\n  ')}`)
      console.log('citations:')
      console.log(citationLines(a.citations).join('\n') || '  (none)')
      console.log('conflicts:')
      for (const c of a.conflicts) console.log(`  [${c.kind}] ${c.source}: ${c.claim} — ${c.note}`)
      if (a.conflicts.length === 0) console.log('  (none)')
      console.log(`trace:   ${a.trace.map((t) => `${t.tool}(${t.inputSummary})`).join(' → ')}`)
      const u = a.usage
      const tokens = u ? `in ${u.input} / cache read ${u.cacheRead} / cache write ${u.cacheWrite} / out ${u.output}` : 'n/a'
      console.log(`tokens:  ${tokens}`)
      const conflicts = a.conflicts.map((c) => `${c.source} (${c.kind})`).join(', ') || 'none'
      rows.push(`| ${i + 1} | ${a.verdict} | ${formatRule(a.rule)} | ${words} | ${conflicts} | ${toolCalls} | ${tokens} | ${seconds}s |`)
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? `${err.name}: ${err.message}` : err}`)
      rows.push(`| ${i + 1} | FAILED | | | | | | |`)
      process.exitCode = 1
    }
  }

  console.log('\n| # | Verdict | Rule | Words | Conflicts | KB tool calls | Tokens | Time |')
  console.log('|---|---|---|---|---|---|---|---|')
  console.log(rows.join('\n'))
}

main()
