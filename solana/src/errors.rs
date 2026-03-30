use anchor_lang::prelude::*;

#[error_code]
pub enum DepositoryError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Receiver is not whitelisted")]
    NotWhitelisted,
    #[msg("Address is already whitelisted")]
    AlreadyWhitelisted,
    #[msg("Receiver address is invalid (zero address or program ID)")]
    InvalidReceiver,
    #[msg("Old and new receiver are the same address")]
    SameReceiver,
    #[msg("Deposits are currently paused")]
    Paused,
    #[msg("Caller is not the program authority")]
    Unauthorized,
    #[msg("No pending authority transfer in progress")]
    NoPendingAuthority,
}
