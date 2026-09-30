# CRM consolidation: Airtable and Luma into ASTN

Goal: ASTN becomes BAISH's single system for people, organizations, programs
and events. The Airtable base "BAISH CRM" (`app2EMVZr0HLk1gWt`) and the TAIS
applications base (`appenjNuTu9j3uv5d`) are imported once and then retired.
Luma stays the ticketing tool, but is managed and mirrored from ASTN.

## What Airtable does that ASTN must match

- **Admin-defined fields.** Personas has 36 fields, mostly single and
  multi-selects with fixed option lists (Campo, Etapa profesional, Habilidades,
  Intereses, Busca en BAISH, Compromiso, Oportunidades…), plus checkboxes
  (Core, Conector/a, Trabaja en AI Safety), dates and URLs.
- **Links between records.** A person links to their Formularios; programs link
  to participation and sessions; sessions to attendance.
- **Views.** Filter, sort, group and hide columns, saved and shared.

ASTN already does better on everything operational (applications, polls,
surveys, email, events), and every record there is tied to a real account.

## Data model

### Configurable fields: `crmFieldDefs`

One row per field of a CRM collection (`contacts` or `organizations`):
`key` (stable, unique per org and collection), `label`, `type`, `options`
(for selects), `order`, `hidden`, `source` (`builtin` | `airtable` | `admin`).

Types: `text`, `longText`, `singleSelect`, `multiSelect`, `checkbox`, `date`
(`YYYY-MM-DD`), `number`, `url`, `email`, `phone`.

Values live on the record in `fields: Record<key, value>`:
text-like → `string`, `multiSelect` → `string[]`, `checkbox` → `boolean`,
`number` → `number`. Writes are validated against the field def.

### Contacts

Core columns stay flat because everything else relies on them: `name`,
`email` (lowercased), `phone`, `linkedin`, `website`, `location`, `notes`.
New columns: `fields`, `otherEmails: string[]` (lowercased), `userId` (linked
app account), `airtableId` (idempotent import).

Every other current flat column moves into `fields` as a `builtin` field def,
with Airtable-compatible types:

| Old column              | Field key               | Type         | Airtable field           |
| ----------------------- | ----------------------- | ------------ | ------------------------ |
| relationship            | relationship            | singleSelect | Vínculo                  |
| role                    | role                    | singleSelect | Rol                      |
| title                   | title                   | text         | —                        |
| professionalField       | professionalField       | multiSelect  | Campo                    |
| careerStage             | careerStage             | multiSelect  | Etapa profesional        |
| aiSafetyExperience      | aiSafetyExperience      | singleSelect | Experiencia en AI Safety |
| skills                  | skills                  | multiSelect  | Habilidades              |
| interests               | interests               | multiSelect  | Intereses                |
| availability            | availability            | singleSelect | Disponibilidad           |
| inBuenosAires           | inBuenosAires           | checkbox     | En Buenos Aires          |
| contactSource           | contactSource           | singleSelect | Fuente de contacto       |
| contactPerson           | contactPerson           | text         | Persona de contacto      |
| firstContact            | firstContact            | date         | Primer contacto          |
| associatedOrganizations | associatedOrganizations | text         | Organizaciones           |
| participatedIn          | participatedIn          | multiSelect  | Participó en             |

Airtable-only fields become `airtable` field defs (Core, Conector/a, Trabaja en
AI Safety, Compromiso, Busca en BAISH, Oportunidades, Contacto preferido,
Contactos valiosos, ¿Cuándo hiciste contacto…?, and the "(no enlistado)"
free-text companions).

### Organizations

Same pattern: core `name`, `website`, `email`, `description`, `notes`, plus
`fields` (Tags, Location, LinkedIn, Phone, People…) and `airtableId`.

### History: `crmActivities`

Things that happened to a person that don't have a richer home in ASTN:
`contactId`, `kind` (`program` | `session` | `form` | `event` | `note` |
`application`), `title`, `occurredAt`, `status`, `source` (`airtable` | `luma`
| `app` | `manual`), `externalId` (for idempotent imports), `data` (any extra
answers). Airtable program participation, session attendance, Formularios and
TAIS applications land here, and so does every Luma event a person registered for.

### Saved views: `crmViews`

Shared per org and collection: `name`, `filters` (`{ field, op, value }`),
`sort`, `columns`, `groupBy`. Replaces the localStorage views.

### The person page

`crm/people.getPerson` joins, by contact, linked `userId` and all emails:
the contact and its fields, the app profile, applications to the org's
opportunities, event registrations (`socialEventGuests`), program
participation, surveys (through applications) and `crmActivities`, as one
timeline.

## Phases

1. **Foundation (this PR):** schema; field defs with the builtin set; migration
   of existing contacts from flat columns into `fields`; typed field updates;
   linking contacts to accounts by email; the person query; MCP and admin-agent
   tools updated to the new shape.
2. **CRM screens:** field-aware table (cell editors per type), filters, sort,
   group, shared saved views, bulk edit, CSV export; field manager; person page.
3. **Airtable import:** preview with a merge report (match by email, other
   emails and `airtableId`), then import fields, contacts, organizations,
   Formularios, programs and attendance, and TAIS applications. Re-runnable.
4. **Luma, managed from ASTN:** mirror every calendar event and its guests
   through the official API (replacing the undocumented-endpoint sync in
   `convex/events`), attendance into person history, create and edit events,
   approve guests, email blasts, and door check-in in ASTN (Luma's API can't
   check guests in; ASTN scans the guest's Luma QR code or searches by name).
5. **Retire Airtable:** read-only for a few weeks, then archived.
