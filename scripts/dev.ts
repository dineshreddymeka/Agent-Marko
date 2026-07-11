const root = import.meta.dir.replace(/[/\\]scripts$/, '')

const bunExe = process.execPath.toLowerCase().includes('bun')
  ? process.execPath
  : process.platform === 'win32'
    ? `${process.env.USERPROFILE ?? process.env.HOME ?? ''}/.bun/bin/bun.exe`
    : 'bun'

const server = Bun.spawn([bunExe, '--hot', 'src/index.ts'], {
  cwd: `${root}/server`,
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
})

const app = Bun.spawn([bunExe, 'run', 'dev'], {
  cwd: `${root}/app`,
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
})

function shutdown() {
  server.kill()
  app.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.race([server.exited, app.exited])
shutdown()
