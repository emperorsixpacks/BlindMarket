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
    use blindmarket::types::{
        TaskMeta,
        AdminCap,
        ENotAuthorized,
        ETaskNotFound,
        ETaskAlreadyExists,
    };

    public struct TaskRegistry has key {
        id: UID,
        /// All task metadata entries (including closed tasks).
        task_metas: Table<u64, TaskMeta>,
        /// Number of currently open tasks (O(1) counter).
        open_task_count: u64,
        /// Total tasks ever published.
        total_tasks: u64,
    }

    fun init(ctx: &mut TxContext) {
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
    //
    // Authorization is checked via the BlindEscrow's authorized_publishers
    // VecMap. This is a cross-module read. For simplicity, the escrow module
    // calls these functions directly using `friend` or package-internal
    // visibility. External callers are blocked.

    /// Publish a new task to the registry. Called by BlindEscrow during create_task.
    public(package) fun publish_task(
        registry: &mut TaskRegistry,
        task_id: u64,
        agent: address,
        category: vector<u8>,
        location_zone: vector<u8>,
        reward: u64,
        created_at: u64,
        ctx: &mut TxContext,
    ) {
        assert!(!table::contains(&registry.task_metas, task_id), ETaskAlreadyExists);

        let meta = TaskMeta {
            task_id,
            agent,
            category,
            location_zone,
            reward,
            created_at,
            is_open: true,
        };
        table::add(&mut registry.task_metas, task_id, meta);

        registry.open_task_count = registry.open_task_count + 1;
        registry.total_tasks = registry.total_tasks + 1;
    }

    /// Close a task (mark as no longer open). Called by BlindEscrow on
    /// assignment, completion, cancellation, etc.
    public(package) fun close_task(registry: &mut TaskRegistry, task_id: u64) {
        assert!(table::contains(&registry.task_metas, task_id), ETaskNotFound);
        let meta = table::borrow_mut(&mut registry.task_metas, task_id);
        assert!(meta.is_open, ETaskNotFound); // already closed
        meta.is_open = false;
        registry.open_task_count = registry.open_task_count - 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions
    // ═══════════════════════════════════════════════════════════════════════

    #[syntax(view)]
    public fun get_task_meta(registry: &TaskRegistry, task_id: u64): &TaskMeta {
        assert!(table::contains(&registry.task_metas, task_id), ETaskNotFound);
        table::borrow(&registry.task_metas, task_id)
    }

    #[syntax(view)]
    public fun open_task_count(registry: &TaskRegistry): u64 {
        registry.open_task_count
    }

    #[syntax(view)]
    public fun total_tasks(registry: &TaskRegistry): u64 {
        registry.total_tasks
    }

    #[syntax(view)]
    public fun task_exists(registry: &TaskRegistry, task_id: u64): bool {
        table::contains(&registry.task_metas, task_id)
    }
}
