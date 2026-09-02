import type { ContractsLogEntry } from './types'
import { formatMoney, formatNumber } from '../../../utils/format/game'
import { pluralize } from '../../../utils/format/string'

/// TYPES

export interface ContractLogSummary {
  total: number
  solved: number
  failed: number
  successRate: number

  firstTimestamp: number | null
  lastTimestamp: number | null
  duration: number

  contractsLastHour: number

  byTitle: Record<string, ContractTypeSummary>
  byHost: Record<string, ContractHostSummary>

  rewards: {
    money: number
    companyReputation: Record<string, number>
    factionReputation: Record<string, number>
  }

  log: ContractsLogEntry[]
}

export interface ContractTypeSummary {
  total: number
  solved: number
  failed: number
  successRate: number
}

export interface ContractHostSummary {
  total: number
  solved: number
  failed: number
  successRate: number
}

export type ContractReward
  = | {
    type: 'money'
    amount: number
  }
  | {
    type: 'company'
    amount: number
    company: string
  }
  | {
    type: 'faction'
    amount: number
    factions: string[]
  }

/// HELPERS

function createCounter() {
  return {
    total: 0,
    solved: 0,
    failed: 0,
    successRate: 0,
  }
}

function updateCounter(
  counter: ReturnType<typeof createCounter>,
  solved: boolean,
) {
  counter.total++

  if (solved) {
    counter.solved++
  }
  else {
    counter.failed++
  }
}

function finalizeCounter(
  counter: ReturnType<typeof createCounter>,
) {
  counter.successRate
    = counter.total === 0
      ? 0
      : counter.solved / counter.total
}

function parseContractReward(reward: string): ContractReward {
  const money = reward.match(
    /^Gained \$([\d.]+)m$/,
  )

  if (money) {
    return {
      type: 'money',
      amount: Number(money[1]) * 1_000_000,
    }
  }

  const company = reward.match(
    /^Gained ([\d.]+) company reputation for (.+)$/,
  )

  if (company) {
    return {
      type: 'company',
      amount: Number(company[1]),
      company: company[2],
    }
  }

  const faction = reward.match(
    /^Gained ([\d.]+) faction reputation for (.+)$/,
  )

  if (faction) {
    return {
      type: 'faction',
      amount: Number(faction[1]),
      factions: [faction[2]],
    }
  }

  const factions = reward.match(
    /^Gained ([\d.]+) reputation for each of the following factions: (.+)$/,
  )

  if (factions) {
    return {
      type: 'faction',
      amount: Number(factions[1]),
      factions: factions[2].split(', '),
    }
  }

  throw new Error(`Unknown contract reward: ${reward}`)
}

/// Summary

export function summarizeContractLog(
  entries: ContractsLogEntry[],
): ContractLogSummary {
  if (!entries?.length) {
    return {
      total: 0,
      solved: 0,
      failed: 0,
      successRate: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      duration: 0,
      byTitle: {},
      byHost: {},
      rewards: {
        money: 0,
        companyReputation: {},
        factionReputation: {},
      },
      contractsLastHour: 0,
      log: [],
    }
  }

  const summary: ContractLogSummary = {
    total: entries.length,
    solved: 0,
    failed: 0,
    successRate: 0,

    firstTimestamp: Math.min(...entries.map(e => e.ts)),
    lastTimestamp: Math.max(...entries.map(e => e.ts)),
    duration: 0,

    contractsLastHour: 0,

    byTitle: {},
    byHost: {},

    rewards: {
      money: 0,
      companyReputation: {},
      factionReputation: {},
    },
    log: entries.map((entry) => {
      if (entry.reward) {
        const reward = parseContractReward(entry.reward)
        let rString = ''
        switch (reward.type) {
          case 'money':
            rString = `+${formatMoney(reward.amount)}`
            break

          case 'company':
            rString = `+${formatNumber(reward.amount)} to ${reward.company}`
            break

          case 'faction':
            rString = `+${formatNumber(reward.amount)} to ${pluralize(reward.factions.length, 'faction', 'factions')}`
            break
        }
        return {
          ...entry,
          reward: rString,
        }
      }
      return entry
    }),
  }

  const now = Date.now()
  const oneHour = 60 * 60 * 1000

  for (const entry of entries) {
    if (entry.solved) {
      summary.solved++
    }
    else {
      summary.failed++
    }

    // By title
    const title = summary.byTitle[entry.title] ??= createCounter()
    updateCounter(title, entry.solved)

    // By host
    const host = summary.byHost[entry.host] ??= createCounter()
    updateCounter(host, entry.solved)

    if (entry.reward) {
      const reward = parseContractReward(entry.reward)
      switch (reward.type) {
        case 'money':
          summary.rewards.money += reward.amount
          break

        case 'company':
          summary.rewards.companyReputation[reward.company]
            = (summary.rewards.companyReputation[reward.company] ?? 0) + reward.amount
          break

        case 'faction':
          for (const faction of reward.factions) {
            summary.rewards.factionReputation[faction]
              = (summary.rewards.factionReputation[faction] ?? 0) + reward.amount
          }
          break
      }
    }

    if (entry.ts >= now - oneHour) {
      summary.contractsLastHour++
    }
  }

  summary.successRate = summary.solved / summary.total

  for (const stats of Object.values(summary.byTitle)) {
    finalizeCounter(stats)
  }

  for (const stats of Object.values(summary.byHost)) {
    finalizeCounter(stats)
  }

  summary.duration
    = summary.lastTimestamp! - summary.firstTimestamp!

  return summary
}
