import {defineArrayMember, defineField, defineType} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'

type EvidenceItem = {source?: {_ref?: string}}

// Local calendar date as YYYY-MM-DD, comparable with Sanity `date` values.
function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Validity period for previews, e.g. "2018-01-01–2023-12-31", "2024-01-01–now",
// or "from 2027-01-01 (not yet in force)" for a rule that has not started.
// Missing dates show as "start unknown" / "end unknown" (superseded rules only).
function validity(validFrom?: string, validTo?: string, status?: string): string {
  if (validFrom && validFrom > today()) {
    return validTo
      ? `${validFrom}–${validTo} (not yet in force)`
      : `from ${validFrom} (not yet in force)`
  }
  const end = validTo ?? (status === 'superseded' ? 'end unknown' : 'now')
  return `${validFrom ?? 'start unknown'}–${end}`
}

export const ruleVersion = defineType({
  name: 'ruleVersion',
  title: 'Rule version',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({
      name: 'checkFirst',
      type: 'text',
      rows: 3,
      readOnly: true,
      description: 'What the reviewer must confirm before publishing.',
    }),
    defineField({
      name: 'ruleKey',
      type: 'string',
      description: 'Dotted key shared by all versions of a rule, e.g. nisa.tsumitate.annualLimit',
      validation: (rule) =>
        rule
          .required()
          .regex(/^[a-z]+(\.[a-zA-Z0-9]+)+$/, {name: 'dotted key (area.part.part)'}),
    }),
    defineField({
      name: 'topic',
      type: 'reference',
      to: [{type: 'topic'}],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'statementEn',
      title: 'Statement (English)',
      type: 'text',
      rows: 4,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'statementJa',
      title: 'Statement (Japanese)',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'value',
      type: 'object',
      fields: [
        defineField({name: 'amount', type: 'number'}),
        defineField({
          name: 'unit',
          type: 'string',
          options: {list: ['JPY', 'JPY/year', 'years', 'percent', 'count', 'none']},
        }),
        defineField({name: 'qualifier', type: 'string'}),
      ],
    }),
    defineField({
      name: 'appliesTo',
      type: 'string',
    }),
    defineField({
      name: 'validFrom',
      type: 'date',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'validTo',
      type: 'date',
      validation: (rule) =>
        rule.custom<string>((validTo, context) => {
          const validFrom = context.document?.validFrom
          if (validTo && typeof validFrom === 'string' && validTo <= validFrom) {
            return 'validTo must be after validFrom.'
          }
          return true
        }),
    }),
    defineField({
      name: 'status',
      type: 'string',
      options: {
        list: [
          {title: 'In force', value: 'in-force'},
          {title: 'Superseded', value: 'superseded'},
          {title: 'Enacted, future', value: 'enacted-future'},
          {title: 'Outline only', value: 'outline-only'},
        ],
        layout: 'radio',
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'supersedes',
      type: 'reference',
      to: [{type: 'ruleVersion'}],
      // Weak: seeded versions start as drafts, so the target may not be published yet.
      weak: true,
    }),
    defineField({
      name: 'evidence',
      type: 'array',
      of: [
        defineArrayMember({
          name: 'evidenceItem',
          title: 'Evidence',
          type: 'object',
          fields: [
            defineField({
              name: 'source',
              type: 'reference',
              to: [{type: 'source'}],
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: 'locator',
              type: 'string',
              description: 'Section heading, page or paragraph in the source.',
            }),
            defineField({name: 'note', type: 'text', rows: 2}),
          ],
          preview: {select: {title: 'source.title', subtitle: 'locator'}},
        }),
      ],
      validation: (rule) => [
        rule.required().min(1),
        rule
          .custom<EvidenceItem[]>(async (evidence, context) => {
            const ids = (evidence ?? []).map((item) => item.source?._ref).filter(Boolean)
            if (ids.length === 0) return true
            // Raw perspective: _id keeps the drafts. prefix, so published and draft-only
            // sources can be told apart.
            const client = context
              .getClient({apiVersion: '2025-02-19'})
              .withConfig({perspective: 'raw'})
            const primary = await client.fetch<{published: number; draftOnly: number}>(
              `{
                "published": count(*[_type == "source" && authority == "primary" && _id in $ids]),
                "draftOnly": count(*[_type == "source" && authority == "primary" && _id in $draftIds])
              }`,
              {ids, draftIds: ids.map((id) => `drafts.${id}`)},
            )
            if (primary.published > 0) return true
            return primary.draftOnly > 0
              ? 'The primary source is not published yet. Publish it before this rule.'
              : 'No evidence points to a primary (official) source.'
          })
          .warning(),
      ],
    }),
    defineField({
      name: 'verification',
      type: 'object',
      fields: [
        defineField({
          name: 'method',
          type: 'string',
          options: {
            list: [
              {title: 'Checked Japanese original', value: 'checked-japanese-original'},
              {title: 'Checked official English', value: 'checked-english-official'},
              {title: 'Secondary sources only', value: 'secondary-only'},
            ],
            layout: 'radio',
          },
        }),
        defineField({name: 'verifiedBy', type: 'string'}),
        defineField({name: 'verifiedAt', type: 'date'}),
      ],
    }),
  ],
  validation: (rule) => [
    rule
      .custom((doc) =>
        doc?.status === 'superseded' && !doc.validTo
          ? 'A superseded rule needs a validTo date.'
          : true,
      )
      .warning(),
    rule
      .custom((doc) =>
        doc?.status === 'enacted-future' &&
        typeof doc.validFrom === 'string' &&
        doc.validFrom <= today()
          ? 'An enacted-future rule needs a validFrom after today.'
          : true,
      )
      .warning(),
  ],
  preview: {
    select: {
      title: 'title',
      ruleKey: 'ruleKey',
      status: 'status',
      validFrom: 'validFrom',
      validTo: 'validTo',
    },
    prepare: ({title, ruleKey, status, validFrom, validTo}) => ({
      title,
      subtitle: `${ruleKey} · ${status} · ${validity(validFrom, validTo, status)}`,
    }),
  },
})
