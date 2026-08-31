import type { ContractLogSummary } from '../../../../contracts/state-file/make-stats'
import React from '@react'
import { formatMoney, formatNumber } from '../../../../utils/format/game'
import { pluralize } from '../../../../utils/format/string'
import { HeroStat } from './hero-stat'

export function RewardsSummary(props: {
  rewards: ContractLogSummary['rewards']
} & React.HTMLAttributes<HTMLDivElement>) {
  const {
    rewards,
    ...divProps
  } = props

  const compRep = Object.values(rewards.companyReputation)
    .reduce((a, b) => a + b, 0)
  const compCount = Object.entries(rewards.companyReputation)
    .filter(([, val]) => val)
    .length
  const factRep = Object.values(rewards.factionReputation)
    .reduce((a, b) => a + b, 0)
  const factCount = Object.entries(rewards.factionReputation)
    .filter(([, val]) => val)
    .length

  // Descending — these feed the "Top Companies"/"Top Factions" cards below,
  // so the biggest reputation gains should lead, not trail.
  const companiesArr = Object.entries(rewards.companyReputation)
    .sort(([, valA], [, valB]) => valB - valA)
  const factionsArr = Object.entries(rewards.factionReputation)
    .sort(([, valA], [, valB]) => valB - valA)

  return (
    <div
      {...divProps}
      className="bb-card"
    >
      <div className="bb-card-header">Rewards Summary</div>
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 4,
      }}
      >
        <HeroStat
          title="Money Earned"
          value={`${formatMoney(rewards.money)}`}
          style={{ flex: 1 }}
          numSize={24}
          color="var(--bb-theme-success)"
        />
        <HeroStat
          title="Company Reputation"
          value={`${formatNumber(compRep)}`}
          sub={`Across ${pluralize(compCount, 'company', 'companies')}`}
          style={{ flex: 1 }}
          numSize={24}
          color="var(--bb-theme-info)"
        />
        <HeroStat
          title="Faction Reputation"
          value={`${formatNumber(factRep)}`}
          sub={`Across ${pluralize(factCount, 'faction', 'factions')}`}
          style={{ flex: 1 }}
          numSize={24}
          color="var(--bb-theme-cha)"
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 4,
        }}
      >
        <div className="bb-card" style={{ flex: 1 }}>
          <div className="bb-card-header">Top Companies</div>
          {companiesArr.map(([company, val]) => (
            <div key={company} style={{ display: 'flex' }}>
              <div style={{ flex: 1 }}>{company}</div>
              <div>{formatNumber(val)}</div>
            </div>
          ))}
        </div>
        <div className="bb-card" style={{ flex: 1 }}>
          <div className="bb-card-header">Top Factions</div>
          {factionsArr.map(([company, val]) => (
            <div key={company} style={{ display: 'flex' }}>
              <div style={{ flex: 1 }}>{company}</div>
              <div>{formatNumber(val)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
