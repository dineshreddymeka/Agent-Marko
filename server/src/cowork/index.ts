export type {
  CoworkCommand,
  CoworkClientOptions,
  CoworkEvent,
  CoworkSpawnFn,
  CoworkStartOptions,
  CoworkTaskResult,
} from './types'

export { JsonlLineBuffer, parseJsonlLine } from './jsonl'
export type { JsonlParseOk, JsonlParseResult, JsonlParseSkip } from './jsonl'

export {
  COWORK_SETTING_EXE,
  COWORK_SETTING_WORKSPACE,
  CoworkClient,
  coworkExeExists,
  defaultCoworkExeCandidate,
  formatCoworkExeMissingMessage,
  getCoworkSetupInfo,
  OPEN_COWORK_RELEASES_URL,
  OPEN_COWORK_WIN_INSTALLER_URL,
  resolveCoworkExe,
  resolveCoworkWorkspace,
} from './client'
export type { CoworkSetupInfo } from './client'

export {
  beginCoworkAudit,
  coworkSessionTitle,
  finishCoworkAudit,
  persistCoworkAudit,
  restoreCoworkTaskFromEvents,
} from './persist'
export type {
  BeginCoworkAuditInput,
  BeginCoworkAuditResult,
  CoworkFinishedPayload,
  CoworkStartedPayload,
  FinishCoworkAuditInput,
  PersistCoworkAuditInput,
  PersistCoworkAuditResult,
} from './persist'

export {
  abortCoworkTask,
  appendCoworkTaskProgress,
  appendCoworkTaskQuestion,
  buildGoalWithDeliverable,
  deliverablePromptAppendix,
  getActiveCoworkClient,
  getCoworkTaskRecord,
  listCoworkTaskProgress,
  listCoworkTaskQuestions,
  listCoworkTaskRecords,
  listOutboxFiles,
  readStatusJson,
  resetCoworkTaskStateForTests,
  runCoworkTask,
  startCoworkTaskAsync,
} from './run-task'
export type {
  CoworkTaskProgressEntry,
  CoworkTaskQuestion,
  RunCoworkTaskInput,
  RunCoworkTaskResult,
} from './run-task'

export {
  bridgeEntriesFromEvents,
  COWORK_PROGRESS_EVENT,
  COWORK_QUESTION_EVENT,
  createJarvisMcpBridgeServer,
  handleAsk,
  handleFetchContext,
  handleReportProgress,
  startJarvisMcpBridge,
} from './mcp-bridge'
export type {
  AskInput,
  AskResult,
  FetchContextInput,
  FetchContextResult,
  ReportProgressInput,
  ReportProgressResult,
} from './mcp-bridge'

export {
  buildJarvisBridgeEntry,
  coworkMcpConfigPath,
  getJarvisMcpBridgeStatus,
  JARVIS_MCP_BRIDGE_ID,
  jarvisBridgeScriptPath,
  readCoworkMcpConfig,
  registerJarvisMcpBridge,
  resolveBunForBridge,
} from './mcp-register'
export type {
  CoworkMcpConfig,
  CoworkMcpServerEntry,
  JarvisMcpBridgeStatus,
} from './mcp-register'
