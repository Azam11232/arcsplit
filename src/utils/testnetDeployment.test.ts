import { describe, expect, it } from 'vitest'
import {
  ARC_TESTNET_DEPLOYMENT,
  assertFreshTestnetAddress,
  ARCSPLIT_FIXED_AMOUNTS_SELECTOR,
  encodeArcSplitTestnetInitCode,
  getDeploymentFeeBudget,
  getArcSplitTestnetRuntimeCode,
  predictArcSplitTestnetAddress,
} from './testnetDeployment'

describe('MetaMask Testnet deployment review parameters', () => {
  it('retains the configured prior Testnet contract for collision protection', () => {
    expect(ARC_TESTNET_DEPLOYMENT.previousContractAddress).toBe(
      '0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2',
    )
  })

  it('encodes the Testnet USDC address as the constructor argument', () => {
    const initCode = encodeArcSplitTestnetInitCode({
      abi: [{
        type: 'constructor',
        inputs: [{ name: 'usdc_', type: 'address' }],
        stateMutability: 'nonpayable',
      }],
      bytecode: '0x60006000',
      deployedBytecode: `0x${'0'.repeat(64)}`,
      immutableReferences: { '23': [{ start: 0, length: 32 }] },
    })

    expect(initCode.slice(-64)).toBe(
      `${'0'.repeat(24)}${ARC_TESTNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`,
    )
  })

  it('patches immutable constructor references with the configured Testnet USDC', () => {
    const runtimeCode = getArcSplitTestnetRuntimeCode({
      abi: [],
      bytecode: '0x6000',
      deployedBytecode: `0x${'0'.repeat(64)}`,
      immutableReferences: { '23': [{ start: 0, length: 32 }] },
    })

    expect(runtimeCode).toBe(`0x${'0'.repeat(24)}${ARC_TESTNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`)
    expect(ARCSPLIT_FIXED_AMOUNTS_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/)
  })

  it('predicts a new CREATE address and rejects the previous Testnet address', () => {
    expect(
      predictArcSplitTestnetAddress(
        '0x1111111111111111111111111111111111111111',
        3,
      ),
    ).toMatch(/^0x[0-9a-fA-F]{40}$/)

    expect(() => assertFreshTestnetAddress(
      ARC_TESTNET_DEPLOYMENT.previousContractAddress,
    )).toThrow(/refusing to reuse/i)
  })

  it('budgets an estimate with an upward-rounded 30 percent gas reserve', () => {
    expect(getDeploymentFeeBudget(660_057n, 25_000_000_000n)).toEqual({
      gasWithReserve: 858_075n,
      estimatedFee: 16_501_425_000_000_000n,
      reserveFee: 21_451_875_000_000_000n,
    })
  })
})
