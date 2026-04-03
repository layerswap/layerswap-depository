use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("3LX4wGbnhEt9ew5GkL98qcc5h6KzNDSSZ6LJBCKXy36p");

/// Minimal transfer hook that always succeeds. Used only for testing.
#[program]
pub mod test_transfer_hook {
    use super::*;

    /// Create the ExtraAccountMetaList PDA for a given mint (no extra accounts needed).
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let extra_account_metas: Vec<ExtraAccountMeta> = vec![];
        let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())
            .map_err(|_| ProgramError::InvalidAccountData)?;

        let lamports = Rent::get()?.minimum_balance(account_size);
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[u8]] = &[
            b"extra-account-metas",
            mint_key.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ];

        system_program::create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            lamports,
            account_size as u64,
            ctx.program_id,
        )?;

        let account_info = ctx.accounts.extra_account_meta_list.to_account_info();
        let mut data = account_info.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        Ok(())
    }

    /// Fallback handler: catches the spl-transfer-hook-interface Execute CPI
    /// from Token-2022 (which uses a different discriminator than Anchor).
    /// Always succeeds — this is a no-op hook for testing.
    pub fn fallback<'info>(
        _program_id: &Pubkey,
        _accounts: &'info [AccountInfo<'info>],
        _data: &[u8],
    ) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The validation state PDA for this mint.
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// CHECK: The mint this hook is for.
    pub mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
