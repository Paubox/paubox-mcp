// Tests run against a real Next.js server (supertest hits /mcp etc.) but
// must NOT make outbound calls to api.paubox.com for credential checks —
// the fixtures use placeholder keys that the real API rejects with 401.
// Bypass the live check in test environments. Never set this in prod.
process.env.PAUBOX_BYPASS_CRED_VALIDATION = 'true'

// The bypass above is compiled out of the production build the test server
// runs (Next inlines NODE_ENV='production' and dead-code-eliminates the
// branch), so checkPauboxCredentials really calls axios.get against
// https://api.paubox.com. Point axios's env-proxy at an unroutable address
// so that call fails fast with a network error — the helper soft-passes on
// network errors, which keeps the suites hermetic regardless of what egress
// the CI environment has (a corporate egress proxy answering 403 would
// otherwise read as "invalid API key" and fail every integration test).
// supertest traffic to localhost and undici/fetch are unaffected: superagent
// and Node's fetch ignore these variables, and NO_PROXY covers localhost.
process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
process.env.https_proxy = 'http://127.0.0.1:9'
process.env.NO_PROXY = 'localhost,127.0.0.1'
process.env.no_proxy = 'localhost,127.0.0.1'
