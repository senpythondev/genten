// The Genten agent: answers a question from the Sanity Context knowledge base.
// Server-only: reads SANITY_CONTEXT_TOKEN and ANTHROPIC_API_KEY. Never import it from a
// client component.
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import {answeringRules, finalizeAnswer, generateAnswer} from './answer'
import {todayInTokyo} from './dates'
import type {GentenAnswer} from './types'

const DEFAULT_MCP_URL = 'https://api.sanity.io/v1/context/organizations/o3x6zwz0n/mcp/genten'
const MAX_TOOL_STEPS = 5
const INITIAL_CONTEXT_TTL_MS = 10 * 60 * 1000

const SYSTEM = `${answeringRules(
  'Answer only from this knowledge base: the outline below and the entries you read with the tools. Use no outside knowledge. If the knowledge base does not cover the question, set abstained to true and verdict to "abstain", and say what is missing.',
)}

How to work (the outline is below, so do not call initial_context):
1. In your first step, read every entry the outline points to for this question in ONE knowledge_base_read call. If the question itself states a figure or claim (for example "¥6 million", "age 20", "Rakuten points"), make one knowledge_base_search for that figure or claim in the same step, to find entries that name English-language guides stating it.
2. Then answer. Call more tools only if what you read does not answer the question, or the outline points to no entry; never search for source titles or for guides when the question states no figure or claim. The hard limit is ${MAX_TOOL_STEPS} tool steps.
List each English-language guide that an entry names as stating a conflicting figure or claim, using its file name from that entry's Sources list. Cite sources exactly as they appear in the Sources lists, and set ruleRef to the "— Dataset" title of the rule you used.`

let initialContextCache: {text: string; loadedAt: number} | undefined

/** The text parts of an MCP tool result. */
export function toolText(result: unknown): string {
  const content = (result as {content?: unknown} | null)?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: {type?: string; text?: string}) => (part?.type === 'text' ? (part.text ?? '') : ''))
    .join('\n')
}

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
    const {output, trace, usage} = await generateAnswer({
      system: `${SYSTEM}\n\n# Knowledge base (from initial_context)\n\n${outline}`,
      prompt: `As of: ${asOf}\n\nQuestion: ${question}`,
      tools,
      maxToolSteps: MAX_TOOL_STEPS,
    })
    return finalizeAnswer(
      output,
      asOf,
      [{tool: 'initial_context', inputSummary: 'outline loaded into the system prompt'}, ...trace],
      usage,
    )
  } finally {
    await client.close()
  }
}
