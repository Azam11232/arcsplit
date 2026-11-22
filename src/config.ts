
/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { arcTestnet } from 'viem/chains'
import { injected } from '@wagmi/connectors'
import { registerChain } from './tracing'

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.arc.io',
    },
  },
})

registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, 'https://rpc.mainnet.arc.io')

export function getSupportedChains(isProduction: boolean) {
  return isProduction ? [arcMainnet] as const : [arcMainnet, arcTestnet] as const
}

export const supportedChains = getSupportedChains(import.meta.env.PROD)

export const config = createConfig({
  chains: supportedChains,
  connectors: [injected()],
  transports: {
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io'),
    [arcTestnet.id]: http(),
  },
})
