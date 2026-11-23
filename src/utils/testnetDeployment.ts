import {
  encodeDeployData,
  getCreateAddress,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { validateContractAddress } from './arcsplit'

export const ARC_TESTNET_DEPLOYMENT = {
  chainId: 5_042_002,
  usdcAddress: '0x3600000000000000000000000000000000000000' as Address,
  // Keep the prior Testnet deployment as a collision check and rollback reference.
  previousContractAddress: validateContractAddress(
    '0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2',
    'ArcSplit Testnet legacy address',
  ),
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  reservePercent: 130n,
} as const

export const ARCSPLIT_FIXED_AMOUNTS_SIGNATURE = 'distributeFixedAmounts(address[],uint256[])'
export const ARCSPLIT_FIXED_AMOUNTS_SELECTOR = toFunctionSelector(ARCSPLIT_FIXED_AMOUNTS_SIGNATURE)
export const ARCSPLIT_ARRAY_LENGTH_MISMATCH_SELECTOR = toFunctionSelector('ArrayLengthMismatch()')

export interface ImmutableReference {
  start: number
  length: number
}

export interface ArcSplitArtifact {
  abi: Abi
  bytecode: Hex
  deployedBytecode: Hex
  immutableReferences: Record<string, ImmutableReference[]>
}

export function encodeArcSplitTestnetInitCode(artifact: ArcSplitArtifact): Hex {
  return encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ARC_TESTNET_DEPLOYMENT.usdcAddress],
  })
}

export function getArcSplitTestnetRuntimeCode(artifact: ArcSplitArtifact): Hex {
  let runtimeCode = artifact.deployedBytecode.slice(2)
  const immutableReferences = Object.values(artifact.immutableReferences).flat()
  if (immutableReferences.length === 0) {
    throw new Error('The ArcSplit artifact has no immutable references; the USDC constructor value cannot be verified.')
  }

  const usdcWord = `${'0'.repeat(24)}${ARC_TESTNET_DEPLOYMENT.usdcAddress.slice(2).toLowerCase()}`
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

export function predictArcSplitTestnetAddress(
  account: Address,
  pendingNonce: number | bigint,
): Address {
  const predicted = getCreateAddress({ from: account, nonce: BigInt(pendingNonce) })
  assertFreshTestnetAddress(predicted)
  return predicted
}

export function assertFreshTestnetAddress(address: Address): void {
  if (address.toLowerCase() === ARC_TESTNET_DEPLOYMENT.previousContractAddress) {
    throw new Error('The predicted address is the existing Testnet deployment; refusing to reuse it.')
  }
}

export function getDeploymentFeeBudget(gas: bigint, gasPrice: bigint) {
  const gasWithReserve = (gas * ARC_TESTNET_DEPLOYMENT.reservePercent + 99n) / 100n
  return {
    gasWithReserve,
    estimatedFee: gas * gasPrice,
    reserveFee: gasWithReserve * gasPrice,
  }
}
