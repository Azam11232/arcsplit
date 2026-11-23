import { describe, expect, it } from 'vitest'
import type { Abi, Hex } from 'viem'
import {
  ARC_MAINNET_DEPLOYMENT,
  assertFreshMainnetAddress,
  type ArcSplitMainnetArtifact,
  encodeArcSplitMainnetInitCode,
  getArcSplitMainnetRuntimeCode,
  getMainnetDeploymentFeeBudget,
  predictArcSplitMainnetAddress,
} from './mainnetDeployment'

const artifact: ArcSplitMainnetArtifact = {
  abi: [{
    type: 'constructor',
    inputs: [{ name: 'usdc_', type: 'address' }],
    stateMutability: 'nonpayable',
  }] as Abi,
  bytecode: '0x60006000',
  deployedBytecode: `0x${'0'.repeat(64)}`,
  immutableReferences: { '23': [{ start: 0, length: 32 }] },
}

describe('Arc Mainnet deployment parameters', () => {
  it('encodes the Mainnet USDC address as the constructor argument', () => {
    const initCode = encodeArcSplitMainnetInitCode(artifact)

    expect(initCode.slice(-64)).toBe(
      `${'0'.repeat(24)}${ARC_MAINNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`,
    )
  })

  it('patches immutable constructor references with Mainnet USDC', () => {
    expect(getArcSplitMainnetRuntimeCode(artifact)).toBe(
      `0x${'0'.repeat(24)}${ARC_MAINNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`,
    )
  })

  it('predicts a fresh CREATE address and rejects the existing Mainnet contract', () => {
    expect(
      predictArcSplitMainnetAddress(
        '0x1111111111111111111111111111111111111111',
        3,
      ),
    ).toMatch(/^0x[0-9a-fA-F]{40}$/)

    expect(() => assertFreshMainnetAddress(
      ARC_MAINNET_DEPLOYMENT.previousContractAddress,
    )).toThrow(/refusing to reuse/i)
  })

  it('budgets an estimate with an upward-rounded 30 percent gas reserve', () => {
    expect(getMainnetDeploymentFeeBudget(660_057n, 25_000_000_000n)).toEqual({
      gasWithReserve: 858_075n,
      estimatedFee: 16_501_425_000_000_000n,
      reserveFee: 21_451_875_000_000_000n,
    })
  })
})
