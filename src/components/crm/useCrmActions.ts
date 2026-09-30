import { useMutation } from 'convex/react'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  CrmCollection,
  CrmColumn,
  CrmRecord,
  FieldDef,
  FieldValue,
} from './fieldValues'
import { isEmptyValue, readValue } from './fieldValues'
import { toastError } from '~/components/social-admin/shared'

/** A problem caught before calling the backend, shown as is. */
class InputError extends Error {}

/**
 * Writes for one CRM collection: core columns go through
 * updateContact/updateOrganization, configurable fields through the strict
 * setField. `save` offers an undo in its toast.
 */
export function useCrmActions(
  orgId: Id<'organizations'>,
  collection: CrmCollection,
) {
  const updateContact = useMutation(api.crm.updateContact)
  const updateOrganization = useMutation(api.crm.updateOrganization)
  const setField = useMutation(api.contacts.records.setField)
  const updateField = useMutation(api.contacts.records.updateField)

  const write = useCallback(
    async (recordId: string, column: CrmColumn, value: FieldValue) => {
      if (column.core) {
        const text = typeof value === 'string' ? value.trim() : ''
        if (column.key === 'name' && !text) {
          throw new InputError('El nombre no puede quedar vacío')
        }
        if (collection === 'contacts') {
          await updateContact({
            orgId,
            id: recordId as Id<'crmContacts'>,
            field: column.key,
            value: text,
          })
        } else {
          await updateOrganization({
            orgId,
            id: recordId as Id<'crmOrganizations'>,
            field: column.key,
            value: text,
          })
        }
        return
      }
      await setField({
        orgId,
        collection,
        id: recordId,
        key: column.key,
        value: isEmptyValue(value) ? null : value,
      })
    },
    [orgId, collection, updateContact, updateOrganization, setField],
  )

  /** Save one value; toasts errors, and offers undo when `undo` is set. */
  const save = useCallback(
    async (
      record: CrmRecord,
      column: CrmColumn,
      value: FieldValue,
      opts: { undo?: boolean } = {},
    ): Promise<boolean> => {
      const previous = readValue(record, column)
      if (JSON.stringify(previous) === JSON.stringify(value)) return true
      try {
        await write(record._id, column, value)
      } catch (err) {
        if (err instanceof InputError) {
          toast.error(err.message)
        } else {
          toastError('No se pudo guardar')(err)
        }
        return false
      }
      if (opts.undo) {
        toast.success(`${column.label}: guardado`, {
          duration: 6000,
          action: {
            label: 'Deshacer',
            onClick: () => {
              write(record._id, column, previous).catch(
                toastError('No se pudo deshacer'),
              )
            },
          },
        })
      }
      return true
    },
    [write],
  )

  /** Add an option to a select field's definition. */
  const createOption = useCallback(
    async (def: FieldDef, value: string): Promise<boolean> => {
      const clean = value.trim()
      if (!clean) return false
      if (def.options.some((o) => o.value === clean)) return true
      try {
        await updateField({
          orgId,
          fieldId: def._id,
          options: [...def.options, { value: clean }],
        })
        return true
      } catch (err) {
        toastError('No se pudo crear la opción')(err)
        return false
      }
    },
    [orgId, updateField],
  )

  return { save, createOption }
}
