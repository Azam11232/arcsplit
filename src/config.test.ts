import { describe, expect, it } from 'vitest'
import { config, getSupportedChains } from './config'
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARCSPLIT_ADDRESS,
  ARCSPLIT_FIXED_ABI,
  ARCSPLIT_MAINNET_NEXT_ADDRESS,
  ARCSPLIT_MAINNET_USE_NEXT_ADDRESS,
  getArcNetwork,
} from './utils/arcsplit'

describe('ArcSplit supported networks', () => {
  it('uses only the injected wallet connector', () => {
    expect(config.connectors.map(({ id }) => id)).toEqual(['injected'])
  })

  it('keeps production Mainnet-only while allowing Testnet in development', () => {
    expect(getSupportedChains(true).map(({ id }) => id)).toEqual([ARC_MAINNET_CHAIN_ID])
    expect(getSupportedChains(false).map(({ id }) => id)).toEqual([
      ARC_MAINNET_CHAIN_ID,
      ARC_TESTNET_CHAIN_ID,
    ])
  })

  it('uses Arc Mainnet as the primary network and retains Arc Testnet', () => {
    expect(config.chains.map(({ id }) => id)).toEqual([
      ARC_MAINNET_CHAIN_ID,
      ARC_TESTNET_CHAIN_ID,
    ])
    expect(getArcNetwork(ARC_TESTNET_CHAIN_ID)).toMatchObject({
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: '0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35',
    })
    expect(getArcNetwork(ARC_MAINNET_CHAIN_ID)?.contractAddress).toBe(
      ARCSPLIT_MAINNET_USE_NEXT_ADDRESS ? ARCSPLIT_MAINNET_NEXT_ADDRESS : ARCSPLIT_ADDRESS,
    )
    expect(ARCSPLIT_FIXED_ABI.some((item) =>
      item.type === 'function' &&
      item.name === 'distributeFixedAmounts' &&
      item.inputs.map(({ type }) => type).join(',') === 'address[],uint256[]',
    )).toBe(true)
  })

  it('does not recognize Testnet as an available network in production', () => {
    expect(getArcNetwork(ARC_TESTNET_CHAIN_ID, true)).toBeUndefined()
    expect(getArcNetwork(ARC_TESTNET_CHAIN_ID, false)).toMatchObject({
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  })

  it('does not offer Ethereum as a supported ArcSplit network', () => {
    expect(config.chains.map(({ id }) => Number(id))).not.toContain(1)
    expect(getArcNetwork(1)).toBeUndefined()
  })
})
