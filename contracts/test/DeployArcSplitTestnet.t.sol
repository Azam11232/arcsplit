// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ArcSplit} from "../ArcSplit.sol";
import {ArcSplitTestnetDeploymentChecks} from "../script/DeployArcSplitTestnet.s.sol";

contract DeploymentChecksHarness {
    function assertTestnetChain(uint256 forkChainId, uint256 rpcChainId) external pure {
        ArcSplitTestnetDeploymentChecks.assertTestnetChain(forkChainId, rpcChainId);
    }

    function assertAllowedDeploymentAddress(address deployed) external pure {
        ArcSplitTestnetDeploymentChecks.assertAllowedDeploymentAddress(deployed);
    }

    function assertOnlyConfiguredSigner(address deployer, address[] memory wallets) external pure {
        ArcSplitTestnetDeploymentChecks.assertOnlyConfiguredSigner(deployer, wallets);
    }

    function assertBroadcastSigner(address deployer, address broadcastSigner) external pure {
        ArcSplitTestnetDeploymentChecks.assertBroadcastSigner(deployer, broadcastSigner);
    }

    function assertReceiptStatus(bool receiptFound, uint256 status) external pure {
        ArcSplitTestnetDeploymentChecks.assertReceiptStatus(receiptFound, status);
    }

    function assertReceiptDeploymentAddress(address deployed) external pure {
        ArcSplitTestnetDeploymentChecks.assertReceiptDeploymentAddress(deployed);
    }

    function assertReceiptSender(address expected, address actual) external pure {
        ArcSplitTestnetDeploymentChecks.assertReceiptSender(expected, actual);
    }

    function assertRuntime(Vm vm, address deployed, address usdc, bytes memory actual) external view {
        ArcSplitTestnetDeploymentChecks.assertRuntime(vm, deployed, usdc, actual);
    }

    function assertInvalidRecipient(address deployed) external {
        ArcSplitTestnetDeploymentChecks.assertInvalidRecipient(deployed);
    }
}

contract DeployArcSplitTestnetTest is Test {
    DeploymentChecksHarness private checks;

    function setUp() public {
        checks = new DeploymentChecksHarness();
    }

    function testArtifactRuntimeMatchesAfterImmutableSubstitution() public {
        address usdc = makeAddr("testnet-usdc");
        ArcSplit deployed = new ArcSplit(usdc);

        bytes memory expected = ArcSplitTestnetDeploymentChecks.expectedRuntime(vm, usdc);
        assertEq(keccak256(address(deployed).code), keccak256(expected));
    }

    function testBothDistributionFunctionsRejectTheSplitterAsRecipient() public {
        ArcSplit deployed = new ArcSplit(makeAddr("testnet-usdc"));
        ArcSplitTestnetDeploymentChecks.assertInvalidRecipient(address(deployed));
    }

    function testRejectsWrongFoundryChainId() public {
        vm.expectRevert(bytes("Foundry execution is not on Arc Testnet"));
        checks.assertTestnetChain(1, 5_042_002);
    }

    function testRejectsWrongRpcChainId() public {
        vm.expectRevert(bytes("Configured RPC is not Arc Testnet"));
        checks.assertTestnetChain(5_042_002, 1);
    }

    function testRejectsFirstPreviousTestnetAddress() public {
        vm.expectRevert(bytes("Previous Testnet address cannot be used"));
        checks.assertAllowedDeploymentAddress(0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35);
    }

    function testRejectsSecondPreviousTestnetAddress() public {
        vm.expectRevert(bytes("Previous Testnet address cannot be used"));
        checks.assertAllowedDeploymentAddress(0xD90b75D07a2B592b0A01F0aC63D522F54ffd1EF2);
    }

    function testRejectsConfiguredDeployerThatDiffersFromFoundrySigner() public {
        address[] memory wallets = new address[](1);
        wallets[0] = makeAddr("actual-foundry-signer");

        vm.expectRevert(bytes("Configured deployer does not match Foundry signer"));
        checks.assertOnlyConfiguredSigner(makeAddr("configured-deployer"), wallets);
    }

    function testRejectsMultipleFoundrySigners() public {
        address[] memory wallets = new address[](2);
        wallets[0] = makeAddr("signer-one");
        wallets[1] = makeAddr("signer-two");

        vm.expectRevert(bytes("Configure exactly one Foundry signer"));
        checks.assertOnlyConfiguredSigner(wallets[0], wallets);
    }

    function testRejectsBroadcastSignerMismatch() public {
        vm.expectRevert(bytes("Configured deployer does not match broadcast signer"));
        checks.assertBroadcastSigner(makeAddr("configured-deployer"), makeAddr("broadcast-signer"));
    }

    function testRejectsMissingDeploymentReceipt() public {
        vm.expectRevert(bytes("Deployment transaction receipt not found"));
        checks.assertReceiptStatus(false, 1);
    }

    function testRejectsFailedDeploymentReceipt() public {
        vm.expectRevert(bytes("Deployment transaction failed"));
        checks.assertReceiptStatus(true, 0);
    }

    function testRejectsReceiptForPreviousTestnetAddress() public {
        vm.expectRevert(bytes("Previous Testnet address cannot be used"));
        checks.assertReceiptDeploymentAddress(0xD90b75D07a2B592b0A01F0aC63D522F54ffd1EF2);
    }

    function testRejectsReceiptWithoutContractAddress() public {
        vm.expectRevert(bytes("Deployment address is zero"));
        checks.assertReceiptDeploymentAddress(address(0));
    }

    function testRejectsReceiptSenderMismatch() public {
        vm.expectRevert(bytes("Deployment receipt sender does not match configured deployer"));
        checks.assertReceiptSender(makeAddr("configured-deployer"), makeAddr("unexpected-sender"));
    }

    function testRejectsRuntimeVerificationMismatch() public {
        address usdc = makeAddr("testnet-usdc");
        ArcSplit deployed = new ArcSplit(usdc);

        vm.expectRevert(bytes("ArcSplit runtime length mismatch"));
        checks.assertRuntime(vm, address(deployed), usdc, hex"6000");
    }

    function testRejectsRuntimeBytecodeMismatch() public {
        address usdc = makeAddr("testnet-usdc");
        ArcSplit deployed = new ArcSplit(usdc);
        bytes memory wrongRuntime = new bytes(2752);

        vm.expectRevert(bytes("ArcSplit runtime bytecode mismatch"));
        checks.assertRuntime(vm, address(deployed), usdc, wrongRuntime);
    }

    function testRejectsRpcCodeThatDiffersFromForkCode() public {
        address usdc = makeAddr("testnet-usdc");
        ArcSplit deployed = new ArcSplit(usdc);
        bytes memory expectedRuntime = ArcSplitTestnetDeploymentChecks.expectedRuntime(vm, usdc);
        vm.etch(address(deployed), hex"6000");

        vm.expectRevert(bytes("RPC code does not match fork code"));
        checks.assertRuntime(vm, address(deployed), usdc, expectedRuntime);
    }

    function testRejectsInvalidRecipientVerificationFailure() public {
        vm.expectRevert(bytes("distribute did not revert with InvalidRecipient"));
        checks.assertInvalidRecipient(makeAddr("not-a-contract"));
    }
}
