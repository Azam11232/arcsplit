import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { AlertCircle, ArrowLeft, Check, Loader2, ShieldCheck } from 'lucide-react'
import { formatUnits, keccak256, type Abi, type Address, type Hex } from 'viem'
import { useAccount, useBalance, usePublicClient, useWalletClient } from 'wagmi'
import { arcMainnet } from '@/config'
import {
  ARC_MAINNET_DEPLOYMENT,
  ARCSPLIT_ARRAY_LENGTH_MISMATCH_SELECTOR,
  ARCSPLIT_FIXED_AMOUNTS_SELECTOR,
  ARCSPLIT_MAINNET_COMPILER_VERSION,
  type ArcSplitMainnetArtifact,
  assertFreshMainnetAddress,
  encodeArcSplitMainnetInitCode,
  getArcSplitMainnetRuntimeCode,
  getMainnetDeploymentFeeBudget,
  predictArcSplitMainnetAddress,
} from '@/utils/mainnetDeployment'

interface DeploymentEstimate {
  account: Address
  predictedAddress: Address
  initCodeHash: Hex
  initCodeBytes: number
  gas: bigint
  gasPrice: bigint
  estimatedFee: bigint
  reserveFee: bigint
  predictedAddressHasCode: boolean
  previousAddressHasCode: boolean
}

interface DeploymentResult {
  address: Address
  transactionHash: Hex
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseArtifact(value: unknown): ArcSplitMainnetArtifact {
  if (
    !isRecord(value) ||
    !Array.isArray(value.abi) ||
    !isRecord(value.bytecode) ||
    !isRecord(value.deployedBytecode) ||
    !isRecord(value.deployedBytecode.immutableReferences)
  ) {
    throw new Error('The Foundry ArcSplit artifact has an unexpected shape. Run forge build and retry.')
  }

  const bytecode = value.bytecode.object
  const deployedBytecode = value.deployedBytecode.object
  if (
    typeof bytecode !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(bytecode) ||
    (bytecode.length - 2) % 2 !== 0 ||
    typeof deployedBytecode !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(deployedBytecode) ||
    (deployedBytecode.length - 2) % 2 !== 0
  ) {
    throw new Error('The compiled ArcSplit creation bytecode is missing or invalid.')
  }

  const metadataValue = value.metadata
  let metadata: unknown = metadataValue
  if (typeof metadataValue === 'string') {
    try {
      metadata = JSON.parse(metadataValue) as unknown
    } catch {
      throw new Error('The ArcSplit artifact metadata is invalid.')
    }
  }
  if (!isRecord(metadata) || !isRecord(metadata.compiler) || !isRecord(metadata.settings)) {
    throw new Error('The ArcSplit artifact is missing compiler metadata.')
  }
  const optimizer = metadata.settings.optimizer
  const sources = metadata.sources
  const source = isRecord(sources) ? sources['contracts/ArcSplit.sol'] : undefined
  if (
    metadata.compiler.version !== ARCSPLIT_MAINNET_COMPILER_VERSION ||
    metadata.settings.evmVersion !== 'paris' ||
    !isRecord(optimizer) ||
    optimizer.enabled !== true ||
    optimizer.runs !== 200 ||
    !isRecord(source) ||
    typeof source.keccak256 !== 'string' ||
    source.keccak256.toLowerCase() !== ARC_MAINNET_DEPLOYMENT.sourceHash.toLowerCase()
  ) {
    throw new Error('The ArcSplit artifact does not match the reviewed Mainnet source and compiler settings.')
  }

  const immutableReferences: ArcSplitMainnetArtifact['immutableReferences'] = {}
  for (const [id, references] of Object.entries(value.deployedBytecode.immutableReferences)) {
    if (!Array.isArray(references)) {
      throw new Error('The compiled ArcSplit artifact has invalid immutable references.')
    }
    immutableReferences[id] = references.map((reference) => {
      if (
        !isRecord(reference) ||
        typeof reference.start !== 'number' ||
        typeof reference.length !== 'number'
      ) {
        throw new Error('The compiled ArcSplit artifact has invalid immutable references.')
      }
      return { start: reference.start, length: reference.length }
    })
  }

  const abi = value.abi as Abi
  const constructor = abi.find((item) => item.type === 'constructor')
  if (
    !constructor ||
    constructor.inputs.length !== 1 ||
    constructor.inputs[0]?.type !== 'address'
  ) {
    throw new Error('The ArcSplit artifact constructor does not match the reviewed USDC address argument.')
  }

  const parsedArtifact = {
    abi,
    bytecode: bytecode as Hex,
    deployedBytecode: deployedBytecode as Hex,
    immutableReferences,
  }
  if (!abi.some((item) =>
    item.type === 'function' &&
    item.name === 'distributeFixedAmounts' &&
    item.inputs.length === 2 &&
    item.inputs[0]?.type === 'address[]' &&
    item.inputs[1]?.type === 'uint256[]',
  )) {
    throw new Error('The compiled ArcSplit ABI is missing distributeFixedAmounts(address[],uint256[]).')
  }
  getArcSplitMainnetRuntimeCode(parsedArtifact)
  return parsedArtifact
}

function errorMessage(error: unknown): string {
  if (isRecord(error)) {
    if (typeof error.shortMessage === 'string') return error.shortMessage
    if (typeof error.message === 'string') return error.message
  }
  return 'Could not prepare the deployment review from the Arc Mainnet RPC.'
}

function formatNative(value: bigint): string {
  return `${formatUnits(value, arcMainnet.nativeCurrency.decimals)} native USDC`
}

function containsExpectedRevert(error: unknown): boolean {
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!isRecord(current) || visited.has(current)) continue
    visited.add(current)
    const errorText = [current.name, current.errorName, current.shortMessage, current.message]
      .filter((entry): entry is string => typeof entry === 'string')
      .join(' ')
    if (
      errorText.includes('ArrayLengthMismatch') ||
      (typeof current.data === 'string'
        && current.data.toLowerCase().startsWith(ARCSPLIT_ARRAY_LENGTH_MISMATCH_SELECTOR))
    ) return true
    pending.push(current.cause, current.data)
  }
  return false
}

function isWalletRejection(error: unknown): boolean {
  let current = error
  while (isRecord(current)) {
    if (current.name === 'UserRejectedRequestError' || current.code === 4001) return true
    current = current.cause
  }
  return false
}

export function MainnetDeploymentReview() {
  const { address, chainId, isConnected } = useAccount()
  const expectedDeployerMatches = !!address
    && address.toLowerCase() === ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress.toLowerCase()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_DEPLOYMENT.chainId })
  const {
    data: nativeBalance,
    isLoading: balanceLoading,
    error: balanceError,
  } = useBalance({
    address,
    chainId: ARC_MAINNET_DEPLOYMENT.chainId,
    query: { enabled: !!address },
  })
  const [artifact, setArtifact] = useState<ArcSplitMainnetArtifact>()
  const [artifactError, setArtifactError] = useState('')
  const [estimate, setEstimate] = useState<DeploymentEstimate>()
  const [estimateFailure, setEstimateFailure] = useState<{
    account: Address
    chainId: number
    message: string
  }>()
  const [deploymentError, setDeploymentError] = useState('')
  const [deploymentStatus, setDeploymentStatus] = useState('')
  const [transactionHash, setTransactionHash] = useState<Hex>()
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult>()
  const [deploymentApproval, setDeploymentApproval] = useState<{ address: Address; chainId: number }>()
  const [isDeploying, setIsDeploying] = useState(false)
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const deploymentLock = useRef(false)

  const initCode = useMemo(
    () => artifact ? encodeArcSplitMainnetInitCode(artifact) : undefined,
    [artifact],
  )

  useEffect(() => {
    let active = true
    void fetch('/contracts/out/ArcSplit.sol/ArcSplit.json')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Foundry artifact not found. Run forge build before opening this page.')
        }
        return parseArtifact(await response.json() as unknown)
      })
      .then((loadedArtifact) => {
        if (active) setArtifact(loadedArtifact)
      })
      .catch((error: unknown) => {
        if (active) setArtifactError(errorMessage(error))
      })
    return () => {
      active = false
    }
  }, [])

  const createEstimate = useCallback(async (account: Address, deploymentData: Hex): Promise<DeploymentEstimate> => {
    if (!publicClient) throw new Error('Arc Mainnet RPC client is unavailable.')
    const [nonce, gas, gasPrice, previousCode] = await Promise.all([
      publicClient.getTransactionCount({ address: account, blockTag: 'pending' }),
      publicClient.estimateGas({ account, data: deploymentData }),
      publicClient.getGasPrice(),
      publicClient.getCode({ address: ARC_MAINNET_DEPLOYMENT.previousContractAddress }),
    ])
    const predictedAddress = predictArcSplitMainnetAddress(account, nonce)
    const predictedCode = await publicClient.getCode({ address: predictedAddress })
    const feeBudget = getMainnetDeploymentFeeBudget(gas, gasPrice)

    return {
      account,
      predictedAddress,
      initCodeHash: keccak256(deploymentData),
      initCodeBytes: (deploymentData.length - 2) / 2,
      gas,
      gasPrice,
      estimatedFee: feeBudget.estimatedFee,
      reserveFee: feeBudget.reserveFee,
      predictedAddressHasCode: !!predictedCode && predictedCode !== '0x',
      previousAddressHasCode: !!previousCode && previousCode !== '0x',
    }
  }, [publicClient])

  useEffect(() => {
    if (!expectedDeployerMatches || !address || !initCode || !publicClient || chainId !== ARC_MAINNET_DEPLOYMENT.chainId) return

    let active = true
    void (async () => {
      const currentEstimate = await createEstimate(address, initCode)
      if (!active) return
      setEstimate(currentEstimate)
      setEstimateFailure((failure) =>
        failure?.account.toLowerCase() === address.toLowerCase() && failure.chainId === chainId
          ? undefined
          : failure,
      )
    })()
      .catch((error: unknown) => {
        if (active) setEstimateFailure({ account: address, chainId, message: errorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [address, chainId, expectedDeployerMatches, initCode, publicClient, createEstimate])

  const wrongChain = isConnected && chainId !== ARC_MAINNET_DEPLOYMENT.chainId
  const currentEstimate = estimate?.account.toLowerCase() === address?.toLowerCase()
    && chainId === ARC_MAINNET_DEPLOYMENT.chainId
    ? estimate
    : undefined
  const hasConfirmedDeployment = !!address
    && deploymentApproval?.address.toLowerCase() === address.toLowerCase()
    && deploymentApproval.chainId === chainId
  const estimateError = estimateFailure
    && estimateFailure.account.toLowerCase() === address?.toLowerCase()
    && estimateFailure.chainId === chainId
    ? estimateFailure.message
    : ''
  const isEstimating = expectedDeployerMatches && chainId === ARC_MAINNET_DEPLOYMENT.chainId
    && !currentEstimate && !estimateError && !artifactError
  const balanceIsSufficient = !!currentEstimate && !!nativeBalance
    && nativeBalance.value >= currentEstimate.reserveFee
  const canProceedToReview = expectedDeployerMatches && chainId === ARC_MAINNET_DEPLOYMENT.chainId
    && !!currentEstimate && balanceIsSufficient
    && !isEstimating && !estimateError && !artifactError && !balanceError && !balanceLoading
    && !currentEstimate.predictedAddressHasCode
    && currentEstimate.previousAddressHasCode
    && !!artifact && !!initCode
  const canDeploy = canProceedToReview && !!walletClient
    && hasConfirmedDeployment && !isDeploying && !deploymentResult
    && !submissionLocked
  const currentStatus = !isConnected
    ? 'Connect MetaMask or OKX to inspect the sender, nonce, and Mainnet balance.'
    : wrongChain
      ? 'Wrong network. Switch to Arc Mainnet manually in your wallet; this page will not switch networks.'
      : !expectedDeployerMatches
        ? `Connected wallet does not match the expected deployer ${ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress}. Deployment is blocked.`
      : isEstimating
        ? 'Estimating deployment transaction from the connected wallet...'
        : estimateError || artifactError || balanceError
          ? 'Preflight incomplete. No deployment transaction can be submitted.'
          : canProceedToReview
            ? 'Preflight ready. Review the transaction details and explicitly approve before your wallet opens.'
            : 'Preflight checks are incomplete or the wallet balance is below the reserve estimate.'

  const handleDeploy = async () => {
    if (
      deploymentLock.current ||
      !walletClient ||
      !publicClient ||
      !address ||
      !expectedDeployerMatches ||
      chainId !== ARC_MAINNET_DEPLOYMENT.chainId ||
      !currentEstimate ||
      !initCode ||
      !artifact ||
      !hasConfirmedDeployment ||
      !canProceedToReview
    ) return

    deploymentLock.current = true
    setIsDeploying(true)
    setDeploymentError('')
    setDeploymentStatus('Rechecking the connected account, chain, nonce, gas estimate, and fee before opening your wallet...')
    let walletRequestOpened = false
    let receiptStatus: string | undefined
    let caughtError: unknown

    try {
      const [walletChainId, walletAccounts] = await Promise.all([
        walletClient.getChainId(),
        walletClient.getAddresses(),
      ])
      if (walletChainId !== ARC_MAINNET_DEPLOYMENT.chainId) {
        throw new Error('Your wallet is no longer on Arc Mainnet. Switch networks manually; no transaction was opened.')
      }
      if (!walletAccounts[0] || walletAccounts[0].toLowerCase() !== address.toLowerCase()) {
        throw new Error('The active wallet account changed. Reconnect or select the reviewed account and review the details again.')
      }
      if (walletAccounts[0].toLowerCase() !== ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress.toLowerCase()) {
        throw new Error(`The active wallet does not match the expected deployer ${ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress}. No transaction was opened.`)
      }

      const latestEstimate = await createEstimate(address, initCode)
      const detailsChanged = latestEstimate.predictedAddress.toLowerCase() !== currentEstimate.predictedAddress.toLowerCase()
        || latestEstimate.initCodeHash.toLowerCase() !== currentEstimate.initCodeHash.toLowerCase()
        || latestEstimate.gas !== currentEstimate.gas
        || latestEstimate.gasPrice !== currentEstimate.gasPrice
        || latestEstimate.previousAddressHasCode !== currentEstimate.previousAddressHasCode
        || latestEstimate.predictedAddressHasCode !== currentEstimate.predictedAddressHasCode
      if (detailsChanged) {
        setEstimate(latestEstimate)
        setDeploymentApproval(undefined)
        setDeploymentStatus('Deployment details changed. Review the refreshed values and explicitly approve again; your wallet was not opened.')
        return
      }
      if (!latestEstimate.previousAddressHasCode) {
        throw new Error('Could not confirm code at the existing Mainnet contract. Deployment is blocked.')
      }
      if (latestEstimate.predictedAddressHasCode) {
        throw new Error('The predicted deployment address now contains code. Deployment is blocked to prevent an address collision.')
      }
      const latestBalance = await publicClient.getBalance({ address })
      if (latestBalance < latestEstimate.reserveFee) {
        throw new Error(`Insufficient native USDC for the deployment fee reserve (${formatNative(latestEstimate.reserveFee)}).`)
      }

      setDeploymentStatus('Your wallet is opening with one Standard CREATE contract-creation transaction. Review it there before signing.')
      walletRequestOpened = true
      const hash = await walletClient.sendTransaction({
        account: address,
        data: initCode,
        value: 0n,
      })
      setTransactionHash(hash)
      setDeploymentStatus(`Transaction ${hash} submitted. Waiting for the Arc Mainnet receipt...`)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      receiptStatus = receipt.status
      if (receipt.status !== 'success') {
        throw new Error(`Deployment transaction ${hash} was mined with status "${receipt.status}".`)
      }
      if (!receipt.contractAddress) {
        throw new Error(`Deployment transaction ${hash} succeeded but the receipt has no contract address.`)
      }
      assertFreshMainnetAddress(receipt.contractAddress)
      if (receipt.contractAddress.toLowerCase() !== latestEstimate.predictedAddress.toLowerCase()) {
        throw new Error(`The receipt deployed to ${receipt.contractAddress}, not the reviewed predicted address ${latestEstimate.predictedAddress}.`)
      }

      const deployedCode = await publicClient.getCode({ address: receipt.contractAddress })
      if (!deployedCode || deployedCode === '0x') {
        throw new Error(`No contract bytecode exists at deployed address ${receipt.contractAddress}.`)
      }
      const expectedRuntime = getArcSplitMainnetRuntimeCode(artifact)
      if (deployedCode.toLowerCase() !== expectedRuntime.toLowerCase()) {
        throw new Error('Deployed runtime bytecode does not match the compiled ArcSplit artifact and reviewed USDC constructor value.')
      }

      let expectedValidationRevert = false
      try {
        await publicClient.simulateContract({
          address: receipt.contractAddress,
          abi: artifact.abi,
          functionName: 'distributeFixedAmounts',
          args: [[], []],
          account: address,
        })
      } catch (error) {
        if (!containsExpectedRevert(error)) {
          throw new Error(`Read-only selector simulation failed: ${errorMessage(error)}`)
        }
        expectedValidationRevert = true
      }
      if (!expectedValidationRevert) {
        throw new Error('The read-only selector simulation did not return the expected ArrayLengthMismatch validation error.')
      }

      setDeploymentResult({ address: receipt.contractAddress, transactionHash: hash })
      setDeploymentStatus('Deployment receipt and contract verification succeeded. No token distributions were performed.')
    } catch (error) {
      caughtError = error
      setDeploymentError(errorMessage(error))
      setDeploymentStatus('')
    } finally {
      setIsDeploying(false)
      const keepSubmissionLock = walletRequestOpened
        && !isWalletRejection(caughtError)
        && receiptStatus !== 'reverted'
      if (!keepSubmissionLock) {
        deploymentLock.current = false
      } else {
        setSubmissionLocked(true)
      }
    }
  }

  return (
    <div className="app-shell min-h-dvh px-4 py-8">
      <main className="mx-auto w-full max-w-2xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <a
            href="/"
            className="surface-hover inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium"
            style={{ color: 'var(--ink-2)', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            <ArrowLeft className="h-4 w-4" /> ArcSplit
          </a>
          <ConnectKitButton />
        </div>

        <section
          className="rounded-3xl p-5 sm:p-7"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="mb-6 flex items-start gap-3">
            <div
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'var(--success-surface)', border: '1px solid var(--success-border)' }}
            >
              <ShieldCheck className="h-5 w-5" style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--success)' }}>
                Local Mainnet review
              </span>
              <h1 className="display mt-1 text-xl font-bold sm:text-2xl" style={{ color: 'var(--ink)' }}>
                Deploy ArcSplit with MetaMask or OKX
              </h1>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                Wallet confirmation only. This page never requests or reads a private key.
              </p>
            </div>
          </div>

          <div
            role="status"
            className="mb-5 flex items-start gap-2 rounded-xl px-3 py-3 text-sm"
            style={{
              background: canProceedToReview ? 'var(--success-surface)' : 'var(--info-surface)',
              border: `1px solid ${canProceedToReview ? 'var(--success-border)' : 'var(--info-border)'}`,
              color: canProceedToReview ? 'var(--success)' : 'var(--ink-2)',
            }}
          >
            {isEstimating
              ? <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
              : canProceedToReview
                ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
                : <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
            <span>{currentStatus}</span>
          </div>

          {(artifactError || estimateError || balanceError) && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-xl px-3 py-3 text-sm"
              style={{ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{artifactError || estimateError || errorMessage(balanceError)}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="Contract" value="ArcSplit" />
            <Detail label="Network" value={`Arc Mainnet · ${ARC_MAINNET_DEPLOYMENT.chainId}`} />
            <Detail label="Constructor USDC" value={ARC_MAINNET_DEPLOYMENT.usdcAddress} mono />
            <Detail label="Compiler" value={`${ARCSPLIT_MAINNET_COMPILER_VERSION} · optimizer 200 · Paris`} />
            <Detail label="Deployment method" value="Standard CREATE" />
            <Detail label="Transaction destination" value="Contract creation (no recipient address)" />
            <Detail label="Transaction value" value="0 USDC" />
            <Detail label="Expected deployer" value={ARC_MAINNET_DEPLOYMENT.expectedDeployerAddress} mono />
            <Detail label="Wallet sender" value={address ?? 'Connect wallet to inspect'} mono={!!address} />
            <Detail
              label="Predicted fresh address"
              value={currentEstimate?.predictedAddress ?? 'Calculated from connected account and pending nonce'}
              mono={!!currentEstimate}
            />
            <Detail
              label="Existing Mainnet contract"
              value={currentEstimate
                ? currentEstimate.previousAddressHasCode ? 'Code present; it will remain untouched' : 'Could not verify old deployment'
                : ARC_MAINNET_DEPLOYMENT.previousContractAddress}
              mono={!currentEstimate}
            />
            <Detail
              label="Predicted address code"
              value={currentEstimate
                ? currentEstimate.predictedAddressHasCode ? 'Already occupied; stop' : 'No code; fresh address'
                : 'Checked during preflight'}
            />
            <Detail label="Initcode" value={currentEstimate ? `${currentEstimate.initCodeBytes.toLocaleString()} bytes` : 'Waiting for artifact and wallet'} />
            <Detail label="Initcode hash" value={currentEstimate?.initCodeHash ?? 'Calculated during preflight'} mono={!!currentEstimate} />
            <Detail label="Estimated gas" value={currentEstimate?.gas.toLocaleString() ?? 'Not estimated'} />
            <Detail label="Estimated gas price" value={currentEstimate ? `${formatUnits(currentEstimate.gasPrice, 9)} gwei` : 'Not estimated'} />
            <Detail label="Estimated fee" value={currentEstimate ? formatNative(currentEstimate.estimatedFee) : 'Not estimated'} />
            <Detail label="Fee reserve (130%)" value={currentEstimate ? formatNative(currentEstimate.reserveFee) : 'Not estimated'} />
            <Detail
              label="Wallet native USDC balance"
              value={balanceLoading ? 'Loading...' : nativeBalance ? formatNative(nativeBalance.value) : 'Connect wallet to inspect'}
            />
            <Detail label="Transaction hash" value={transactionHash ?? 'Not created; no transaction has been sent'} mono={!!transactionHash} />
          </div>

          {deploymentStatus && (
            <div
              role="status"
              className="mt-4 rounded-xl px-3 py-3 text-sm"
              style={{ background: 'var(--info-surface)', border: '1px solid var(--info-border)', color: 'var(--ink-2)' }}
            >
              {isDeploying && <Loader2 className="mr-2 inline h-4 w-4 animate-spin align-text-bottom" />}
              {deploymentStatus}
            </div>
          )}

          {deploymentError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl px-3 py-3 text-sm"
              style={{ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{deploymentError}</span>
            </div>
          )}

          {deploymentResult && (
            <div
              className="mt-4 rounded-2xl p-4"
              style={{ background: 'var(--success-surface)', border: '1px solid var(--success-border)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Deployment verified</p>
              <div className="mt-2 grid gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
                <p>Receipt status: success</p>
                <p>Contract address: <span className="mono break-all">{deploymentResult.address}</span></p>
                <p>Verified selector: <span className="mono">{ARCSPLIT_FIXED_AMOUNTS_SELECTOR}</span> (distributeFixedAmounts(address[],uint256[]))</p>
                <p>Constructor USDC: <span className="mono break-all">{ARC_MAINNET_DEPLOYMENT.usdcAddress}</span></p>
                <p>
                  Transaction:{' '}
                  <a
                    className="mono break-all underline"
                    href={`${ARC_MAINNET_DEPLOYMENT.explorerUrl}/tx/${deploymentResult.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {deploymentResult.transactionHash}
                  </a>
                </p>
                <p>Read-only validation passed. No USDC distribution was sent.</p>
              </div>
            </div>
          )}

          <div
            className="mt-5 rounded-2xl p-4"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Separate deployment approval required</p>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Review every detail above. Checking the box and pressing the button are required before your wallet opens.
              MetaMask or OKX must separately review and approve the contract-creation transaction. This page never
              requests a private key or switches networks.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm" style={{ color: 'var(--ink-2)' }}>
              <input
                type="checkbox"
                checked={hasConfirmedDeployment}
                onChange={(event) => setDeploymentApproval(
                  event.target.checked && address && chainId !== undefined
                    ? { address, chainId }
                    : undefined,
                )}
                disabled={!canProceedToReview || isDeploying || !!deploymentResult}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--success)]"
              />
              <span>I explicitly approve one Arc Mainnet ArcSplit Standard CREATE deployment using these exact details.</span>
            </label>
            <button
              type="button"
              onClick={() => void handleDeploy()}
              disabled={!canDeploy}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: '#fff', background: 'var(--success)' }}
            >
              {isDeploying && <Loader2 className="h-4 w-4 animate-spin" />}
              {deploymentResult ? 'Deployment verified' : 'Deploy ArcSplit with MetaMask or OKX'}
            </button>
            {submissionLocked && !isDeploying && !deploymentResult && (
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                A wallet request was opened and its outcome could not be fully verified. This page is locked to prevent an accidental duplicate deployment.
              </p>
            )}
          </div>

          {!canProceedToReview && address && chainId === ARC_MAINNET_DEPLOYMENT.chainId && currentEstimate && !balanceIsSufficient && (
            <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
              The connected wallet needs at least {formatNative(currentEstimate.reserveFee)} for the current estimate and reserve.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      className="min-w-0 rounded-xl p-3"
      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className={`mt-1 break-all text-sm font-semibold ${mono ? 'mono' : ''}`} style={{ color: 'var(--ink-2)' }}>
        {value}
      </p>
    </div>
  )
}
