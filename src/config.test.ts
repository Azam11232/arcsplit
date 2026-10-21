import { describe, expect, it } from 'vitest'
import { config } from './config'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, getArcNetwork } from './utils/arcsplit'

describe('ArcSplit supported networks', () => {
  it('uses Arc Mainnet as the primary network and retains Arc Testnet', () => {
    expect(config.chains.map(({ id }) => id)).toEqual([
      ARC_MAINNET_CHAIN_ID,
      ARC_TESTNET_CHAIN_ID,
    ])
    expect(getArcNetwork(ARC_TESTNET_CHAIN_ID)?.chainId).toBe(ARC_TESTNET_CHAIN_ID)
  })

  it('does not offer Ethereum as a supported ArcSplit network', () => {
    expect(config.chains.map(({ id }) => Number(id))).not.toContain(1)
    expect(getArcNetwork(1)).toBeUndefined()
  })
})
