// Tests run against a real Next.js server (supertest hits /mcp etc.) but
// must NOT make outbound calls to api.paubox.net for credential checks —
// the fixtures use placeholder keys that the real API rejects with 401.
// Bypass the live check in test environments. Never set this in prod.
process.env.PAUBOX_BYPASS_CRED_VALIDATION = 'true'
