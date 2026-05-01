# BlindBounty — Gotchas

> Append every surprise, undocumented behavior, or painful lesson here so future sessions don't repeat them.

## Format

```
### [Date] Short title
**Context:** What we were doing
**Problem:** What went wrong
**Fix:** What solved it
```

---

### [2026-04-14] TaskRegistry closeTask default-value bug
**Context:** Security audit of TaskRegistry.sol
**Problem:** `taskIdToIndex` mapping returns 0 for non-existent taskIds. If task 1 sits at index 0, calling `closeTask(999)` would close task 1 because both map to index 0.
**Fix:** Added separate `taskExists` mapping. `closeTask()` now checks `taskExists[taskId]` before accessing the array. Also added `TaskAlreadyClosed` check to prevent double-close.

### [2026-04-14] Solidity custom errors vs string reverts
**Context:** Hardening contracts for gas efficiency
**Problem:** `require(condition, "string message")` costs more gas than custom errors. Also custom errors carry structured data.
**Fix:** Replaced all `require` + string messages with custom `error` declarations and `if (!condition) revert CustomError()` pattern. Tests updated to use `.revertedWithCustomError()` instead of `.revertedWith("string")`.

### [2026-04-14] Hardhat network-helpers for time manipulation
**Context:** Testing deadline/timeout features in BlindEscrow
**Problem:** Need to fast-forward block.timestamp for deadline tests.
**Fix:** Import `time` from `@nomicfoundation/hardhat-network-helpers` and use `time.increase(seconds)`. Already included in hardhat-toolbox.
