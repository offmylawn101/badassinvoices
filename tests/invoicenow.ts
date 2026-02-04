import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Invoicenow } from "../target/types/invoicenow";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

describe("invoicenow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Invoicenow as Program<Invoicenow>;
  const creator = provider.wallet;

  const invoiceId = "INV-001";

  let invoicePda: PublicKey;
  let invoiceBump: number;

  before(async () => {
    [invoicePda, invoiceBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("invoice"),
        creator.publicKey.toBuffer(),
        Buffer.from(invoiceId),
      ],
      program.programId
    );
  });

  it("Creates an invoice", async () => {
    const amount = new anchor.BN(100_000_000); // 100 USDC (6 decimals)
    const dueDate = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 30); // 30 days
    const memo = "Website development - Phase 1";
    const tokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

    const tx = await program.methods
      .createInvoice(
        invoiceId,
        amount,
        tokenMint,
        dueDate,
        memo,
        [] // No milestones for simple invoice
      )
      .accounts({
        invoice: invoicePda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Create invoice tx:", tx);

    const invoice = await program.account.invoice.fetch(invoicePda);
    expect(invoice.creator.toString()).to.equal(creator.publicKey.toString());
    expect(invoice.invoiceId).to.equal(invoiceId);
    expect(invoice.amount.toNumber()).to.equal(100_000_000);
    expect(invoice.status).to.deep.equal({ pending: {} });
  });

  it("Creates an invoice with milestones", async () => {
    const milestoneInvoiceId = "INV-002";
    const [milestonePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("invoice"),
        creator.publicKey.toBuffer(),
        Buffer.from(milestoneInvoiceId),
      ],
      program.programId
    );

    const amount = new anchor.BN(500_000_000); // 500 USDC
    const dueDate = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 60);
    const memo = "Full website build with milestones";
    const tokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    const milestones = [
      {
        description: "Design mockups",
        amount: new anchor.BN(100_000_000),
        completed: false,
        completedAt: new anchor.BN(0),
      },
      {
        description: "Frontend development",
        amount: new anchor.BN(200_000_000),
        completed: false,
        completedAt: new anchor.BN(0),
      },
      {
        description: "Backend + deployment",
        amount: new anchor.BN(200_000_000),
        completed: false,
        completedAt: new anchor.BN(0),
      },
    ];

    const tx = await program.methods
      .createInvoice(
        milestoneInvoiceId,
        amount,
        tokenMint,
        dueDate,
        memo,
        milestones
      )
      .accounts({
        invoice: milestonePda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Create milestone invoice tx:", tx);

    const invoice = await program.account.invoice.fetch(milestonePda);
    expect(invoice.milestones.length).to.equal(3);
    expect(invoice.currentMilestone).to.equal(0);
  });

  it("Marks invoice as paid", async () => {
    const paidInvoiceId = "INV-003";
    const [paidPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("invoice"),
        creator.publicKey.toBuffer(),
        Buffer.from(paidInvoiceId),
      ],
      program.programId
    );

    const amount = new anchor.BN(50_000_000);
    const dueDate = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 7);
    const tokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    // Create invoice first
    await program.methods
      .createInvoice(paidInvoiceId, amount, tokenMint, dueDate, "Quick job", [])
      .accounts({
        invoice: paidPda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Mark as paid
    const txSig = "5abc123...fake_signature";
    const tx = await program.methods
      .markPaid(txSig)
      .accounts({
        invoice: paidPda,
        payer: creator.publicKey,
      })
      .rpc();

    console.log("Mark paid tx:", tx);

    const invoice = await program.account.invoice.fetch(paidPda);
    expect(invoice.status).to.deep.equal({ paid: {} });
    expect(invoice.paidAt.toNumber()).to.be.greaterThan(0);
  });

  it("Creates user profile", async () => {
    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), creator.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .createProfile("John Doe", "john@example.com", "Acme Inc")
      .accounts({
        profile: profilePda,
        owner: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Create profile tx:", tx);

    const profile = await program.account.userProfile.fetch(profilePda);
    expect(profile.name).to.equal("John Doe");
    expect(profile.email).to.equal("john@example.com");
    expect(profile.businessName).to.equal("Acme Inc");
  });

  it("Cancels an unpaid invoice", async () => {
    const cancelInvoiceId = "INV-004";
    const [cancelPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("invoice"),
        creator.publicKey.toBuffer(),
        Buffer.from(cancelInvoiceId),
      ],
      program.programId
    );

    const amount = new anchor.BN(25_000_000);
    const dueDate = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);
    const tokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    // Create invoice
    await program.methods
      .createInvoice(cancelInvoiceId, amount, tokenMint, dueDate, "Cancelled", [])
      .accounts({
        invoice: cancelPda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Cancel it
    const tx = await program.methods
      .cancelInvoice()
      .accounts({
        invoice: cancelPda,
        creator: creator.publicKey,
      })
      .rpc();

    console.log("Cancel invoice tx:", tx);

    const invoice = await program.account.invoice.fetch(cancelPda);
    expect(invoice.status).to.deep.equal({ cancelled: {} });
  });
});
