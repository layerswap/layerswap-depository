use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::events::{Paused, Unpaused};
use crate::state::Config;

/// Shared accounts for pause and unpause (same required signers and accounts).
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        constraint = config.authority == authority.key() @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

pub fn pause_handler(ctx: Context<SetPaused>) -> Result<()> {
    require!(!ctx.accounts.config.paused, DepositoryError::AlreadyPaused);
    ctx.accounts.config.paused = true;
    emit!(Paused {});
    Ok(())
}

pub fn unpause_handler(ctx: Context<SetPaused>) -> Result<()> {
    require!(ctx.accounts.config.paused, DepositoryError::NotPaused);
    ctx.accounts.config.paused = false;
    emit!(Unpaused {});
    Ok(())
}
