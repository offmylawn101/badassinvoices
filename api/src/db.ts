import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "invoicenow.db");

export const db = new Database(dbPath);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      creator_wallet TEXT NOT NULL,
      client_email TEXT,
      client_wallet TEXT,
      amount INTEGER NOT NULL,
      token_mint TEXT NOT NULL,
      due_date INTEGER NOT NULL,
      memo TEXT,
      status TEXT DEFAULT 'pending',
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
    CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_wallet);
  `);

  console.log("Database initialized");
}

// Invoice queries
export const invoiceQueries = {
  create: db.prepare(`
    INSERT INTO invoices (id, creator_wallet, client_email, amount, token_mint, due_date, memo, milestones, payment_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    INSERT INTO clients (id, owner_wallet, name, email, wallet)
    VALUES (?, ?, ?, ?, ?)
  `),

  getByOwner: db.prepare(`SELECT * FROM clients WHERE owner_wallet = ?`),

  getById: db.prepare(`SELECT * FROM clients WHERE id = ?`),
};

// Reminder queries
export const reminderQueries = {
  create: db.prepare(`
    INSERT INTO reminders (invoice_id, type) VALUES (?, ?)
  `),

  getByInvoice: db.prepare(`SELECT * FROM reminders WHERE invoice_id = ?`),
};
