export const dockerCandidates = [
  'docker',
  'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
  'C:/Program Files/Docker/Docker/resources/docker.exe',
]

export const dockerBinDir = 'C:/Program Files/Docker/Docker/resources/bin'

export function dockerPathEnv(): Record<string, string> {
  const extra = [dockerBinDir.replace(/\//g, '\\'), dockerBinDir]
  const path = [...extra, process.env.PATH ?? process.env.Path ?? ''].join(';')
  return { PATH: path, Path: path }
}

export async function resolveDocker(): Promise<string | null> {
  for (const cmd of dockerCandidates) {
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
