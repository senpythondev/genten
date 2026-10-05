# Genten evaluation

Run 2026-10-04T10:26:08.975Z · model `claude-sonnet-5-5` · default as-of 2026-10-04 · raw results: `eval/results/2026-10-05T03-16-04-497Z.json`

Failed calls re-run on 2026-10-05T03:16:04.497Z: genten Q24, genten Q25.

## Setup

- **Questions:** 25 held-out questions in 7 categories (`eval/questions.ts`). The agent prompt was not tuned on them.
- **Prompt changes after seeing results:** none.
- **Configurations.** All three use the same model, output schema, as-of date, answering rules and post-processing (shortening pass, citation mapping). Only rule 1, which says what to answer from, differs:
  - **closed-book:** no retrieval.
  - **keyword-search:** BM25 over `snapshots/files` (57 files, 530 chunks of up to ~1,000 characters). PDFs are read with `pdftotext`; all PDFs were readable, none skipped. The top 6 chunks go into the prompt. Citations are the chunk file names, mapped through `sources.json`.
  - **genten:** `askGenten`, which works over the Sanity Context knowledge base through MCP (verified rule versions plus official sources).
- **Sampling:** temperature 0 is not available. The AI SDK drops it for `claude-sonnet-5-5` ("temperature is not supported … and will be ignored"), so every call uses default sampling and results vary between runs. Each question ran once per configuration.
- **Grader:** deterministic, no LLM judge (`eval/grade.ts`).
  - **CORRECT:** the verdict is allowed (if specified), every yen amount is present after normalization (¥1,200,000, 1.2M, 120万円 and so on), the regex matches, and the abstain flag is right. For `ja` questions the answer must also be mostly Japanese: at least half of its letters are Japanese characters, which is stricter than merely "contains Japanese".
  - **CORRECT+OFFICIAL:** CORRECT, plus a citation of an official government source or a Genten verified rule. Abstain questions have nothing to cite, so for them it equals CORRECT.

## Pass rates

| Category | n | closed-book CORRECT | closed-book CORRECT+OFFICIAL | keyword-search CORRECT | keyword-search CORRECT+OFFICIAL | genten CORRECT | genten CORRECT+OFFICIAL |
|---|---|---|---|---|---|---|---|
| current | 5 | 5/5 (100%) | 0/5 (0%) | 5/5 (100%) | 1/5 (20%) | 5/5 (100%) | 5/5 (100%) |
| premise | 5 | 5/5 (100%) | 0/5 (0%) | 4/5 (80%) | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| date | 5 | 3/5 (60%) | 0/5 (0%) | 1/5 (20%) | 0/5 (0%) | 5/5 (100%) | 5/5 (100%) |
| future | 3 | 0/3 (0%) | 0/3 (0%) | 2/3 (67%) | 0/3 (0%) | 3/3 (100%) | 3/3 (100%) |
| leaving | 3 | 2/3 (67%) | 0/3 (0%) | 2/3 (67%) | 0/3 (0%) | 3/3 (100%) | 3/3 (100%) |
| abstain | 2 | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) |
| ja | 2 | 2/2 (100%) | 0/2 (0%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) |
| **All** | 25 | 19/25 (76%) | 2/25 (8%) | 18/25 (72%) | 5/25 (20%) | 25/25 (100%) | 25/25 (100%) |

## Latency

| Configuration | Average | Median | Slowest | Avg. knowledge-base tool calls |
|---|---|---|---|---|
| closed-book | 3.2s | 3.1s | 7.0s | – |
| keyword-search | 3.4s | 3.1s | 5.1s | – |
| genten | 15.2s | 16.0s | 18.3s | 4.9 |

Wall-clock time per answered question; failed API calls are excluded. The three configurations ran concurrently.

## Tokens per question (average)

| Configuration | Questions measured | Input (incl. cache) | Cache read | Cache write | Output |
|---|---|---|---|---|---|
| genten | 2 of 25 | 39,268 | 18,658 | 3,218 | 944 |

Token usage is recorded only for calls made after token logging and prompt caching were added (2026-10-05). Questions without it are left out of the averages.

## Failures

### closed-book

CORRECT failures (6):

- **Q14** [date, as of 2027-03-01] Can my 10-year-old open a NISA account?
  - Reason: verdict: verdict=no, allowed yes|depends; amounts: missing ¥600,000
  - Answer: "No — not under the rule in force as of 2027-03-01. NISA accounts require the holder to be a Japanese resident aged 18 or older (the account opening age is 18+ …"
- **Q15** [date] Can my 10-year-old open a NISA account now?
  - Reason: text: /2027/i
  - Answer: "No — as of 2026-10-04, NISA accounts are only available to Japanese residents aged 18 or older (the account-opening age is 18 as of January 1 of the opening ye…"
- **Q16** [future] From October 2028, what share of donations must municipalities keep for local use?
  - Reason: abstained: abstained=true, expected false; text: /57\.5/i
  - Answer: "I can't confirm this from my knowledge. As of 2026-10-04, I'm not aware of any enacted rule that requires municipalities to keep a specific share of furusato n…"
- **Q17** [future] Does the ¥1.93 million cap on the furusato special deduction apply to my donations this year?
  - Reason: abstained: abstained=true, expected false; verdict: verdict=abstain, allowed no; text: /2027/i
  - Answer: "I can't confirm a ¥1.93 million cap. I don't know of any fixed yen cap on the furusato nozei special deduction (特例控除額). As far as I know, the limit is tied to …"
- **Q18** [future] What is the furusato special deduction cap for donations made in 2027?
  - Reason: abstained: abstained=true, expected false; amounts: missing ¥1,930,000
  - Answer: "There is no single fixed yen cap for 2027. The furusato nozei deduction limit depends on your income, family structure and other deductions, so it differs for …"
- **Q19** [leaving] I'm moving abroad on my own to study. Can I keep my NISA?
  - Reason: verdict: verdict=depends, allowed no
  - Answer: "Generally, no, not in the usual sense. NISA can only be used by residents of Japan. If you become a non-resident, you must file a notice of departure (出国届出書) w…"

Correct but no official citation (17): Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q20, Q21, Q24, Q25. Closed-book has no sources to cite.

### keyword-search

CORRECT failures (7):

- **Q8** [premise] I need to be 20 to open a NISA account, correct?
  - Reason: abstained: abstained=true, expected false; verdict: verdict=abstain, allowed no; text: /\b18\b/i
  - Answer: "No, not as of 2026-10-04. The excerpts show only an older guide (tyton-nisa-foreigners.md) saying you must be over 20, and it describes the pre-2024 Ordinary/T…"
- **Q12** [date, as of 2015-06-01] What is the annual limit for general NISA?
  - Reason: abstained: abstained=true, expected false; amounts: missing ¥1,000,000
  - Answer: "As of 2015-06-01, I can't confirm the general NISA annual limit from my sources. The excerpts only say that the old General NISA (valid until 2023) had a ¥1.2 …"
- **Q13** [date, as of 2010-06-01] What is the minimum amount I pay myself for furusato nozei donations this year?
  - Reason: abstained: abstained=true, expected false; amounts: missing ¥5,000
  - Answer: "The excerpts say you pay ¥2,000 out of pocket (the self-pay amount), as long as you stay within your donation limit. Donations above your limit are not credite…"
- **Q14** [date, as of 2027-03-01] Can my 10-year-old open a NISA account?
  - Reason: verdict: verdict=no, allowed yes|depends; amounts: missing ¥600,000
  - Answer: "No. A NISA account requires the holder to be 18 or older (as of January 1 of the opening year), so a 10-year-old cannot open one. Eligibility rests on residenc…"
- **Q15** [date] Can my 10-year-old open a NISA account now?
  - Reason: text: /2027/i
  - Answer: "No. A 10-year-old cannot open a NISA account now. The excerpts say the new NISA (from January 2024) requires the holder to be 18 or older (as of January 1) and…"
- **Q16** [future] From October 2028, what share of donations must municipalities keep for local use?
  - Reason: abstained: abstained=true, expected false; text: /57\.5/i
  - Answer: "I can't answer this from the excerpts provided. None of them mention a rule starting in October 2028 or any minimum share of donations that municipalities must…"
- **Q19** [leaving] I'm moving abroad on my own to study. Can I keep my NISA?
  - Reason: abstained: abstained=true, expected false; verdict: verdict=abstain, allowed no
  - Answer: "Generally no. The excerpts contain no official or Genten-dataset rule, only secondary sources, so this is not a verified answer. They say NISA is for Japan res…"

Correct but no official citation (13):

- **Q2** What is the maximum I can invest in NISA per year in total?. Cited: mailmate-new-nisa.md (secondary-institutional), argentum-nisa.md (secondary-institutional), tyton-nisa-english.md (secondary-institutional), tyton-nisa-foreigners.md (secondary-institutional)
- **Q3** What is the NISA lifetime limit, and how much of it can the growth quota use?. Cited: mailmate-new-nisa.md (secondary-institutional), maymoney-nisa-en.md (secondary-independent)
- **Q4** How long can I keep NISA investments tax-free if I buy them now?. Cited: argentum-nisa.md (secondary-institutional), tyton-nisa-foreigners.md (secondary-institutional)
- **Q5** How much of my furusato nozei donations do I pay myself?. Cited: japanlifestart-furusato.md (secondary-independent), mailmate-furusato.md (secondary-institutional), expatjp-furusato.md (secondary-independent)
- **Q6** Tsumitate NISA is limited to ¥400,000 a year, right?. Cited: mailmate-new-nisa.md (secondary-institutional), argentum-nisa.md (secondary-institutional), tyton-nisa-english.md (secondary-institutional), tyton-nisa-foreigners.md (secondary-institutional), retirejapan-forum-tsumitate.md (secondary-independent)
- **Q7** Is the tsumitate lifetime limit ¥6 million?. Cited: maymoney-nisa-en.md (secondary-independent), mailmate-new-nisa.md (secondary-institutional), retirejapan-nisa.md (secondary-independent)
- **Q9** Can I still get Rakuten points for furusato nozei donations?. Cited: mailmate-furusato.md (secondary-institutional), maymoney-furusato-en.md (secondary-independent), ezeirishi-furusato.md (secondary-institutional), japanlifestart-furusato.md (secondary-independent)
- **Q10** I donated to 2 towns, 6 times in total. Can I still use the one-stop exception?. Cited: ezeirishi-furusato.md (secondary-institutional), japanlifestart-furusato.md (secondary-independent), mailmate-furusato.md (secondary-institutional), expatjp-furusato.md (secondary-independent)
- **Q11** What is the annual limit for tsumitate NISA?. Cited: maymoney-nisa-en.md (secondary-independent), retirejapan-forum-tsumitate.md (secondary-independent), mailmate-new-nisa.md (secondary-institutional), retirejapan-nisa.md (secondary-independent)
- **Q17** Does the ¥1.93 million cap on the furusato special deduction apply to my donations this year?. Cited: helloworldjapan-furusato.md (secondary-independent)
- **Q18** What is the furusato special deduction cap for donations made in 2027?. Cited: helloworldjapan-furusato.md (secondary-independent)
- **Q20** My employer is transferring me overseas for 4 years. Can I keep buying in my NISA while abroad?. Cited: maymoney-nisa-en.md (secondary-independent), retirejapan-forum-fsa-guideline.md (secondary-independent)
- **Q21** My company is sending me abroad for 7 years. Will my NISA stay tax-free the whole time?. Cited: maymoney-nisa-en.md (secondary-independent)

### genten

No failures.

