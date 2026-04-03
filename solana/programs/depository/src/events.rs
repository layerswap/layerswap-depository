use anchor_lang::prelude::*;

/// Emitted on every successful deposit.
/// mint = None for SOL deposits.
#[event]
pub struct Deposited {
    pub id: [u8; 32],
    pub mint: Option<Pubkey>,
    pub receiver: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ReceiverAdded {
    pub receiver: Pubkey,
}

#[event]
pub struct ReceiverRemoved {
    pub receiver: Pubkey,
}

#[event]
pub struct ReceiverUpdated {
    pub old_receiver: Pubkey,
    pub new_receiver: Pubkey,
}

#[event]
pub struct Paused {}

#[event]
pub struct Unpaused {}

#[event]
pub struct AuthorityTransferInitiated {
    pub new_authority: Pubkey,
}

#[event]
pub struct AuthorityTransferAccepted {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}
