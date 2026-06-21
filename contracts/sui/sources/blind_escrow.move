/// BlindEscrow — Encrypted task escrow for BlindMarket on Sui.
///
/// Port of the Solidity BlindEscrow.sol to Sui Move. Manages the full
/// lifecycle of encrypted tasks: creation with locked funds, worker
/// assignment, encrypted evidence submission, verification, payout,
/// cancellation, deadline expiry, and dispute resolution.

module blindmarket::blind_escrow {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use sui::event;
    use sui::vec_map::{Self, VecMap};
    use sui::sui::SUI;

    use blindmarket::types::{Self, TaskMeta};
    use blindmarket::task_registry;

    // ── Error codes ────────────────────────────────────────────────────────

    const ENotAgent: u64 = 1;
    const ENotWorker: u64 = 2;
    const ENotVerifier: u64 = 3;
    const ENotPendingAdmin: u64 = 4;
    const EZeroAddress: u64 = 5;
    const EInvalidStatus: u64 = 10;
    const ESelfAssignment: u64 = 11;
    const EDeadlineNotReached: u64 = 12;
    const EMaxSubmissionAttemptsReached: u64 = 14;
    const EFeeExceedsMax: u64 = 15;

    // ── Constants ──────────────────────────────────────────────────────────

    const MAX_FEE_BPS: u64 = 3000;
    const MAX_SUBMISSION_ATTEMPTS: u8 = 3;

    const STATUS_FUNDED: u8 = 0;
    const STATUS_ASSIGNED: u8 = 1;
    const STATUS_SUBMITTED: u8 = 2;
    const STATUS_VERIFIED: u8 = 3;
    const STATUS_COMPLETED: u8 = 4;
    const STATUS_CANCELLED: u8 = 5;
    const STATUS_DISPUTED: u8 = 6;

    // ── On-chain task representation ───────────────────────────────────────

    public struct Task has store {
        agent: address,
        worker: address,
        token_type: vector<u8>,
        amount: u64,
        task_hash: vector<u8>,
        evidence_hash: vector<u8>,
        status: u8,
        category: vector<u8>,
        location_zone: vector<u8>,
        created_at: u64,
        deadline: u64,
        submission_attempts: u8,
        verifier: address,
    }

    // ── Admin capability ───────────────────────────────────────────────────

    public struct AdminCap has key, store {
        id: UID,
    }

    // ── One-time witness for init ──────────────────────────────────────────

    public struct BLIND_ESCROW has drop {}

    // ── Events ─────────────────────────────────────────────────────────────

    public struct TaskCreated has copy, drop {
        task_id: u64,
        agent: address,
        amount: u64,
        task_hash: vector<u8>,
        category: vector<u8>,
        location_zone: vector<u8>,
        deadline: u64,
    }

    public struct WorkerAssigned has copy, drop {
        task_id: u64,
        worker: address,
    }

    public struct EvidenceSubmitted has copy, drop {
        task_id: u64,
        worker: address,
        evidence_hash: vector<u8>,
        attempt: u8,
    }

    public struct VerificationCompleted has copy, drop {
        task_id: u64,
        passed: bool,
    }

    public struct TaskCompleted has copy, drop {
        task_id: u64,
        worker_payout: u64,
        platform_fee: u64,
    }

    public struct TaskCancelled has copy, drop {
        task_id: u64,
        refund_amount: u64,
    }

    public struct TaskDisputed has copy, drop {
        task_id: u64,
        initiator: address,
    }

    public struct DisputeResolved has copy, drop {
        task_id: u64,
        worker_favored: bool,
    }

    public struct DeadlineExpired has copy, drop {
        task_id: u64,
        refund_amount: u64,
    }

    public struct PublisherAuthorizationChanged has copy, drop {
        publisher: address,
        authorized: bool,
    }

    public struct RaterAuthorizationChanged has copy, drop {
        rater: address,
        authorized: bool,
    }

    public struct AdminChanged has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    /// The BlindEscrow shared object — the on-chain hub for all task operations.
    public struct BlindEscrow has key {
        id: UID,
        next_task_id: u64,
        tasks: Table<u64, Task>,
        task_metas: Table<u64, TaskMeta>,
        task_amounts: Table<u64, u64>,
        escrow_balance: Balance<SUI>,
        fee_bps: u64,
        treasury: address,
        verifier: address,
        open_task_count: u64,
        pending_admin: address,
        authorized_publishers: VecMap<address, bool>,
        authorized_raters: VecMap<address, bool>,
    }

    /// One-time setup. Creates AdminCap → deployer, freezes BlindEscrow as shared.
    fun init(_otw: BLIND_ESCROW, ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::public_transfer(admin_cap, ctx.sender());

        let escrow = BlindEscrow {
            id: object::new(ctx),
            next_task_id: 1,
            tasks: table::new(ctx),
            task_metas: table::new(ctx),
            task_amounts: table::new(ctx),
            escrow_balance: balance::zero(),
            fee_bps: 1500,
            treasury: @0x0,
            verifier: @0x0,
            open_task_count: 0,
            pending_admin: @0x0,
            authorized_publishers: vec_map::empty(),
            authorized_raters: vec_map::empty(),
        };
        transfer::share_object(escrow);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Task lifecycle
    // ═══════════════════════════════════════════════════════════════════════

    /// Create a new task with escrowed SUI. The caller sends Coin<SUI> as
    /// payment; it is held by the escrow until task completion or cancellation.
    public entry fun create_task(
        escrow: &mut BlindEscrow,
        payment: Coin<SUI>,
        task_hash: vector<u8>,
        category: vector<u8>,
        location_zone: vector<u8>,
        deadline: u64,
        ctx: &mut TxContext,
    ) {
        types::assert_nonempty_hash(&task_hash);
        types::assert_nonzero_amount(coin::value(&payment));
        types::assert_valid_deadline(tx_context::epoch_timestamp_ms(ctx), deadline, ctx);

        let amount = coin::value(&payment);
        let task_id = escrow.next_task_id;
        escrow.next_task_id = task_id + 1;
        escrow.open_task_count = escrow.open_task_count + 1;

        balance::join(&mut escrow.escrow_balance, coin::into_balance(payment));
        table::add(&mut escrow.task_amounts, task_id, amount);

        // Copy vector fields before moving them into the Task struct
        let task_hash_copy = copy task_hash;
        let category_copy = copy category;
        let location_zone_copy = copy location_zone;
        let created_at = tx_context::epoch_timestamp_ms(ctx);

        let task = Task {
            agent: ctx.sender(),
            worker: @0x0,
            token_type: b"0x2::sui::SUI",
            amount,
            task_hash,
            evidence_hash: vector[],
            status: STATUS_FUNDED,
            category,
            location_zone,
            created_at,
            deadline,
            submission_attempts: 0,
            verifier: @0x0,
        };
        table::add(&mut escrow.tasks, task_id, task);

        let meta = types::create_task_meta(
            task_id,
            ctx.sender(),
            category_copy,
            location_zone_copy,
            amount,
            created_at,
            true,
        );
        table::add(&mut escrow.task_metas, task_id, meta);

        event::emit(TaskCreated {
            task_id,
            agent: ctx.sender(),
            amount,
            task_hash: task_hash_copy,
            category: category_copy,
            location_zone: location_zone_copy,
            deadline,
        });
    }

    /// Assign a worker. Caller must be the task agent.
    public entry fun assign_worker(
        escrow: &mut BlindEscrow,
        task_id: u64,
        worker: address,
        ctx: &TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);

        types::assert_eq_address(task.agent, ctx.sender(), ENotAgent);
        assert!(worker != @0x0, EZeroAddress);
        assert!(worker != task.agent, ESelfAssignment);
        assert!(task.status == STATUS_FUNDED, EInvalidStatus);

        task.worker = worker;
        task.status = STATUS_ASSIGNED;

        let meta = table::borrow_mut(&mut escrow.task_metas, task_id);
        types::set_task_meta_open(meta, false);

        event::emit(WorkerAssigned { task_id, worker });
    }

    /// Assign a worker via the marketplace/verifier. Mirrors the EVM
    /// marketplaceAssign — lets the verifier assign workers for A2A tasks
    /// without requiring the task agent to sign.
    public entry fun marketplace_assign(
        escrow: &mut BlindEscrow,
        registry: &mut task_registry::TaskRegistry,
        task_id: u64,
        worker: address,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == escrow.verifier, ENotVerifier);
        let task = table::borrow_mut(&mut escrow.tasks, task_id);

        assert!(worker != @0x0, EZeroAddress);
        assert!(worker != task.agent, ESelfAssignment);
        assert!(task.status == STATUS_FUNDED, EInvalidStatus);
        assert!(tx_context::epoch_timestamp_ms(ctx) < task.deadline, EDeadlineNotReached);

        task.worker = worker;
        task.status = STATUS_ASSIGNED;

        let meta = table::borrow_mut(&mut escrow.task_metas, task_id);
        types::set_task_meta_open(meta, false);

        // Close the task in the public registry if it was published there.
        if (task_registry::task_exists(registry, task_id)) {
            task_registry::close_task(registry, task_id);
        };

        event::emit(WorkerAssigned { task_id, worker });
    }

    /// Complete verification gated by the marketplace verifier address
    /// (escrow.verifier) instead of AdminCap. The marketplace backend signs
    /// this after auto-verify passes, so it does not need the AdminCap object.
    public entry fun marketplace_complete_verification(
        escrow: &mut BlindEscrow,
        task_id: u64,
        passed: bool,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.verifier, ENotVerifier);
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        assert!(task.status == STATUS_SUBMITTED, EInvalidStatus);

        let amount = *table::borrow(&escrow.task_amounts, task_id);
        let amount_ref = table::borrow_mut(&mut escrow.task_amounts, task_id);

        if (passed) {
            task.status = STATUS_COMPLETED;
            let fee = amount * escrow.fee_bps / 10000;
            let worker_payout = amount - fee;
            let worker_addr = task.worker;

            let worker_balance = balance::split(&mut escrow.escrow_balance, worker_payout);
            transfer::public_transfer(coin::from_balance(worker_balance, ctx), worker_addr);

            if (fee > 0 && escrow.treasury != @0x0) {
                let fee_balance = balance::split(&mut escrow.escrow_balance, fee);
                transfer::public_transfer(coin::from_balance(fee_balance, ctx), escrow.treasury);
            };

            event::emit(TaskCompleted { task_id, worker_payout, platform_fee: fee });
        } else {
            task.status = STATUS_VERIFIED;
            let agent_addr = task.agent;

            let refund = balance::split(&mut escrow.escrow_balance, amount);
            transfer::public_transfer(coin::from_balance(refund, ctx), agent_addr);

            event::emit(VerificationCompleted { task_id, passed: false });
        };

        *amount_ref = 0;
    }

    /// Submit an evidence hash. Caller must be the worker.
    public entry fun submit_evidence(
        escrow: &mut BlindEscrow,
        task_id: u64,
        evidence_hash: vector<u8>,
        ctx: &TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);

        types::assert_eq_address(task.worker, ctx.sender(), ENotWorker);
        types::assert_nonempty_hash(&evidence_hash);
        assert!(task.status == STATUS_ASSIGNED, EInvalidStatus);

        let attempt = task.submission_attempts + 1;
        assert!(attempt <= MAX_SUBMISSION_ATTEMPTS, EMaxSubmissionAttemptsReached);

        let evidence_hash_clone = copy evidence_hash;
        task.evidence_hash = evidence_hash;
        task.submission_attempts = attempt;
        task.status = STATUS_SUBMITTED;

        event::emit(EvidenceSubmitted { task_id, worker: ctx.sender(), evidence_hash: evidence_hash_clone, attempt });
    }

    /// Complete verification. Admin/verifier only.
    public entry fun complete_verification(
        escrow: &mut BlindEscrow,
        task_id: u64,
        passed: bool,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        assert!(task.status == STATUS_SUBMITTED, EInvalidStatus);

        let amount = *table::borrow(&escrow.task_amounts, task_id);
        let amount_ref = table::borrow_mut(&mut escrow.task_amounts, task_id);

        if (passed) {
            task.status = STATUS_COMPLETED;
            let fee = amount * escrow.fee_bps / 10000;
            let worker_payout = amount - fee;
            let worker_addr = task.worker;

            let worker_balance = balance::split(&mut escrow.escrow_balance, worker_payout);
            transfer::public_transfer(coin::from_balance(worker_balance, ctx), worker_addr);

            if (fee > 0 && escrow.treasury != @0x0) {
                let fee_balance = balance::split(&mut escrow.escrow_balance, fee);
                transfer::public_transfer(coin::from_balance(fee_balance, ctx), escrow.treasury);
            };

            event::emit(TaskCompleted { task_id, worker_payout, platform_fee: fee });
        } else {
            task.status = STATUS_VERIFIED;
            let agent_addr = task.agent;

            let refund = balance::split(&mut escrow.escrow_balance, amount);
            transfer::public_transfer(coin::from_balance(refund, ctx), agent_addr);

            event::emit(VerificationCompleted { task_id, passed: false });
        };

        *amount_ref = 0;
        table::remove(&mut escrow.task_amounts, task_id);
        escrow.open_task_count = escrow.open_task_count - 1;
    }

    /// Cancel a task. Admin only.
    public entry fun cancel_task(
        escrow: &mut BlindEscrow,
        task_id: u64,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        assert!(
            task.status == STATUS_FUNDED || task.status == STATUS_ASSIGNED,
            EInvalidStatus
        );

        let agent_addr = task.agent;
        let amount = *table::borrow(&escrow.task_amounts, task_id);

        task.status = STATUS_CANCELLED;

        let refund = balance::split(&mut escrow.escrow_balance, amount);
        transfer::public_transfer(coin::from_balance(refund, ctx), agent_addr);

        table::remove(&mut escrow.task_amounts, task_id);
        types::set_task_meta_open(
            table::borrow_mut(&mut escrow.task_metas, task_id),
            false,
        );
        escrow.open_task_count = escrow.open_task_count - 1;

        event::emit(TaskCancelled { task_id, refund_amount: amount });
    }

    /// Claim escrow after deadline expiry. Caller must be the agent.
    public entry fun claim_timeout(
        escrow: &mut BlindEscrow,
        task_id: u64,
        ctx: &mut TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        types::assert_eq_address(task.agent, ctx.sender(), ENotAgent);
        assert!(tx_context::epoch_timestamp_ms(ctx) >= task.deadline, EDeadlineNotReached);
        assert!(
            task.status == STATUS_FUNDED || task.status == STATUS_ASSIGNED || task.status == STATUS_SUBMITTED,
            EInvalidStatus
        );

        let agent_addr = task.agent;
        let amount = *table::borrow(&escrow.task_amounts, task_id);

        task.status = STATUS_CANCELLED;

        let refund = balance::split(&mut escrow.escrow_balance, amount);
        transfer::public_transfer(coin::from_balance(refund, ctx), agent_addr);

        table::remove(&mut escrow.task_amounts, task_id);
        escrow.open_task_count = escrow.open_task_count - 1;

        event::emit(DeadlineExpired { task_id, refund_amount: amount });
    }

    /// Raise a dispute. Agent or worker can call.
    public entry fun raise_dispute(
        escrow: &mut BlindEscrow,
        task_id: u64,
        ctx: &TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        assert!(
            task.status == STATUS_SUBMITTED || task.status == STATUS_VERIFIED,
            EInvalidStatus
        );

        let sender = ctx.sender();
        assert!(sender == task.agent || sender == task.worker, ENotAgent);

        task.status = STATUS_DISPUTED;
        event::emit(TaskDisputed { task_id, initiator: sender });
    }

    /// Resolve a dispute. Admin only.
    public entry fun resolve_dispute(
        escrow: &mut BlindEscrow,
        task_id: u64,
        worker_favored: bool,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let task = table::borrow_mut(&mut escrow.tasks, task_id);
        assert!(task.status == STATUS_DISPUTED, EInvalidStatus);

        let amount = *table::borrow(&escrow.task_amounts, task_id);
        table::remove(&mut escrow.task_amounts, task_id);

        if (worker_favored) {
            let fee = amount * escrow.fee_bps / 10000;
            let worker_payout = amount - fee;
            let worker_addr = task.worker;

            let worker_balance = balance::split(&mut escrow.escrow_balance, worker_payout);
            transfer::public_transfer(coin::from_balance(worker_balance, ctx), worker_addr);

            if (fee > 0 && escrow.treasury != @0x0) {
                let fee_balance = balance::split(&mut escrow.escrow_balance, fee);
                transfer::public_transfer(coin::from_balance(fee_balance, ctx), escrow.treasury);
            };
        } else {
            let agent_addr = task.agent;
            let refund = balance::split(&mut escrow.escrow_balance, amount);
            transfer::public_transfer(coin::from_balance(refund, ctx), agent_addr);
        };

        task.status = STATUS_COMPLETED;
        escrow.open_task_count = escrow.open_task_count - 1;

        event::emit(DisputeResolved { task_id, worker_favored });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Admin functions
    // ═══════════════════════════════════════════════════════════════════════

    public entry fun set_treasury(escrow: &mut BlindEscrow, new_treasury: address, _cap: &AdminCap) {
        escrow.treasury = new_treasury;
    }

    public entry fun set_verifier(escrow: &mut BlindEscrow, new_verifier: address, _cap: &AdminCap) {
        escrow.verifier = new_verifier;
    }

    public entry fun set_fee_bps(escrow: &mut BlindEscrow, new_fee_bps: u64, _cap: &AdminCap) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EFeeExceedsMax);
        escrow.fee_bps = new_fee_bps;
    }

    public entry fun authorize_publisher(escrow: &mut BlindEscrow, publisher: address, _cap: &AdminCap) {
        vec_map::insert(&mut escrow.authorized_publishers, publisher, true);
        event::emit(PublisherAuthorizationChanged { publisher, authorized: true });
    }

    public entry fun revoke_publisher(escrow: &mut BlindEscrow, publisher: address, _cap: &AdminCap) {
        vec_map::remove(&mut escrow.authorized_publishers, &publisher);
        event::emit(PublisherAuthorizationChanged { publisher, authorized: false });
    }

    public entry fun authorize_rater(escrow: &mut BlindEscrow, rater: address, _cap: &AdminCap) {
        vec_map::insert(&mut escrow.authorized_raters, rater, true);
        event::emit(RaterAuthorizationChanged { rater, authorized: true });
    }

    public entry fun revoke_rater(escrow: &mut BlindEscrow, rater: address, _cap: &AdminCap) {
        vec_map::remove(&mut escrow.authorized_raters, &rater);
        event::emit(RaterAuthorizationChanged { rater, authorized: false });
    }

    public entry fun propose_admin(escrow: &mut BlindEscrow, new_admin: address, _cap: &AdminCap) {
        assert!(new_admin != @0x0, EZeroAddress);
        escrow.pending_admin = new_admin;
    }

    public entry fun accept_admin(escrow: &mut BlindEscrow, _cap: &mut AdminCap, ctx: &TxContext) {
        let pending = escrow.pending_admin;
        types::assert_eq_address(pending, ctx.sender(), ENotPendingAdmin);
        escrow.pending_admin = @0x0;
        event::emit(AdminChanged { old_admin: @0x0, new_admin: pending });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions (read-only queries)
    // ═══════════════════════════════════════════════════════════════════════

    /// View accessor for off-chain readers (backend devInspect).
    ///
    /// Returns a tuple of copy+drop scalars instead of `&Task` because
    /// programmable transactions cannot return references to non-droppable
    /// structs — `Task` has only `store`, so `&Task` fails Sui's static
    /// `InvalidPublicFunctionReturnType` check during devInspect.
    ///
    /// Tuple shape: (worker, deadline, status, evidence_hash, submission_attempts).
    /// Backend BCS parser in chain.ts::getSuiTask expects this exact order.
    public fun get_task(
        escrow: &BlindEscrow,
        task_id: u64,
    ): (address, u64, u8, vector<u8>, u8) {
        let task = table::borrow(&escrow.tasks, task_id);
        (
            task.worker,
            task.deadline,
            task.status,
            task.evidence_hash,
            task.submission_attempts,
        )
    }

    public fun is_task_expired(escrow: &BlindEscrow, task_id: u64, ctx: &TxContext): bool {
        let task = table::borrow(&escrow.tasks, task_id);
        tx_context::epoch_timestamp_ms(ctx) >= task.deadline
    }

    public fun next_task_id(escrow: &BlindEscrow): u64 {
        escrow.next_task_id
    }

    public fun fee_bps(escrow: &BlindEscrow): u64 {
        escrow.fee_bps
    }

    public fun open_task_count(escrow: &BlindEscrow): u64 {
        escrow.open_task_count
    }

    public fun get_task_meta(escrow: &BlindEscrow, task_id: u64): &TaskMeta {
        table::borrow(&escrow.task_metas, task_id)
    }

    public fun get_balance(escrow: &BlindEscrow): u64 {
        balance::value(&escrow.escrow_balance)
    }
}
