// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IEscrow.sol";

/**
 * @title Escrow
 * @notice Main escrow contract for my decentralized freelancing project.
 * @dev Basic flow:
 *      create escrow -> client deposits -> freelancer submits work ->
 *      client approves (release) or rejects (refund).
 *      This is a draft version made for first submission.
 */
contract Escrow is IEscrow {
    /// @notice Client wallet address.
    address public client;

    /// @notice Freelancer wallet address.
    address public freelancer;

    /// @notice Agreed payment amount in wei.
    uint256 public amount;

    /// @notice Current stage of escrow.
    EscrowStatus public status;

    /// @notice Off-chain work proof/reference (CID, hash, link, etc.).
    string public workReference;

    /// @notice Prevents re-initializing the same escrow contract.
    bool private initialized;

    /**
     * @notice Only client can call functions using this modifier.
     */
    modifier onlyClient() {
        require(msg.sender == client, "Only client can call this");
        _;
    }

    /**
     * @notice Only freelancer can call functions using this modifier.
     */
    modifier onlyFreelancer() {
        require(msg.sender == freelancer, "Only freelancer can call this");
        _;
    }

    /**
     * @notice Allows action only in a specific state.
     * @param expectedStatus Required current status before function runs.
     */
    modifier inStatus(EscrowStatus expectedStatus) {
        require(status == expectedStatus, "Invalid status for this action");
        _;
    }

    /**
     * @notice Sets client, freelancer, and agreed amount.
     * @dev This can run only once.
     * @param _client Client wallet address.
     * @param _freelancer Freelancer wallet address.
     * @param _amount Agreed escrow amount in wei.
     */
    function createEscrow(address _client, address _freelancer, uint256 _amount) external override {
        require(!initialized, "Escrow already initialized");
        require(_client != address(0), "Invalid client address");
        require(_freelancer != address(0), "Invalid freelancer address");
        require(_client != _freelancer, "Client and freelancer must differ");
        require(_amount > 0, "Amount must be greater than zero");

        // Save participants and amount for this escrow.
        client = _client;
        freelancer = _freelancer;
        amount = _amount;
        // Escrow starts in Created state before funding.
        status = EscrowStatus.Created;
        initialized = true;
    }

    /**
     * @notice Client deposits exact agreed funds into contract.
     * @dev Changes state Created -> Funded.
     */
    function depositFunds()
        external
        payable
        override
        onlyClient
        inStatus(EscrowStatus.Created)
    {
        require(msg.value == amount, "Deposit must match agreed amount");

        // Funds are now locked in escrow.
        status = EscrowStatus.Funded;
        emit FundsDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Freelancer submits completed work reference.
     * @dev Changes state Funded -> Completed.
     * @param _workReference CID/hash/link for submitted work.
     */
    function submitWork(string calldata _workReference)
        external
        override
        onlyFreelancer
        inStatus(EscrowStatus.Funded)
    {
        require(bytes(_workReference).length > 0, "Work reference is required");

        // Save proof so client can verify off-chain work.
        workReference = _workReference;
        status = EscrowStatus.Completed;
        emit WorkSubmitted(msg.sender, _workReference);
    }

    /**
     * @notice Client approves submitted work.
     * @dev Changes state Completed -> Approved and sends payment to freelancer.
     */
    function approveWork() external override onlyClient inStatus(EscrowStatus.Completed) {
        status = EscrowStatus.Approved;

        // Transfer escrowed amount to freelancer.
        (bool sent, ) = payable(freelancer).call{value: amount}("");
        require(sent, "Transfer to freelancer failed");

        emit FundsReleased(freelancer, amount);
    }

    /**
     * @notice Client rejects work and takes refund.
     * @dev Changes state Completed -> Refunded and sends funds back to client.
     */
    function rejectWork() external override onlyClient inStatus(EscrowStatus.Completed) {
        status = EscrowStatus.Refunded;

        // Return escrowed amount back to client.
        (bool sent, ) = payable(client).call{value: amount}("");
        require(sent, "Refund to client failed");

        emit FundsRefunded(client, amount);
    }
}
