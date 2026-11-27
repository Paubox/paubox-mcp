import { CliSessionError, cliCommand, readCliSession, type RunCli } from '../src/cli-session'

const SESSION = {
  token: 'session.jwt.token',
  email: 'jerry@paubox.com',
  customerId: 25,
  customer: 'Paubox',
  environment: 'staging',
  webUrl: 'https://next.staging.paubox.net',
  iamUrl: 'https://api.staging.paubox.net/iam',
  expiresAt: '2026-12-12T00:00:00.000Z',
}

/** A stand-in for running the CLI that records what it was asked to run. */
function fakeCli(result: { stdout?: string; error?: Error }) {
  const calls: Array<{ file: string; args: string[] }> = []
  const run: RunCli = async (file, args) => {
    calls.push({ file, args })
    if (result.error) throw result.error
    return { stdout: result.stdout ?? '' }
  }
  return { run, calls }
}

function failure(props: { code?: string | number; stderr?: string }): Error {
  return Object.assign(new Error('Command failed'), props)
}

describe('cliCommand', () => {
  it('runs `paubox` from PATH by default', () => {
    expect(cliCommand({})).toBe('paubox')
  })

  it('honours PAUBOX_CLI_PATH', () => {
    expect(cliCommand({ PAUBOX_CLI_PATH: ' /tmp/paubox-dev ' })).toBe('/tmp/paubox-dev')
  })
})

describe('readCliSession', () => {
  it('asks the CLI for its session as JSON', async () => {
    const cli = fakeCli({ stdout: JSON.stringify(SESSION) })

    await expect(readCliSession(cli.run, {})).resolves.toEqual(SESSION)
    expect(cli.calls).toEqual([{ file: 'paubox', args: ['--json', 'auth', 'token'] }])
  })

  it('runs the CLI named by PAUBOX_CLI_PATH', async () => {
    const cli = fakeCli({ stdout: JSON.stringify(SESSION) })

    await readCliSession(cli.run, { PAUBOX_CLI_PATH: '/work/paubox-cli/bin/paubox.js' })
    expect(cli.calls[0].file).toBe('/work/paubox-cli/bin/paubox.js')
  })

  it('says how to install the CLI when it is missing', async () => {
    const cli = fakeCli({ error: failure({ code: 'ENOENT' }) })

    await expect(readCliSession(cli.run, {})).rejects.toThrow(
      'was not found. Install it with `npm install -g paubox-cli`'
    )
  })

  it("relays the CLI's own reason when it has no session", async () => {
    const stderr = JSON.stringify({
      error: { type: 'auth', message: 'Not logged in with a browser session.', suggestion: 'Run `paubox auth login --web`.' },
    })
    const cli = fakeCli({ error: failure({ code: 2, stderr }) })

    const err = await readCliSession(cli.run, {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CliSessionError)
    expect((err as Error).message).toBe(
      'Not logged in with a browser session. Run `paubox auth login` in a terminal, then try again.'
    )
  })

  it('falls back to the first stderr line when it is not JSON', async () => {
    const cli = fakeCli({ error: failure({ code: 1, stderr: 'boom\nstack' }) })

    await expect(readCliSession(cli.run, {})).rejects.toThrow('boom. Run `paubox auth login`')
  })

  it('asks for an upgrade when the CLI answers without a session token', async () => {
    const cli = fakeCli({ stdout: JSON.stringify({ authenticated: true }) })

    await expect(readCliSession(cli.run, {})).rejects.toThrow('does not support browser login')
  })

  it('rejects output that is not JSON', async () => {
    const cli = fakeCli({ stdout: 'session.jwt.token\n' })

    await expect(readCliSession(cli.run, {})).rejects.toThrow('unexpected response')
  })
})
