import {z} from 'zod'
import {todayInTokyo} from '@/lib/dates'
import {askGenten} from '@/lib/genten'

export const maxDuration = 60

const RATE_LIMIT = 10
const RATE_WINDOW_MS = 10 * 60 * 1000

const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const AskRequest = z.object({
  question: z.string().trim().min(1, 'Please enter a question.').max(500, 'Questions can be at most 500 characters.'),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be a date (YYYY-MM-DD).')
    .refine(isRealDate, 'asOf must be a real date.')
    .optional(),
})

// In-memory, per server instance: enough to protect API credits for a demo.
const recentRequests = new Map<string, number[]>()

function rateLimited(ip: string): number | null {
  const now = Date.now()
  const recent = (recentRequests.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    recentRequests.set(ip, recent)
    return Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000)
  }
  recentRequests.set(ip, [...recent, now])
  return null
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || 'unknown'
}

const error = (message: string, status: number, headers?: HeadersInit) =>
  Response.json({error: message}, {status, headers})

export async function POST(request: Request) {
  if (process.env.GENTEN_DISABLED === 'true') {
    return error('Genten is paused right now. Please try again later.', 503)
  }

  const retryAfter = rateLimited(clientIp(request))
  if (retryAfter !== null) {
    return error('Too many questions. Please wait a few minutes.', 429, {'Retry-After': String(retryAfter)})
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return error('Send JSON: {"question": "...", "asOf": "YYYY-MM-DD"}.', 400)
  }
  const parsed = AskRequest.safeParse(body)
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid request.', 400)

  try {
    const answer = await askGenten({question: parsed.data.question, asOf: parsed.data.asOf ?? todayInTokyo()})
    return Response.json(answer)
  } catch (err) {
    console.error('askGenten failed:', err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : 'unknown error')
    return error('Genten could not answer right now. Please try again.', 502)
  }
}
