// Deterministic grader: no LLM judge.
import type {GentenAnswer} from '../web/src/lib/types'
import type {EvalQuestion} from './questions'

export type Check = {name: string; pass: boolean; detail: string}
export type Grade = {correct: boolean; correctOfficial: boolean; checks: Check[]}

const MULTIPLIERS: Record<string, number> = {million: 1e6, mn: 1e6, m: 1e6, 万: 1e4, 億: 1e8, 千: 1e3}

/**
 * Yen amounts in a text, as numbers. Accepts ¥1,200,000 / 1,200,000 yen / 1,200,000円 /
 * ¥1.2 million / 1.2M / 120万円 / 1,800万円 / 1億円. A bare number counts only with a
 * yen marker (¥, 円, yen, JPY) or a magnitude word (million, M, 万, 億), so ages,
 * years and percentages are ignored.
 */
export function yenAmounts(text: string): number[] {
  const normalized = text.normalize('NFKC') // full-width digits and ￥ become ASCII
  const pattern =
    /(¥|JPY\s?)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(million|mn|m(?![a-z])|万|億|千)?\s?(円|yen|JPY)?/gi
  const amounts: number[] = []
  for (const match of normalized.matchAll(pattern)) {
    const [, prefix, number, unit, suffix] = match
    if (!prefix && !unit && !suffix) continue
    const value = Number(number.replace(/,/g, '')) * (unit ? MULTIPLIERS[unit.toLowerCase()] : 1)
    if (Number.isFinite(value)) amounts.push(Math.round(value))
  }
  return amounts
}

const JAPANESE = /[぀-ヿ㐀-鿿]/g
const LATIN = /[a-z]/gi

/** Mostly Japanese: Japanese characters are at least half of all letters. */
export function isMostlyJapanese(text: string): boolean {
  const ja = text.match(JAPANESE)?.length ?? 0
  const latin = text.match(LATIN)?.length ?? 0
  return ja > 0 && ja >= latin
}

export function grade(q: EvalQuestion, a: GentenAnswer): Grade {
  const checks: Check[] = []
  const shouldAbstain = q.category === 'abstain'
  checks.push({
    name: 'abstained',
    pass: a.abstained === shouldAbstain,
    detail: `abstained=${a.abstained}, expected ${shouldAbstain}`,
  })
  if (q.verdict) {
    checks.push({
      name: 'verdict',
      pass: q.verdict.includes(a.verdict),
      detail: `verdict=${a.verdict}, allowed ${q.verdict.join('|')}`,
    })
  }
  if (q.amounts) {
    const found = yenAmounts(a.answer)
    const missing = q.amounts.filter((amount) => !found.includes(amount))
    checks.push({
      name: 'amounts',
      pass: missing.length === 0,
      detail: missing.length
        ? `missing ${missing.map((m) => `¥${m.toLocaleString('en-US')}`).join(', ')}`
        : 'all present',
    })
  }
  if (q.text) {
    checks.push({
      name: 'text',
      pass: new RegExp(q.text, 'i').test(a.answer),
      detail: `/${q.text}/i`,
    })
  }
  if (q.japanese) {
    checks.push({name: 'japanese', pass: isMostlyJapanese(a.answer), detail: 'answer mostly in Japanese'})
  }

  const correct = checks.every((check) => check.pass)
  // Abstain questions have nothing to cite: for them CORRECT+OFFICIAL equals CORRECT.
  const official =
    shouldAbstain || a.citations.some((c) => c.authority === 'primary' || c.authority === 'verified')
  if (!shouldAbstain) {
    checks.push({
      name: 'official',
      pass: official,
      detail: official ? 'cites an official source or verified rule' : 'no official source or verified rule cited',
    })
  }
  return {correct, correctOfficial: correct && official, checks}
}
