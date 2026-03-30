use anchor_lang::prelude::*;

/// Marks a receiver address as whitelisted. Existence of this PDA = whitelisted.
/// seeds = [b"whitelist", receiver.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct WhitelistEntry {
    /// The whitelisted receiver pubkey (also encoded in PDA seeds).
    pub receiver: Pubkey,
    /// PDA bump.
    pub bump: u8,
}
