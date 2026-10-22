// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcSplit} from "../ArcSplit.sol";

contract FailingRecipientToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public failingRecipient;

    constructor(address recipient) {
        failingRecipient = recipient;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external returns (bool)
    {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != failingRecipient, "recipient transfer failed");
        require(balanceOf[msg.sender] >= amount, "insufficient balance");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ArcSplitRollbackTest is Test {
    address internal payer = address(0x1111);
    address internal alice = address(0x2222);
    address internal bob = address(0x3333);

    FailingRecipientToken internal token;
    ArcSplit internal splitter;

    function setUp() public {
        token = new FailingRecipientToken(bob);
        splitter = new ArcSplit(address(token));

        token.mint(payer, 100e6);

        vm.prank(payer);
        token.approve(address(splitter), 100e6);
    }

    function test_SecondRecipientFailureRollsBackEverything() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        uint256 payerBefore = token.balanceOf(payer);
        uint256 splitterBefore = token.balanceOf(address(splitter));
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        uint256 allowanceBefore = token.allowance(payer, address(splitter));

        vm.prank(payer);
        vm.expectRevert(bytes("recipient transfer failed"));
        splitter.distribute(recipients, shares, 100e6);

        assertEq(token.balanceOf(payer), payerBefore);
        assertEq(token.balanceOf(address(splitter)), splitterBefore);
        assertEq(token.balanceOf(alice), aliceBefore);
        assertEq(token.balanceOf(bob), bobBefore);
        assertEq(token.allowance(payer, address(splitter)), allowanceBefore);
    }
}
