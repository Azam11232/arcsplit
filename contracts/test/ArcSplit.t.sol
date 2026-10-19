// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcSplit} from "../ArcSplit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---------------------------------------------------------------------------
// Minimal inline mock ERC-20 — supports mint / approve / transferFrom / transfer
// ---------------------------------------------------------------------------
contract MockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _sym, uint8 _dec) {
        name = _name; symbol = _sym; decimals = _dec;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ---------------------------------------------------------------------------
// Invariant handler — wraps distribute() calls for stateful fuzzing
// ---------------------------------------------------------------------------
contract ArcSplitHandler is Test {
    ArcSplit    public splitter;
    MockERC20   public token;
    address     public payer;

    // Accumulated tracking for the invariant
    uint256 public totalDistributed;
    uint256 public totalPaid;

    address internal immutable ALICE;
    address internal immutable BOB;

    constructor(ArcSplit _splitter, MockERC20 _token, address _payer) {
        splitter = _splitter;
        token    = _token;
        payer    = _payer;
        ALICE    = makeAddr("inv_alice");
        BOB      = makeAddr("inv_bob");
    }

    /// @dev Called by the invariant fuzzer with arbitrary totalAmount.
    function distribute(uint256 amount) external {
        amount = bound(amount, 1, 1_000_000e6);

        address[] memory recipients = new address[](2);
        recipients[0] = ALICE;
        recipients[1] = BOB;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        // Snapshot balances BEFORE the call so we capture the delta, not the
        // cumulative balance (which grows across rounds).
        uint256 aliceBefore = token.balanceOf(ALICE);
        uint256 bobBefore   = token.balanceOf(BOB);

        // Mint and approve fresh for each call
        token.mint(payer, amount);
        vm.prank(payer);
        token.approve(address(splitter), amount);

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        totalPaid        += amount;
        totalDistributed += (token.balanceOf(ALICE) - aliceBefore)
                          + (token.balanceOf(BOB)   - bobBefore);
    }
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------
contract ArcSplitTest is Test {

    MockERC20 internal token;
    ArcSplit  internal splitter;

    address internal payer = makeAddr("payer");
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant MINT_AMOUNT = 10_000e6; // 10,000 USDC (6 dec mock)

    // -----------------------------------------------------------------------
    // setUp — fresh state before every test
    // -----------------------------------------------------------------------
    function setUp() public {
        token    = new MockERC20("Mock USDC", "mUSDC", 6);
        splitter = new ArcSplit(address(token));

        // Give payer plenty of tokens
        token.mint(payer, MINT_AMOUNT);
    }

    // -----------------------------------------------------------------------
    // Helper
    // -----------------------------------------------------------------------
    function _approve(address from, uint256 amount) internal {
        vm.prank(from);
        token.approve(address(splitter), amount);
    }

    // -----------------------------------------------------------------------
    // 1. Deployment & constructor
    // -----------------------------------------------------------------------

    function test_Constructor_SetsUSDC() public view {
        // The contract compiles and is deployed — sanity-check it is non-zero.
        assertTrue(address(splitter) != address(0));
    }

    function test_Constructor_RevertsZeroAddress() public {
        vm.expectRevert(ArcSplit.ZeroAddress.selector);
        new ArcSplit(address(0));
    }

    // -----------------------------------------------------------------------
    // 2. Happy-path: 2-recipient 50/50 split
    // -----------------------------------------------------------------------
    function test_Distribute_TwoRecipients_5050() public {
        uint256 amount = 1000e6;
        _approve(payer, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        // Expect RecipientPayout for alice
        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.RecipientPayout(alice, 500e6);

        // Expect RecipientPayout for bob
        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.RecipientPayout(bob, 500e6);

        // Expect Distributed
        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.Distributed(payer, amount, 2);

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        assertEq(token.balanceOf(alice), 500e6, "alice balance");
        assertEq(token.balanceOf(bob),   500e6, "bob balance");
        assertEq(token.balanceOf(payer), MINT_AMOUNT - amount, "payer balance decremented");
    }

    // -----------------------------------------------------------------------
    // 3. Happy-path: 3-recipient 30/30/40 split
    // -----------------------------------------------------------------------
    function test_Distribute_ThreeRecipients_303040() public {
        uint256 amount = 1000e6;
        _approve(payer, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 3000; // 30%
        shares[1] = 3000; // 30%
        shares[2] = 4000; // 40% — last gets remainder

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        assertEq(token.balanceOf(alice), 300e6, "alice 30%");
        assertEq(token.balanceOf(bob),   300e6, "bob 30%");
        // carol is last recipient — receives remainder
        uint256 aliceAmt = (amount * 3000) / 10_000;
        uint256 bobAmt   = (amount * 3000) / 10_000;
        uint256 carolAmt = amount - aliceAmt - bobAmt;
        assertEq(token.balanceOf(carol), carolAmt, "carol 40% remainder");
    }

    // -----------------------------------------------------------------------
    // 4. Happy-path: single recipient (100%)
    // -----------------------------------------------------------------------
    function test_Distribute_SingleRecipient_Full() public {
        uint256 amount = 500e6;
        _approve(payer, amount);

        address[] memory recipients = new address[](1);
        recipients[0] = alice;

        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.RecipientPayout(alice, amount);

        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.Distributed(payer, amount, 1);

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        assertEq(token.balanceOf(alice), amount, "single recipient gets all");
    }

    // -----------------------------------------------------------------------
    // 5. Happy-path: dust / uneven split — totalAmount=7, shares [3334,3333,3333]
    // -----------------------------------------------------------------------
    function test_Distribute_DustRemainder_LastRecipientGetsRemainder() public {
        uint256 amount = 7;
        _approve(payer, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 3334;
        shares[1] = 3333;
        shares[2] = 3333;

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        uint256 aliceAmt = (amount * 3334) / 10_000;
        uint256 bobAmt   = (amount * 3333) / 10_000;
        uint256 carolAmt = amount - aliceAmt - bobAmt; // last gets remainder

        assertEq(token.balanceOf(alice), aliceAmt, "alice dust");
        assertEq(token.balanceOf(bob),   bobAmt,   "bob dust");
        assertEq(token.balanceOf(carol), carolAmt, "carol gets remainder");

        // Total distributed must equal totalAmount exactly
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol),
            amount,
            "total distributed == totalAmount"
        );
    }

    // -----------------------------------------------------------------------
    // 6. Revert: ZeroAmount
    // -----------------------------------------------------------------------
    function test_Revert_ZeroAmount() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        vm.prank(payer);
        vm.expectRevert(ArcSplit.ZeroAmount.selector);
        splitter.distribute(recipients, shares, 0);
    }

    // -----------------------------------------------------------------------
    // 7. Revert: ArrayLengthMismatch — lengths differ
    // -----------------------------------------------------------------------
    function test_Revert_ArrayLengthMismatch_DifferentLengths() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        vm.prank(payer);
        vm.expectRevert(ArcSplit.ArrayLengthMismatch.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 8. Revert: ArrayLengthMismatch — empty recipients array
    // -----------------------------------------------------------------------
    function test_Revert_ArrayLengthMismatch_EmptyArray() public {
        address[] memory recipients = new address[](0);
        uint256[] memory shares = new uint256[](0);

        vm.prank(payer);
        vm.expectRevert(ArcSplit.ArrayLengthMismatch.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 9. Revert: TooManyRecipients (> 50)
    // -----------------------------------------------------------------------
    function test_Revert_TooManyRecipients() public {
        uint256 n = 51;
        address[] memory recipients = new address[](n);
        uint256[] memory shares     = new uint256[](n);

        // Give each a unique address and equal share (won't hit 10000 but
        // TooManyRecipients is checked before InvalidSharesTotal)
        for (uint256 i = 0; i < n; i++) {
            recipients[i] = address(uint160(0x1000 + i));
            shares[i]     = 196; // 51 × 196 = 9996 ≠ 10000, but check order matters
        }
        // Adjust last to make it sum-irrelevant — TooManyRecipients fires before shares check
        shares[50] = 200;

        vm.prank(payer);
        vm.expectRevert(ArcSplit.TooManyRecipients.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 10. Revert: ZeroAddress
    // -----------------------------------------------------------------------
    function test_Revert_ZeroAddress() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = address(0); // invalid

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        vm.prank(payer);
        vm.expectRevert(ArcSplit.ZeroAddress.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 11. Revert: DuplicateRecipient
    // -----------------------------------------------------------------------
    function test_Revert_DuplicateRecipient() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = alice; // duplicate

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        vm.prank(payer);
        vm.expectRevert(ArcSplit.DuplicateRecipient.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 12. Revert: ZeroShare
    // -----------------------------------------------------------------------
    function test_Revert_ZeroShare() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 10_000;
        shares[1] = 0; // invalid

        vm.prank(payer);
        vm.expectRevert(ArcSplit.ZeroShare.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 13. Revert: InvalidSharesTotal (sum != 10000)
    // -----------------------------------------------------------------------
    function test_Revert_InvalidSharesTotal_TooLow() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 4999; // sum = 9999

        vm.prank(payer);
        vm.expectRevert(ArcSplit.InvalidSharesTotal.selector);
        splitter.distribute(recipients, shares, 100);
    }

    function test_Revert_InvalidSharesTotal_TooHigh() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5001; // sum = 10001

        vm.prank(payer);
        vm.expectRevert(ArcSplit.InvalidSharesTotal.selector);
        splitter.distribute(recipients, shares, 100);
    }

    // -----------------------------------------------------------------------
    // 14. Revert: insufficient allowance (no approve)
    // -----------------------------------------------------------------------
    function test_Revert_InsufficientAllowance() public {
        // payer has tokens but has NOT approved the splitter
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        vm.prank(payer);
        // SafeERC20 wraps transferFrom; the mock reverts with a string,
        // so we use the raw bytes matcher via vm.expectRevert(bytes("..."))
        vm.expectRevert();
        splitter.distribute(recipients, shares, 100e6);
    }

    // -----------------------------------------------------------------------
    // 15. Revert: insufficient balance (approved but balance too low)
    // -----------------------------------------------------------------------
    function test_Revert_InsufficientBalance() public {
        address poorPayer = makeAddr("poorPayer");
        // poorPayer has 0 tokens but approves a large amount
        vm.prank(poorPayer);
        token.approve(address(splitter), 1_000e6);

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10_000;

        vm.prank(poorPayer);
        vm.expectRevert();
        splitter.distribute(recipients, shares, 1_000e6);
    }

    // -----------------------------------------------------------------------
    // 16. Event: RecipientPayout and Distributed emit in correct order
    // -----------------------------------------------------------------------
    function test_Events_OrderAndValues() public {
        uint256 amount = 200e6;
        _approve(payer, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 7000;
        shares[1] = 3000;

        uint256 aliceExpected = (amount * 7000) / 10_000; // 140e6
        uint256 bobExpected   = amount - aliceExpected;    // 60e6 (last = remainder)

        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.RecipientPayout(alice, aliceExpected);

        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.RecipientPayout(bob, bobExpected);

        vm.expectEmit(true, false, false, true, address(splitter));
        emit ArcSplit.Distributed(payer, amount, 2);

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);
    }

    // -----------------------------------------------------------------------
    // 17. No residual tokens remain in the splitter after distribute
    // -----------------------------------------------------------------------
    function test_NoResidualTokensInSplitter() public {
        uint256 amount = 999e6;
        _approve(payer, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 3333;
        shares[1] = 3333;
        shares[2] = 3334;

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        assertEq(token.balanceOf(address(splitter)), 0, "splitter holds no residual tokens");
    }

    // -----------------------------------------------------------------------
    // 18. Fuzz: 2-recipient 5000/5000 — sum distributed always equals totalAmount
    // -----------------------------------------------------------------------
    function testFuzz_TwoRecipients_5050_SumEqualsTotal(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);

        // Ensure payer has enough
        token.mint(payer, amount);
        _approve(payer, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore   = token.balanceOf(bob);

        vm.prank(payer);
        splitter.distribute(recipients, shares, amount);

        uint256 aliceGot = token.balanceOf(alice) - aliceBefore;
        uint256 bobGot   = token.balanceOf(bob)   - bobBefore;

        assertEq(aliceGot + bobGot, amount, "sum distributed == totalAmount");
    }

    // -----------------------------------------------------------------------
    // 19. Fuzz: arbitrary valid 3-recipient split — no residual in splitter
    // -----------------------------------------------------------------------
    function testFuzz_ThreeRecipients_NoResidual(
        uint256 amount,
        uint16  share0Raw,
        uint16  share1Raw
    ) public {
        amount = bound(amount, 1, 1_000_000e6);

        // Derive two valid non-zero shares that leave room for a third
        uint256 share0 = bound(uint256(share0Raw), 1, 9998);
        uint256 share1 = bound(uint256(share1Raw), 1, 9999 - share0);
        uint256 share2 = 10_000 - share0 - share1;
        if (share2 == 0) share2 = 1; // guard
        // Re-normalise if we overflowed due to guard
        if (share0 + share1 + share2 != 10_000) return; // skip degenerate

        token.mint(payer, amount);
        _approve(payer, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory sharesBps = new uint256[](3);
        sharesBps[0] = share0;
        sharesBps[1] = share1;
        sharesBps[2] = share2;

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore   = token.balanceOf(bob);
        uint256 carolBefore = token.balanceOf(carol);

        vm.prank(payer);
        splitter.distribute(recipients, sharesBps, amount);

        uint256 total = (token.balanceOf(alice) - aliceBefore)
                      + (token.balanceOf(bob)   - bobBefore)
                      + (token.balanceOf(carol) - carolBefore);

        assertEq(total, amount, "total distributed == totalAmount");
        assertEq(token.balanceOf(address(splitter)), 0, "splitter holds 0");
    }
}

// ---------------------------------------------------------------------------
// Invariant test — separate contract so forge finds it via invariant_* naming
// ---------------------------------------------------------------------------
contract ArcSplitInvariantTest is Test {
    MockERC20         internal token;
    ArcSplit          internal splitter;
    ArcSplitHandler   internal handler;

    address internal payer = makeAddr("inv_payer");

    function setUp() public {
        token    = new MockERC20("Mock USDC", "mUSDC", 6);
        splitter = new ArcSplit(address(token));
        handler  = new ArcSplitHandler(splitter, token, payer);

        // Scope the invariant fuzzer to only call the handler
        targetContract(address(handler));
    }

    /// @notice For every valid distribute call, sum(RecipientPayout amounts) == totalAmount.
    ///         We track this via the handler's accounting: totalDistributed == totalPaid.
    function invariant_SumPayoutsEqualsTotalPaid() public view {
        assertEq(handler.totalDistributed(), handler.totalPaid(), "invariant: distributed == paid");
    }

    /// @notice Splitter should never hold a token balance after any sequence of calls.
    function invariant_SplitterHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(splitter)), 0, "invariant: splitter balance == 0");
    }
}
