import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ARC_MAINNET_CHAIN_ID, getArcNetwork } from '@/utils/arcsplit'

/**
 * Returns the payer's current USDC allowance granted to the ArcSplit contract.
 */
export function useUsdcAllowance() {
  const { address, chainId } = useAccount()
  const network = getArcNetwork(chainId)

  const { data: raw, isLoading, refetch } = useReadContract({
    address: network?.usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && network?.contractAddress
      ? [address, network.contractAddress]
      : undefined,
    chainId: network?.chainId ?? ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address && !!network?.contractAddress },
  })

  return {
    raw: (raw) ?? 0n,
    isLoading,
    refetch,
  }
}
