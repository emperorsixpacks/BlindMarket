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
    use sui::bcs;

    const EInvalidScore: u64 = 18;
    const EAlreadyRated: u64 = 17;

    // ── OTW ────────────────────────────────────────────────────────────────

    public struct BLIND_REPUTATION has drop {}

    // ── Reputation struct ──────────────────────────────────────────────────

    public struct Reputation has store {
        tasks_completed: u64,
        total_score: u64,
        disputes: u64,
    }

    // ── Events ─────────────────────────────────────────────────────────────

    public struct Rated has copy, drop {
        worker: address,
        rater: address,
        score: u8,
        task_id: u64,
    }

    public struct DisputeRecorded has copy, drop {
        worker: address,
        task_id: u64,
    }

    public struct BlindReputation has key {
        id: UID,
        reputations: Table<address, Reputation>,
        rated_tasks: Table<vector<u8>, bool>,
    }

    fun init(_otw: BLIND_REPUTATION, ctx: &mut TxContext) {
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

    public fun get_reputation(rep: &BlindReputation, worker: address): (u64, u64, u64) {
        if (!table::contains(&rep.reputations, worker)) {
            return (0, 0, 0)
        };

        let entry = table::borrow(&rep.reputations, worker);
        let avg = if (entry.tasks_completed > 0) {
            entry.total_score * 100 / entry.tasks_completed
        } else {
            0
        };

        (entry.tasks_completed, avg, entry.disputes)
    }

    public fun has_been_rated(rep: &BlindReputation, worker: address, task_id: u64): bool {
        let key = rating_key(worker, task_id);
        table::contains(&rep.rated_tasks, key)
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    fun rating_key(worker: address, _task_id: u64): vector<u8> {
        let mut key = vector[];
        let addr_vec = bcs::to_bytes<address>(&worker);
        key.append(addr_vec);
        key.append(bcs::to_bytes<u64>(&_task_id));
        key
    }
}
