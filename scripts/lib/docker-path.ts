/** Windows Docker Desktop install paths (ignored on Linux/macOS/CI). */
export const dockerCandidates = [
  'docker',
  'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
  'C:/Program Files/Docker/Docker/resources/docker.exe',
]

export const dockerBinDir = 'C:/Program Files/Docker/Docker/resources/bin'

/**
 * Augment PATH so `docker` resolves on Windows when Docker Desktop is installed
 * but not on PATH. On Linux/macOS (incl. GitHub Actions ubuntu), return {} —
 * do not inject Windows paths or `;` separators into PATH.
 */
export function dockerPathEnv(): Record<string, string> {
  if (process.platform !== 'win32') {
    return {}
  }
  const extra = [dockerBinDir.replace(/\//g, '\\'), dockerBinDir]
  const path = [...extra, process.env.PATH ?? process.env.Path ?? ''].join(';')
  return { PATH: path, Path: path }
}

export async function resolveDocker(): Promise<string | null> {
  const candidates =
    process.platform === 'win32' ? dockerCandidates : (['docker'] as const)

  for (const cmd of candidates) {
    try {
      const proc = Bun.spawn([cmd, '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...dockerPathEnv() },
      })
      if ((await proc.exited) === 0) return cmd
    } catch {
      /* next */
    }
  }
  return null
}

export async function isDockerDaemonReady(docker?: string | null): Promise<boolean> {
  const cmd = docker ?? (await resolveDocker())
  if (!cmd) return false
  try {
    const proc = Bun.spawn([cmd, 'info'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...dockerPathEnv() },
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}
