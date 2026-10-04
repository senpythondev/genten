// Shared by the Genten agent and the evaluation baselines: the model, the output
// schema, the answering rules and the post-processing. Server-only.
import {anthropic} from '@ai-sdk/anthropic'
import {
  APICallError,
  generateText,
  Output,
  RetryError,
  stepCountIs,
  type LanguageModelUsage,
  type ToolSet,
} from 'ai'
import {z} from 'zod'
import {resolveCitations, resolveRef, ruleIdForRef, ruleVersionOn} from './sources'
import type {GentenAnswer, TokenUsage, TraceStep} from './types'

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const TARGET_WORDS = 120
const MAX_WORDS = 150

export const modelId = () => process.env.GENTEN_MODEL || DEFAULT_MODEL

// Anthropic prompt caching: a breakpoint after the tool definitions and one after the
// system prompt (requests render tools, then system, then messages).
const CACHE = {anthropic: {cacheControl: {type: 'ephemeral' as const}}}

function withCachedTools(tools?: ToolSet): ToolSet | undefined {
  const names = Object.keys(tools ?? {})
  if (!tools || names.length === 0) return tools
  const last = names[names.length - 1]
  return {...tools, [last]: {...tools[last], providerOptions: {...tools[last].providerOptions, ...CACHE}}}
}

const cachedInstructions = (system: string) => ({role: 'system' as const, content: system, providerOptions: CACHE})

const toUsage = (u: LanguageModelUsage): TokenUsage => ({
  input: u.inputTokens ?? 0,
  cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0,
  cacheWrite: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  output: u.outputTokens ?? 0,
})

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
})

/** True if an error came from the Anthropic API (credit, auth, rate limit, outage). */
export function isModelApiError(err: unknown): boolean {
  const cause = RetryError.isInstance(err) ? err.lastError : err
  return APICallError.isInstance(cause) && cause.url.includes('anthropic.com')
}

const providerOptions = (structured: boolean) => ({
  anthropic: {
    ...(structured ? {structuredOutputMode: 'outputFormat' as const} : {}),
    effort: 'medium' as const,
    fallbacks: 'default' as const,
  },
})

export const AgentOutput = z.object({
  answer: z
    .string()
    .describe(`The answer in markdown, at most ${TARGET_WORDS} words, in the language of the question.`),
  verdict: z
    .enum(['yes', 'no', 'depends', 'info', 'abstain'])
    .describe(
      'yes/no for a yes-or-no question; depends when it turns on the person\'s situation; info for "how much / when / how" questions; abstain when you cannot answer from your sources.',
    ),
  ruleRef: z
    .string()
    .nullable()
    .describe(
      'The Genten rule version the answer rests on, exactly as it appears in a Sources list (a "— Dataset" title, without the suffix). null if none.',
    ),
  citedRefs: z
    .array(z.string())
    .describe(
      'Every source the answer relies on, exactly as named in your sources: file names such as "fsa-nisa-know.md", or dataset titles. Official sources first.',
    ),
  conflicts: z
    .array(
      z.object({
        claim: z.string().describe('What the guide claims, briefly.'),
        source: z.string().describe('The guide\'s file name from the Sources list (e.g. "retirejapan-nisa.md").'),
        kind: z.enum(['outdated', 'incorrect', 'same-rule-different-wording']),
        note: z.string().describe('One sentence: what the rule actually is.'),
      }),
    )
    .describe('English-language guides named as stating something that conflicts with the rule. Empty if none.'),
  abstained: z.boolean().describe('true if your sources do not cover the question.'),
})

export type AgentOutputValue = z.infer<typeof AgentOutput>

/** The answering rules. `sourcesRule` says what the model may answer from (rule 1). */
export const answeringRules = (sourcesRule: string) => `You are Genten (原典). You answer foreign residents' questions about Japanese NISA and furusato nozei rules.

Rules:
1. ${sourcesRule}
2. Use the rule version valid on the "as of" date given with the question: validFrom ≤ as-of ≤ validTo, or no end date. State its effective date. If the relevant rule is enacted-future (law, but not in force on the as-of date), say it is law but starts on its start date.
3. Verified Genten rule versions (sources marked "— Dataset") and official Japanese government sources outrank banks, companies, blogs, forums and Wikipedia.
4. If the question has a false or outdated premise, say so first, for example "No — ¥400,000 was the pre-2024 limit."
5. List English-language guides that your sources name as stating something that conflicts with the rule, each with its file name and kind: outdated (true for an earlier rule version), incorrect (never true), or same-rule-different-wording (the same rule, phrased differently).
6. Reply in the language of the question (Japanese or English). This is information, not financial or tax advice.

Answer the question that was asked; mention another rule only if it changes the answer for this person (for example, one that starts soon). Keep the answer to ${TARGET_WORDS} words or fewer.`

/** Words in a text; Intl.Segmenter also splits Japanese, which has no spaces. */
export function countWords(text: string): number {
  let words = 0
  for (const segment of new Intl.Segmenter(undefined, {granularity: 'word'}).segment(text)) {
    if (segment.isWordLike) words++
  }
  return words
}

/** One model call (with tools, if given) that returns the structured answer. */
export async function generateAnswer({
  system,
  prompt,
  tools,
  maxToolSteps = 0,
}: {
  system: string
  prompt: string
  tools?: ToolSet
  maxToolSteps?: number
}) {
  const result = await generateText({
    model: anthropic(modelId()),
    instructions: cachedInstructions(system),
    prompt,
    tools: withCachedTools(tools),
    stopWhen: stepCountIs(maxToolSteps + 1),
    // After the tool budget is spent, answer with what was found.
    prepareStep: ({stepNumber}) => (stepNumber >= maxToolSteps ? {toolChoice: 'none' as const} : undefined),
    output: Output.object({schema: AgentOutput}),
    maxOutputTokens: 16000,
    providerOptions: providerOptions(true),
  })
  const trace: TraceStep[] = result.steps.flatMap((step) => {
    const failed = new Set(step.content.filter((part) => part.type === 'tool-error').map((part) => part.toolCallId))
    return step.toolCalls.map((call) => ({
      tool: call.toolName,
      inputSummary: summarizeInput(call.input) + (failed.has(call.toolCallId) ? ' (failed)' : ''),
    }))
  })
  return {output: result.output, trace, usage: toUsage(result.totalUsage)}
}

// A short, readable summary of a tool call's input for the trace (no knowledge base id).
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const text = Object.entries(input as Record<string, unknown>)
    .filter(([key]) => key !== 'knowledgeBase')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('; ')
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** If an answer is over MAX_WORDS, one shortening pass with the same model and no tools. */
export async function shortenIfLong(
  answer: string,
): Promise<{answer: string; shortened: boolean; usage?: TokenUsage}> {
  if (countWords(answer) <= MAX_WORDS) return {answer, shortened: false}
  const result = await generateText({
    model: anthropic(modelId()),
    instructions:
      'You shorten answers. Keep the language, the opening verdict, and every figure, date and source name. Return only the shortened markdown.',
    prompt: `Shorten this answer to at most ${TARGET_WORDS} words:\n\n${answer}`,
    maxOutputTokens: 4000,
    providerOptions: providerOptions(false),
  })
  const shorter = result.text.trim()
  const usage = toUsage(result.totalUsage)
  return shorter && countWords(shorter) < countWords(answer)
    ? {answer: shorter, shortened: true, usage}
    : {answer, shortened: false, usage}
}

/** Turn the model's output into the GentenAnswer returned to callers. */
export async function finalizeAnswer(
  out: AgentOutputValue,
  asOf: string,
  trace: TraceStep[],
  usage: TokenUsage,
): Promise<GentenAnswer> {
  const abstained = out.abstained || out.verdict === 'abstain'
  const ruleId = !abstained && out.ruleRef ? ruleIdForRef(out.ruleRef) : undefined
  const refs = out.ruleRef && !abstained ? [out.ruleRef, ...out.citedRefs] : out.citedRefs
  const {answer, shortened, usage: shortenUsage} = await shortenIfLong(out.answer)
  return {
    usage: shortenUsage ? addUsage(usage, shortenUsage) : usage,
    answer,
    verdict: abstained ? 'abstain' : out.verdict,
    rule: ruleId ? ruleVersionOn(ruleId, asOf) : undefined,
    asOf,
    citations: resolveCitations(refs),
    conflicts: out.conflicts.map((conflict) => {
      const source = resolveRef(conflict.source)
      return {...conflict, sourceTitle: source.title, url: source.url}
    }),
    abstained,
    trace: shortened ? [...trace, {tool: 'shorten', inputSummary: `answer over ${MAX_WORDS} words`}] : trace,
  }
}
