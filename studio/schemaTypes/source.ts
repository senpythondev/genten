import {defineArrayMember, defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const source = defineType({
  name: 'source',
  title: 'Source',
  type: 'document',
  icon: LinkIcon,
  fieldsets: [
    {
      name: 'curation',
      title: 'Curation (internal)',
      description: 'Evaluation answer key. Never sent to the Knowledge Base.',
    },
  ],
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'url',
      title: 'URL',
      type: 'url',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'publisher',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'publisherType',
      type: 'string',
      options: {
        list: [
          {title: 'Government', value: 'government'},
          {title: 'Financial institution', value: 'financial-institution'},
          {title: 'Company', value: 'company'},
          {title: 'Media', value: 'media'},
          {title: 'Blog', value: 'blog'},
          {title: 'Forum', value: 'forum'},
          {title: 'Wiki', value: 'wiki'},
        ],
      },
    }),
    defineField({
      name: 'authority',
      type: 'string',
      options: {
        list: [
          {title: 'Primary (official)', value: 'primary'},
          {title: 'Secondary, institutional', value: 'secondary-institutional'},
          {title: 'Secondary, independent', value: 'secondary-independent'},
        ],
        layout: 'radio',
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'language',
      type: 'string',
      options: {
        list: [
          {title: 'Japanese', value: 'ja'},
          {title: 'English', value: 'en'},
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'topics',
      type: 'array',
      of: [defineArrayMember({type: 'reference', to: [{type: 'topic'}]})],
    }),
    defineField({
      name: 'publishedAt',
      type: 'date',
    }),
    defineField({
      name: 'capturedAt',
      type: 'datetime',
      readOnly: true,
    }),
    defineField({
      name: 'snapshotSha256',
      title: 'Snapshot SHA-256',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'role',
      type: 'string',
      fieldset: 'curation',
      options: {
        list: [
          'official-current',
          'official-history',
          'official-future',
          'official-english',
          'official-english-dated',
          'institution-current',
          'institution-dated',
          'secondary-current',
          'secondary-dated',
          'secondary-mixed',
          'secondary-outdated',
          'secondary-incorrect',
        ],
      },
    }),
    defineField({
      name: 'curationNote',
      type: 'text',
      rows: 4,
      fieldset: 'curation',
    }),
  ],
  preview: {
    select: {title: 'title', authority: 'authority', language: 'language', publisher: 'publisher'},
    prepare: ({title, authority, language, publisher}) => ({
      title,
      subtitle: [authority, language, publisher].filter(Boolean).join(' · '),
    }),
  },
})
