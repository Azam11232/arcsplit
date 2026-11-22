// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm, VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {ArcSplit} from "../ArcSplit.sol";

library ArcSplitTestnetDeploymentChecks {
    uint256 internal constant TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant EXPECTED_RUNTIME_LENGTH = 2752;
    address internal constant PREVIOUS_TESTNET_ADDRESS_1 = 0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35;
    address internal constant PREVIOUS_TESTNET_ADDRESS_2 = 0xD90b75D07a2B592b0A01F0aC63D522F54ffd1EF2;

    function assertTestnetChain(uint256 forkChainId, uint256 rpcChainId) internal pure {
        require(forkChainId == TESTNET_CHAIN_ID, "Foundry execution is not on Arc Testnet");
        require(rpcChainId == TESTNET_CHAIN_ID, "Configured RPC is not Arc Testnet");
    }

    function assertAllowedDeploymentAddress(address deployed) internal pure {
        require(deployed != address(0), "Deployment address is zero");
        require(
            deployed != PREVIOUS_TESTNET_ADDRESS_1 && deployed != PREVIOUS_TESTNET_ADDRESS_2,
            "Previous Testnet address cannot be used"
        );
    }

    function assertOnlyConfiguredSigner(address deployer, address[] memory wallets) internal pure {
        require(deployer != address(0), "Testnet deployer address is required");
        require(wallets.length == 1, "Configure exactly one Foundry signer");
        require(wallets[0] == deployer, "Configured deployer does not match Foundry signer");
    }

    function assertBroadcastSigner(address deployer, address broadcastSigner) internal pure {
        require(broadcastSigner == deployer, "Configured deployer does not match broadcast signer");
    }

    function assertReceiptStatus(bool receiptFound, uint256 status) internal pure {
        require(receiptFound, "Deployment transaction receipt not found");
        require(status == 1, "Deployment transaction failed");
    }

    function assertReceiptDeploymentAddress(address deployed) internal pure {
        assertAllowedDeploymentAddress(deployed);
    }

    function assertReceiptSender(address expected, address actual) internal pure {
        require(actual == expected, "Deployment receipt sender does not match configured deployer");
    }

    function expectedRuntime(Vm vm, address usdc) internal view returns (bytes memory runtime) {
        runtime = vm.getDeployedCode("contracts/ArcSplit.sol:ArcSplit");
        require(runtime.length == EXPECTED_RUNTIME_LENGTH, "ArcSplit artifact runtime length changed");

        bytes32 immutableValue = bytes32(uint256(uint160(usdc)));
        // These are the USDC immutable references in the reviewed solc 0.8.28 artifact.
        _replaceImmutable(runtime, 542, immutableValue);
        _replaceImmutable(runtime, 662, immutableValue);
        _replaceImmutable(runtime, 1442, immutableValue);
        _replaceImmutable(runtime, 1646, immutableValue);
    }

    function assertRuntime(Vm vm, address deployed, address usdc, bytes memory actual) internal view {
        bytes memory expected = expectedRuntime(vm, usdc);
        bytes memory forkCode = deployed.code;
        require(actual.length == expected.length, "ArcSplit runtime length mismatch");
        require(keccak256(actual) == keccak256(expected), "ArcSplit runtime bytecode mismatch");
        require(
            forkCode.length == actual.length && keccak256(forkCode) == keccak256(actual),
            "RPC code does not match fork code"
        );
    }

    function assertInvalidRecipient(address deployed) internal {
        address[] memory recipients = new address[](1);
        recipients[0] = deployed;

        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        (bool percentageSucceeded, bytes memory percentageResult) =
            deployed.call(abi.encodeCall(ArcSplit.distribute, (recipients, shares, 1)));
        require(
            !percentageSucceeded && _selector(percentageResult) == ArcSplit.InvalidRecipient.selector,
            "distribute did not revert with InvalidRecipient"
        );

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;

        (bool fixedSucceeded, bytes memory fixedResult) =
            deployed.call(abi.encodeCall(ArcSplit.distributeFixedAmounts, (recipients, amounts)));
        require(
            !fixedSucceeded && _selector(fixedResult) == ArcSplit.InvalidRecipient.selector,
            "distributeFixedAmounts did not revert with InvalidRecipient"
        );
    }

    function _replaceImmutable(bytes memory runtime, uint256 offset, bytes32 value) private pure {
        require(offset + 32 <= runtime.length, "ArcSplit immutable offset outside runtime");
        assembly ("memory-safe") {
            mstore(add(add(runtime, 0x20), offset), value)
        }
    }

    function _selector(bytes memory revertData) private pure returns (bytes4 result) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            result := mload(add(revertData, 0x20))
        }
    }
}

contract DeployArcSplitTestnet is Script {
    uint256 internal constant TESTNET_CHAIN_ID = 5_042_002;
    address internal constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;

    function preflight(address deployer) external returns (uint256 estimatedGas, uint256 requiredBalance) {
        return _preflight(deployer);
    }

    function run() external returns (address deployedAddress) {
        require(
            vm.envOr("ARCSPLIT_TESTNET_DEPLOY_CONFIRM", false),
            "Set ARCSPLIT_TESTNET_DEPLOY_CONFIRM=true only after deployment approval"
        );
        address deployer = vm.envAddress("ARCSPLIT_TESTNET_DEPLOYER");
        (uint256 estimatedGas, uint256 requiredBalance) = _preflight(deployer);
        address predictedAddress = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        ArcSplitTestnetDeploymentChecks.assertAllowedDeploymentAddress(predictedAddress);
        require(predictedAddress.code.length == 0, "Predicted deployment address already has code");

        ArcSplitTestnetDeploymentChecks.assertOnlyConfiguredSigner(deployer, vm.getWallets());
        console2.log("Estimated deployment gas:", estimatedGas);
        console2.log("Required native USDC balance (wei):", requiredBalance);

        vm.startBroadcast();
        (Vm.CallerMode callerMode, address broadcastSigner,) = vm.readCallers();
        require(callerMode == VmSafe.CallerMode.RecurrentBroadcast, "Foundry broadcast signer is unavailable");
        ArcSplitTestnetDeploymentChecks.assertBroadcastSigner(deployer, broadcastSigner);
        ArcSplit deployed = new ArcSplit(USDC_ADDRESS);
        vm.stopBroadcast();

        deployedAddress = address(deployed);
        require(deployedAddress == predictedAddress, "Deployed address differs from preflight prediction");
        ArcSplitTestnetDeploymentChecks.assertAllowedDeploymentAddress(deployedAddress);

        // These are local Foundry simulation checks, not verification of a mined deployment.
        ArcSplitTestnetDeploymentChecks.assertRuntime(vm, deployedAddress, USDC_ADDRESS, deployedAddress.code);
        ArcSplitTestnetDeploymentChecks.assertInvalidRecipient(deployedAddress);
        console2.log("Simulation checks passed; live receipt verification is still mandatory.");
        console2.log("Predicted Testnet deployment address:", deployedAddress);
    }

    function verifyReceipt(bytes32 transactionHash) external returns (address deployedAddress) {
        _assertTestnet();
        require(transactionHash != bytes32(0), "Deployment transaction hash is required");

        string memory transactionParams = string.concat('["', vm.toString(transactionHash), '"]');
        string memory receiptJson = vm.rpcJson("eth_getTransactionReceipt", transactionParams);
        ArcSplitTestnetDeploymentChecks.assertReceiptStatus(
            vm.keyExistsJson(receiptJson, ".status"),
            vm.keyExistsJson(receiptJson, ".status") ? vm.parseJsonUint(receiptJson, ".status") : 0
        );

        deployedAddress = vm.parseJsonAddress(receiptJson, ".contractAddress");
        ArcSplitTestnetDeploymentChecks.assertReceiptDeploymentAddress(deployedAddress);
        uint256 receiptBlock = vm.parseJsonUint(receiptJson, ".blockNumber");
        require(receiptBlock > 0, "Deployment receipt has no mined block");
        uint256 latestBlock = vm.parseJsonUint(vm.rpcJson("eth_blockNumber", "[]"), "$");
        require(latestBlock >= receiptBlock, "Deployment receipt block is not confirmed by the RPC");

        string memory transactionJson = vm.rpcJson("eth_getTransactionByHash", transactionParams);
        require(vm.keyExistsJson(transactionJson, ".from"), "Deployment transaction not found");
        address expectedDeployer = vm.envAddress("ARCSPLIT_TESTNET_DEPLOYER");
        ArcSplitTestnetDeploymentChecks.assertReceiptSender(
            expectedDeployer, vm.parseJsonAddress(transactionJson, ".from")
        );

        string memory codeJson =
            vm.rpcJson("eth_getCode", string.concat('["', vm.toString(deployedAddress), '","latest"]'));
        bytes memory deployedCode = vm.parseJsonBytes(codeJson, "$");
        require(deployedCode.length > 0, "No deployed code at receipt contract address");
        ArcSplitTestnetDeploymentChecks.assertRuntime(vm, deployedAddress, USDC_ADDRESS, deployedCode);
        console2.log("Live RPC receipt, sender, and runtime verification passed:", deployedAddress);

        // These calls execute on the local fork and are simulations, not eth_call RPC responses.
        ArcSplitTestnetDeploymentChecks.assertInvalidRecipient(deployedAddress);
        console2.log("Local fork InvalidRecipient simulations passed:", deployedAddress);
        return deployedAddress;
    }

    function _preflight(address deployer) private returns (uint256 estimatedGas, uint256 requiredBalance) {
        _assertTestnet();
        require(deployer != address(0), "Testnet deployer address is required");

        string memory usdcCodeJson =
            vm.rpcJson("eth_getCode", string.concat('["', vm.toString(USDC_ADDRESS), '","latest"]'));
        require(vm.parseJsonBytes(usdcCodeJson, "$").length > 0, "Testnet USDC has no deployed code");

        bytes memory creationCode =
            abi.encodePacked(vm.getCode("contracts/ArcSplit.sol:ArcSplit"), abi.encode(USDC_ADDRESS));
        string memory estimateParams =
            string.concat('[{"from":"', vm.toString(deployer), '","data":"', vm.toString(creationCode), '"}]');
        string memory estimateJson = vm.rpcJson("eth_estimateGas", estimateParams);
        estimatedGas = vm.parseJsonUint(estimateJson, "$");
        require(estimatedGas > 0, "Testnet returned an empty gas estimate");

        string memory gasPriceJson = vm.rpcJson("eth_gasPrice", "[]");
        uint256 gasPrice = vm.parseJsonUint(gasPriceJson, "$");
        require(gasPrice > 0, "Testnet RPC returned zero gas price");
        requiredBalance = (estimatedGas * gasPrice * 120) / 100;

        string memory balanceJson =
            vm.rpcJson("eth_getBalance", string.concat('["', vm.toString(deployer), '","latest"]'));
        uint256 balance = vm.parseJsonUint(balanceJson, "$");
        require(balance >= requiredBalance, "Testnet deployer lacks native USDC gas balance");

        _assertPredictedAddressAvailable(deployer);
    }

    function _assertPredictedAddressAvailable(address deployer) private view {
        address predictedAddress = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        ArcSplitTestnetDeploymentChecks.assertAllowedDeploymentAddress(predictedAddress);
        require(predictedAddress.code.length == 0, "Predicted deployment address already has code");
    }

    function _assertTestnet() private {
        uint256 rpcChainId = vm.parseJsonUint(vm.rpcJson("eth_chainId", "[]"), "$");
        ArcSplitTestnetDeploymentChecks.assertTestnetChain(block.chainid, rpcChainId);
    }
}
