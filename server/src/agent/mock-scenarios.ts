import type { ChatMessage } from './llm'
import type { MockLlmScript } from './mock-llm'

export type MockScenario = 'default' | 'a2ui-cron' | 'a2ui-memory' | 'a2ui-skills'

export function getMockScenario(messages: ChatMessage[] = []): MockScenario {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const content = lastUser?.content ?? ''
  const fromMessage = content.match(/Run (a2ui-(?:cron|memory|skills)) demo/i)?.[1]?.toLowerCase()
  if (fromMessage === 'a2ui-cron' || fromMessage === 'a2ui-memory' || fromMessage === 'a2ui-skills') {
    return fromMessage
  }

  const raw = process.env.HERMES_MOCK_SCENARIO ?? 'default'
  if (raw === 'a2ui-cron' || raw === 'a2ui-memory' || raw === 'a2ui-skills') return raw
  return 'default'
}

function toolTurn(script: MockLlmScript): MockLlmScript {
  return {
    reasoning: ['Planning UI surface…'],
    content: [],
    toolCalls: script.toolCalls,
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
  }
}

function doneTurn(message: string): MockLlmScript {
  return {
    // Second reasoning burst after tool results, mirroring real reasoning models.
    reasoning: ['Reviewing tool results…'],
    content: [message],
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
  }
}

const SCENARIO_SCRIPTS: Record<Exclude<MockScenario, 'default'>, { first: MockLlmScript; done: string }> = {
  'a2ui-cron': {
    first: toolTurn({
      toolCalls: [
        {
          name: 'a2ui_render',
          arguments: {
            payload: {
              surfaceId: 'demo-cron-surface',
              component: {
                id: 'cron-picker',
                type: 'hermes:CronSchedulePicker',
                props: {
                  name: 'Daily digest',
                  schedule: '0 9 * * *',
                  prompt: 'Summarize overnight activity',
                },
              },
              complete: true,
            },
          },
        },
      ],
    }),
    done: 'Cron setup form rendered. Submit it to create the job.',
  },
  'a2ui-memory': {
    first: toolTurn({
      toolCalls: [
        {
          name: 'a2ui_render',
          arguments: {
            payload: {
              surfaceId: 'demo-memory-surface',
              component: {
                id: 'mem-1',
                type: 'hermes:MemoryEntryEditor',
                props: {
                  entryId: '00000000-0000-4000-8000-000000000101',
                  kind: 'semantic',
                  content: 'User prefers Postgres over SQLite for agent memory.',
                },
              },
              complete: true,
            },
          },
        },
      ],
    }),
    done: 'Memory entry rendered. Edit or delete from the surface.',
  },
  'a2ui-skills': {
    first: toolTurn({
      toolCalls: [
        {
          name: 'a2ui_render',
          arguments: {
            payload: {
              surfaceId: 'demo-skills-surface',
              component: {
                id: 'skill-deploy',
                type: 'hermes:SkillCard',
                props: {
                  name: 'deploy',
                  description: 'Production release checklist',
                  usageCount: 12,
                },
              },
              complete: true,
            },
          },
        },
      ],
    }),
    done: 'Skill card gallery rendered.',
  },
}

export function resolveMockScript(messages: ChatMessage[]): MockLlmScript {
  const scenario = getMockScenario(messages)
  if (scenario === 'default') {
    return {
      reasoning: ['Analyzing', ' the request…'],
      content: ['Hello from mock LLM.'],
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    }
  }

  const toolResults = messages.filter((m) => m.role === 'tool').length
  const spec = SCENARIO_SCRIPTS[scenario]
  if (toolResults === 0) return spec.first
  return doneTurn(spec.done)
}
