import type { CloudServersState } from '../logic/use-cloud-servers'
import React from '@react'
import { formatMoney, formatRam } from '../../../../utils/format/game'
/**
 * The purchase form: hostname (blank = random), RAM tier picker, and the
 * Buy button.
 */
export function BuyForm({ cs }: { cs: CloudServersState }) {
  return (
    <div style={{ paddingTop: '10px' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', marginBottom: '8px' }}>
        Hostname
        <input
          type="text"
          value={cs.buyHostname}
          placeholder="blank = random name"
          disabled={cs.busy || cs.atServerLimit}
          onChange={(ev: any) => cs.setBuyHostname(ev.target.value)}
          className="bb-field"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', marginBottom: '8px' }}>
        RAM
        <select
          value={cs.buyRam}
          disabled={cs.busy || cs.atServerLimit || cs.ramTiers.length === 0}
          onChange={(ev: any) => cs.setBuyRam(Number(ev.target.value))}
          className="bb-field"
        >
          {cs.ramTiers.map(ram => (
            <option key={ram} value={ram} disabled={cs.costByRam[ram] > cs.moneyAvailable}>
              {formatRam(ram)}
              {' '}
              —
              {' '}
              {formatMoney(cs.costByRam[ram])}
            </option>
          ))}
        </select>
      </label>
      {cs.atServerLimit
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
              Server limit reached (
              {cs.serverLimit}
              ). Delete one to buy another.
            </div>
          )
        : null}
      {cs.buyError
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
              {cs.buyError}
            </div>
          )
        : null}
      <button
        onClick={() => void cs.handleBuy()}
        disabled={cs.buyDisabled}
        title={cs.insufficientMoney ? 'Not enough money' : undefined}
        className="bb-btn bb-btn--block"
      >
        {cs.buyBusy ? '...' : `Buy`}
      </button>
    </div>
  )
}
