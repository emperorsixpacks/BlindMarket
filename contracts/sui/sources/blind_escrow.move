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

    use blindmarket::types::{
        Self,
        Task,
        TaskMeta,
        AdminCap,
        TaskCreated,
        WorkerAssigned,
        EvidenceSubmitted,
        VerificationCompleted,
        TaskCompleted,
        TaskCancelled,
        TaskDisputed,
        DisputeResolved,
        DeadlineExpired,
        PublisherAuthorizationChanged,
        RaterAuthorizationChanged,
        AdminChanged,
        ENotAdmin,
        ENotAgent,
        ENotWorker,
        ENotPendingAdmin,
        EZeroAddress,
        EZeroAmount,
        EEmptyHash,
        EInvalidDeadline,
        EInvalidStatus,
        ESelfAssignment,
        EDeadlineNotReached,
        EDeadlineReached,
        EMaxSubmissionAttemptsReached,
        EFeeExceedsMax,
        MAX_FEE_BPS,
        MAX_SUBMISSION_ATTEMPTS,
        STATUS_FUNDED,
        STATUS_ASSIGNED,
        STATUS_SUBMITTED,
        STATUS_VERIFIED,
        STATUS_COMPLETED,
        STATUS_CANCELLED,
        STATUS_DISPUTED,
    };

    /// The BlindEscrow shared object — the on-chain hub for all task operations.
    public struct BlindEscrow has key {
        id: UID,
        next_task_id: u64,
        /// All tasks keyed by task ID.
        tasks: Table<u64, Task>,
        /// Task metadata for discovery (inlined registry).
        task_metas: Table<u64, TaskMeta>,
        /// Per-task escrowed amounts. All funds held in `escrow_balance`.
        task_amounts: Table<u64, u64>,
        /// Consolidated escrow balance for all active tasks.
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
    fun init(treasury: address, verifier: address, ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::public_transfer(admin_cap, ctx.sender());

        let escrow = BlindEscrow {
            id: object::new(ctx),
            next_task_id: 1,
            tasks: table::new(ctx),
            task_metas: table::new(ctx),
            task_amounts: table::new(ctx),
            escrow_balance: balance::zero(),
            fee_bps: 1500,
            treasury,
            verifier,
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

        // Merge payment into escrow balance
        balance::join(&mut escrow.escrow_balance, coin::into_balance(payment));
        table::add(&mut escrow.task_amounts, task_id, amount);

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
            created_at: tx_context::epoch_timestamp_ms(ctx),
            deadline,
            submission_attempts: 0,
            verifier: @0x0,
        };
        table::add(&mut escrow.tasks, task_id, task);

        let meta = TaskMeta {
            task_id,
            agent: ctx.sender(),
            category: task.category,
            location_zone: task.location_zone,
            reward: amount,
            created_at: task.created_at,
            is_open: true,
        };
        table::add(&mut escrow.task_metas, task_id, meta);

        event::emit(TaskCreated {
            task_id,
            agent: ctx.sender(),
            amount,
            task_hash,
            category: task.category,
            location_zone: task.location_zone,
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
        meta.is_open = false;

        event::emit(WorkerAssigned { task_id, worker });
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

        task.evidence_hash = evidence_hash;
        task.submission_attempts = attempt;
        task.status = STATUS_SUBMITTED;

        event::emit(EvidenceSubmitted { task_id, worker: ctx.sender(), evidence_hash, attempt });
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
        table::borrow_mut(&mut escrow.task_metas, task_id).is_open = false;
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

    public entry fun accept_admin(escrow: &mut BlindEscrow, cap: &mut AdminCap, ctx: &TxContext) {
        let pending = escrow.pending_admin;
        types::assert_eq_address(pending, ctx.sender(), ENotPendingAdmin);
        escrow.pending_admin = @0x0;
        // In production: transfer AdminCap to the new admin
        // For now, emit the event
        event::emit(AdminChanged { old_admin: @0x0, new_admin: pending });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions (read-only queries)
    // ═══════════════════════════════════════════════════════════════════════

    #[syntax(view)]
    public fun get_task(escrow: &BlindEscrow, task_id: u64): &Task {
        table::borrow(&escrow.tasks, task_id)
    }

    #[syntax(view)]
    public fun is_task_expired(escrow: &BlindEscrow, task_id: u64, ctx: &TxContext): bool {
        let task = table::borrow(&escrow.tasks, task_id);
        tx_context::epoch_timestamp_ms(ctx) >= task.deadline
    }

    #[syntax(view)]
    public fun next_task_id(escrow: &BlindEscrow): u64 {
        escrow.next_task_id
    }

    #[syntax(view)]
    public fun fee_bps(escrow: &BlindEscrow): u64 {
        escrow.fee_bps
    }

    #[syntax(view)]
    public fun open_task_count(escrow: &BlindEscrow): u64 {
        escrow.open_task_count
    }

    #[syntax(view)]
    public fun get_task_meta(escrow: &BlindEscrow, task_id: u64): &TaskMeta {
        table::borrow(&escrow.task_metas, task_id)
    }

    #[syntax(view)]
    pub fun get_balance(escrow: &BlindEscrow): u64 {
        balance::value(&escrow.escrow_balance)
    }
}
