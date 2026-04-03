use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use crate::errors::DepositoryError;
use crate::events::Deposited;
use crate::state::{Config, WhitelistEntry};

/// SPL Memo program v2.
mod memo_program {
    anchor_lang::declare_id!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
}

#[derive(Accounts)]
pub struct DepositToken<'info> {
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

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub depositor_ata: InterfaceAccount<'info, TokenAccount>,

    /// Created if it does not yet exist (depositor pays rent).
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = mint,
        associated_token::authority = receiver,
        associated_token::token_program = token_program,
    )]
    pub receiver_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Identity validated via whitelist_entry PDA seed derivation.
    pub receiver: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: SPL Memo program v2 — address validated by constraint.
    #[account(address = memo_program::ID)]
    pub memo_program: UncheckedAccount<'info>,
}

/// Forward SPL tokens from `depositor` directly to a whitelisted `receiver`.
/// Supports both SPL Token and Token-2022 (transfer hooks via remaining accounts,
/// MemoTransfer via memo CPI). Uses balance-delta to handle fee-on-transfer tokens.
pub fn handler<'a>(ctx: Context<'_, '_, 'a, 'a, DepositToken<'a>>, id: [u8; 32], amount: u64) -> Result<()> {
    require!(amount > 0, DepositoryError::ZeroAmount);

    let before = ctx.accounts.receiver_ata.amount;

    // Emit a memo before the transfer. Satisfies the MemoTransfer extension
    // (when enabled on receiver ATA) and is a no-op otherwise.
    invoke(
        &Instruction {
            program_id: ctx.accounts.memo_program.key(),
            accounts: vec![AccountMeta::new_readonly(ctx.accounts.depositor.key(), true)],
            data: id.to_vec(),
        },
        &[
            ctx.accounts.depositor.to_account_info(),
            ctx.accounts.memo_program.to_account_info(),
        ],
    )?;

    // Build transfer_checked CPI manually so that remaining accounts
    // (transfer hook program + validation PDA) are included in the instruction.
    // Anchor's token_interface::transfer_checked helper does not pass remaining
    // accounts into the instruction's account list, which Token-2022 hooks require.
    let mut accounts = vec![
        AccountMeta::new(ctx.accounts.depositor_ata.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint.key(), false),
        AccountMeta::new(ctx.accounts.receiver_ata.key(), false),
        AccountMeta::new_readonly(ctx.accounts.depositor.key(), true),
    ];
    let mut infos = vec![
        ctx.accounts.depositor_ata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.receiver_ata.to_account_info(),
        ctx.accounts.depositor.to_account_info(),
    ];

    for extra in ctx.remaining_accounts {
        accounts.push(if extra.is_writable {
            AccountMeta::new(extra.key(), false)
        } else {
            AccountMeta::new_readonly(extra.key(), false)
        });
        infos.push(extra.clone());
    }

    // TransferChecked discriminator (12) + amount (u64 LE) + decimals (u8)
    let mut data = Vec::with_capacity(10);
    data.push(12u8);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(ctx.accounts.mint.decimals);

    infos.push(ctx.accounts.token_program.to_account_info());
    invoke(
        &Instruction { program_id: ctx.accounts.token_program.key(), accounts, data },
        &infos,
    )?;

    // Reload to capture actual received amount (handles fee-on-transfer tokens).
    ctx.accounts.receiver_ata.reload()?;
    let received = ctx.accounts.receiver_ata.amount.saturating_sub(before);

    require!(received > 0, DepositoryError::ZeroAmount);

    emit!(Deposited {
        id,
        mint: Some(ctx.accounts.mint.key()),
        receiver: ctx.accounts.receiver.key(),
        amount: received,
    });

    Ok(())
}
