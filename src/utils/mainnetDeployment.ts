import {
  encodeDeployData,
  getCreateAddress,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { ARCSPLIT_MAINNET_LEGACY_ADDRESS } from './arcsplit'

export interface ArcSplitMainnetArtifact {
  abi: Abi
  bytecode: Hex
  deployedBytecode: Hex
  immutableReferences: Record<string, { start: number; length: number }[]>
}

export const ARC_MAINNET_DEPLOYMENT = {
  chainId: 5_042,
  usdcAddress: '0x3600000000000000000000000000000000000000' as Address,
  expectedDeployerAddress: '0xBCCb7750dE26b1A1AC3a18cE08Be01eCd4094c6C' as Address,
  previousContractAddress: ARCSPLIT_MAINNET_LEGACY_ADDRESS,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerUrl: 'https://explorer.arc.io',
  reservePercent: 130n,
  sourceHash: '0x7f28a233c62b04c9444191ff924ba6ae1875843a611326156d5ace13181b3cef' as Hex,
} as const

export const ARCSPLIT_MAINNET_COMPILER_VERSION = '0.8.28+commit.7893614a'
export const ARCSPLIT_FIXED_AMOUNTS_SELECTOR = toFunctionSelector('distributeFixedAmounts(address[],uint256[])')
export const ARCSPLIT_ARRAY_LENGTH_MISMATCH_SELECTOR = toFunctionSelector('ArrayLengthMismatch()')

export function encodeArcSplitMainnetInitCode(artifact: ArcSplitMainnetArtifact): Hex {
  return encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ARC_MAINNET_DEPLOYMENT.usdcAddress],
  })
}

export function getArcSplitMainnetRuntimeCode(artifact: ArcSplitMainnetArtifact): Hex {
  let runtimeCode = artifact.deployedBytecode.slice(2)
  const immutableReferences = Object.values(artifact.immutableReferences).flat()
  if (immutableReferences.length === 0) {
    throw new Error('The ArcSplit artifact has no immutable references; the USDC constructor value cannot be verified.')
  }

  const usdcWord = `${'0'.repeat(24)}${ARC_MAINNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`
  for (const reference of immutableReferences) {
    if (
      !Number.isInteger(reference.start) ||
      reference.start < 0 ||
      reference.length !== 32 ||
      reference.start * 2 + reference.length * 2 > runtimeCode.length
    ) {
      throw new Error('The ArcSplit artifact has invalid immutable references.')
    }

    const start = reference.start * 2
    const end = start + reference.length * 2
    runtimeCode = `${runtimeCode.slice(0, start)}${usdcWord}${runtimeCode.slice(end)}`
  }

  return `0x${runtimeCode}`
}

export function predictArcSplitMainnetAddress(
  account: Address,
  pendingNonce: number | bigint,
): Address {
  const predicted = getCreateAddress({ from: account, nonce: BigInt(pendingNonce) })
  assertFreshMainnetAddress(predicted)
  return predicted
}

export function assertFreshMainnetAddress(address: Address): void {
  if (address.toLowerCase() === ARC_MAINNET_DEPLOYMENT.previousContractAddress.toLowerCase()) {
    throw new Error('The predicted address is the existing Mainnet deployment; refusing to reuse it.')
  }
}

export function getMainnetDeploymentFeeBudget(gas: bigint, gasPrice: bigint) {
  const gasWithReserve = (gas * ARC_MAINNET_DEPLOYMENT.reservePercent + 99n) / 100n
  return {
    gasWithReserve,
    estimatedFee: gas * gasPrice,
    reserveFee: gasWithReserve * gasPrice,
  }
}
