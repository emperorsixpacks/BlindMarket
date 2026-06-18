/// AgentNFT — Agent identity token (INFT / ERC-7857 equivalent) for
/// BlindMarket on Sui.
///
/// On Sui, every object is natively an NFT, so this is much simpler than the
/// Solidity ERC-721 implementation. Each agent is an owned object with an
/// encrypted metadata URI (stored on 0G Storage or Sui Walrus).

module blindmarket::agent_nft {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use sui::url;
    use sui::event;
    use blindmarket::types::AdminCap;

    /// An agent identity token. Transferable only with TEE proof (post-MVP).
    public struct Agent has key, store {
        id: UID,
        /// Owner address.
        owner: address,
        /// Encrypted off-chain metadata URI (0G Storage / Walrus blob ID).
        encrypted_uri: vector<u8>,
        /// keccak256 hash of the plaintext metadata (for integrity verification).
        metadata_hash: vector<u8>,
        /// When the agent was minted (ms since epoch).
        minted_at: u64,
    }

    /// Emitted when a new agent is minted.
    public struct AgentMinted has copy, drop {
        token_id: address, // object ID serves as token ID
        owner: address,
        metadata_hash: vector<u8>,
    }

    /// Emitted when an agent's metadata is updated.
    public struct MetadataUpdated has copy, drop {
        token_id: address,
        new_hash: vector<u8>,
    }

    /// Mint a new agent identity token. Only the admin can call this
    /// (backend service holds the AdminCap).
    public entry fun mint(
        to: address,
        encrypted_uri: vector<u8>,
        metadata_hash: vector<u8>,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let agent = Agent {
            id: object::new(ctx),
            owner: to,
            encrypted_uri,
            metadata_hash,
            minted_at: sui::tx_context::epoch_timestamp_ms(ctx),
        };

        let token_id = object::uid_to_address(&agent.id);

        event::emit(AgentMinted {
            token_id,
            owner: to,
            metadata_hash: agent.metadata_hash,
        });

        transfer::public_transfer(agent, to);
    }

    /// Transfer an agent token to a new owner. In production, this should
    /// require a TEE proof that the metadata was re-encrypted to the new
    /// owner's public key (matching the ERC-7857 spec). Currently unrestricted.
    public entry fun transfer(
        agent: Agent,
        to: address,
        _ctx: &mut TxContext,
    ) {
        // TODO(post-MVP): require TEE proof for metadata re-encryption
        // let Agent { id, owner: _, encrypted_uri, metadata_hash, minted_at } = agent;
        transfer::public_transfer(agent, to);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  View functions
    // ═══════════════════════════════════════════════════════════════════════

    #[syntax(view)]
    public fun get_encrypted_uri(agent: &Agent): &vector<u8> {
        &agent.encrypted_uri
    }

    #[syntax(view)]
    public fun get_metadata_hash(agent: &Agent): &vector<u8> {
        &agent.metadata_hash
    }

    #[syntax(view)]
    public fun owner(agent: &Agent): address {
        agent.owner
    }

    #[syntax(view)]
    public fun minted_at(agent: &Agent): u64 {
        agent.minted_at
    }
}
