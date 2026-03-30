use anchor_lang::prelude::*;

/// Global program configuration. One PDA, seeds = [b"config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Current program authority (manages whitelist, pause, ownership transfer).
    pub authority: Pubkey,
    /// Set during a two-step authority transfer; None when no transfer is pending.
    pub pending_authority: Option<Pubkey>,
    /// When true, all deposit instructions revert.
    pub paused: bool,
    /// PDA bump, stored to skip recomputation on every instruction.
    pub bump: u8,
}
