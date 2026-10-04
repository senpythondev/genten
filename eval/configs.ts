// The three evaluated configurations. All use the same model, output schema, answering
// rules (rule 1 differs: what to answer from), post-processing and as-of date.
import {answeringRules, finalizeAnswer, generateAnswer} from '../web/src/lib/answer'
import {askGenten} from '../web/src/lib/genten'
import type {GentenAnswer} from '../web/src/lib/types'
import type {KeywordIndex} from './keyword'

export type ConfigName = 'closed-book' | 'keyword-search' | 'genten'
export const CONFIGS: ConfigName[] = ['closed-book', 'keyword-search', 'genten']
export const TOP_K = 6

export type RunOutput = {answer: GentenAnswer; retrieved?: string[]}

const CLOSED_BOOK_SYSTEM = answeringRules(
  'Answer from your own knowledge; you have no documents or tools, so leave citedRefs empty. Genten covers only Japanese NISA and furusato nozei: if the question is outside that scope or you do not know the answer, set abstained to true and verdict to "abstain", and say what is missing.',
)

const KEYWORD_SYSTEM = answeringRules(
  'Answer only from the excerpts given with the question. Use no outside knowledge. If they do not cover the question, set abstained to true and verdict to "abstain", and say what is missing. Cite excerpts by their file names (for example "fsa-nisa-know.md").',
)

const userPrompt = (question: string, asOf: string) => `As of: ${asOf}\n\nQuestion: ${question}`

export async function runConfig(
  config: ConfigName,
  question: string,
  asOf: string,
  index: KeywordIndex,
): Promise<RunOutput> {
  if (config === 'genten') return {answer: await askGenten({question, asOf})}

  if (config === 'closed-book') {
    const {output, trace} = await generateAnswer({system: CLOSED_BOOK_SYSTEM, prompt: userPrompt(question, asOf)})
    return {answer: await finalizeAnswer(output, asOf, trace)}
  }

  const chunks = index.search(question, TOP_K)
  const excerpts = chunks.map((c) => `[${c.file}]\n${c.text}`).join('\n\n---\n\n')
  const {output, trace} = await generateAnswer({
    system: KEYWORD_SYSTEM,
    prompt: `${userPrompt(question, asOf)}\n\nExcerpts (top ${TOP_K} by keyword search):\n\n${excerpts || '(none found)'}`,
  })
  return {
    answer: await finalizeAnswer(output, asOf, [{tool: 'bm25', inputSummary: chunks.map((c) => c.id).join(', ')}, ...trace]),
    retrieved: chunks.map((c) => c.id),
  }
}
