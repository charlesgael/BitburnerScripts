import type { ManagedAppDefinition } from '../logic/types'
import React from '@react'
import { taskKey } from '../logic/task-key'
import { useTaskManager } from '../logic/use-task-manager'
import { SpawnRow } from './spawn-row'
import { TaskRow } from './task-row'

/**
 * Body shared by every `createTaskManagerApp` instance — the RAM bar, the
 * spawn rows (one per catalog entry), and the running-task list — driven
 * off `useTaskManager`. See `../index.ts`'s header comment for this app's
 * full design.
 */
export function TaskManagerBody({
  apps,
  runnableApps,
  appByScript,
}: {
  apps: ManagedAppDefinition[]
  runnableApps: ManagedAppDefinition[]
  appByScript: Record<string, ManagedAppDefinition>
}) {
  const tm = useTaskManager(apps, runnableApps)
  // Left out of the Spawn list entirely when its `isAvailable` (see
  // `logic/types.ts`) fails — e.g. `backdoor.app.js` needs Singularity
  // access — same "hide, don't disable" treatment a regular app gets in
  // `ui/components/app-grid.tsx`.
  const spawnableApps = apps.filter(tm.appAvailable)

  const ramBar = (
    <div style={{ marginBottom: '12px' }}>
      <div className="bb-progress">
        <div
          className={`bb-progress-fill${tm.homePct > 90 ? ' bb-progress-fill--danger' : ''}`}
          style={{ width: `${tm.homePct}%` }}
        />
      </div>
      <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '4px', textAlign: 'right' }}>
        home:
        {' '}
        {tm.homeRam.used.toFixed(2)}
        {' '}
        /
        {tm.homeRam.max.toFixed(2)}
        {' '}
        GB
      </div>
    </div>
  )

  const errorBanner = tm.error
    ? (
        <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
          {tm.error}
        </div>
      )
    : null

  // Invisible click-catcher that closes an open cloud-host menu when the
  // player clicks anywhere else. Sits at z-index 1 — below the open row's
  // z-index 2 (see SpawnRow) — and above everything else (which is
  // unpositioned, so it stacks below any explicitly positioned sibling
  // regardless of DOM order).
  const menuBackdrop = tm.openMenuFor
    ? (
        <div onClick={() => tm.setOpenMenuFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
      )
    : null

  return (
    <div>
      {menuBackdrop}
      {errorBanner}
      {ramBar}

      <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>Spawn</div>
      {spawnableApps.map(app => (
        <SpawnRow key={app.script} tm={tm} app={app} appByScript={appByScript} />
      ))}

      <div style={{ fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px' }}>
        Running Tasks
        {' '}
        {tm.tasks.length > 0 ? `(${tm.tasks.length})` : ''}
      </div>
      {tm.loading
        ? (
            <div style={{ fontSize: '12px', opacity: 0.7 }}>Loading...</div>
          )
        : tm.tasks.length === 0
          ? (
              <div style={{ fontSize: '12px', opacity: 0.7 }}>No tasks running.</div>
            )
          : (
              tm.tasks.map(task => (
                <TaskRow key={taskKey(task)} tm={tm} task={task} app={appByScript[task.script]} />
              ))
            )}
    </div>
  )
}
