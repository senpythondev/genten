// The 25 held-out evaluation questions. The agent prompt is not tuned on these.
//   amounts: yen values that must all appear in the answer
//   text:    regex (case-insensitive) that must match the answer
//   verdict: allowed verdicts
//   japanese: the answer must be written in Japanese

export type Category = 'current' | 'premise' | 'date' | 'future' | 'leaving' | 'abstain' | 'ja'
export type Verdict = 'yes' | 'no' | 'depends' | 'info' | 'abstain'

export type EvalQuestion = {
  id: number
  category: Category
  question: string
  asOf?: string
  amounts?: number[]
  text?: string
  verdict?: Verdict[]
  abstained?: true
  japanese?: true
}

export const DEFAULT_AS_OF = '2026-10-04'

export const QUESTIONS: EvalQuestion[] = [
  {id: 1, category: 'current', question: 'What is the annual limit of the NISA growth investment quota?', amounts: [2400000]},
  {id: 2, category: 'current', question: 'What is the maximum I can invest in NISA per year in total?', amounts: [3600000]},
  {id: 3, category: 'current', question: 'What is the NISA lifetime limit, and how much of it can the growth quota use?', amounts: [18000000, 12000000]},
  {id: 4, category: 'current', question: 'How long can I keep NISA investments tax-free if I buy them now?', text: 'indefinite|no time limit|unlimited|無期限'},
  {id: 5, category: 'current', question: 'How much of my furusato nozei donations do I pay myself?', amounts: [2000]},
  {id: 6, category: 'premise', question: 'Tsumitate NISA is limited to ¥400,000 a year, right?', verdict: ['no'], amounts: [1200000]},
  {id: 7, category: 'premise', question: 'Is the tsumitate lifetime limit ¥6 million?', verdict: ['no'], amounts: [18000000]},
  {id: 8, category: 'premise', question: 'I need to be 20 to open a NISA account, correct?', verdict: ['no'], text: '\\b18\\b'},
  {id: 9, category: 'premise', question: 'Can I still get Rakuten points for furusato nozei donations?', verdict: ['no'], text: '2025'},
  {id: 10, category: 'premise', question: 'I donated to 2 towns, 6 times in total. Can I still use the one-stop exception?', verdict: ['yes', 'depends'], text: 'municipalit|自治体'},
  {id: 11, category: 'date', asOf: '2022-06-01', question: 'What is the annual limit for tsumitate NISA?', amounts: [400000]},
  {id: 12, category: 'date', asOf: '2015-06-01', question: 'What is the annual limit for general NISA?', amounts: [1000000]},
  {id: 13, category: 'date', asOf: '2010-06-01', question: 'What is the minimum amount I pay myself for furusato nozei donations this year?', amounts: [5000]},
  {id: 14, category: 'date', asOf: '2027-03-01', question: 'Can my 10-year-old open a NISA account?', verdict: ['yes', 'depends'], amounts: [600000]},
  {id: 15, category: 'date', question: 'Can my 10-year-old open a NISA account now?', verdict: ['no'], text: '2027'},
  {id: 16, category: 'future', question: 'From October 2028, what share of donations must municipalities keep for local use?', text: '57\\.5'},
  {id: 17, category: 'future', question: 'Does the ¥1.93 million cap on the furusato special deduction apply to my donations this year?', verdict: ['no'], text: '2027'},
  {id: 18, category: 'future', question: 'What is the furusato special deduction cap for donations made in 2027?', amounts: [1930000], text: '20 ?%|2割'},
  {id: 19, category: 'leaving', question: "I'm moving abroad on my own to study. Can I keep my NISA?", verdict: ['no'], text: 'departure notice|出国届出書|taxable'},
  {id: 20, category: 'leaving', question: 'My employer is transferring me overseas for 4 years. Can I keep buying in my NISA while abroad?', verdict: ['no'], text: 'continuation|継続適用'},
  {id: 21, category: 'leaving', question: 'My company is sending me abroad for 7 years. Will my NISA stay tax-free the whole time?', verdict: ['no', 'depends'], text: '\\b5\\b|five'},
  {id: 22, category: 'abstain', question: 'What is the iDeCo contribution limit for company employees?', abstained: true},
  {id: 23, category: 'abstain', question: 'What is the capital gains tax rate in Singapore?', abstained: true},
  {id: 24, category: 'ja', question: 'ふるさと納税のワンストップ特例は何自治体まで使えますか？', text: '5', japanese: true},
  {id: 25, category: 'ja', question: '成長投資枠の生涯上限はいくらですか？', amounts: [12000000], japanese: true},
]
