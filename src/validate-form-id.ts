// Reject caller-supplied UUID-shaped identifiers that would splice the URL
// path (`..`, `?`, `#`, `/`) once interpolated. The HTTP-server lib client
// (`lib/paubox-forms.ts`) enforces the same policy at its own layer; this
// module is the stdio server's copy of it since `tsconfig.stdio.json` scopes
// stdio to `src/` and forbids importing from `lib/`.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateFormId(raw: string | undefined, field: string): string {
  const value = (raw ?? "").trim()
  if (value.length === 0) throw new Error(`${field} is required.`)
  if (value === "." || value === "..") throw new Error(`${field} must be a UUID.`)
  if (!UUID_REGEX.test(value)) throw new Error(`${field} must be a UUID.`)
  return value
}
