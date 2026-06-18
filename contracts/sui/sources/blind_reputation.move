/// BlindReputation — Anonymous on-chain reputation system for BlindMarket on Sui.
///
/// Port of Solidity BlindReputation.sol. Tracks cumulative scores, average
/// ratings, and disputes per worker. Only authorized raters (the BlindEscrow)
/// can record scores.

module blindmarket::blind_reputation {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use sui::table::{Self, Table};
    use sui::event;
    use blindmarket::types::{
        Reputation,
        AdminCap,
        Rated,
        DisputeRecorded,
        ENotAuthorized,
        EInvalidScore,
        EAlreadyRated,
    };

    public struct BlindReputation has key {
        id: UID,
        /// Worker address → Reputation.
        reputations: Table<address, Reputation>,
        /// Hash of (worker || task_id) → already rated flag.
        /// Key format: sha256(worker_bytes ++ task_id_bytes)
        rated_tasks: Table<vector<u8>, bool>,
    }

    fun init(ctx: &mut TxContext) {
        let rep = BlindReputation {
            id: object::new(ctx),
            reputations: table::new(ctx),
            rated_tasks: table::new(ctx),
        };
        transfer::share_object(rep);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Package-internal writes (called by BlindEscrow)
    // ═══════════════════════════════════════════════════════════════════════

    /// Rate a worker after task completion. Score 1-5.
    public(package) fun rate(
        rep: &mut BlindReputation,
        worker: address,
        score: u8,
        task_id: u64,
        _rater: address,
    ) {
        assert!(score >= 1 && score <= 5, EInvalidScore);

        let key = rating_key(worker, task_id);
        assert!(!table::contains(&rep.rated_tasks, key), EAlreadyRated);
        table::add(&mut rep.rated_tasks, key, true);

        if (!table::contains(&rep.reputations, worker)) {
            table::add(&mut rep.reputations, worker, Reputation {
                tasks_completed: 0,
                total_score: 0,
                disputes: 0,
            });
        };

        let entry = table::borrow_mut(&mut rep.reputations, worker);
        entry.tasks_completed = entry.tasks_completed + 1;
        entry.total_score = entry.total_score + (score as u64);

        event::emit(Rated { worker, rater: worker, score, task_id });
    }

    /// Record a dispute against a worker (no score impact, just tracking).
    public(package) fun record_dispute(
        rep: &mut BlindReputation,
        worker: address,
        _task_id: u64,
    ) {
        if (!table::contains(&rep.reputations, worker)) {
            table::add(&mut rep.reputations, worker, Reputation {
                tasks_completed: 0,
                total_score: 0,
                disputes: 0,
            });
        };

        let entry = table::borrow_mut(&mut rep.reputations, worker);
        entry.disputes = entry.disputes + 1;

        event::emit(DisputeRecorded { worker, task_id: 0 });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Returns (tasks_completed, avg_score, disputes).
    #[syntax(view)]
    public fun get_reputation(rep: &BlindReputation, worker: address): (u64, u64, u64) {
        if (!table::contains(&rep.reputations, worker)) {
            return (0, 0, 0)
        };

        let entry = table::borrow(&rep.reputations, worker);
        let avg = if (entry.tasks_completed > 0) {
            entry.total_score * 100 / entry.tasks_completed // scaled by 100 for precision
        } else {
            0
        };

        (entry.tasks_completed, avg, entry.disputes)
    }

    #[syntax(view)]
    public fun has_been_rated(rep: &BlindReputation, worker: address, task_id: u64): bool {
        let key = rating_key(worker, task_id);
        table::contains(&rep.rated_tasks, key)
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// Build a deduplication key from worker + task_id.
    fun rating_key(worker: address, task_id: u64): vector<u8> {
        let mut key = vector[];
        // Append worker address as raw bytes (32 bytes on Sui)
        let addr_vec = to_bytes(worker);
        key.append(addr_vec);
        // Append task_id as big-endian u64 bytes
        key.append(bcs::to_bytes(&task_id));
        key
    }

    // Move doesn't have a built-in address→bytes conversion.
    // This is a placeholder; Sui provides `address::to_bytes` in the
    // move-stdlib or via `bcs::to_bytes`.
    native fun to_bytes(addr: address): vector<u8>;
}
