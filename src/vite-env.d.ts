/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly VITE_ARCSPLIT_ADDRESS?: string
  readonly VITE_ARCSPLIT_MAINNET_NEXT_ADDRESS?: string
  readonly VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS?: string
  readonly VITE_ARCSPLIT_TESTNET_ADDRESS?: string
}
