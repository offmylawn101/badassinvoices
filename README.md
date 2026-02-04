# InvoiceNow - Instant Invoicing on Solana

**Colosseum Agent Hackathon Submission**

InvoiceNow is an invoicing platform for freelancers that enables instant payment in USDC/SOL via Solana. An AI agent monitors invoices, sends payment reminders, and handles escrow for milestone-based work.

## Why InvoiceNow?

- **Instant Settlement**: Get paid in seconds, not 3-5 business days
- **Near-Zero Fees**: Sub-cent transaction costs vs $25-50 wire fees
- **AI-Powered Reminders**: Never chase payments manually again
- **Milestone Escrow**: Protect both parties with built-in escrow
- **Open Source**: Full transparency and customization

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   INVOICENOW                         │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Frontend  │  │   Backend   │  │   Agent     │ │
│  │   (Next.js) │  │   (Express) │  │  (Claude)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         └────────────────┼────────────────┘         │
│                          │                          │
│                 ┌────────┴────────┐                 │
│                 │  Solana Program │                 │
│                 │    (Anchor)     │                 │
│                 └────────┬────────┘                 │
│         ┌────────────────┼────────────────┐        │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐│
│  │  Invoice    │  │   Escrow    │  │  Payment    ││
│  │  Registry   │  │   PDAs      │  │  Tracking   ││
│  └─────────────┘  └─────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Rust & Cargo
- Solana CLI
- Anchor CLI

### 1. Install Dependencies

```bash
# Root dependencies
npm install

# API
cd api && npm install

# Frontend
cd ../app && npm install

# Agent
cd ../agent && npm install
```

### 2. Configure Environment

```bash
# API
cp api/.env.example api/.env

# Agent
cp agent/.env.example agent/.env
```

Edit the `.env` files with your configuration.

### 3. Build Solana Program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### 4. Run Services

```bash
# Terminal 1: API
cd api && npm run dev

# Terminal 2: Frontend
cd app && npm run dev

# Terminal 3: Agent (optional)
cd agent && npm run dev
```

Visit `http://localhost:3000` to use the app.

## Project Structure

```
invoicenow/
├── programs/invoicenow/    # Solana/Anchor program
│   └── src/lib.rs          # Smart contract
├── api/                    # Backend API
│   └── src/
│       ├── index.ts        # Express server
│       ├── db.ts           # SQLite database
│       └── routes/         # API endpoints
│           ├── invoices.ts # Invoice CRUD
│           ├── pay.ts      # Payment page
│           └── webhooks.ts # Helius webhook
├── app/                    # Next.js frontend
│   └── pages/
│       ├── index.tsx       # Dashboard
│       ├── create.tsx      # Create invoice
│       └── pay/[id].tsx    # Payment page
├── agent/                  # AI Agent
│   └── src/
│       ├── index.ts        # Agent logic
│       ├── email.ts        # Email service
│       └── cron.ts         # Scheduled tasks
└── tests/                  # Anchor tests
```

## Features

### For Freelancers

- **Create Invoices**: Professional templates with line items
- **Payment Links**: Shareable links + QR codes
- **Instant Payment**: USDC or SOL, directly to your wallet
- **AI Reminders**: Automatic payment follow-ups
- **Dashboard**: Track all invoices in one place

### For Clients

- **Easy Payment**: Connect wallet, click pay
- **Multiple Tokens**: Pay in USDC or SOL
- **Transparent**: See exact amounts and fees
- **Secure**: Funds go directly to freelancer

### Milestone Escrow

For larger projects:
1. Split invoice into milestones
2. Client funds full escrow upfront
3. Funds release as milestones complete
4. Both parties protected

## Solana Program

### Instructions

| Instruction | Description |
|------------|-------------|
| `create_invoice` | Create new invoice PDA |
| `fund_escrow` | Client deposits for milestone work |
| `release_milestone` | Release funds for completed milestone |
| `mark_paid` | Record direct payment |
| `cancel_invoice` | Cancel unpaid invoice |
| `create_profile` | Create user profile |

### PDAs

- **Invoice**: `[b"invoice", creator, invoice_id]`
- **Escrow**: `[b"escrow", invoice_id]`
- **Profile**: `[b"profile", wallet]`

## AI Agent

The agent uses Claude to intelligently manage invoices:

- **Monitors** all pending invoices
- **Sends reminders** based on urgency:
  - 3 days before due: Gentle reminder
  - On due date: Firm reminder
  - Overdue: Urgent reminder
- **Tracks** on-chain payment status
- **Reports** weekly summaries

### Running the Agent

```bash
# One-time run
cd agent && npm run dev

# As cron service
cd agent && npm run cron
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/invoices` | Create invoice |
| GET | `/api/invoices` | List invoices |
| GET | `/api/invoices/:id` | Get invoice |
| POST | `/api/invoices/:id/remind` | Send reminder |
| GET | `/pay/:id` | Payment page data |
| POST | `/api/webhooks/helius` | Payment tracking |

## Testing

```bash
# Anchor tests
anchor test

# Or with specific cluster
anchor test --provider.cluster devnet
```

## Deployment

### Solana Program

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

### Backend

Deploy API to your preferred platform (Vercel, Railway, etc.)

### Frontend

```bash
cd app && npm run build
```

Deploy to Vercel or similar.

## Environment Variables

### API (.env)

```
SOLANA_RPC=https://api.devnet.solana.com
PORT=3001
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email
SMTP_PASS=your-password
HELIUS_API_KEY=your-key
```

### Agent (.env)

```
ANTHROPIC_API_KEY=your-key
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email
SMTP_PASS=your-password
```

## Contributing

Pull requests welcome! Please read the contributing guidelines first.

## License

MIT

---

Built for the Colosseum Agent Hackathon
