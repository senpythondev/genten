/**
 * Runs the example questions through askGenten and prints, for each: verdict, rule,
 * citation URLs and conflicts. Calls the model, so it uses API credits.
 *
 * Run from web/: npm run smoke [-- 1,3]   (optional 1-based question numbers)
 */
import {EXAMPLE_QUESTIONS} from '../src/lib/examples'
import {askGenten} from '../src/lib/genten'
import type {Citation, Rule} from '../src/lib/types'

process.loadEnvFile('.env.local')

const formatRule = (rule?: Rule) =>
  rule
    ? `${rule.ruleKey} · ${rule.status} · ${rule.validFrom ?? '?'}–${rule.validTo ?? 'now'} · ` +
      `${rule.value?.amount ?? ''} ${rule.value?.unit ?? ''} (${rule.value?.qualifier ?? ''})`
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

  for (const {q, i} of questions) {
    const started = Date.now()
    console.log(`\n=== ${i + 1}. ${q}`)
    try {
      const a = await askGenten({question: q})
      // Japanese has no spaces between words, so report characters for it.
      const length = /[぀-ヿ一-鿿]/.test(a.answer)
        ? `${a.answer.length} chars`
        : `${a.answer.split(/\s+/).filter(Boolean).length} words`
      console.log(`verdict: ${a.verdict}${a.abstained ? ' (abstained)' : ''}   asOf: ${a.asOf}   ${((Date.now() - started) / 1000).toFixed(1)}s`)
      console.log(`rule:    ${formatRule(a.rule)}`)
      console.log(`answer (${length}):\n  ${a.answer.replace(/\n/g, '\n  ')}`)
      console.log('citations:')
      console.log(citationLines(a.citations).join('\n') || '  (none)')
      console.log('conflicts:')
      for (const c of a.conflicts) console.log(`  [${c.kind}] ${c.source}: ${c.claim} — ${c.note}`)
      if (a.conflicts.length === 0) console.log('  (none)')
      console.log(`trace:   ${a.trace.map((t) => `${t.tool}(${t.inputSummary})`).join(' → ')}`)
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? `${err.name}: ${err.message}` : err}`)
      process.exitCode = 1
    }
  }
}

main()
