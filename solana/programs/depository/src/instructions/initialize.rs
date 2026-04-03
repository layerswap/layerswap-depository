use anchor_lang::prelude::*;
use crate::errors::DepositoryError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Pays for the Config PDA rent. Must be the program's upgrade authority.
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

    /// The deployed program; used to locate its programdata account.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ DepositoryError::Unauthorized,
    )]
    pub program: Program<'info, crate::program::LayerswapDepository>,

    /// BPF-upgradeable-loader programdata; its upgrade_authority must equal payer.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(payer.key()) @ DepositoryError::Unauthorized,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// One-time initialization. Creates the Config PDA.
/// Call add_receiver separately for each initial whitelisted address.
pub fn handler(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
    require!(authority != Pubkey::default(), DepositoryError::InvalidAuthority);
    require!(authority != crate::ID, DepositoryError::InvalidAuthority);

    let config = &mut ctx.accounts.config;
    config.authority = authority;
    config.pending_authority = None;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}
