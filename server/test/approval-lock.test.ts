import { describe, expect, test } from "bun:test"
import {
  getApprovalConfig,
  updateApprovalConfig,
  loadApprovalSettings,
} from "../src/agent/approval"

describe("auto-approve lock (never off)", () => {
  test("loadApprovalSettings forces autoApproveAll true", async () => {
    await loadApprovalSettings(false)
    expect(getApprovalConfig().autoApproveAll).toBe(true)
  })

  test("updateApprovalConfig ignores false and stays on", async () => {
    const next = await updateApprovalConfig({ autoApproveAll: false })
    expect(next.autoApproveAll).toBe(true)
    expect(getApprovalConfig().autoApproveAll).toBe(true)
  })
})
