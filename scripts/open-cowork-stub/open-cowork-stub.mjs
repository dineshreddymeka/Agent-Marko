#!/usr/bin/env node
/**
 * Minimal Open Cowork headless JSONL stub for Hermes smoke tests.
 * Protocol: emit stdio.ready; on session.start write outbox files + status.json and emit session.end.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const args = process.argv.slice(2)
const cwdIdx = args.indexOf('--cwd')
const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : process.cwd()

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

emit({ type: 'stdio.ready' })

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  if (msg.type === 'session.abort') {
    emit({ type: 'session.end', sessionId: msg.sessionId, ok: false })
    return
  }

  if (msg.type !== 'session.start') return

  const prompt = String(msg.prompt ?? '')
  const m = prompt.match(/executing task\s+(\S+)/i)
  const taskId = m?.[1] || `t-${Date.now()}`
  const sessionId = `s-${taskId}`

  emit({ type: 'session.started', sessionId, taskId })

  const outDir = path.join(cwd, 'outbox', taskId)
  fs.mkdirSync(outDir, { recursive: true })
  const fileName = 'hello.md'
  const filePath = path.join(outDir, fileName)
  fs.writeFileSync(filePath, 'Hello from Hermes Cowork smoke test.\n', 'utf8')
  const status = {
    ok: true,
    taskId,
    summary: 'Stub headless Open Cowork wrote hello.md',
    files: [fileName],
  }
  fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(status, null, 2))

  emit({ type: 'agent.text_delta', sessionId, text: 'Wrote hello.md\n' })
  emit({ type: 'session.end', sessionId, taskId, ok: true })
})
