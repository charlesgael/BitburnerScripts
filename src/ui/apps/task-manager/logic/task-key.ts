import type { Task } from './types'

export function taskKey(task: Task): string {
  return `${task.script}@${task.host}`
}
