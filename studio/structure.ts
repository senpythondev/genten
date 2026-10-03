import type {StructureBuilder, StructureResolver} from 'sanity/structure'
import {ArchiveIcon} from '@sanity/icons/Archive'
import {CalendarIcon} from '@sanity/icons/Calendar'
import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'
import {EditIcon} from '@sanity/icons/Edit'
import {LinkIcon} from '@sanity/icons/Link'
import {TagIcon} from '@sanity/icons/Tag'

// Document lists run under the Studio's selected perspective (default: drafts), which
// rewrites _id to the published id and keeps the stored id in _originalId.
// coalesce() gives the stored id under any perspective, including raw.
const STORED_ID = 'coalesce(_originalId, _id)'
const IS_DRAFT = `${STORED_ID} in path("drafts.**")`
const IS_PUBLISHED = `!(${STORED_ID} in path("drafts.**")) && !(${STORED_ID} in path("versions.**"))`

const BY_RULE = [
  {field: 'ruleKey', direction: 'asc' as const},
  {field: 'validFrom', direction: 'asc' as const},
]

const AUTHORITIES = [
  {title: 'Primary (official)', value: 'primary'},
  {title: 'Secondary, institutional', value: 'secondary-institutional'},
  {title: 'Secondary, independent', value: 'secondary-independent'},
]

function ruleList(S: StructureBuilder, id: string, title: string, filter: string, icon: typeof EditIcon) {
  return S.listItem()
    .id(id)
    .title(title)
    .icon(icon)
    .child(
      S.documentList()
        .title(title)
        .schemaType('ruleVersion')
        .filter(`_type == "ruleVersion" && ${filter}`)
        .defaultOrdering(BY_RULE),
    )
}

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Genten')
    .items([
      ruleList(S, 'needs-review', 'Needs review', IS_DRAFT, EditIcon),
      ruleList(S, 'in-force', 'In force', `status == "in-force" && ${IS_PUBLISHED}`, CheckmarkIcon),
      ruleList(
        S,
        'future',
        'Future',
        `status in ["enacted-future", "outline-only"] && ${IS_PUBLISHED}`,
        CalendarIcon,
      ),
      ruleList(S, 'superseded', 'Superseded', `status == "superseded" && ${IS_PUBLISHED}`, ArchiveIcon),
      S.documentTypeListItem('ruleVersion').title('All rule versions').icon(DocumentTextIcon),
      S.divider(),
      S.listItem()
        .id('sources')
        .title('Sources')
        .icon(LinkIcon)
        .child(
          S.list()
            .title('Sources')
            .items([
              S.documentTypeListItem('source').title('All sources'),
              S.divider(),
              ...AUTHORITIES.map(({title, value}) =>
                S.listItem()
                  .id(`sources-${value}`)
                  .title(title)
                  .child(
                    S.documentList()
                      .title(title)
                      .schemaType('source')
                      .filter('_type == "source" && authority == $authority')
                      .params({authority: value}),
                  ),
              ),
            ]),
        ),
      S.documentTypeListItem('topic').title('Topics').icon(TagIcon),
    ])
