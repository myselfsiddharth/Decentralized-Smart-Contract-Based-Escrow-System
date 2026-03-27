// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IEscrow
 * @notice Interface for my escrow project workflow.
 * @dev This keeps all important function signatures and events in one place.
 */
interface IEscrow {
    /**
     * @notice These are the main stages of the escrow process.
     * @dev The main contract checks these states before allowing actions.
     */
    enum EscrowStatus {
        Created,
        Funded,
        Completed,
        Approved,
        Refunded
    }

    /**
     * @notice Triggered when client deposits money in escrow.
     * @param depositor Wallet address that sent the funds.
     * @param amount Deposit amount in wei.
     */
    event FundsDeposited(address indexed depositor, uint256 amount);

    /**
     * @notice Triggered when freelancer submits completed work reference.
     * @param freelancer Freelancer wallet address.
     * @param workReference Link/hash/CID pointing to delivered work.
     */
    event WorkSubmitted(address indexed freelancer, string workReference);

    /**
     * @notice Triggered when client approves and payment is released.
     * @param freelancer Freelancer address receiving payment.
     * @param amount Released amount in wei.
     */
    event FundsReleased(address indexed freelancer, uint256 amount);

    /**
     * @notice Triggered when client rejects work and gets refund.
     * @param client Client address receiving refund.
     * @param amount Refunded amount in wei.
     */
    event FundsRefunded(address indexed client, uint256 amount);

    function createEscrow(address _client, address _freelancer, uint256 _amount) external;

    function depositFunds() external payable;

    function submitWork(string calldata _workReference) external;

    function approveWork() external;

    function rejectWork() external;
}
