import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUsdcAllowance } from './useUsdcAllowance'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useReadContract: mocks.readContract,
}))

vi.mock('@/utils/arcsplit', () => ({
  ARC_MAINNET_CHAIN_ID: 5042,
  isProductionArcEnvironment: () => false,
  getArcNetwork: () => ({
    chainId: 5042,
    contractAddress: '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
    usdcAddress: '0x3600000000000000000000000000000000000000',
  }),
}))

describe('useUsdcAllowance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.account.mockReturnValue({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 5042,
    })
    mocks.readContract.mockReturnValue({ data: 0n })
  })

  it('reads allowance for the selected Mainnet contract spender', () => {
    renderHook(() => useUsdcAllowance())

    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: '0x3600000000000000000000000000000000000000',
      functionName: 'allowance',
      args: [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
      ],
      chainId: 5042,
    }))
  })
})
