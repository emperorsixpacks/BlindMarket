/// TaskRegistry — On-chain task discovery index for BlindMarket on Sui.
///
/// Port of Solidity TaskRegistry.sol. Stores lightweight task metadata for
/// workers to browse open tasks. Discovery is separate from the escrow for
/// gas efficiency — only category, zone, and reward are public.

module blindmarket::task_registry {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use sui::table::{Self, Table};
    use sui::event;
    use blindmarket::types::{Self, TaskMeta};

    // Local error codes
    const ETaskNotFound: u64 = 19;
    const ETaskAlreadyExists: u64 = 20;

    public struct TASK_REGISTRY has drop {}

    public struct TaskRegistry has key {
        id: UID,
        task_metas: Table<u64, TaskMeta>,
        open_task_count: u64,
        total_tasks: u64,
    }

    fun init(_otw: TASK_REGISTRY, ctx: &mut TxContext) {
        let registry = TaskRegistry {
            id: object::new(ctx),
            task_metas: table::new(ctx),
            open_task_count: 0,
            total_tasks: 0,
        };
        transfer::share_object(registry);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Publisher-gated write functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Publish a new task to the registry. Called by BlindEscrow during create_task.
    public(package) fun publish_task(
        registry: &mut TaskRegistry,
        task_id: u64,
        agent: address,
        category: vector<u8>,
        location_zone: vector<u8>,
        reward: u64,
        created_at: u64,
        _ctx: &mut TxContext,
    ) {
        assert!(!table::contains(&registry.task_metas, task_id), ETaskAlreadyExists);

        let meta = types::create_task_meta(
            task_id,
            agent,
            category,
            location_zone,
            reward,
            created_at,
            true,
        );
        table::add(&mut registry.task_metas, task_id, meta);

        registry.open_task_count = registry.open_task_count + 1;
        registry.total_tasks = registry.total_tasks + 1;
    }

    /// Close a task (mark as no longer open). Called by BlindEscrow on
    /// assignment, completion, cancellation, etc.
    public(package) fun close_task(registry: &mut TaskRegistry, task_id: u64) {
        assert!(table::contains(&registry.task_metas, task_id), ETaskNotFound);
        let meta = table::borrow_mut(&mut registry.task_metas, task_id);
        assert!(types::task_meta_is_open(meta), ETaskNotFound);
        types::set_task_meta_open(meta, false);
        registry.open_task_count = registry.open_task_count - 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions
    // ═══════════════════════════════════════════════════════════════════════

    public fun get_task_meta(registry: &TaskRegistry, task_id: u64): &TaskMeta {
        table::borrow(&registry.task_metas, task_id)
    }

    public fun open_task_count(registry: &TaskRegistry): u64 {
        registry.open_task_count
    }

    public fun total_tasks(registry: &TaskRegistry): u64 {
        registry.total_tasks
    }

    public fun task_exists(registry: &TaskRegistry, task_id: u64): bool {
        table::contains(&registry.task_metas, task_id)
    }
}
