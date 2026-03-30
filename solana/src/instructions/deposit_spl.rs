use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};
use crate::errors::DepositoryError;
use crate::events::Deposited;
use crate::state::{Config, WhitelistEntry};

#[derive(Accounts)]
pub struct DepositSpl<'info> {
    /// Sender of the SPL tokens. Pays for receiver ATA creation if needed.
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DepositoryError::Paused,
    )]
    pub config: Account<'info, Config>,

    /// Proves `receiver` is whitelisted.
    #[account(
        seeds = [b"whitelist", receiver.key().as_ref()],
        bump = whitelist_entry.bump,
        has_one = receiver @ DepositoryError::NotWhitelisted,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = depositor,
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    /// Created if it does not yet exist (depositor pays rent).
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = mint,
        associated_token::authority = receiver,
    )]
    pub receiver_ata: Account<'info, TokenAccount>,

    /// CHECK: Identity validated via whitelist_entry PDA seed derivation.
    pub receiver: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Forward SPL tokens from `depositor` directly to a whitelisted `receiver`.
/// Uses balance-delta to correctly handle fee-on-transfer tokens.
pub fn handler(ctx: Context<DepositSpl>, id: [u8; 32], amount: u64) -> Result<()> {
    require!(amount > 0, DepositoryError::ZeroAmount);

    let before = ctx.accounts.receiver_ata.amount;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_ata.to_account_info(),
                to: ctx.accounts.receiver_ata.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // Reload to capture actual received amount (handles fee-on-transfer tokens).
    ctx.accounts.receiver_ata.reload()?;
    let received = ctx.accounts.receiver_ata.amount.saturating_sub(before);

    emit!(Deposited {
        id,
        mint: Some(ctx.accounts.mint.key()),
        receiver: ctx.accounts.receiver.key(),
        amount: received,
    });

    Ok(())
}
