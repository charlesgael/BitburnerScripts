import type { AppDefinition } from '../types'
import { CloudServersApp } from './cloud-servers'
import { ContractsApp } from './contracts'
import { FileExplorerApp } from './file-explorer'
import { GoApp } from './go'
import { MoneyFarmApp } from './money-farm'
import { ProgramsApp } from './programs'
import { ShareApp } from './share'
import { TrainerApp } from './trainer'
import { XpFarmApp } from './xp-farm'

/**
 * Registry of every app shown in the sidebar grid (see
 * `ui/components/app-grid.tsx`). To add a new app: create a folder next to
 * `hello-world/` containing an `index.ts` that exports an `AppDefinition`
 * (with its own `components/`/`logic/` inside, per the existing apps), then
 * list it here.
 */
export const APPS: AppDefinition[] = [
  /* HelloWorldApp, */
  FileExplorerApp,
  ProgramsApp,
  CloudServersApp,
  ShareApp,
  XpFarmApp,
  MoneyFarmApp,
  TrainerApp,
  GoApp,
  ContractsApp,
]
