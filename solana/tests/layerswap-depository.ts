import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LayerswapDepository } from "../target/types/layerswap_depository";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("layerswap-depository", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .LayerswapDepository as Program<LayerswapDepository>;
  const connection = provider.connection;

  const authority = Keypair.generate();
  const receiver = Keypair.generate();
  const stranger = Keypair.generate();
  const depositor = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [receiverWhitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), receiver.publicKey.toBuffer()],
    program.programId
  );
  const [strangerWhitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), stranger.publicKey.toBuffer()],
    program.programId
  );

  let mint: PublicKey;
  let depositorAta: PublicKey;
  let receiverAta: PublicKey;

  const ORDER_ID: number[] = Array.from(
    Buffer.concat([Buffer.from("test-order-id"), Buffer.alloc(32 - 13)])
  );

  before(async () => {
    // Fund test accounts
    for (const kp of [authority, depositor, receiver, stranger]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    }

    // Create SPL mint (6 decimals)
    mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create depositor ATA and mint 1000 tokens
    depositorAta = await createAssociatedTokenAccount(
      connection,
      depositor,
      mint,
      depositor.publicKey
    );
    await mintTo(
      connection,
      authority,
      mint,
      depositorAta,
      authority,
      1_000_000_000
    );

    // Create receiver ATA (authority pays so receiver doesn't need SOL)
    receiverAta = await createAssociatedTokenAccount(
      connection,
      authority,
      mint,
      receiver.publicKey
    );
  });

  // ── 1. Initialize ──────────────────────────────────────────────────────────

  it("initialize: creates Config PDA with correct authority", async () => {
    await program.methods
      .initialize(authority.publicKey)
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(
      config.authority.toString(),
      authority.publicKey.toString(),
      "authority mismatch"
    );
    assert.isNull(config.pendingAuthority, "pendingAuthority should be null");
    assert.isFalse(config.paused, "should not be paused");
  });

  // ── 2. Add receiver ────────────────────────────────────────────────────────

  it("add_receiver: creates WhitelistEntry PDA", async () => {
    await program.methods
      .addReceiver()
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        receiver: receiver.publicKey,
        whitelistEntry: receiverWhitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const entry = await program.account.whitelistEntry.fetch(
      receiverWhitelistPda
    );
    assert.equal(
      entry.receiver.toString(),
      receiver.publicKey.toString(),
      "receiver mismatch"
    );
  });

  // ── 3. Add receiver: duplicate ─────────────────────────────────────────────

  it("add_receiver: fails if already whitelisted", async () => {
    try {
      await program.methods
        .addReceiver()
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          receiver: receiver.publicKey,
          whitelistEntry: receiverWhitelistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(
        e.message,
        "already in use",
        "should fail with 'already in use'"
      );
    }
  });

  // ── 4. deposit_sol: success ────────────────────────────────────────────────

  it("deposit_sol: transfers SOL to whitelisted receiver", async () => {
    const amount = new anchor.BN(LAMPORTS_PER_SOL);
    const balBefore = await connection.getBalance(receiver.publicKey);

    await program.methods
      .depositSol(ORDER_ID, amount)
      .accounts({
        depositor: depositor.publicKey,
        config: configPda,
        whitelistEntry: receiverWhitelistPda,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const balAfter = await connection.getBalance(receiver.publicKey);
    assert.equal(
      balAfter - balBefore,
      LAMPORTS_PER_SOL,
      "receiver balance delta mismatch"
    );
  });

  // ── 5. deposit_sol: non-whitelisted ────────────────────────────────────────

  it("deposit_sol: fails for non-whitelisted receiver", async () => {
    try {
      await program.methods
        .depositSol(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accounts({
          depositor: depositor.publicKey,
          config: configPda,
          whitelistEntry: strangerWhitelistPda,
          receiver: stranger.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      // whitelistEntry PDA does not exist -> AccountNotInitialized
      assert.match(
        e.message,
        /account.*does not exist|AccountNotInitialized/i,
        "should fail with account-not-found error"
      );
    }
  });

  // ── 6. deposit_sol: zero amount ────────────────────────────────────────────

  it("deposit_sol: fails with zero amount", async () => {
    try {
      await program.methods
        .depositSol(ORDER_ID, new anchor.BN(0))
        .accounts({
          depositor: depositor.publicKey,
          config: configPda,
          whitelistEntry: receiverWhitelistPda,
          receiver: receiver.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "ZeroAmount");
    }
  });

  // ── 7. deposit_spl: success ────────────────────────────────────────────────

  it("deposit_spl: transfers SPL tokens to whitelisted receiver", async () => {
    const amount = new anchor.BN(1_000_000); // 1 token (6 decimals)
    const balBefore = (await getAccount(connection, receiverAta)).amount;

    await program.methods
      .depositSpl(ORDER_ID, amount)
      .accounts({
        depositor: depositor.publicKey,
        config: configPda,
        whitelistEntry: receiverWhitelistPda,
        mint,
        depositorAta,
        receiverAta,
        receiver: receiver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const balAfter = (await getAccount(connection, receiverAta)).amount;
    assert.equal(
      (balAfter - balBefore).toString(),
      "1000000",
      "token balance delta mismatch"
    );
  });

  // ── 8. Pause ───────────────────────────────────────────────────────────────

  it("pause: prevents deposits", async () => {
    await program.methods
      .pause()
      .accounts({ config: configPda, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.isTrue(config.paused, "should be paused");

    try {
      await program.methods
        .depositSol(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accounts({
          depositor: depositor.publicKey,
          config: configPda,
          whitelistEntry: receiverWhitelistPda,
          receiver: receiver.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Paused");
    }
  });

  // ── 9. Unpause ─────────────────────────────────────────────────────────────

  it("unpause: allows deposits again", async () => {
    await program.methods
      .unpause()
      .accounts({ config: configPda, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.isFalse(config.paused, "should not be paused");

    const balBefore = await connection.getBalance(receiver.publicKey);
    await program.methods
      .depositSol(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
      .accounts({
        depositor: depositor.publicKey,
        config: configPda,
        whitelistEntry: receiverWhitelistPda,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const balAfter = await connection.getBalance(receiver.publicKey);
    assert.isAbove(balAfter, balBefore, "deposit should succeed after unpause");
  });

  // ── 10. Remove receiver ────────────────────────────────────────────────────

  it("remove_receiver: closes PDA and blocks deposits", async () => {
    // Whitelist stranger first
    await program.methods
      .addReceiver()
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        receiver: stranger.publicKey,
        whitelistEntry: strangerWhitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Remove stranger
    await program.methods
      .removeReceiver()
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        receiver: stranger.publicKey,
        whitelistEntry: strangerWhitelistPda,
      })
      .signers([authority])
      .rpc();

    assert.isNull(
      await connection.getAccountInfo(strangerWhitelistPda),
      "PDA should be closed"
    );

    // Deposit to removed receiver should now fail
    try {
      await program.methods
        .depositSol(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accounts({
          depositor: depositor.publicKey,
          config: configPda,
          whitelistEntry: strangerWhitelistPda,
          receiver: stranger.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.match(e.message, /account.*does not exist|AccountNotInitialized/i);
    }
  });

  // ── 11. Update receiver ────────────────────────────────────────────────────

  it("update_receiver: atomically replaces old with new", async () => {
    const newReceiver = Keypair.generate();
    const [newWhitelistPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), newReceiver.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .updateReceiver()
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        oldReceiver: receiver.publicKey,
        newReceiver: newReceiver.publicKey,
        oldEntry: receiverWhitelistPda,
        newEntry: newWhitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    assert.isNull(
      await connection.getAccountInfo(receiverWhitelistPda),
      "old PDA should be closed"
    );

    const entry = await program.account.whitelistEntry.fetch(newWhitelistPda);
    assert.equal(
      entry.receiver.toString(),
      newReceiver.publicKey.toString(),
      "new entry receiver mismatch"
    );
  });

  // ── 12. Update receiver: same address ─────────────────────────────────────

  it("update_receiver: fails if same address", async () => {
    // Re-add receiver so we can try to update it to itself
    await program.methods
      .addReceiver()
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        receiver: receiver.publicKey,
        whitelistEntry: receiverWhitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .updateReceiver()
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          oldReceiver: receiver.publicKey,
          newReceiver: receiver.publicKey,
          oldEntry: receiverWhitelistPda,
          newEntry: receiverWhitelistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "SameReceiver");
    }
  });

  // ── 13. Two-step authority transfer ───────────────────────────────────────

  it("transfer_authority + accept_authority: completes two-step transfer", async () => {
    const newAuth = Keypair.generate();
    const sig = await connection.requestAirdrop(
      newAuth.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    // Step 1: nominate
    await program.methods
      .transferAuthority(newAuth.publicKey)
      .accounts({ config: configPda, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    let config = await program.account.config.fetch(configPda);
    assert.equal(
      config.pendingAuthority?.toString(),
      newAuth.publicKey.toString(),
      "pending authority mismatch"
    );

    // Step 2: accept
    await program.methods
      .acceptAuthority()
      .accounts({ config: configPda, pendingAuthority: newAuth.publicKey })
      .signers([newAuth])
      .rpc();

    config = await program.account.config.fetch(configPda);
    assert.equal(
      config.authority.toString(),
      newAuth.publicKey.toString(),
      "authority should have changed"
    );
    assert.isNull(config.pendingAuthority, "pending should be cleared");

    // Transfer back to original authority for any remaining tests
    await program.methods
      .transferAuthority(authority.publicKey)
      .accounts({ config: configPda, authority: newAuth.publicKey })
      .signers([newAuth])
      .rpc();
    await program.methods
      .acceptAuthority()
      .accounts({ config: configPda, pendingAuthority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ── 14. Accept authority: no pending ──────────────────────────────────────

  it("accept_authority: fails with no pending transfer", async () => {
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          config: configPda,
          pendingAuthority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "NoPendingAuthority");
    }
  });

  // ── 15. Unauthorized access ────────────────────────────────────────────────

  it("unauthorized: non-authority cannot call admin instructions", async () => {
    const nobody = Keypair.generate();
    const sig = await connection.requestAirdrop(
      nobody.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    const newReceiver = Keypair.generate();
    const [newWhitelistPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), newReceiver.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .addReceiver()
        .accounts({
          config: configPda,
          authority: nobody.publicKey,
          receiver: newReceiver.publicKey,
          whitelistEntry: newWhitelistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });
});
