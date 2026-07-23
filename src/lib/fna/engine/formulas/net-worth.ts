// src/lib/fna/engine/formulas/net-worth.ts
// Net-worth / balance sheet: total assets − total liabilities. Pure decimal.js
// (ADR-015). Aggregate/permitted balances only — the securities firewall (§4.1)
// is enforced upstream at data capture; this formula sums whatever it is handed.

import { money, str, sum, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const NET_WORTH_ID = 'net_worth'
export const NET_WORTH_VERSION = '1.0.0'

export interface BalanceLine {
  label: string
  amount: number
}

export interface NetWorthInput {
  assets: BalanceLine[]
  liabilities: BalanceLine[]
}

export interface NetWorthOutput {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  assetCount: number
  liabilityCount: number
}

export function netWorth(input: NetWorthInput, ctx: CalcContext): CalcResult<NetWorthOutput> {
  const totalAssets = sum(input.assets.map((a) => a.amount))
  const totalLiabilities = sum(input.liabilities.map((l) => l.amount))
  const nw = totalAssets.minus(totalLiabilities)

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.assets.length === 0) {
    missing.push('assets')
    warnings.push({ code: 'no_assets', message: 'No assets supplied; totals reflect liabilities only.', severity: 'warning' })
  }

  return buildResult<NetWorthOutput>({
    formulaId: NET_WORTH_ID,
    formulaVersion: NET_WORTH_VERSION,
    inputs: { assetCount: input.assets.length, liabilityCount: input.liabilities.length },
    output: {
      totalAssets: money(totalAssets),
      totalLiabilities: money(totalLiabilities),
      netWorth: money(nw),
      assetCount: input.assets.length,
      liabilityCount: input.liabilities.length,
    },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { totalAssetsExact: str(totalAssets), totalLiabilitiesExact: str(totalLiabilities), netWorthExact: str(nw) },
    warnings,
    missingInputs: missing,
  })
}
