import {defineField, defineType} from 'sanity'
import {TagIcon} from '@sanity/icons/Tag'

export const topic = defineType({
  name: 'topic',
  title: 'Topic',
  type: 'document',
  icon: TagIcon,
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'title'},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'area',
      type: 'string',
      options: {
        list: [
          {title: 'NISA', value: 'nisa'},
          {title: 'Furusato nozei', value: 'furusato-nozei'},
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'summary',
      type: 'text',
      rows: 3,
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'area'},
  },
})
