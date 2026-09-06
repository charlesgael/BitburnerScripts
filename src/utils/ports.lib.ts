export const CONTRACT_PORT = 1
export const CONTRACT_TEST_PORT = 2
export const MONEY_FARM_PORT = 3
/**
 * Separate from `MONEY_FARM_PORT` on purpose — `steady-farm.daemon.ts`'s
 * worker processes write here instead, so each daemon only ever drains its
 * own queue. Sharing one port between two independent daemons would race:
 * whichever daemon's tick happens to poll first would consume (and
 * mis-attribute) status messages that actually came from the other
 * daemon's own workers, since nothing in a worker's own status payload
 * says which orchestrator launched it.
 */
export const STEADY_FARM_PORT = 4
