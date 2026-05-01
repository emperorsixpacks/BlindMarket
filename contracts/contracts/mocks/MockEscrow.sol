// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockEscrow {
    uint256 public lastTaskId;
    bool public lastWorkerFavored;
    uint256 public resolveCount;

    function resolveDispute(uint256 taskId, bool workerFavored) external {
        lastTaskId = taskId;
        lastWorkerFavored = workerFavored;
        resolveCount++;
    }
}
