import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { USDC_ADDRESS, USDC_DECIMALS, ARC_TESTNET_CHAIN_ID, formatUsdc } from '@/utils/arcsplit'

/**
 * Returns the connected wallet's USDC balance on Arc Testnet.
 * Reads from the ERC-20 contract (6-decimal view) — do NOT also use
 * useBalance for the native view on Arc, as they both represent the same pool.
 */
export function useUsdcBalance() {
  const { address } = useAccount()

  const { data: rawBalance, isLoading, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const raw = (rawBalance) ?? 0n
  const decimals = USDC_DECIMALS

  return {
    raw,
    decimals,
    formatted: formatUsdc(raw),
    isLoading,
    refetch,
  }
}
