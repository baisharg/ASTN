import { clerkLocalization } from './clerk-language'

// The text of Clerk's sign-in screens per language (src/lib/clerk-language.tsx).

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('clerkLocalization', () => {
  test("English is Clerk's built-in text: no dictionary", () => {
    expect(clerkLocalization('en')).toBe(undefined)
  })

  test('Spanish uses the "vos" forms attendees read everywhere else', () => {
    const spanish = clerkLocalization('es')
    expect(spanish?.signIn?.start?.title).toBe(
      'Iniciá sesión en {{applicationName}}',
    )
    expect(spanish?.signUp?.start?.title).toBe('Creá tu cuenta')
    expect(spanish?.locale).toBe('es-AR')
  })

  test('Spanish covers the wrong-code error of the verification step', () => {
    expect(clerkLocalization('es')?.unstable__errors?.form_code_incorrect).toBe(
      'El código ingresado es incorrecto.',
    )
  })

  test('gives the same object every time, so Clerk is not updated needlessly', () => {
    expect(clerkLocalization('es')).toBe(clerkLocalization('es'))
  })
})
