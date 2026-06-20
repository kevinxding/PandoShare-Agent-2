import { createCommandEnvelope } from '../protocol/index.js'
import type { AgentKernel } from '../agent/index.js'
import type { Attempt, Task } from './LoopTypes.js'

export class AttemptRunner {
  constructor(private readonly agentKernel: Pick<AgentKernel, 'submitRun'>) {}

  async run(input: {
    workspaceId: string
    goalId: string
    task: Task
  }): Promise<Attempt> {
    const attempt: Attempt = {
      attemptId: `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      taskId: input.task.taskId,
      status: 'running',
      startedAtMs: Date.now(),
    }
    const command = createCommandEnvelope({
      commandType: 'agent.run',
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      source: 'daemon',
      payload: {
        prompt: [
          `Goal task: ${input.task.title}`,
          '',
          `Execution mode: ${input.task.executionMode}`,
          'Complete the task and report the result.',
        ].join('\n'),
      },
    })
    const result = await this.agentKernel.submitRun(command)
    return {
      ...attempt,
      runId: result.runId,
      status: 'completed',
      completedAtMs: Date.now(),
      summary: result.finalText.slice(0, 500),
    }
  }
}
