// Fails when a public Convex function is neither in the permission matrix nor
// listed, with a reason, in coverage.helpers.ts. A new endpoint has to be
// decided on: who may call it, and a test that says so.
import { publicFunctions } from './harness.helpers'
import { COVERED_BY_MATRIX } from './matrix.cases.helpers'
import {
  COVERED_BY_SCENARIOS,
  FILES_OUTSIDE_THE_MATRIX,
  PUBLIC_OR_OWN,
} from './coverage.helpers'

declare const describe: (name: string, fn: () => void) => void
declare const test: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(actual: T) => {
  toEqual(expected: unknown): void
}

const moduleOf = (fn: string) => fn.split(':')[0]
const matrixFiles = new Set([...COVERED_BY_MATRIX].map(moduleOf))

describe('permission coverage', () => {
  test('every public function is in the matrix or listed with a reason', async () => {
    const unclassified = (await publicFunctions()).filter(
      (fn) =>
        !COVERED_BY_MATRIX.has(fn) &&
        !(fn in COVERED_BY_SCENARIOS) &&
        !(fn in PUBLIC_OR_OWN) &&
        !Object.keys(FILES_OUTSIDE_THE_MATRIX).some(
          (file) =>
            moduleOf(fn) === file || moduleOf(fn).startsWith(`${file}/`),
        ),
    )
    // To fix: add the function to matrix.cases.helpers.ts, or to
    // PUBLIC_OR_OWN in coverage.helpers.ts with the reason it needs no role.
    expect(unclassified).toEqual([])
  })

  test('the lists name functions and files that still exist', async () => {
    const all = new Set(await publicFunctions())
    const modules = new Set([...all].map(moduleOf))
    const staleFunctions = [
      ...Object.keys(PUBLIC_OR_OWN),
      ...Object.keys(COVERED_BY_SCENARIOS),
      ...COVERED_BY_MATRIX,
    ].filter((fn) => !all.has(fn))
    const staleFiles = Object.keys(FILES_OUTSIDE_THE_MATRIX).filter(
      (file) =>
        ![...modules].some((m) => m === file || m.startsWith(`${file}/`)),
    )
    expect({ staleFunctions, staleFiles }).toEqual({
      staleFunctions: [],
      staleFiles: [],
    })
  })

  test('a file in the matrix is not hidden behind a whole-file entry', () => {
    const hidden = Object.keys(FILES_OUTSIDE_THE_MATRIX).filter((file) =>
      [...matrixFiles].some((m) => m === file || m.startsWith(`${file}/`)),
    )
    expect(hidden).toEqual([])
  })

  test('every entry gives a reason', () => {
    const empty = [
      ...Object.entries(PUBLIC_OR_OWN),
      ...Object.entries(COVERED_BY_SCENARIOS),
      ...Object.entries(FILES_OUTSIDE_THE_MATRIX),
    ]
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([name]) => name)
    expect(empty).toEqual([])
  })

  test('a function is not listed twice', () => {
    const twice = Object.keys(PUBLIC_OR_OWN).filter(
      (fn) => COVERED_BY_MATRIX.has(fn) || fn in COVERED_BY_SCENARIOS,
    )
    expect(twice).toEqual([])
  })
})
