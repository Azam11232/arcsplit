import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Abi, Hex } from 'viem'
import {
  ARC_MAINNET_DEPLOYMENT,
  type ArcSplitMainnetArtifact,
  encodeArcSplitMainnetInitCode,
  getArcSplitMainnetRuntimeCode,
  predictArcSplitMainnetAddress,
} from '@/utils/mainnetDeployment'
import { MainnetDeploymentReview } from './MainnetDeploymentReview'

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
  ConnectKitButton: () => <button type="button">Connect MetaMask or OKX</button>,
}))

vi.mock('@/config', () => ({
  arcMainnet: { nativeCurrency: { decimals: 18 } },
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
  metadata: JSON.stringify({
    compiler: { version: '0.8.28+commit.7893614a' },
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 } },
    sources: {
      'contracts/ArcSplit.sol': { keccak256: ARC_MAINNET_DEPLOYMENT.sourceHash },
    },
  }),
}

const runtimeArtifact: ArcSplitMainnetArtifact = {
  abi: artifact.abi as Abi,
  bytecode: artifact.bytecode.object as Hex,
  deployedBytecode: artifact.deployedBytecode.object as Hex,
  immutableReferences: artifact.deployedBytecode.immutableReferences,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockReturnValue({
    address: ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress,
    chainId: ARC_MAINNET_DEPLOYMENT.chainId,
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
    Promise.resolve(address.toLowerCase() === ARC_MAINNET_DEPLOYMENT.previousContractAddress.toLowerCase()
      ? '0x6000'
      : '0x'),
  )
  mocks.publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000_000n)
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    contractAddress: predictArcSplitMainnetAddress(
      ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress,
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

describe('Arc Mainnet deployment review', () => {
  it('shows Mainnet deployment details and requires a separate approval', async () => {
    render(<MainnetDeploymentReview />)

    expect(await screen.findByText(/Preflight ready/)).toBeTruthy()
    expect(screen.getByText('Arc Mainnet · 5042')).toBeTruthy()
    expect(screen.getByText(ARC_MAINNET_DEPLOYMENT.usdcAddress)).toBeTruthy()
    expect(screen.getByText('Contract creation (no recipient address)')).toBeTruthy()
    expect(screen.getByText(/no transaction has been sent/i)).toBeTruthy()
    const deployButton = screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' })
    expect(deployButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText(/I explicitly approve one Arc Mainnet/)).toBeTruthy()
    await waitFor(() => expect(mocks.publicClient.estimateGas).toHaveBeenCalledTimes(1))
    expect(mocks.publicClient.getCode).toHaveBeenCalledTimes(2)
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled()
  })

  it('does not estimate or offer submission on another network', async () => {
    mocks.account.mockReturnValue({
      address: ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress,
      chainId: 5042002,
      isConnected: true,
    })
    render(<MainnetDeploymentReview />)

    expect(await screen.findByText(/Switch to Arc Mainnet manually/)).toBeTruthy()
    expect(mocks.publicClient.estimateGas).not.toHaveBeenCalled()
    expect(mocks.publicClient.getTransactionCount).not.toHaveBeenCalled()
  })

  it('blocks preflight when the connected wallet is not the expected deployer', async () => {
    mocks.account.mockReturnValue({
      address: '0x1111111111111111111111111111111111111111',
      chainId: ARC_MAINNET_DEPLOYMENT.chainId,
      isConnected: true,
    })
    render(<MainnetDeploymentReview />)

    expect(await screen.findByText(new RegExp(`does not match the expected deployer ${ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress}`))).toBeTruthy()
    expect(screen.getByText(ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress)).toBeTruthy()
    expect(mocks.publicClient.estimateGas).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('blocks wallet submission when the reviewed artifact does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...artifact,
        metadata: JSON.stringify({
          compiler: { version: '0.8.28+commit.7893614a' },
          settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 } },
          sources: { 'contracts/ArcSplit.sol': { keccak256: `0x${'0'.repeat(64)}` } },
        }),
      }),
    }))
    const sendTransaction = vi.fn()
    mocks.walletClient.mockReturnValue({ data: { sendTransaction } })
    render(<MainnetDeploymentReview />)

    expect((await screen.findByRole('alert')).textContent).toContain('does not match the reviewed Mainnet source')
    expect(screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' }).hasAttribute('disabled'))
      .toBe(true)
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('does not open the wallet when gas estimation fails', async () => {
    const sendTransaction = vi.fn()
    mocks.walletClient.mockReturnValue({ data: { sendTransaction } })
    mocks.publicClient.estimateGas.mockRejectedValue(new Error('Arc Mainnet gas estimate failed'))
    render(<MainnetDeploymentReview />)

    expect((await screen.findByRole('alert')).textContent).toContain('Arc Mainnet gas estimate failed')
    expect(screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' }).hasAttribute('disabled'))
      .toBe(true)
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('rechecks the wallet chain before opening the deployment request', async () => {
    const account = ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress
    const connectedWalletClient = {
      getChainId: vi.fn().mockResolvedValue(5042002),
      getAddresses: vi.fn().mockResolvedValue([account]),
      sendTransaction: vi.fn(),
    }
    mocks.walletClient.mockReturnValue({ data: connectedWalletClient })
    render(<MainnetDeploymentReview />)

    expect(await screen.findByText(/Preflight ready/)).toBeTruthy()
    const deployButton = screen.getByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' })
    fireEvent.click(screen.getByLabelText(/I explicitly approve one Arc Mainnet/))
    fireEvent.click(deployButton)

    expect((await screen.findByRole('alert')).textContent).toContain('no transaction was opened')
    expect(connectedWalletClient.sendTransaction).not.toHaveBeenCalled()
  })

  it('submits one reviewed deployment only after explicit approval and wallet confirmation', async () => {
    const account = ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress
    const deployedAddress = predictArcSplitMainnetAddress(account, 7)
    const deployedRuntime = getArcSplitMainnetRuntimeCode(runtimeArtifact)
    let deploymentSubmitted = false
    const connectedWalletClient = {
      getChainId: vi.fn().mockResolvedValue(ARC_MAINNET_DEPLOYMENT.chainId),
      getAddresses: vi.fn().mockResolvedValue([account]),
      sendTransaction: vi.fn().mockImplementation(() => {
        deploymentSubmitted = true
        return Promise.resolve(`0x${'1'.repeat(64)}`)
      }),
    }
    mocks.walletClient.mockReturnValue({ data: connectedWalletClient })
    mocks.publicClient.getCode.mockImplementation(({ address }: { address: string }) => {
      if (address.toLowerCase() === ARC_MAINNET_DEPLOYMENT.previousContractAddress.toLowerCase()) {
        return Promise.resolve('0x6000')
      }
      return Promise.resolve(
        deploymentSubmitted && address.toLowerCase() === deployedAddress.toLowerCase()
          ? deployedRuntime
          : '0x',
      )
    })
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      contractAddress: deployedAddress,
    })

    render(<MainnetDeploymentReview />)

    expect(await screen.findByText(/Preflight ready/)).toBeTruthy()
    const deployButton = await screen.findByRole('button', { name: 'Deploy ArcSplit with MetaMask or OKX' })
    expect(connectedWalletClient.sendTransaction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(/I explicitly approve one Arc Mainnet/))
    expect(deployButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(deployButton)
    fireEvent.click(deployButton)

    await waitFor(() => expect(connectedWalletClient.getChainId).toHaveBeenCalled())
    await waitFor(() => expect(connectedWalletClient.sendTransaction).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Receipt status: success')).toBeTruthy()
    expect(connectedWalletClient.sendTransaction).toHaveBeenCalledWith({
      account,
      data: encodeArcSplitMainnetInitCode(runtimeArtifact),
      value: 0n,
    })
    expect(mocks.publicClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: deployedAddress,
      functionName: 'distributeFixedAmounts',
      args: [[], []],
      account,
    }))
    expect(screen.getByRole('link', { name: `0x${'1'.repeat(64)}` }).getAttribute('href'))
      .toBe(`${ARC_MAINNET_DEPLOYMENT.explorerUrl}/tx/0x${'1'.repeat(64)}`)
  })
})
