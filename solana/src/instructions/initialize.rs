use anchor_lang::prelude::*;
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Pays for the Config PDA rent. Typically the deployer wallet.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

/// One-time initialization. Creates the Config PDA.
/// Call add_receiver separately for each initial whitelisted address.
pub fn handler(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = authority;
    config.pending_authority = None;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}
