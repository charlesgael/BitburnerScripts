import type { ManagedAppDefinition, Task } from '../logic/types'
import type { TaskManagerState } from '../logic/use-task-manager'
import React from '@react'
import { taskKey } from '../logic/task-key'

/** One running task's row: its label/host/RAM, and Tail/Kill buttons. */
export function TaskRow({
  tm,
  task,
  app,
}: {
  tm: TaskManagerState
  task: Task
  app: ManagedAppDefinition | undefined
}) {
  const key = taskKey(task)
  const isOccupied = tm.taskBusy.has(key)
  const ram = (tm.appRam[task.script] ?? 0) * (app?.threads ?? 1)

  return (
    <div
      className="bb-divider-bottom"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 0',
      }}
    >
      <span className="bb-wrap" style={{ fontSize: '12px' }}>
        {app?.label ?? task.script}
        {' '}
        @
        {task.host}
        {' '}
        (
        {ram.toFixed(2)}
        {' '}
        GB)
      </span>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => void tm.tailTask(task)}
          disabled={isOccupied}
          title="Open this task's log window"
          className="bb-btn"
        >
          📃
        </button>
        <button
          onClick={() => void tm.killTask(task)}
          disabled={isOccupied}
          className="bb-btn bb-btn-danger"
        >
          {isOccupied ? '...' : 'Kill'}
        </button>
      </div>
    </div>
  )
}
