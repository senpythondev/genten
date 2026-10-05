/**
 * Regenerates recorded example answers live: runs askGenten on the example questions in
 * src/lib/examples.ts and writes src/data/example-answers.json with the full output of each.
 * Calls the model (uses API credits).
 *
 * Run from web/: npm run precompute-examples [-- --as-of YYYY-MM-DD]
 */
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {modelId} from '../src/lib/answer'
import {todayInTokyo} from '../src/lib/dates'
import {EXAMPLE_QUESTIONS} from '../src/lib/examples'
import {askGenten} from '../src/lib/genten'
import type {GentenAnswer} from '../src/lib/types'

process.loadEnvFile('.env.local')

const OUT = path.resolve(__dirname, '../src/data/example-answers.json')

async function main() {
  const i = process.argv.indexOf('--as-of')
  const asOf = i >= 0 ? process.argv[i + 1] : todayInTokyo()
  const answers: {question: string; answer: GentenAnswer}[] = []
  for (const question of EXAMPLE_QUESTIONS) {
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
