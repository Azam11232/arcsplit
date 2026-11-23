import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ARC_MAINNET_CHAIN_ID, getArcNetwork, isProductionArcEnvironment } from '@/utils/arcsplit'

/**
 * Returns the payer's current USDC allowance granted to the ArcSplit contract.
 */
export function useUsdcAllowance() {
  const { address, chainId } = useAccount()
  const network = getArcNetwork(chainId)
  const productionTestnetBlocked = isProductionArcEnvironment()
    && chainId !== undefined
    && chainId !== ARC_MAINNET_CHAIN_ID

  const { data: raw, error, isError, isLoading, isFetching, refetch } = useReadContract({
    address: network?.usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && network?.contractAddress
      ? [address, network.contractAddress]
      : undefined,
    chainId: network?.chainId ?? ARC_MAINNET_CHAIN_ID,
    query: {
      enabled: !!address && !!network?.contractAddress && !productionTestnetBlocked,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  })

  return {
    raw: (raw) ?? 0n,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  }
}
