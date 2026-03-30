use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::events::ReceiverRemoved;
use crate::state::{Config, WhitelistEntry};

#[derive(Accounts)]
pub struct RemoveReceiver<'info> {
    #[account(
        constraint = config.authority == authority.key() @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Receiver being removed from whitelist.
    pub receiver: UncheckedAccount<'info>,

    /// Closing this PDA removes the receiver from the whitelist.
    /// Rent is returned to authority.
    #[account(
        mut,
        close = authority,
        seeds = [b"whitelist", receiver.key().as_ref()],
        bump = whitelist_entry.bump,
        has_one = receiver @ DepositoryError::NotWhitelisted,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,
}

pub fn handler(ctx: Context<RemoveReceiver>) -> Result<()> {
    emit!(ReceiverRemoved {
        receiver: ctx.accounts.receiver.key(),
    });
    Ok(())
}
