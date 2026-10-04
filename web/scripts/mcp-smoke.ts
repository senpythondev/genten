/**
 * Smoke test for the Sanity Context MCP endpoint (Knowledge Base mode):
 * connect, list the tools the server offers, call initial_context.
 *
 * Run from web/: npx tsx scripts/mcp-smoke.ts
 */
import {createMCPClient} from '@ai-sdk/mcp'
import {toolText} from '../src/lib/genten'

process.loadEnvFile('.env.local')

const MCP_URL =
  process.env.SANITY_CONTEXT_MCP_URL ??
  'https://api.sanity.io/v1/context/organizations/o3x6zwz0n/mcp/genten'

async function main() {
  const token = process.env.SANITY_CONTEXT_TOKEN
  if (!token) throw new Error('SANITY_CONTEXT_TOKEN is not set in .env.local')

  const client = await createMCPClient({
    transport: {type: 'http', url: MCP_URL, headers: {Authorization: `Bearer ${token}`}},
  })
  try {
    console.log('Server:', JSON.stringify(client.serverInfo))
    if (client.instructions) console.log('Instructions:', client.instructions)

    const {tools} = await client.listTools()
    console.log(`\nTools (${tools.length}):`)
    for (const tool of tools) {
      console.log(`- ${tool.name}: ${tool.description ?? ''}`)
      console.log(`  input schema: ${JSON.stringify(tool.inputSchema)}`)
    }

    const result = await client.callTool({name: 'initial_context', arguments: {}})
    const text = toolText(result)
    const isError = 'isError' in result && result.isError
    console.log(`\ninitial_context (${text.length} chars, isError=${isError ?? false}):`)
    console.log(text.length > 4000 ? `${text.slice(0, 4000)}\n... [truncated]` : text)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('MCP smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
