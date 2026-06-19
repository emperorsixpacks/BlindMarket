/// Shared types, helpers, and accessor functions for BlindMarket on Sui.
module blindmarket::types {
    use sui::object::UID;

    // ── Constants used by helpers ──────────────────────────────────────────

    const EZeroAmount: u64 = 6;
    const EEmptyHash: u64 = 7;
    const EInvalidDeadline: u64 = 9;
    const MIN_DEADLINE_MS: u64 = 3_600_000;
    const MAX_DEADLINE_MS: u64 = 7_776_000_000;

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

    // ── TaskMeta accessors ──────────────────────────────────────────────────

    public fun task_meta_task_id(meta: &TaskMeta): u64 { meta.task_id }
    public fun task_meta_agent(meta: &TaskMeta): address { meta.agent }
    public fun task_meta_category(meta: &TaskMeta): &vector<u8> { &meta.category }
    public fun task_meta_location_zone(meta: &TaskMeta): &vector<u8> { &meta.location_zone }
    public fun task_meta_reward(meta: &TaskMeta): u64 { meta.reward }
    public fun task_meta_created_at(meta: &TaskMeta): u64 { meta.created_at }
    public fun task_meta_is_open(meta: &TaskMeta): bool { meta.is_open }

    // ── TaskMeta constructor (package-internal) ───────────────────────────

    public(package) fun create_task_meta(
        task_id: u64,
        agent: address,
        category: vector<u8>,
        location_zone: vector<u8>,
        reward: u64,
        created_at: u64,
        is_open: bool,
    ): TaskMeta {
        TaskMeta { task_id, agent, category, location_zone, reward, created_at, is_open }
    }

    // ── TaskMeta setters (for modules in the same package) ─────────────────

    public(package) fun set_task_meta_open(meta: &mut TaskMeta, is_open: bool) {
        meta.is_open = is_open;
    }

    public(package) fun set_task_meta_agent(meta: &mut TaskMeta, agent: address) {
        meta.agent = agent;
    }

    // ── Helper functions ───────────────────────────────────────────────────

    public fun assert_eq_address(a: address, b: address, code: u64) {
        assert!(a == b, code);
    }

    public fun assert_nonzero_amount(amount: u64) {
        assert!(amount > 0, EZeroAmount);
    }

    public fun assert_nonempty_hash(hash: &vector<u8>) {
        assert!(hash.length() > 0, EEmptyHash);
    }

    public fun assert_valid_deadline(created_at: u64, deadline: u64, _ctx: &sui::tx_context::TxContext) {
        let duration = deadline - created_at;
        assert!(duration >= MIN_DEADLINE_MS, EInvalidDeadline);
        assert!(duration <= MAX_DEADLINE_MS, EInvalidDeadline);
    }
}
