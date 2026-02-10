import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "invoicenow.db");

export const db = new Database(dbPath);

// Enable foreign key enforcement
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// Initialize tables immediately
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    creator_wallet TEXT NOT NULL,
    client_email TEXT,
    client_wallet TEXT,
    amount INTEGER NOT NULL CHECK(amount > 0),
    token_mint TEXT NOT NULL,
    due_date INTEGER NOT NULL,
    memo TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'escrow_funded')),
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    paid_at INTEGER,
    tx_signature TEXT,
    on_chain_address TEXT,
    payment_link TEXT,
    milestones TEXT,
    reminder_count INTEGER DEFAULT 0,
    last_reminder_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    wallet TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    business_name TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    owner_wallet TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    wallet TEXT,
    twitter_handle TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT NOT NULL,
    sent_at INTEGER DEFAULT (strftime('%s', 'now')),
    type TEXT,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_creator ON invoices(creator_wallet);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
  CREATE INDEX IF NOT EXISTS idx_invoices_client_email ON invoices(client_email);
  CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_wallet);

  CREATE TABLE IF NOT EXISTS lottery_pools (
    id TEXT PRIMARY KEY,
    token_mint TEXT NOT NULL UNIQUE,
    total_balance INTEGER DEFAULT 0,
    total_premiums_collected INTEGER DEFAULT 0,
    total_payouts INTEGER DEFAULT 0,
    total_entries INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    house_edge_bps INTEGER DEFAULT 500,
    min_pool_reserve_bps INTEGER DEFAULT 2000,
    max_win_pct_bps INTEGER DEFAULT 1000,
    paused INTEGER DEFAULT 0,
    on_chain_address TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS lottery_entries (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    client_wallet TEXT NOT NULL,
    invoice_amount INTEGER NOT NULL,
    premium_paid INTEGER NOT NULL,
    win_probability_bps INTEGER NOT NULL,
    status TEXT DEFAULT 'pending_vrf' CHECK(status IN ('pending_vrf', 'won', 'lost', 'refund_failed')),
    won INTEGER,
    random_result TEXT,
    tx_signature TEXT,
    refund_tx_signature TEXT,
    on_chain_address TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    resolved_at INTEGER,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );

  CREATE INDEX IF NOT EXISTS idx_lottery_entries_invoice ON lottery_entries(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_lottery_entries_client ON lottery_entries(client_wallet);
  CREATE INDEX IF NOT EXISTS idx_lottery_entries_status ON lottery_entries(status);
  CREATE INDEX IF NOT EXISTS idx_lottery_entries_resolved ON lottery_entries(resolved_at);
`);

// Migrations for existing databases - add columns that may be missing
const migrations = [
  { table: "lottery_entries", column: "tx_signature", sql: "ALTER TABLE lottery_entries ADD COLUMN tx_signature TEXT" },
  { table: "lottery_entries", column: "refund_tx_signature", sql: "ALTER TABLE lottery_entries ADD COLUMN refund_tx_signature TEXT" },
  { table: "invoices", column: "line_items", sql: "ALTER TABLE invoices ADD COLUMN line_items TEXT" },
];

for (const m of migrations) {
  const columns = db.pragma(`table_info(${m.table})`) as any[];
  if (!columns.some((c: any) => c.name === m.column)) {
    db.exec(m.sql);
    console.log(`Migration: added ${m.column} to ${m.table}`);
  }
}

// Reset negative pool balances (one-time fix for broken pool state)
db.exec(`UPDATE lottery_pools SET total_balance = 0 WHERE total_balance < 0`);

// Widen the CHECK constraint on lottery_entries.status for existing DBs
// SQLite doesn't support ALTER CHECK, but new rows will use the CREATE TABLE definition above.
// For existing DBs where the table was created with the old constraint, we need to handle
// refund_failed status at the application level if the constraint blocks it.

export function initDatabase() {
  console.log("Database initialized (tables created at import time)");
}

// Invoice queries
export const invoiceQueries = {
  create: db.prepare(`
    INSERT INTO invoices (id, creator_wallet, client_email, amount, token_mint, due_date, memo, milestones, payment_link, line_items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getById: db.prepare(`SELECT * FROM invoices WHERE id = ?`),

  getByCreator: db.prepare(`
    SELECT * FROM invoices WHERE creator_wallet = ? ORDER BY created_at DESC
  `),

  updateStatus: db.prepare(`
    UPDATE invoices SET status = ?, paid_at = ?, tx_signature = ? WHERE id = ?
  `),

  updateOnChainAddress: db.prepare(`
    UPDATE invoices SET on_chain_address = ? WHERE id = ?
  `),

  updateReminder: db.prepare(`
    UPDATE invoices SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?
  `),

  getPending: db.prepare(`
    SELECT * FROM invoices WHERE status = 'pending' ORDER BY due_date ASC
  `),

  getOverdue: db.prepare(`
    SELECT * FROM invoices WHERE status = 'pending' AND due_date < strftime('%s', 'now')
  `),
};

// User queries
export const userQueries = {
  upsert: db.prepare(`
    INSERT INTO users (wallet, name, email, business_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      business_name = excluded.business_name
  `),

  getByWallet: db.prepare(`SELECT * FROM users WHERE wallet = ?`),
};

// Client queries
export const clientQueries = {
  create: db.prepare(`
    INSERT INTO clients (id, owner_wallet, name, email, wallet, twitter_handle)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  getByOwner: db.prepare(`SELECT * FROM clients WHERE owner_wallet = ?`),

  getById: db.prepare(`SELECT * FROM clients WHERE id = ?`),

  getByEmail: db.prepare(`SELECT * FROM clients WHERE email = ?`),

  updateTwitterHandle: db.prepare(`
    UPDATE clients SET twitter_handle = ? WHERE email = ?
  `),
};

// Reminder queries
export const reminderQueries = {
  create: db.prepare(`
    INSERT INTO reminders (invoice_id, type) VALUES (?, ?)
  `),

  getByInvoice: db.prepare(`SELECT * FROM reminders WHERE invoice_id = ?`),
};

// Lottery pool queries
export const lotteryPoolQueries = {
  create: db.prepare(`
    INSERT INTO lottery_pools (id, token_mint, house_edge_bps, min_pool_reserve_bps, max_win_pct_bps, on_chain_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  getByTokenMint: db.prepare(`SELECT * FROM lottery_pools WHERE token_mint = ?`),

  getById: db.prepare(`SELECT * FROM lottery_pools WHERE id = ?`),

  // Atomic increment to avoid read-modify-write races
  addPremium: db.prepare(`
    UPDATE lottery_pools
    SET total_balance = total_balance + ?,
        total_premiums_collected = total_premiums_collected + ?,
        total_entries = total_entries + 1
    WHERE token_mint = ?
  `),

  // Atomic decrement for payouts
  addPayout: db.prepare(`
    UPDATE lottery_pools
    SET total_balance = total_balance - ?,
        total_payouts = total_payouts + ?,
        total_wins = total_wins + 1
    WHERE token_mint = ? AND total_balance >= ?
  `),

  getAll: db.prepare(`SELECT * FROM lottery_pools`),
};

// Lottery entry queries
export const lotteryEntryQueries = {
  create: db.prepare(`
    INSERT INTO lottery_entries (id, invoice_id, client_wallet, invoice_amount, premium_paid, win_probability_bps, on_chain_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  getById: db.prepare(`SELECT * FROM lottery_entries WHERE id = ?`),

  getByInvoice: db.prepare(`SELECT * FROM lottery_entries WHERE invoice_id = ?`),

  getPending: db.prepare(`SELECT * FROM lottery_entries WHERE status = 'pending_vrf'`),

  settle: db.prepare(`
    UPDATE lottery_entries
    SET status = ?, won = ?, random_result = ?, resolved_at = ?, tx_signature = ?
    WHERE id = ? AND status = 'pending_vrf'
  `),

  updateRefundTx: db.prepare(`
    UPDATE lottery_entries SET refund_tx_signature = ? WHERE id = ?
  `),

  updateStatus: db.prepare(`
    UPDATE lottery_entries SET status = ? WHERE id = ?
  `),

  getByClient: db.prepare(`
    SELECT * FROM lottery_entries WHERE client_wallet = ? ORDER BY created_at DESC
  `),

  getRecentWins: db.prepare(`
    SELECT le.*, i.memo, i.amount as total_invoice_amount
    FROM lottery_entries le
    JOIN invoices i ON le.invoice_id = i.id
    WHERE le.won = 1
    ORDER BY le.resolved_at DESC
    LIMIT 10
  `),
};
