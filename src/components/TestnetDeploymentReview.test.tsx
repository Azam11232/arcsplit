import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Abi, Hex } from 'viem'
import {
  ARC_TESTNET_DEPLOYMENT,
  encodeArcSplitTestnetInitCode,
  getArcSplitTestnetRuntimeCode,
  predictArcSplitTestnetAddress,
  type ArcSplitArtifact,
} from '@/utils/testnetDeployment'
import { TestnetDeploymentReview } from './TestnetDeploymentReview'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  balance: vi.fn(),
  walletClient: vi.fn(),
  publicClient: {
    getTransactionCount: vi.fn(),
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    getCode: vi.fn(),
    getBalance: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    simulateContract: vi.fn(),
  },
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useBalance: mocks.balance,
  usePublicClient: () => mocks.publicClient,
  useWalletClient: mocks.walletClient,
}))

vi.mock('connectkit', () => ({
  ConnectKitButton: () => <button type="button">Connect MetaMask</button>,
}))

const artifact = {
  abi: [{
    type: 'constructor',
    inputs: [{ name: 'usdc_', type: 'address' }],
    stateMutability: 'nonpayable',
  }, {
    type: 'function',
    name: 'distributeFixedAmounts',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  }, {
    type: 'error',
    name: 'ArrayLengthMismatch',
    inputs: [],
  }],
  bytecode: { object: '0x60006000' },
  deployedBytecode: {
    object: `0x${'0'.repeat(64)}`,
    immutableReferences: { '23': [{ start: 0, length: 32 }] },
  },
}

const runtimeArtifact: ArcSplitArtifact = {
  abi: artifact.abi as Abi,
  bytecode: artifact.bytecode.object as Hex,
  deployedBytecode: artifact.deployedBytecode.object as Hex,
  immutableReferences: artifact.deployedBytecode.immutableReferences,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockReturnValue({
    address: '0x1111111111111111111111111111111111111111',
    chainId: ARC_TESTNET_DEPLOYMENT.chainId,
    isConnected: true,
  })
  mocks.balance.mockReturnValue({
    data: { value: 1_000_000_000_000_000_000n },
    isLoading: false,
    error: null,
  })
  mocks.publicClient.getTransactionCount.mockResolvedValue(7)
  mocks.publicClient.estimateGas.mockResolvedValue(660_057n)
  mocks.publicClient.getGasPrice.mockResolvedValue(25_000_000_000n)
  mocks.publicClient.getCode.mockImplementation(({ address }: { address: string }) =>
    Promise.resolve(address.toLowerCase() === ARC_TESTNET_DEPLOYMENT.previousContractAddress
      ? '0x6000'
      : '0x'),
  )
  mocks.publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000_000n)
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    contractAddress: predictArcSplitTestnetAddress(
      '0x1111111111111111111111111111111111111111',
      7,
    ),
  })
  mocks.publicClient.simulateContract.mockRejectedValue(new Error('ArrayLengthMismatch'))
  mocks.walletClient.mockReturnValue({ data: undefined })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(artifact),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MetaMask Testnet deployment review', () => {
  it('shows complete deployment details and requires a separate explicit approval', async () => {
    render(<TestnetDeploymentReview />)

    expect(await screen.findByText(/Preflight ready/)).toBeTruthy()
    expect(screen.getByText(ARC_TESTNET_DEPLOYMENT.usdcAddress)).toBeTruthy()
    expect(screen.getByText('Contract creation (no recipient address)')).toBeTruthy()
    expect(screen.getByText(/no transaction has been sent/i)).toBeTruthy()
    const deployButton = screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask' })
    expect(deployButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText(/I explicitly approve one Arc Testnet/)).toBeTruthy()
    await waitFor(() => expect(mocks.publicClient.estimateGas).toHaveBeenCalledTimes(1))
    expect(mocks.publicClient.getCode).toHaveBeenCalledTimes(2)
    expect(mocks.publicClient.getBalance).not.toHaveBeenCalled()
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled()
  })

  it('does not estimate, switch, or offer submission on another network', async () => {
    mocks.account.mockReturnValue({
      address: '0x1111111111111111111111111111111111111111',
      chainId: 5042,
      isConnected: true,
    })
    render(<TestnetDeploymentReview />)

    expect(await screen.findByText(/Switch to Arc Testnet manually/)).toBeTruthy()
    expect(mocks.publicClient.estimateGas).not.toHaveBeenCalled()
    expect(mocks.publicClient.getTransactionCount).not.toHaveBeenCalled()
  })

  it('blocks deployment when gas estimation fails', async () => {
    const sendTransaction = vi.fn()
    mocks.walletClient.mockReturnValue({ data: { sendTransaction } })
    mocks.publicClient.estimateGas.mockRejectedValue(new Error('Arc Testnet gas estimate failed'))
    render(<TestnetDeploymentReview />)

    expect((await screen.findByRole('alert')).textContent).toContain('Arc Testnet gas estimate failed')
    expect(screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask' }).hasAttribute('disabled'))
      .toBe(true)
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(mocks.publicClient.getBalance).not.toHaveBeenCalled()
  })

  it('submits one reviewed Testnet deployment only after the explicit approval', async () => {
    const account = '0x1111111111111111111111111111111111111111'
    const deployedAddress = predictArcSplitTestnetAddress(account, 7)
    const deployedRuntime = getArcSplitTestnetRuntimeCode(runtimeArtifact)
    let deploymentBroadcast = false
    const connectedWalletClient = {
      getChainId: vi.fn().mockResolvedValue(ARC_TESTNET_DEPLOYMENT.chainId),
      getAddresses: vi.fn().mockResolvedValue([account]),
      sendTransaction: vi.fn().mockImplementation(() => {
        deploymentBroadcast = true
        return Promise.resolve(`0x${'1'.repeat(64)}`)
      }),
    }
    mocks.walletClient.mockReturnValue({
      data: connectedWalletClient,
    })
    mocks.publicClient.getCode.mockImplementation(({ address }: { address: string }) =>
      Promise.resolve(address.toLowerCase() === ARC_TESTNET_DEPLOYMENT.previousContractAddress
        ? '0x6000'
        : deploymentBroadcast && address.toLowerCase() === deployedAddress.toLowerCase()
          ? deployedRuntime
          : '0x'),
    )
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      contractAddress: deployedAddress,
    })

    render(<TestnetDeploymentReview />)

    expect(await screen.findByText(/Preflight ready/)).toBeTruthy()
    const deployButton = await screen.findByRole('button', { name: 'Deploy ArcSplit with MetaMask' })
    expect(connectedWalletClient.sendTransaction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(/I explicitly approve one Arc Testnet/))
    expect(deployButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(deployButton)
    fireEvent.click(deployButton)

    await waitFor(() => expect(connectedWalletClient.getChainId).toHaveBeenCalled())
    await waitFor(() => expect(connectedWalletClient.sendTransaction).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Receipt status: success')).toBeTruthy()
    expect(connectedWalletClient.sendTransaction).toHaveBeenCalledTimes(1)
    expect(connectedWalletClient.sendTransaction).toHaveBeenCalledWith({
      account,
      data: encodeArcSplitTestnetInitCode(runtimeArtifact),
      value: 0n,
    })
    expect(mocks.publicClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: deployedAddress,
      functionName: 'distributeFixedAmounts',
      args: [[], []],
      account,
    }))
    expect(screen.getByRole('link', { name: `0x${'1'.repeat(64)}` }).getAttribute('href'))
      .toBe(`${ARC_TESTNET_DEPLOYMENT.explorerUrl}/tx/0x${'1'.repeat(64)}`)
  })
})
