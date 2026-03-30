use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::events::ReceiverUpdated;
use crate::state::{Config, WhitelistEntry};

#[derive(Accounts)]
pub struct UpdateReceiver<'info> {
    #[account(
        constraint = config.authority == authority.key() @ DepositoryError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Old whitelisted receiver to replace.
    pub old_receiver: UncheckedAccount<'info>,

    /// CHECK: New receiver address to whitelist in its place.
    pub new_receiver: UncheckedAccount<'info>,

    /// Close the old entry first (field order ensures this constraint is checked
    /// before new_entry's `init` is processed by Anchor).
    #[account(
        mut,
        close = authority,
        seeds = [b"whitelist", old_receiver.key().as_ref()],
        bump = old_entry.bump,
        constraint = old_entry.receiver == old_receiver.key() @ DepositoryError::NotWhitelisted,
        constraint = old_receiver.key() != new_receiver.key() @ DepositoryError::SameReceiver,
    )]
    pub old_entry: Account<'info, WhitelistEntry>,

    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistEntry::INIT_SPACE,
        seeds = [b"whitelist", new_receiver.key().as_ref()],
        bump,
    )]
    pub new_entry: Account<'info, WhitelistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpdateReceiver>) -> Result<()> {
    let new_key = ctx.accounts.new_receiver.key();
    require!(new_key != Pubkey::default(), DepositoryError::InvalidReceiver);
    require!(new_key != crate::ID, DepositoryError::InvalidReceiver);

    let new_entry = &mut ctx.accounts.new_entry;
    new_entry.receiver = new_key;
    new_entry.bump = ctx.bumps.new_entry;

    emit!(ReceiverUpdated {
        old_receiver: ctx.accounts.old_receiver.key(),
        new_receiver: new_key,
    });

    Ok(())
}
