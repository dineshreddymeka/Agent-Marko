const root = import.meta.dir.replace(/[/\\]scripts$/, '')

const server = Bun.spawn(['bun', '--hot', 'src/index.ts'], {
  cwd: `${root}/server`,
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
})

const app = Bun.spawn(['bun', 'run', 'dev'], {
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
