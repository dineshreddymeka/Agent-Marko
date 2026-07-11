export type ErrorCode =
  | 'LLM_ERROR'
  | 'TOOL_ERROR'
  | 'PROVIDER_ERROR'
  | 'DB_ERROR'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_TIMEOUT'
  | 'APPROVAL_REQUIRED'
  | 'MCP_ERROR'
  | 'VECTOR_ERROR'

export class HermesError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, status = 500, details?: unknown) {
    super(message)
    this.name = 'HermesError'
    this.code = code
    this.status = status
    this.details = details
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export class LlmError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('LLM_ERROR', message, 502, details)
    this.name = 'LlmError'
  }
}

export class ToolError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('TOOL_ERROR', message, 500, details)
    this.name = 'ToolError'
  }
}

export class ProviderError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('PROVIDER_ERROR', message, 502, details)
    this.name = 'ProviderError'
  }
}

export class DbError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('DB_ERROR', message, 500, details)
    this.name = 'DbError'
  }
}

export class AuthError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('AUTH_ERROR', message, 401, details)
    this.name = 'AuthError'
  }
}

export class McpError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('MCP_ERROR', message, 502, details)
    this.name = 'McpError'
  }
}

export class VectorError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('VECTOR_ERROR', message, 502, details)
    this.name = 'VectorError'
  }
}

export class ApprovalRejectedError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('APPROVAL_REJECTED', message, 403, details)
    this.name = 'ApprovalRejectedError'
  }
}

export class ApprovalTimeoutError extends HermesError {
  constructor(message: string, details?: unknown) {
    super('APPROVAL_TIMEOUT', message, 408, details)
    this.name = 'ApprovalTimeoutError'
  }
}

export function isHermesError(err: unknown): err is HermesError {
  return err instanceof HermesError
}
