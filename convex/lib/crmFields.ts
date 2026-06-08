import { labelToKey } from './formFields'

// Shared CRM field registry. Single source of truth for which schema fields
// each CRM collection exposes, their human labels, and the header aliases used
// to auto-suggest a mapping in the import dialog. The frontend builds the
// column-mapping UI from this; the backend `insert*` mutations read the
// canonical `key`s directly (no more `??` alias-guessing chains).

export type CrmCollection =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

export interface CrmFieldDef {
  /** Canonical schema field name the value is written to. */
  key: string
  /** Human label shown in the mapping dropdown. */
  label: string
  /**
   * Header variants (English + Spanish, accents allowed) that should
   * auto-map to this field. Compared after `labelToKey` normalization, so
   * casing/accents/punctuation don't matter — list the readable form.
   */
  aliases: Array<string>
  /** `boolean` fields are run through `parseBoolish` on the backend. */
  type?: 'string' | 'boolean'
  required?: boolean
}

// Special mapping targets (not real schema fields).
export const NOTES_TARGET = '__notes__' // typed collections: append to `notes`
export const DATA_TARGET = '__data__' // submissions: keep in flexible `data` bag
export const SKIP_TARGET = '__skip__' // drop the column

export const CRM_FIELDS: Record<CrmCollection, Array<CrmFieldDef>> = {
  contacts: [
    { key: 'name', label: 'Name', aliases: ['name', 'nombre'], required: true },
    { key: 'email', label: 'Email', aliases: ['email', 'correo'] },
    {
      key: 'phone',
      label: 'Phone',
      aliases: ['phone', 'telefono', 'teléfono'],
    },
    { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin'] },
    {
      key: 'website',
      label: 'Website',
      aliases: ['website', 'pagina web', 'página web', 'sitio web'],
    },
    {
      key: 'relationship',
      label: 'Relationship',
      aliases: ['relationship', 'vinculo', 'vínculo'],
    },
    { key: 'role', label: 'Role', aliases: ['role', 'rol'] },
    {
      key: 'title',
      label: 'Title / Position',
      aliases: ['title', 'cargo', 'puesto'],
    },
    {
      key: 'professionalField',
      label: 'Professional field',
      aliases: ['professional field', 'campo profesional', 'campo'],
    },
    {
      key: 'careerStage',
      label: 'Career stage',
      aliases: ['career stage', 'etapa profesional', 'etapa'],
    },
    {
      key: 'aiSafetyExperience',
      label: 'AI Safety experience',
      aliases: [
        'ai safety experience',
        'experiencia en ai safety',
        'experiencia ai safety',
      ],
    },
    {
      key: 'skills',
      label: 'Skills',
      aliases: ['skills', 'habilidades', 'expertise'],
    },
    {
      key: 'interests',
      label: 'Interests',
      aliases: ['interests', 'intereses'],
    },
    {
      key: 'availability',
      label: 'Availability',
      aliases: ['availability', 'disponibilidad'],
    },
    {
      key: 'location',
      label: 'Location',
      aliases: ['location', 'ubicacion', 'ubicación'],
    },
    {
      key: 'inBuenosAires',
      label: 'In Buenos Aires',
      aliases: ['in buenos aires', 'en buenos aires'],
      type: 'boolean',
    },
    {
      key: 'contactSource',
      label: 'Contact source',
      aliases: ['contact source', 'fuente de contacto', 'fuente'],
    },
    {
      key: 'contactPerson',
      label: 'Contact person',
      aliases: ['contact person', 'persona de contacto'],
    },
    {
      key: 'firstContact',
      label: 'First contact',
      aliases: ['first contact', 'primer contacto'],
    },
    {
      key: 'associatedOrganizations',
      label: 'Associated organizations',
      aliases: [
        'associated organizations',
        'organizaciones asociadas',
        'organizaciones',
      ],
    },
    {
      key: 'participatedIn',
      label: 'Participated in',
      aliases: ['participated in', 'participó en', 'participo en'],
    },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'notas'] },
  ],
  organizations: [
    {
      key: 'name',
      label: 'Name',
      aliases: ['name', 'nombre', 'organization name', 'organización'],
      required: true,
    },
    {
      key: 'description',
      label: 'Description',
      aliases: ['description', 'descripcion', 'descripción'],
    },
    {
      key: 'keyPeople',
      label: 'Key people',
      aliases: ['key people', 'personas clave', 'people', 'personas'],
    },
    { key: 'type', label: 'Type', aliases: ['type', 'tipo'] },
    {
      key: 'aiStance',
      label: 'AI stance',
      aliases: [
        'ai stance',
        'postura ia/regulación',
        'postura ia / regulación',
        'postura ia regulación',
        'postura ia',
      ],
    },
    {
      key: 'mainTopic',
      label: 'Main topic',
      aliases: ['main topic', 'tematica principal', 'temática principal'],
    },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'notas'] },
    {
      key: 'autoSummary',
      label: 'Auto-summary',
      aliases: [
        'auto-summary',
        'resumen auto-generado',
        'auto-generated organization summary',
        'resumen',
      ],
    },
  ],
  opportunities: [
    {
      key: 'title',
      label: 'Title',
      aliases: ['title', 'titulo', 'título'],
      required: true,
    },
    {
      key: 'organization',
      label: 'Organization',
      aliases: ['organization', 'organizacion', 'organización'],
    },
    {
      key: 'location',
      label: 'Location',
      aliases: ['location', 'ubicacion', 'ubicación'],
    },
    { key: 'type', label: 'Type', aliases: ['type', 'tipo'] },
    {
      key: 'category',
      label: 'Category',
      aliases: ['category', 'categoria', 'categoría'],
    },
    { key: 'date', label: 'Date', aliases: ['date', 'fecha'] },
    { key: 'status', label: 'Status', aliases: ['status', 'estado'] },
    { key: 'source', label: 'Source', aliases: ['source', 'fuente'] },
  ],
  submissions: [
    {
      key: 'participant',
      label: 'Participant',
      aliases: ['participant', 'participante', 'persona'],
    },
    {
      key: 'period',
      label: 'Period',
      aliases: ['period', 'periodo', 'período'],
    },
    { key: 'source', label: 'Source', aliases: ['source', 'fuente'] },
  ],
}

/**
 * Suggest the canonical field key for an Excel header, or `null` if nothing
 * matches. Exact (normalized) alias/key match wins; falls back to a
 * substring match guarded by length to avoid spurious hits.
 */
export function suggestFieldKey(
  header: string,
  fields: Array<CrmFieldDef>,
): string | null {
  const h = labelToKey(header)
  if (!h) return null

  for (const f of fields) {
    const norms = [f.key, ...f.aliases.map(labelToKey)].filter(Boolean)
    if (norms.includes(h)) return f.key
  }
  for (const f of fields) {
    const norms = [f.key, ...f.aliases.map(labelToKey)].filter(Boolean)
    for (const n of norms) {
      if (n.length >= 4 && (n.includes(h) || h.includes(n))) return f.key
    }
  }
  return null
}
