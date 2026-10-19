// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcSplit
/// @notice Stateless, non-custodial USDC payment splitter.
/// @dev The payer approves this contract, then calls {distribute} to atomically split a payment.
contract ArcSplit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MAX_RECIPIENTS = 50;

    IERC20 private immutable USDC;

    error ZeroAmount();
    error ArrayLengthMismatch();
    error TooManyRecipients();
    error ZeroAddress();
    error DuplicateRecipient();
    error ZeroShare();
    error InvalidSharesTotal();

    event Distributed(address indexed payer, uint256 totalAmount, uint256 recipientCount);
    event RecipientPayout(address indexed recipient, uint256 amount);

    /// @notice Sets the USDC token address used for all distributions.
    /// @param usdc_ ERC-20 token address to pull from payer and pay recipients.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        USDC = IERC20(usdc_);
    }

    /// @notice Splits a USDC payment from msg.sender across recipients by basis-point shares.
    /// @dev Pulls `totalAmount` from the payer via transferFrom, then pays recipients.
    ///      The final recipient receives the remainder to absorb integer division rounding.
    /// @param recipients Recipient addresses to receive payouts.
    /// @param sharesBps Share weights in basis points (must sum to 10_000).
    /// @param totalAmount Total USDC amount to split.
    function distribute(
        address[] calldata recipients,
        uint256[] calldata sharesBps,
        uint256 totalAmount
    ) external nonReentrant {
        if (totalAmount == 0) revert ZeroAmount();

        uint256 recipientCount = recipients.length;
        if (recipientCount == 0 || recipientCount != sharesBps.length) revert ArrayLengthMismatch();
        if (recipientCount > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 sharesTotal = 0;

        for (uint256 i = 0; i < recipientCount; ++i) {
            address recipient = recipients[i];
            if (recipient == address(0)) revert ZeroAddress();

            uint256 share = sharesBps[i];
            if (share == 0) revert ZeroShare();

            sharesTotal += share;

            for (uint256 j = i + 1; j < recipientCount; ++j) {
                if (recipient == recipients[j]) revert DuplicateRecipient();
            }
        }

        if (sharesTotal != BPS_DENOMINATOR) revert InvalidSharesTotal();

        USDC.safeTransferFrom(msg.sender, address(this), totalAmount);

        uint256 distributedSoFar = 0;
        for (uint256 i = 0; i < recipientCount; ++i) {
            uint256 amount;
            if (i == recipientCount - 1) {
                amount = totalAmount - distributedSoFar;
            } else {
                amount = (totalAmount * sharesBps[i]) / BPS_DENOMINATOR;
                distributedSoFar += amount;
            }

            USDC.safeTransfer(recipients[i], amount);
            emit RecipientPayout(recipients[i], amount);
        }

        emit Distributed(msg.sender, totalAmount, recipientCount);
    }
}
