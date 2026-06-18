/// Shared types and error codes for the BlindMarket Move package.
module blindmarket::types {
    use sui::object::UID;

    // ── Error codes ────────────────────────────────────────────────────────

    /// Caller is not the contract admin.
    const ENotAdmin: u64 = 0;
    /// Caller is not the task agent.
    const ENotAgent: u64 = 1;
    /// Caller is not the assigned worker.
    const ENotWorker: u64 = 2;
    /// Caller is not the verifier.
    const ENotVerifier: u64 = 3;
    /// Caller is not the pending admin.
    const ENotPendingAdmin: u64 = 4;
    /// A zero address was provided where a non-zero one is required.
    const EZeroAddress: u64 = 5;
    /// Amount must be greater than zero.
    const EZeroAmount: u64 = 6;
    /// Empty task hash or evidence hash.
    const EEmptyHash: u64 = 7;
    /// Token type is not allowed for escrow.
    const ETokenNotAllowed: u64 = 8;
    /// Deadline is out of valid range.
    const EInvalidDeadline: u64 = 9;
    /// Task status does not allow this operation.
    const EInvalidStatus: u64 = 10;
    /// Agent cannot assign themselves as worker.
    const ESelfAssignment: u64 = 11;
    /// Deadline has not been reached yet.
    const EDeadlineNotReached: u64 = 12;
    /// Deadline has already passed.
    const EDeadlineReached: u64 = 13;
    /// Max submission attempts exceeded.
    const EMaxSubmissionAttemptsReached: u64 = 14;
    /// Platform fee exceeds maximum allowed.
    const EFeeExceedsMax: u64 = 15;
    /// Not authorized to call this function.
    const ENotAuthorized: u64 = 16;
    /// Worker already rated for this task.
    const EAlreadyRated: u64 = 17;
    /// Invalid score (must be 1-5).
    const EInvalidScore: u64 = 18;
    /// Task not found.
    const ETaskNotFound: u64 = 19;
    /// Task already exists.
    const ETaskAlreadyExists: u64 = 20;

    // ── Constants ──────────────────────────────────────────────────────────

    /// Maximum platform fee in basis points (30%).
    const MAX_FEE_BPS: u64 = 3000;
    /// Maximum number of evidence submissions before task fails.
    const MAX_SUBMISSION_ATTEMPTS: u8 = 3;
    /// Minimum deadline duration (1 hour in milliseconds).
    const MIN_DEADLINE_MS: u64 = 3_600_000;
    /// Maximum deadline duration (90 days in milliseconds).
    const MAX_DEADLINE_MS: u64 = 7_776_000_000;

    // ── Task status enum ───────────────────────────────────────────────────

    /// Mirrors the Solidity TaskStatus enum for cross-chain compatibility.
    const STATUS_FUNDED: u8 = 0;
    const STATUS_ASSIGNED: u8 = 1;
    const STATUS_SUBMITTED: u8 = 2;
    const STATUS_VERIFIED: u8 = 3;
    const STATUS_COMPLETED: u8 = 4;
    const STATUS_CANCELLED: u8 = 5;
    const STATUS_DISPUTED: u8 = 6;

    // ── Task struct ────────────────────────────────────────────────────────

    /// On-chain task representation. Stored in the BlindEscrow's dynamic
    /// field Table<u64, Task>.
    public struct Task has store {
        /// Task creator / poster.
        agent: address,
        /// Assigned worker (0x0 if unassigned).
        worker: address,
        /// Payment token type. For native SUI, use the string "0x2::sui::SUI".
        token_type: vector<u8>,
        /// Escrowed amount (in token's base units / MIST for SUI).
        amount: u64,
        /// keccak256 hash of encrypted task content stored off-chain.
        task_hash: vector<u8>,
        /// keccak256 hash of submitted evidence (0 if not yet submitted).
        evidence_hash: vector<u8>,
        /// Current task status.
        status: u8,
        /// Task category label.
        category: vector<u8>,
        /// Geographic / jurisdictional zone.
        location_zone: vector<u8>,
        /// Block timestamp when task was created (ms).
        created_at: u64,
        /// Deadline timestamp (ms since epoch).
        deadline: u64,
        /// Number of evidence submission attempts.
        submission_attempts: u8,
        /// Per-task verifier address (0x0 = use global verifier).
        verifier: address,
    }

    // ── Task metadata struct ───────────────────────────────────────────────

    /// Lightweight metadata for task discovery. Stored in TaskRegistry.
    public struct TaskMeta has store {
        task_id: u64,
        agent: address,
        category: vector<u8>,
        location_zone: vector<u8>,
        reward: u64,
        created_at: u64,
        is_open: bool,
    }

    // ── Reputation struct ──────────────────────────────────────────────────

    /// On-chain reputation for a worker.
    public struct Reputation has store {
        tasks_completed: u64,
        total_score: u64,
        disputes: u64,
    }

    // ── Admin capability ───────────────────────────────────────────────────

    /// Capability object held by the contract admin. Transferred via
    /// two-step admin transfer. Only the holder can call admin-gated
    /// functions like set_fee, set_verifier, pause, etc.
    public struct AdminCap has key, store {
        id: UID,
    }

    // ── Events ─────────────────────────────────────────────────────────────

    /// Emitted when a new task is created.
    public struct TaskCreated has copy, drop {
        task_id: u64,
        agent: address,
        amount: u64,
        task_hash: vector<u8>,
        category: vector<u8>,
        location_zone: vector<u8>,
        deadline: u64,
    }

    /// Emitted when a worker is assigned to a task.
    public struct WorkerAssigned has copy, drop {
        task_id: u64,
        worker: address,
    }

    /// Emitted when evidence is submitted.
    public struct EvidenceSubmitted has copy, drop {
        task_id: u64,
        worker: address,
        evidence_hash: vector<u8>,
        attempt: u8,
    }

    /// Emitted when verification completes.
    public struct VerificationCompleted has copy, drop {
        task_id: u64,
        passed: bool,
    }

    /// Emitted when a task is completed and payout occurs.
    public struct TaskCompleted has copy, drop {
        task_id: u64,
        worker_payout: u64,
        platform_fee: u64,
    }

    /// Emitted when a task is cancelled.
    public struct TaskCancelled has copy, drop {
        task_id: u64,
        refund_amount: u64,
    }

    /// Emitted when a dispute is raised.
    public struct TaskDisputed has copy, drop {
        task_id: u64,
        initiator: address,
    }

    /// Emitted when a dispute is resolved.
    public struct DisputeResolved has copy, drop {
        task_id: u64,
        worker_favored: bool,
    }

    /// Emitted when timeout is claimed.
    public struct DeadlineExpired has copy, drop {
        task_id: u64,
        refund_amount: u64,
    }

    /// Emitted when a worker is rated.
    public struct Rated has copy, drop {
        worker: address,
        rater: address,
        score: u8,
        task_id: u64,
    }

    /// Emitted when a dispute is recorded against a worker.
    public struct DisputeRecorded has copy, drop {
        worker: address,
        task_id: u64,
    }

    /// Emitted when the admin is changed.
    public struct AdminChanged has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    /// Emitted when a publisher is authorized/revoked.
    public struct PublisherAuthorizationChanged has copy, drop {
        publisher: address,
        authorized: bool,
    }

    /// Emitted when a rater is authorized/revoked.
    public struct RaterAuthorizationChanged has copy, drop {
        rater: address,
        authorized: bool,
    }

    // ── Helper functions ───────────────────────────────────────────────────

    /// Check that two addresses are equal. Aborts with `code` if not.
    public fun assert_eq_address(a: address, b: address, code: u64) {
        assert!(a == b, code);
    }

    /// Check that amount is > 0.
    public fun assert_nonzero_amount(amount: u64) {
        assert!(amount > 0, EZeroAmount);
    }

    /// Check that a hash (vector<u8>) is non-empty.
    public fun assert_nonempty_hash(hash: &vector<u8>) {
        assert!(hash.length() > 0, EEmptyHash);
    }

    /// Validate deadline is within allowed range.
    public fun assert_valid_deadline(created_at: u64, deadline: u64, ctx: &sui::tx_context::TxContext) {
        let duration = deadline - created_at;
        assert!(duration >= MIN_DEADLINE_MS, EInvalidDeadline);
        assert!(duration <= MAX_DEADLINE_MS, EInvalidDeadline);
    }
}
