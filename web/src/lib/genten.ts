// The Genten agent: answers a question from the Sanity Context knowledge base.
// Server-only: reads SANITY_CONTEXT_TOKEN and ANTHROPIC_API_KEY. Never import it from a
// client component.
import {anthropic} from '@ai-sdk/anthropic'
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import {generateText, Output, stepCountIs} from 'ai'
import {z} from 'zod'
import {todayInTokyo} from './dates'
import {resolveCitations, resolveRef, ruleIdForRef, ruleVersionOn} from './sources'
import type {GentenAnswer, TraceStep} from './types'

const DEFAULT_MCP_URL = 'https://api.sanity.io/v1/context/organizations/o3x6zwz0n/mcp/genten'
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_STEPS = 8
const INITIAL_CONTEXT_TTL_MS = 10 * 60 * 1000

const AgentOutput = z.object({
  answer: z
    .string()
    .describe('The answer in markdown, at most 150 words, in the language of the question.'),
  verdict: z
    .enum(['yes', 'no', 'depends', 'info', 'abstain'])
    .describe(
      'yes/no for a yes-or-no question; depends when it turns on the person\'s situation; info for "how much / when / how" questions; abstain when the knowledge base cannot answer.',
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
      'Every source the answer relies on, exactly as listed under Sources in the entries you read: file names such as "fsa-nisa-know.md", or dataset titles. Official sources first.',
    ),
  conflicts: z
    .array(
      z.object({
        claim: z.string().describe('What the guide claims, briefly.'),
        source: z.string().describe('The guide, exactly as listed under Sources (e.g. "retirejapan-nisa.md").'),
        kind: z.enum(['outdated', 'incorrect', 'same-rule-different-wording']),
        note: z.string().describe('One sentence: what the rule actually is.'),
      }),
    )
    .describe('Claims in English-language guides that conflict with the rule. Empty if none.'),
  abstained: z.boolean().describe('true if the knowledge base does not cover the question.'),
})

const SYSTEM_RULES = `You are Genten (原典). You answer foreign residents' questions about Japanese NISA and furusato nozei rules.

Rules:
1. Answer only from this knowledge base: the outline below and the entries you read with the tools. Use no outside knowledge. If the knowledge base does not cover the question, set abstained to true and verdict to "abstain", and say what is missing.
2. Use the rule version valid on the "as of" date given with the question: validFrom ≤ as-of ≤ validTo, or no end date. State its effective date. If the relevant rule is enacted-future (law, but not in force on the as-of date), say it is law but starts on its start date.
3. Verified Genten rule versions (sources marked "— Dataset") and official Japanese government sources outrank banks, companies, blogs, forums and Wikipedia.
4. If the question has a false or outdated premise, say so first, for example "No — ¥400,000 was the pre-2024 limit."
5. List claims from English-language guides that conflict with the rule, with the source and its kind: outdated (true for an earlier rule version), incorrect (never true), or same-rule-different-wording (the same rule, phrased differently).
6. Reply in the language of the question (Japanese or English). This is information, not financial or tax advice.

How to work: the outline is already below, so do not call initial_context. Read the likely entries with knowledge_base_read (several paths in one call), or find them with knowledge_base_search (exact keywords; try English and Japanese terms). Then answer. Answer the question that was asked; mention another rule only if it changes the answer for this person (for example, one that starts soon). Cite sources exactly as they appear in the entries' Sources lists. Keep the answer under 150 words.`

let initialContextCache: {text: string; loadedAt: number} | undefined

async function connect(): Promise<MCPClient> {
  const token = process.env.SANITY_CONTEXT_TOKEN
  if (!token) throw new Error('SANITY_CONTEXT_TOKEN is not set')
  return createMCPClient({
    transport: {
      type: 'http',
      url: process.env.SANITY_CONTEXT_MCP_URL || DEFAULT_MCP_URL,
      headers: {Authorization: `Bearer ${token}`},
    },
  })
}

/** The text parts of an MCP tool result. */
export function toolText(result: unknown): string {
  const content = (result as {content?: unknown} | null)?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: {type?: string; text?: string}) => (part?.type === 'text' ? (part.text ?? '') : ''))
    .join('\n')
}

/** The knowledge base outline from initial_context, cached for a few minutes. */
async function initialContext(client: MCPClient): Promise<string> {
  if (initialContextCache && Date.now() - initialContextCache.loadedAt < INITIAL_CONTEXT_TTL_MS) {
    return initialContextCache.text
  }
  const result = await client.callTool({name: 'initial_context', arguments: {}})
  const text = toolText(result)
  if (('isError' in result && result.isError) || !text.trim()) {
    throw new Error('initial_context returned no outline')
  }
  initialContextCache = {text, loadedAt: Date.now()}
  return text
}

// A short, readable summary of a tool call's input for the trace (no knowledge base id).
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const parts = Object.entries(input as Record<string, unknown>)
    .filter(([key]) => key !== 'knowledgeBase')
    .map(
    ([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
  )
  const text = parts.join('; ')
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

export async function askGenten({
  question,
  asOf = todayInTokyo(),
}: {
  question: string
  asOf?: string
}): Promise<GentenAnswer> {
  const client = await connect()
  try {
    const outline = await initialContext(client)
    // Tools come from the server; initial_context is already in the system prompt.
    const tools = Object.fromEntries(
      Object.entries(await client.tools()).filter(([name]) => name !== 'initial_context'),
    )

    const result = await generateText({
      model: anthropic(process.env.GENTEN_MODEL || DEFAULT_MODEL),
      system: `${SYSTEM_RULES}\n\n# Knowledge base (from initial_context)\n\n${outline}`,
      prompt: `As of: ${asOf}\n\nQuestion: ${question}`,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      // On the last step, stop calling tools and answer with what was found.
      prepareStep: ({stepNumber}) => (stepNumber >= MAX_STEPS - 1 ? {toolChoice: 'none'} : undefined),
      output: Output.object({schema: AgentOutput}),
      maxOutputTokens: 16000,
      providerOptions: {
        anthropic: {structuredOutputMode: 'outputFormat', effort: 'medium', fallbacks: 'default'},
      },
    })

    const out = result.output
    const trace: TraceStep[] = [
      {tool: 'initial_context', inputSummary: 'outline loaded into the system prompt'},
      ...result.steps.flatMap((step) => {
        const failed = new Set(
          step.content.filter((part) => part.type === 'tool-error').map((part) => part.toolCallId),
        )
        return step.toolCalls.map((call) => ({
          tool: call.toolName,
          inputSummary:
            summarizeInput(call.input) + (failed.has(call.toolCallId) ? ' (failed)' : ''),
        }))
      }),
    ]
    const abstained = out.abstained || out.verdict === 'abstain'
    const ruleId = !abstained && out.ruleRef ? ruleIdForRef(out.ruleRef) : undefined
    const refs = out.ruleRef && !abstained ? [out.ruleRef, ...out.citedRefs] : out.citedRefs

    return {
      answer: out.answer,
      verdict: abstained ? 'abstain' : out.verdict,
      rule: ruleId ? ruleVersionOn(ruleId, asOf) : undefined,
      asOf,
      citations: resolveCitations(refs),
      conflicts: out.conflicts.map((conflict) => {
        const source = resolveRef(conflict.source)
        return {...conflict, sourceTitle: source.title, url: source.url}
      }),
      abstained,
      trace,
    }
  } finally {
    await client.close()
  }
}
