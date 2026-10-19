import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { USDC_ADDRESS, ARCSPLIT_ADDRESS, ARC_TESTNET_CHAIN_ID } from '@/utils/arcsplit'

/**
 * Returns the payer's current USDC allowance granted to the ArcSplit contract.
 */
export function useUsdcAllowance() {
  const { address } = useAccount()

  const { data: raw, isLoading, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && ARCSPLIT_ADDRESS ? [address, ARCSPLIT_ADDRESS] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address && !!ARCSPLIT_ADDRESS },
  })

  return {
    raw: (raw) ?? 0n,
    isLoading,
    refetch,
  }
}
