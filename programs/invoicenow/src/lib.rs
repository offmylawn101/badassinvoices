use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GyR2tNwj8UF4AUpiUjzXKqW9mdHcgQzuByqnyhGk6s3N");

// Constants for lottery
const MAX_HOUSE_EDGE_BPS: u16 = 1000; // 10% max house edge
const MAX_WIN_PCT_BPS: u16 = 1000; // 10% max single win as % of pool
const MIN_POOL_RESERVE_BPS: u16 = 2000; // 20% min reserve
const BPS_DIVISOR: u64 = 10000;

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

    // ============== LOTTERY INSTRUCTIONS ==============

    /// Initialize a lottery pool for a specific token
    pub fn initialize_lottery_pool(
        ctx: Context<InitializeLotteryPool>,
        house_edge_bps: u16,
        min_pool_reserve_bps: u16,
        max_win_pct_bps: u16,
    ) -> Result<()> {
        require!(house_edge_bps <= MAX_HOUSE_EDGE_BPS, InvoiceError::HouseEdgeTooHigh);
        require!(min_pool_reserve_bps <= 5000, InvoiceError::ReserveTooHigh);
        require!(max_win_pct_bps <= MAX_WIN_PCT_BPS, InvoiceError::MaxWinTooHigh);

        let pool = &mut ctx.accounts.lottery_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.total_balance = 0;
        pool.total_premiums_collected = 0;
        pool.total_payouts = 0;
        pool.total_entries = 0;
        pool.total_wins = 0;
        pool.house_edge_bps = house_edge_bps;
        pool.min_pool_reserve_bps = min_pool_reserve_bps;
        pool.max_win_pct_bps = max_win_pct_bps;
        pool.paused = false;
        pool.bump = ctx.bumps.lottery_pool;

        emit!(LotteryPoolCreated {
            pool: pool.key(),
            token_mint: pool.token_mint,
            house_edge_bps,
        });

        Ok(())
    }

    /// Seed the lottery pool with initial funds
    pub fn seed_lottery_pool(ctx: Context<SeedLotteryPool>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;

        require!(!pool.paused, InvoiceError::PoolPaused);
        require!(amount > 0, InvoiceError::InvalidAmount);

        // Transfer tokens from seeder to pool vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seeder_token_account.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
                authority: ctx.accounts.seeder.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        pool.total_balance = pool.total_balance.checked_add(amount).unwrap();

        emit!(LotteryPoolSeeded {
            pool: pool.key(),
            amount,
            new_balance: pool.total_balance,
        });

        Ok(())
    }

    /// Pay invoice with lottery option (premium for chance to win)
    pub fn pay_with_lottery(
        ctx: Context<PayWithLottery>,
        premium_amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let invoice = &ctx.accounts.invoice;
        let entry = &mut ctx.accounts.lottery_entry;
        let clock = Clock::get()?;

        // Validations
        require!(!pool.paused, InvoiceError::PoolPaused);
        require!(invoice.status == InvoiceStatus::Pending, InvoiceError::InvalidInvoiceStatus);
        require!(premium_amount > 0, InvoiceError::InvalidAmount);

        // Invoice must be at least 5 minutes old (prevent gaming)
        require!(
            clock.unix_timestamp - invoice.created_at >= 300,
            InvoiceError::InvoiceTooNew
        );

        let invoice_amount = invoice.amount;

        // Calculate max win based on pool balance
        let available_pool = pool.total_balance
            .saturating_mul(BPS_DIVISOR - pool.min_pool_reserve_bps as u64)
            / BPS_DIVISOR;
        let max_win = available_pool
            .saturating_mul(pool.max_win_pct_bps as u64)
            / BPS_DIVISOR;

        require!(invoice_amount <= max_win, InvoiceError::InvoiceExceedsMaxWin);

        // Calculate win probability
        // Formula: win_prob = premium / (invoice_amount * (1 + house_edge))
        let house_edge_multiplier = BPS_DIVISOR + pool.house_edge_bps as u64;
        let effective_invoice = invoice_amount
            .checked_mul(house_edge_multiplier)
            .unwrap()
            / BPS_DIVISOR;

        let win_probability_bps = (premium_amount as u128)
            .checked_mul(BPS_DIVISOR as u128)
            .unwrap()
            .checked_div(effective_invoice as u128)
            .unwrap_or(0) as u16;

        // Cap probability at 95%
        let win_probability_bps = win_probability_bps.min(9500);

        // Transfer total payment (invoice + premium) from client to pool vault
        let total_payment = invoice_amount.checked_add(premium_amount).unwrap();
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.client_token_account.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
                authority: ctx.accounts.client.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, total_payment)?;

        // Update pool balance (add premium only, invoice amount held for settlement)
        pool.total_balance = pool.total_balance.checked_add(premium_amount).unwrap();
        pool.total_premiums_collected = pool.total_premiums_collected.checked_add(premium_amount).unwrap();
        pool.total_entries = pool.total_entries.checked_add(1).unwrap();

        // Create lottery entry
        entry.invoice = invoice.key();
        entry.client = ctx.accounts.client.key();
        entry.invoice_amount = invoice_amount;
        entry.premium_paid = premium_amount;
        entry.win_probability_bps = win_probability_bps;
        entry.status = LotteryStatus::PendingVrf;
        entry.random_result = None;
        entry.created_at = clock.unix_timestamp;
        entry.resolved_at = 0;
        entry.bump = ctx.bumps.lottery_entry;

        emit!(LotteryEntryCreated {
            entry: entry.key(),
            invoice: invoice.key(),
            client: ctx.accounts.client.key(),
            invoice_amount,
            premium_paid: premium_amount,
            win_probability_bps,
        });

        Ok(())
    }

    /// Settle lottery result (called with randomness - simplified without VRF for hackathon)
    pub fn settle_lottery(
        ctx: Context<SettleLottery>,
        random_bytes: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let invoice = &mut ctx.accounts.invoice;
        let entry = &mut ctx.accounts.lottery_entry;
        let clock = Clock::get()?;

        require!(entry.status == LotteryStatus::PendingVrf, InvoiceError::LotteryAlreadySettled);

        // Derive randomness (0-9999)
        let random_value = u16::from_le_bytes([random_bytes[0], random_bytes[1]]) % 10000;

        // Determine win/loss
        let won = random_value < entry.win_probability_bps;

        entry.random_result = Some(random_bytes);
        entry.resolved_at = clock.unix_timestamp;

        let token_mint = pool.token_mint;
        let pool_bump = pool.bump;

        if won {
            // WIN: Refund invoice amount from pool to client
            entry.status = LotteryStatus::Won;
            pool.total_wins = pool.total_wins.checked_add(1).unwrap();
            pool.total_payouts = pool.total_payouts.checked_add(entry.invoice_amount).unwrap();

            // Transfer invoice amount back to client (they won!)
            let seeds = &[
                b"lottery_pool",
                token_mint.as_ref(),
                &[pool_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.client_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_ctx, entry.invoice_amount)?;

            // Transfer invoice amount to creator (paid by pool)
            let transfer_to_creator = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_to_creator, entry.invoice_amount)?;

            // Deduct payout from pool
            pool.total_balance = pool.total_balance.saturating_sub(entry.invoice_amount);

            emit!(LotteryWon {
                entry: entry.key(),
                invoice: invoice.key(),
                client: entry.client,
                amount_won: entry.invoice_amount,
            });
        } else {
            // LOSE: Pay invoice amount to creator
            entry.status = LotteryStatus::Lost;

            let seeds = &[
                b"lottery_pool",
                token_mint.as_ref(),
                &[pool_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_ctx, entry.invoice_amount)?;

            emit!(LotteryLost {
                entry: entry.key(),
                invoice: invoice.key(),
                client: entry.client,
            });
        }

        // Mark invoice as paid
        invoice.status = InvoiceStatus::Paid;
        invoice.paid_at = clock.unix_timestamp;
        invoice.client = entry.client;

        Ok(())
    }

    /// Pause/unpause lottery pool (admin only)
    pub fn toggle_lottery_pool(ctx: Context<ToggleLotteryPool>) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        pool.paused = !pool.paused;

        emit!(LotteryPoolToggled {
            pool: pool.key(),
            paused: pool.paused,
        });

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

// ============== LOTTERY ACCOUNT STRUCTS ==============

#[derive(Accounts)]
pub struct InitializeLotteryPool<'info> {
    #[account(
        init,
        payer = authority,
        space = LotteryPool::SPACE,
        seeds = [b"lottery_pool", token_mint.key().as_ref()],
        bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = lottery_pool,
        seeds = [b"lottery_vault", token_mint.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SeedLotteryPool<'info> {
    #[account(
        mut,
        seeds = [b"lottery_pool", lottery_pool.token_mint.as_ref()],
        bump = lottery_pool.bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        mut,
        seeds = [b"lottery_vault", lottery_pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seeder_token_account.owner == seeder.key(),
        constraint = seeder_token_account.mint == lottery_pool.token_mint
    )]
    pub seeder_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub seeder: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PayWithLottery<'info> {
    #[account(
        mut,
        seeds = [b"lottery_pool", lottery_pool.token_mint.as_ref()],
        bump = lottery_pool.bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        mut,
        seeds = [b"lottery_vault", lottery_pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump,
        constraint = invoice.token_mint == lottery_pool.token_mint
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        init,
        payer = client,
        space = LotteryEntry::SPACE,
        seeds = [b"lottery_entry", invoice.key().as_ref(), client.key().as_ref()],
        bump
    )]
    pub lottery_entry: Account<'info, LotteryEntry>,

    #[account(
        mut,
        constraint = client_token_account.owner == client.key(),
        constraint = client_token_account.mint == lottery_pool.token_mint
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleLottery<'info> {
    #[account(
        mut,
        seeds = [b"lottery_pool", lottery_pool.token_mint.as_ref()],
        bump = lottery_pool.bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        mut,
        seeds = [b"lottery_vault", lottery_pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"invoice", invoice.creator.as_ref(), invoice.invoice_id.as_bytes()],
        bump = invoice.bump
    )]
    pub invoice: Account<'info, Invoice>,

    #[account(
        mut,
        seeds = [b"lottery_entry", invoice.key().as_ref(), lottery_entry.client.as_ref()],
        bump = lottery_entry.bump
    )]
    pub lottery_entry: Account<'info, LotteryEntry>,

    #[account(
        mut,
        constraint = client_token_account.owner == lottery_entry.client,
        constraint = client_token_account.mint == lottery_pool.token_mint
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.owner == invoice.creator,
        constraint = creator_token_account.mint == lottery_pool.token_mint
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// Anyone can settle (typically backend/crank)
    pub settler: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ToggleLotteryPool<'info> {
    #[account(
        mut,
        seeds = [b"lottery_pool", lottery_pool.token_mint.as_ref()],
        bump = lottery_pool.bump,
        constraint = lottery_pool.authority == authority.key()
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    pub authority: Signer<'info>,
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

// ============== LOTTERY STATE ==============

#[account]
pub struct LotteryPool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub total_balance: u64,
    pub total_premiums_collected: u64,
    pub total_payouts: u64,
    pub total_entries: u64,
    pub total_wins: u64,
    pub house_edge_bps: u16,
    pub min_pool_reserve_bps: u16,
    pub max_win_pct_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl LotteryPool {
    pub const SPACE: usize = 8 + // discriminator
        32 + // authority
        32 + // token_mint
        8 + // total_balance
        8 + // total_premiums_collected
        8 + // total_payouts
        8 + // total_entries
        8 + // total_wins
        2 + // house_edge_bps
        2 + // min_pool_reserve_bps
        2 + // max_win_pct_bps
        1 + // paused
        1; // bump
}

#[account]
pub struct LotteryEntry {
    pub invoice: Pubkey,
    pub client: Pubkey,
    pub invoice_amount: u64,
    pub premium_paid: u64,
    pub win_probability_bps: u16,
    pub status: LotteryStatus,
    pub random_result: Option<[u8; 32]>,
    pub created_at: i64,
    pub resolved_at: i64,
    pub bump: u8,
}

impl LotteryEntry {
    pub const SPACE: usize = 8 + // discriminator
        32 + // invoice
        32 + // client
        8 + // invoice_amount
        8 + // premium_paid
        2 + // win_probability_bps
        1 + // status
        1 + 32 + // Option<[u8; 32]>
        8 + // created_at
        8 + // resolved_at
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum LotteryStatus {
    PendingVrf,
    Won,
    Lost,
}

impl Default for LotteryStatus {
    fn default() -> Self {
        LotteryStatus::PendingVrf
    }
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

// ============== LOTTERY EVENTS ==============

#[event]
pub struct LotteryPoolCreated {
    pub pool: Pubkey,
    pub token_mint: Pubkey,
    pub house_edge_bps: u16,
}

#[event]
pub struct LotteryPoolSeeded {
    pub pool: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct LotteryEntryCreated {
    pub entry: Pubkey,
    pub invoice: Pubkey,
    pub client: Pubkey,
    pub invoice_amount: u64,
    pub premium_paid: u64,
    pub win_probability_bps: u16,
}

#[event]
pub struct LotteryWon {
    pub entry: Pubkey,
    pub invoice: Pubkey,
    pub client: Pubkey,
    pub amount_won: u64,
}

#[event]
pub struct LotteryLost {
    pub entry: Pubkey,
    pub invoice: Pubkey,
    pub client: Pubkey,
}

#[event]
pub struct LotteryPoolToggled {
    pub pool: Pubkey,
    pub paused: bool,
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

    // Lottery errors
    #[msg("House edge too high (max 10%)")]
    HouseEdgeTooHigh,
    #[msg("Reserve percentage too high")]
    ReserveTooHigh,
    #[msg("Max win percentage too high")]
    MaxWinTooHigh,
    #[msg("Lottery pool is paused")]
    PoolPaused,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invoice is too new for lottery (wait 5 minutes)")]
    InvoiceTooNew,
    #[msg("Invoice amount exceeds max win from pool")]
    InvoiceExceedsMaxWin,
    #[msg("Lottery entry already settled")]
    LotteryAlreadySettled,
}
