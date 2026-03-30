use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::events::ReceiverAdded;
use crate::state::{Config, WhitelistEntry};

#[derive(Accounts)]
pub struct AddReceiver<'info> {
    #[account(
        constraint = config.authority == authority.key() @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Address to whitelist; validated in handler (non-zero, not program ID).
    pub receiver: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistEntry::INIT_SPACE,
        seeds = [b"whitelist", receiver.key().as_ref()],
        bump,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddReceiver>) -> Result<()> {
    let receiver_key = ctx.accounts.receiver.key();
    require!(receiver_key != Pubkey::default(), DepositoryError::InvalidReceiver);
    require!(receiver_key != crate::ID, DepositoryError::InvalidReceiver);

    let entry = &mut ctx.accounts.whitelist_entry;
    entry.receiver = receiver_key;
    entry.bump = ctx.bumps.whitelist_entry;

    emit!(ReceiverAdded { receiver: receiver_key });

    Ok(())
}
