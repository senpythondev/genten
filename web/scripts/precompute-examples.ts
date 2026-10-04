/**
 * Regenerates recorded example answers live: runs askGenten on the example questions
 * and writes src/data/example-answers.json with the full output of each.
 * Calls the model (uses API credits).
 *
 * Run from web/: npx tsx scripts/precompute-examples.ts [--as-of YYYY-MM-DD]
 */
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {modelId} from '../src/lib/answer'
import {todayInTokyo} from '../src/lib/dates'
import {askGenten} from '../src/lib/genten'
import type {GentenAnswer} from '../src/lib/types'

process.loadEnvFile('.env.local')

// The six example questions, taken from the evaluation set (eval/questions.ts ids in comments).
const QUESTIONS = [
  'Is the tsumitate lifetime limit ¥6 million?', // Q7
  'Tsumitate NISA is limited to ¥400,000 a year, right?', // Q6
  'Can my 10-year-old open a NISA account now?', // Q15
  'Can I still get Rakuten points for furusato nozei donations?', // Q9
  'My employer is transferring me overseas for 4 years. Can I keep buying in my NISA while abroad?', // Q20
  'Does the ¥1.93 million cap on the furusato special deduction apply to my donations this year?', // Q17
]

const OUT = path.resolve(__dirname, '../src/data/example-answers.json')

async function main() {
  const i = process.argv.indexOf('--as-of')
  const asOf = i >= 0 ? process.argv[i + 1] : todayInTokyo()
  const answers: {question: string; answer: GentenAnswer}[] = []
  for (const question of QUESTIONS) {
    const started = Date.now()
    const answer = await askGenten({question, asOf})
    answers.push({question, answer})
    console.log(`${answer.verdict.padEnd(8)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${question}`)
  }
  const data = {generatedAt: new Date().toISOString(), model: modelId(), asOf, answers}
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${answers.length} answers, as of ${asOf}).`)
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exit(1)
})
