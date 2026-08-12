// Regression: pins the URL-path-safety guard used by the stdio MCP server on
// every caller-supplied `formId` / `submissionId`. A hostile value that
// splices the URL path (`..`, `?`, `#`, `/`) would otherwise let the caller
// retarget the outbound request on the same host. Same class of finding
// that gate-blocked paubox-python3 PR #10 and paubox-php PR #16, addressed
// on the HTTP surface here by `lib/paubox-forms.ts`'s equivalent guard
// (regression-tested via `__tests__/route.test.ts`).
import { validateFormId } from '../src/validate-form-id'

describe('validateFormId', () => {
  const VALID_UUID = '823b8ccd-1234-4a5b-9c8d-0123456789ab'

  const HOSTILE_INPUTS: Array<{ label: string; value: string }> = [
    { label: 'dot-dot', value: '..' },
    { label: 'single dot', value: '.' },
    { label: 'path traversal', value: '../public/customers' },
    { label: 'query splice', value: 'abc?admin=true' },
    { label: 'fragment splice', value: 'abc#frag' },
    { label: 'slash', value: 'abc/def' },
    { label: 'empty string', value: '' },
    { label: 'whitespace only', value: '   ' },
    { label: 'not a UUID', value: 'not-a-uuid' },
    { label: 'partial UUID', value: '823b8ccd-1234' },
  ]

  HOSTILE_INPUTS.forEach(({ label, value }) => {
    it(`rejects hostile formId (${label}) with a UUID-error`, () => {
      expect(() => validateFormId(value, 'formId')).toThrow()
      try {
        validateFormId(value, 'formId')
      } catch (error) {
        const message = (error as Error).message
        if (value.trim().length === 0) {
          expect(message).toBe('formId is required.')
        } else {
          expect(message).toBe('formId must be a UUID.')
        }
      }
    })
  })

  it('accepts a valid UUID and returns the trimmed value', () => {
    expect(validateFormId(VALID_UUID, 'formId')).toBe(VALID_UUID)
    expect(validateFormId(`  ${VALID_UUID}  `, 'formId')).toBe(VALID_UUID)
  })

  it('accepts UUID with uppercase hex digits', () => {
    const upper = VALID_UUID.toUpperCase()
    expect(validateFormId(upper, 'formId')).toBe(upper)
  })

  it('threads the field name into the error message', () => {
    expect(() => validateFormId('..', 'submissionId')).toThrow('submissionId must be a UUID.')
    expect(() => validateFormId('', 'submissionId')).toThrow('submissionId is required.')
  })

  it('treats undefined as empty (required)', () => {
    expect(() => validateFormId(undefined, 'formId')).toThrow('formId is required.')
  })
})
