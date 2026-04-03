use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::errors::DepositoryError;
use crate::events::Deposited;
use crate::state::{Config, WhitelistEntry};

#[derive(Accounts)]
pub struct DepositNative<'info> {
    /// Sender of the SOL.
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DepositoryError::Paused,
    )]
    pub config: Account<'info, Config>,

    /// Proves `receiver` is whitelisted. If this PDA does not exist the
    /// instruction fails with AccountNotInitialized (effectively NotWhitelisted).
    #[account(
        seeds = [b"whitelist", receiver.key().as_ref()],
        bump = whitelist_entry.bump,
        has_one = receiver @ DepositoryError::NotWhitelisted,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    /// CHECK: Identity validated via whitelist_entry PDA seed derivation.
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Forward SOL from `depositor` directly to a whitelisted `receiver`.
/// Non-custodial: the program never holds funds.
pub fn handler(ctx: Context<DepositNative>, id: [u8; 32], amount: u64) -> Result<()> {
    require!(amount > 0, DepositoryError::ZeroAmount);

    emit!(Deposited {
        id,
        mint: None,
        receiver: ctx.accounts.receiver.key(),
        amount,
    });

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.receiver.to_account_info(),
            },
        ),
        amount,
    )?;

    Ok(())
}
