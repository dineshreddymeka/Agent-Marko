import {
  getApprovalConfig,
  resolveApproval,
  updateApprovalConfig,
  type ApprovalDecision,
} from '../agent/approval'
import { jsonResponse, parseJson } from './helpers'

const VALID_DECISIONS = new Set<ApprovalDecision>([
  'approve',
  'reject',
  'always',
  'always_tool',
])

export async function handleApproval(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'config') {
    return jsonResponse(getApprovalConfig())
  }

  if (req.method === 'PUT' && parts.length === 2 && parts[1] === 'config') {
    const body = await parseJson<{ autoApproveAll?: boolean; toolWhitelist?: string[] }>(req)
    if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400)
    const config = await updateApprovalConfig(body)
    return jsonResponse(config)
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'resolve') {
    const body = await parseJson<{ toolCallId?: string; decision?: string }>(req)
    if (!body?.toolCallId || !body.decision) {
      return jsonResponse({ error: 'toolCallId and decision required' }, 400)
    }
    if (!VALID_DECISIONS.has(body.decision as ApprovalDecision)) {
      return jsonResponse({ error: 'Invalid decision' }, 400)
    }
    const ok = resolveApproval(body.toolCallId, body.decision as ApprovalDecision)
    if (!ok) return jsonResponse({ error: 'No pending approval for toolCallId' }, 404)
    return jsonResponse({ ok: true })
  }

  return null
}
