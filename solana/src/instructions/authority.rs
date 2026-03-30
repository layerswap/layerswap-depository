use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::state::Config;

/// Step 1 of a two-step authority transfer: current authority nominates a successor.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        constraint = config.authority == authority.key() @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

pub fn transfer_handler(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_authority = Some(new_authority);
    Ok(())
}

/// Step 2: the nominated address accepts, completing the transfer.
#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        constraint = config.pending_authority.is_some() @ DepositoryError::NoPendingAuthority,
        constraint = config.pending_authority == Some(pending_authority.key()) @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub pending_authority: Signer<'info>,
}

pub fn accept_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = config.pending_authority.unwrap();
    config.pending_authority = None;
    Ok(())
}
