import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ARC_MAINNET_CHAIN_ID, formatUsdc, getArcNetwork } from '@/utils/arcsplit'

/**
 * Reads the connected Arc chain's ERC-20 USDC balance in 6-decimal units.
 * Do not use the native balance: Arc's gas-token view uses 18 decimals.
 */
export function useUsdcBalance() {
  const { address, chainId } = useAccount()
  const network = getArcNetwork(chainId)

  const { data: rawBalance, isLoading, refetch } = useReadContract({
    address: network?.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: network?.chainId ?? ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address && !!network },
  })

  const raw = (rawBalance) ?? 0n
  const decimals = network?.usdcDecimals ?? 6

  return {
    raw,
    decimals,
    formatted: formatUsdc(raw),
    isLoading,
    refetch,
  }
}
