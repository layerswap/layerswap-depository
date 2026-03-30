use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use instructions::add_receiver::*;
pub use instructions::authority::*;
pub use instructions::deposit_sol::*;
pub use instructions::deposit_spl::*;
pub use instructions::initialize::*;
pub use instructions::pause::*;
pub use instructions::remove_receiver::*;
pub use instructions::update_receiver::*;

// NOTE: Run `anchor keys sync` after the first `anchor build` to update this ID.
declare_id!("CRhRGdDA2y966AqbAoaeHMLVLK43Bzhwk3vdsSaEkJLe");

#[program]
pub mod layerswap_depository {
    use super::*;

    /// One-time initialization. Creates the Config PDA with the given authority.
    /// Call `add_receiver` separately for each initial whitelisted address.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, authority)
    }

    /// Forward SOL from depositor directly to a whitelisted receiver.
    pub fn deposit_sol(ctx: Context<DepositSol>, id: [u8; 32], amount: u64) -> Result<()> {
        instructions::deposit_sol::handler(ctx, id, amount)
    }

    /// Forward SPL tokens from depositor directly to a whitelisted receiver.
    /// Uses balance-delta to support fee-on-transfer tokens.
    pub fn deposit_spl(ctx: Context<DepositSpl>, id: [u8; 32], amount: u64) -> Result<()> {
        instructions::deposit_spl::handler(ctx, id, amount)
    }

    /// Create a WhitelistEntry PDA for the given receiver address.
    pub fn add_receiver(ctx: Context<AddReceiver>) -> Result<()> {
        instructions::add_receiver::handler(ctx)
    }

    /// Close the WhitelistEntry PDA for the given receiver address.
    pub fn remove_receiver(ctx: Context<RemoveReceiver>) -> Result<()> {
        instructions::remove_receiver::handler(ctx)
    }

    /// Atomically close one WhitelistEntry and open another.
    pub fn update_receiver(ctx: Context<UpdateReceiver>) -> Result<()> {
        instructions::update_receiver::handler(ctx)
    }

    /// Pause all deposit instructions.
    pub fn pause(ctx: Context<SetPaused>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    /// Resume deposit instructions.
    pub fn unpause(ctx: Context<SetPaused>) -> Result<()> {
        instructions::pause::unpause_handler(ctx)
    }

    /// Step 1 of two-step authority transfer: nominate a new authority.
    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::authority::transfer_handler(ctx, new_authority)
    }

    /// Step 2: nominated address accepts and becomes the authority.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::authority::accept_handler(ctx)
    }
}
