import type { Task, TaskType } from './Task.js'

export type TaskRegistry = {
  readonly tasks: readonly Task[]
  get(type: TaskType): Task | undefined
}

export function createTaskRegistry(tasks: readonly Task[]): TaskRegistry {
  return {
    tasks,
    get(type) {
      return tasks.find(task => task.type === type)
    },
  }
}

export function createDefaultTaskRegistry(): TaskRegistry {
  return createTaskRegistry([])
}
