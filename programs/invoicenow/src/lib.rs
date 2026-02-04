use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("GyR2tNwj8UF4AUpiUjzXKqW9mdHcgQzuByqnyhGk6s3N");

#[program]
pub mod invoicenow {
    use super::*;

    /// Create a new invoice
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        invoice_id: String,
        amount: u64,
        token_mint: Pubkey,
        due_date: i64,
        memo: String,
        milestones: Vec<Milestone>,
    ) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        let clock = Clock::get()?;

        require!(invoice_id.len() <= 32, InvoiceError::InvoiceIdTooLong);
        require!(memo.len() <= 256, InvoiceError::MemoTooLong);
        require!(milestones.len() <= 10, InvoiceError::TooManyMilestones);

        invoice.creator = ctx.accounts.creator.key();
        invoice.client = Pubkey::default(); // Set when client pays or escrow is funded
        invoice.invoice_id = invoice_id;
        invoice.amount = amount;
        invoice.token_mint = token_mint;
        invoice.due_date = due_date;
        invoice.memo = memo;
        invoice.status = InvoiceStatus::Pending;
        invoice.created_at = clock.unix_timestamp;
        invoice.paid_at = 0;
        invoice.milestones = milestones;
        invoice.current_milestone = 0;
        invoice.escrow_funded = false;
        invoice.bump = ctx.bumps.invoice;

        emit!(InvoiceCreated {
            invoice_key: invoice.key(),
            creator: invoice.creator,
            invoice_id: invoice.invoice_id.clone(),
            amount: invoice.amount,
            due_date: invoice.due_date,
        });

        Ok(())
    }

    /// Fund escrow for milestone-based invoice
    pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        let escrow = &mut ctx.accounts.escrow;

        require!(
            invoice.status == InvoiceStatus::Pending,
            InvoiceError::InvalidInvoiceStatus
        );
        require!(amount >= invoice.amount, InvoiceError::InsufficientFunding);
        require!(!invoice.milestones.is_empty(), InvoiceError::NoMilestones);

        // Initialize escrow
        escrow.invoice_id = invoice.invoice_id.clone();
        escrow.bump = ctx.bumps.escrow;

        // Transfer tokens from client to escrow
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.client_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.client.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        invoice.client = ctx.accounts.client.key();
        invoice.escrow_funded = true;
        invoice.status = InvoiceStatus::EscrowFunded;

        emit!(EscrowFunded {
            invoice_key: invoice.key(),
            client: ctx.accounts.client.key(),
            amount,
        });

        Ok(())
    }

    /// Release funds for a completed milestone
    pub fn release_milestone(ctx: Context<ReleaseMilestone>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        let clock = Clock::get()?;

        require!(
            invoice.status == InvoiceStatus::EscrowFunded,
            InvoiceError::InvalidInvoiceStatus
        );
        require!(invoice.escrow_funded, InvoiceError::EscrowNotFunded);
        require!(
            (invoice.current_milestone as usize) < invoice.milestones.len(),
            InvoiceError::AllMilestonesComplete
        );

        // Only creator or client can release milestone
        require!(
            ctx.accounts.authority.key() == invoice.creator
                || ctx.accounts.authority.key() == invoice.client,
            InvoiceError::Unauthorized
        );

        let milestone_idx = invoice.current_milestone as usize;
        let milestone_amount = invoice.milestones[milestone_idx].amount;

        // Transfer from escrow to creator
        let invoice_id = invoice.invoice_id.clone();
        let seeds = &[
            b"escrow",
            invoice_id.as_bytes(),
            &[ctx.accounts.escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, milestone_amount)?;

        // Update milestone status
        invoice.milestones[milestone_idx].completed = true;
        invoice.milestones[milestone_idx].completed_at = clock.unix_timestamp;
        invoice.current_milestone += 1;

        // Check if all milestones complete
        if invoice.current_milestone as usize >= invoice.milestones.len() {
            invoice.status = InvoiceStatus::Paid;
            invoice.paid_at = clock.unix_timestamp;
        }

        emit!(MilestoneReleased {
            invoice_key: invoice.key(),
            milestone_index: milestone_idx as u8,
            amount: milestone_amount,
        });

        Ok(())
    }

    /// Mark invoice as paid (for direct payments without escrow)
    pub fn mark_paid(ctx: Context<MarkPaid>, tx_signature: String) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        let clock = Clock::get()?;

        require!(
            invoice.status == InvoiceStatus::Pending,
            InvoiceError::InvalidInvoiceStatus
        );
        require!(tx_signature.len() <= 88, InvoiceError::TxSignatureTooLong);

        invoice.status = InvoiceStatus::Paid;
        invoice.paid_at = clock.unix_timestamp;
        invoice.client = ctx.accounts.payer.key();

        emit!(InvoicePaid {
            invoice_key: invoice.key(),
            payer: ctx.accounts.payer.key(),
            tx_signature,
            paid_at: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Cancel an unpaid invoice
    pub fn cancel_invoice(ctx: Context<CancelInvoice>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;

        require!(
            invoice.status == InvoiceStatus::Pending,
            InvoiceError::InvalidInvoiceStatus
        );
        require!(
            ctx.accounts.creator.key() == invoice.creator,
            InvoiceError::Unauthorized
        );

        invoice.status = InvoiceStatus::Cancelled;

        emit!(InvoiceCancelled {
            invoice_key: invoice.key(),
        });

        Ok(())
    }

    /// Create user profile
    pub fn create_profile(
        ctx: Context<CreateProfile>,
        name: String,
        email: String,
        business_name: Option<String>,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.profile;

        require!(name.len() <= 64, InvoiceError::NameTooLong);
        require!(email.len() <= 128, InvoiceError::EmailTooLong);

        profile.wallet = ctx.accounts.owner.key();
        profile.name = name;
        profile.email = email;
        profile.business_name = business_name.unwrap_or_default();
        profile.total_invoices = 0;
        profile.total_received = 0;
        profile.bump = ctx.bumps.profile;

        Ok(())
    }
}

// === ACCOUNTS ===

#[derive(Accounts)]
#[instruction(invoice_id: String)]
pub struct CreateInvoice<'info> {
    #[account(
        init,
        payer = creator,
        space = Invoice::space(&invoice_id),
        seeds = [b"invoice", creator.key().as_ref(), invoice_id.as_bytes()],
        bump
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        init,
        payer = client,
        space = Escrow::SPACE,
        seeds = [b"escrow", invoice.invoice_id.as_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = client,
        token::mint = token_mint,
        token::authority = escrow,
        seeds = [b"escrow_vault", invoice.invoice_id.as_bytes()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = client_token_account.owner == client.key(),
        constraint = client_token_account.mint == token_mint.key()
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// CHECK: Token mint for payment
    pub token_mint: AccountInfo<'info>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseMilestone<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        seeds = [b"escrow", invoice.invoice_id.as_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"escrow_vault", invoice.invoice_id.as_bytes()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.owner == invoice.creator
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MarkPaid<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump
    )]
    pub invoice: Account<'info, Invoice>,

    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelInvoice<'info> {
    #[account(
        mut,
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump
    )]
    pub invoice: Account<'info, Invoice>,

    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(
        init,
        payer = owner,
        space = UserProfile::SPACE,
        seeds = [b"profile", owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// === STATE ===

#[account]
pub struct Invoice {
    pub creator: Pubkey,
    pub client: Pubkey,
    pub invoice_id: String,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub due_date: i64,
    pub memo: String,
    pub status: InvoiceStatus,
    pub created_at: i64,
    pub paid_at: i64,
    pub milestones: Vec<Milestone>,
    pub current_milestone: u8,
    pub escrow_funded: bool,
    pub bump: u8,
}

impl Invoice {
    pub fn space(invoice_id: &str) -> usize {
        8 + // discriminator
        32 + // creator
        32 + // client
        4 + invoice_id.len() + // invoice_id string
        8 + // amount
        32 + // token_mint
        8 + // due_date
        4 + 256 + // memo (max)
        1 + // status
        8 + // created_at
        8 + // paid_at
        4 + (10 * Milestone::SPACE) + // milestones vec (max 10)
        1 + // current_milestone
        1 + // escrow_funded
        1 // bump
    }
}

#[account]
pub struct Escrow {
    pub invoice_id: String,
    pub bump: u8,
}

impl Escrow {
    pub const SPACE: usize = 8 + 4 + 32 + 1;
}

#[account]
pub struct UserProfile {
    pub wallet: Pubkey,
    pub name: String,
    pub email: String,
    pub business_name: String,
    pub total_invoices: u64,
    pub total_received: u64,
    pub bump: u8,
}

impl UserProfile {
    pub const SPACE: usize = 8 + 32 + (4 + 64) + (4 + 128) + (4 + 128) + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Milestone {
    pub description: String,
    pub amount: u64,
    pub completed: bool,
    pub completed_at: i64,
}

impl Milestone {
    pub const SPACE: usize = 4 + 128 + 8 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum InvoiceStatus {
    Pending,
    EscrowFunded,
    Paid,
    Cancelled,
    Disputed,
}

impl Default for InvoiceStatus {
    fn default() -> Self {
        InvoiceStatus::Pending
    }
}

// === EVENTS ===

#[event]
pub struct InvoiceCreated {
    pub invoice_key: Pubkey,
    pub creator: Pubkey,
    pub invoice_id: String,
    pub amount: u64,
    pub due_date: i64,
}

#[event]
pub struct EscrowFunded {
    pub invoice_key: Pubkey,
    pub client: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MilestoneReleased {
    pub invoice_key: Pubkey,
    pub milestone_index: u8,
    pub amount: u64,
}

#[event]
pub struct InvoicePaid {
    pub invoice_key: Pubkey,
    pub payer: Pubkey,
    pub tx_signature: String,
    pub paid_at: i64,
}

#[event]
pub struct InvoiceCancelled {
    pub invoice_key: Pubkey,
}

// === ERRORS ===

#[error_code]
pub enum InvoiceError {
    #[msg("Invoice ID too long (max 32 chars)")]
    InvoiceIdTooLong,
    #[msg("Memo too long (max 256 chars)")]
    MemoTooLong,
    #[msg("Too many milestones (max 10)")]
    TooManyMilestones,
    #[msg("Invalid invoice status for this operation")]
    InvalidInvoiceStatus,
    #[msg("Insufficient funding amount")]
    InsufficientFunding,
    #[msg("No milestones defined for escrow")]
    NoMilestones,
    #[msg("Escrow not funded")]
    EscrowNotFunded,
    #[msg("All milestones already complete")]
    AllMilestonesComplete,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Transaction signature too long")]
    TxSignatureTooLong,
    #[msg("Name too long (max 64 chars)")]
    NameTooLong,
    #[msg("Email too long (max 128 chars)")]
    EmailTooLong,
}
