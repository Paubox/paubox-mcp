// The Paubox CLI's browser login (`paubox auth login`), borrowed by the stdio
// server so an agent can act as the logged-in user without its own login flow.
//
// The session is read by running `paubox auth token --json`, the same way tools
// shell out to `gh auth token`, rather than opening the CLI's keychain entry
// directly: the CLI owns where and how the session is stored.
//
// stdio only. The hosted server runs elsewhere and has no CLI to ask.

import { execFile } from "node:child_process"

export interface CliSession {
  token: string
  email: string
  customerId: number | null
  customer: string | null
  environment: string
  webUrl: string
  iamUrl: string
  expiresAt: string
}

export type RunCli = (file: string, args: string[]) => Promise<{ stdout: string }>

export class CliSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CliSessionError"
  }
}

const CLI_TIMEOUT_MS = 10_000
const LOGIN_HINT = "Run `paubox auth login` in a terminal, then try again."

/** `PAUBOX_CLI_PATH` points at a specific build, e.g. a local checkout under test. */
export function cliCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAUBOX_CLI_PATH?.trim() || "paubox"
}

export const runCli: RunCli = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      // npm installs the CLI as paubox.cmd on Windows, which only runs through a
      // shell. The arguments are fixed strings, never user input.
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, shell: process.platform === "win32" },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr: String(stderr ?? "") }))
          return
        }
        resolve({ stdout: String(stdout) })
      }
    )
  })

/** The CLI writes `{"error": {"message", "suggestion"}}` to stderr under --json. */
function cliErrorMessage(stderr: string | undefined): string | undefined {
  if (!stderr) return undefined
  try {
    const parsed = JSON.parse(stderr) as { error?: { message?: unknown } }
    return typeof parsed.error?.message === "string" ? parsed.error.message : undefined
  } catch {
    return stderr.trim().split("\n")[0] || undefined
  }
}

export async function readCliSession(
  run: RunCli = runCli,
  env: NodeJS.ProcessEnv = process.env
): Promise<CliSession> {
  const cli = cliCommand(env)

  let stdout: string
  try {
    ;({ stdout } = await run(cli, ["--json", "auth", "token"]))
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === "ENOENT") {
      throw new CliSessionError(
        `The Paubox CLI (\`${cli}\`) was not found. Install it with \`npm install -g paubox-cli\`, then run \`paubox auth login\`.`
      )
    }
    const detail = cliErrorMessage(err.stderr) ?? "The Paubox CLI could not provide a login session."
    throw new CliSessionError(`${detail.replace(/\.?$/, ".")} ${LOGIN_HINT}`)
  }

  let session: Partial<CliSession>
  try {
    session = JSON.parse(stdout) as Partial<CliSession>
  } catch {
    throw new CliSessionError(
      "The Paubox CLI returned an unexpected response. Update it with `npm install -g paubox-cli`, then try again."
    )
  }
  if (typeof session.token !== "string" || !session.token || typeof session.iamUrl !== "string") {
    throw new CliSessionError(
      "This Paubox CLI version does not support browser login. Update it with `npm install -g paubox-cli`, then run `paubox auth login`."
    )
  }
  return session as CliSession
}
