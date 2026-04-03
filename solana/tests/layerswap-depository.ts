import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LayerswapDepository } from "../target/types/layerswap_depository";
import { TestTransferHook } from "../target/types/test_transfer_hook";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

const SPL_MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

describe("layerswap-depository", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .LayerswapDepository as Program<LayerswapDepository>;
  const hookProgram = anchor.workspace
    .TestTransferHook as Program<TestTransferHook>;
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

  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  );

  let mint: PublicKey;
  let depositorAta: PublicKey;
  let receiverAta: PublicKey;

  let mint2022: PublicKey;
  let depositorAta2022: PublicKey;
  let receiverAta2022: PublicKey;

  let mintFee: Keypair;           // Token-2022 with transfer fee
  let depositorAtaFee: PublicKey;
  let receiverAtaFee: PublicKey;
  const FEE_BASIS_POINTS = 500;   // 5%
  const MAX_FEE = BigInt(5_000_000_000); // cap at 50 tokens (8 decimals)

  let mintHook: Keypair;           // Token-2022 with transfer hook
  let depositorAtaHook: PublicKey;
  let receiverAtaHook: PublicKey;

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

    // Create Token-2022 mint (8 decimals)
    mint2022 = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      8,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create depositor ATA for Token-2022 and mint tokens
    depositorAta2022 = await createAssociatedTokenAccount(
      connection,
      depositor,
      mint2022,
      depositor.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      mint2022,
      depositorAta2022,
      authority,
      1_000_000_000,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create receiver ATA for Token-2022
    receiverAta2022 = await createAssociatedTokenAccount(
      connection,
      authority,
      mint2022,
      receiver.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create Token-2022 mint with TransferFee extension (5% fee, 8 decimals)
    mintFee = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const createMintFeeTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintFee.publicKey,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintFee.publicKey,
        authority.publicKey,  // fee config authority
        authority.publicKey,  // withdraw withheld authority
        FEE_BASIS_POINTS,
        MAX_FEE,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintFee.publicKey,
        8,                    // decimals
        authority.publicKey,  // mint authority
        null,                 // freeze authority
        TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createMintFeeTx, [authority, mintFee]);

    // Create depositor ATA for fee-mint and mint tokens
    depositorAtaFee = await createAssociatedTokenAccount(
      connection,
      depositor,
      mintFee.publicKey,
      depositor.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      mintFee.publicKey,
      depositorAtaFee,
      authority,
      1_000_000_000,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create receiver ATA for fee-mint
    receiverAtaFee = await createAssociatedTokenAccount(
      connection,
      authority,
      mintFee.publicKey,
      receiver.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create Token-2022 mint with TransferHook extension (6 decimals)
    mintHook = Keypair.generate();
    const hookMintLen = getMintLen([ExtensionType.TransferHook]);
    const hookMintLamports = await connection.getMinimumBalanceForRentExemption(hookMintLen);

    const createMintHookTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintHook.publicKey,
        space: hookMintLen,
        lamports: hookMintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mintHook.publicKey,
        authority.publicKey,
        hookProgram.programId,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintHook.publicKey,
        6,
        authority.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createMintHookTx, [authority, mintHook]);

    // Initialize the ExtraAccountMetaList PDA for the hook
    // (Anchor auto-derives extraAccountMetaList from the mint seed)
    await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: authority.publicKey,
        mint: mintHook.publicKey,
      })
      .signers([authority])
      .rpc();

    // Create depositor ATA for hook-mint and mint tokens
    depositorAtaHook = await createAssociatedTokenAccount(
      connection,
      depositor,
      mintHook.publicKey,
      depositor.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      mintHook.publicKey,
      depositorAtaHook,
      authority,
      1_000_000_000,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create receiver ATA for hook-mint
    receiverAtaHook = await createAssociatedTokenAccount(
      connection,
      authority,
      mintHook.publicKey,
      receiver.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  // ── 1. Initialize ──────────────────────────────────────────────────────────

  it("initialize: creates Config PDA with correct authority", async () => {
    await program.methods
      .initialize(authority.publicKey)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        program: program.programId,
        programData: programDataPda,
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
        authority: authority.publicKey,
        receiver: receiver.publicKey,
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
          authority: authority.publicKey,
          receiver: receiver.publicKey,
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

  // ── 4. deposit_native: success ────────────────────────────────────────────────

  it("deposit_native: transfers SOL to whitelisted receiver", async () => {
    const amount = new anchor.BN(LAMPORTS_PER_SOL);
    const balBefore = await connection.getBalance(receiver.publicKey);

    await program.methods
      .depositNative(ORDER_ID, amount)
      .accountsPartial({
        depositor: depositor.publicKey,
        receiver: receiver.publicKey,
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

  // ── 5. deposit_native: non-whitelisted ────────────────────────────────────────

  it("deposit_native: fails for non-whitelisted receiver", async () => {
    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: stranger.publicKey,
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

  // ── 6. deposit_native: zero amount ────────────────────────────────────────────

  it("deposit_native: fails with zero amount", async () => {
    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(0))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: receiver.publicKey,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "ZeroAmount");
    }
  });

  // ── 7. deposit_token: success ────────────────────────────────────────────────

  it("deposit_token: transfers legacy SPL tokens to whitelisted receiver", async () => {
    const amount = new anchor.BN(1_000_000); // 1 token (6 decimals)
    const balBefore = (await getAccount(connection, receiverAta)).amount;

    await program.methods
      .depositToken(ORDER_ID, amount)
      .accountsPartial({
        depositor: depositor.publicKey,
        mint,
        receiver: receiver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        memoProgram: SPL_MEMO_PROGRAM_ID,
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

  // ── 8. deposit_token: Token-2022 ──────────────────────────────────────────

  it("deposit_token: transfers Token-2022 tokens to whitelisted receiver", async () => {
    const amount = new anchor.BN(100_000_000); // 1 token (8 decimals)
    const balBefore = (await getAccount(connection, receiverAta2022, undefined, TOKEN_2022_PROGRAM_ID)).amount;

    await program.methods
      .depositToken(ORDER_ID, amount)
      .accountsPartial({
        depositor: depositor.publicKey,
        mint: mint2022,
        receiver: receiver.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        memoProgram: SPL_MEMO_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    const balAfter = (await getAccount(connection, receiverAta2022, undefined, TOKEN_2022_PROGRAM_ID)).amount;
    assert.equal(
      (balAfter - balBefore).toString(),
      "100000000",
      "Token-2022 balance delta mismatch"
    );
  });

  // ── 9. deposit_token: Token-2022 with transfer fee ────────────────────────

  it("deposit_token: Token-2022 transfer-fee token — received < requested", async () => {
    const amount = new anchor.BN(100_000_000); // 1 token (8 decimals)
    const balBefore = (await getAccount(connection, receiverAtaFee, undefined, TOKEN_2022_PROGRAM_ID)).amount;

    await program.methods
      .depositToken(ORDER_ID, amount)
      .accountsPartial({
        depositor: depositor.publicKey,
        mint: mintFee.publicKey,
        receiver: receiver.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        memoProgram: SPL_MEMO_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    const balAfter = (await getAccount(connection, receiverAtaFee, undefined, TOKEN_2022_PROGRAM_ID)).amount;
    const received = balAfter - balBefore;

    // 5% fee: sent 100_000_000, fee = 5_000_000, received = 95_000_000
    const expectedFee = BigInt(Math.floor(100_000_000 * FEE_BASIS_POINTS / 10_000));
    const expectedReceived = BigInt(100_000_000) - expectedFee;

    assert.equal(
      received.toString(),
      expectedReceived.toString(),
      "received amount should reflect 5% transfer fee deduction"
    );
    assert.isTrue(
      received < BigInt(100_000_000),
      "received must be less than requested amount for fee-on-transfer"
    );
  });

  // ── 10. deposit_token: Token-2022 with transfer hook ─────────────────────

  it("deposit_token: Token-2022 transfer-hook token succeeds with extra accounts", async () => {
    const amount = new anchor.BN(1_000_000); // 1 token (6 decimals)
    const balBefore = (await getAccount(connection, receiverAtaHook, undefined, TOKEN_2022_PROGRAM_ID)).amount;

    // Use the spl-token helper to build a full transfer instruction with
    // all the extra accounts the transfer hook needs resolved automatically.
    const { createTransferCheckedWithTransferHookInstruction } = await import("@solana/spl-token");
    const resolvedIx = await createTransferCheckedWithTransferHookInstruction(
      connection,
      depositorAtaHook,
      mintHook.publicKey,
      receiverAtaHook,
      depositor.publicKey,
      BigInt(1_000_000),
      6,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    // Extract remaining accounts from the resolved instruction.
    // The first 4 keys are [source, mint, destination, authority] — already in
    // our DepositToken accounts struct. Everything after is hook-related.
    const extraAccounts = resolvedIx.keys.slice(4).map((meta) => ({
      pubkey: meta.pubkey,
      isSigner: false,
      isWritable: meta.isWritable,
    }));

    await program.methods
      .depositToken(ORDER_ID, amount)
      .accountsPartial({
        depositor: depositor.publicKey,
        mint: mintHook.publicKey,
        receiver: receiver.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        memoProgram: SPL_MEMO_PROGRAM_ID,
      })
      .remainingAccounts(extraAccounts)
      .signers([depositor])
      .rpc();

    const balAfter = (await getAccount(connection, receiverAtaHook, undefined, TOKEN_2022_PROGRAM_ID)).amount;
    assert.equal(
      (balAfter - balBefore).toString(),
      "1000000",
      "transfer hook token balance delta mismatch"
    );
  });

  // ── 11. Pause ──────────────────────────────────────────────────────────────

  it("pause: prevents deposits", async () => {
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.isTrue(config.paused, "should be paused");

    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: receiver.publicKey,
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
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.isFalse(config.paused, "should not be paused");

    const balBefore = await connection.getBalance(receiver.publicKey);
    await program.methods
      .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
      .accountsPartial({
        depositor: depositor.publicKey,
        receiver: receiver.publicKey,
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
        authority: authority.publicKey,
        receiver: stranger.publicKey,
      })
      .signers([authority])
      .rpc();

    // Remove stranger
    await program.methods
      .removeReceiver()
      .accountsPartial({
        authority: authority.publicKey,
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
        .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: stranger.publicKey,
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
        authority: authority.publicKey,
        oldReceiver: receiver.publicKey,
        newReceiver: newReceiver.publicKey,
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
        authority: authority.publicKey,
        receiver: receiver.publicKey,
      })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .updateReceiver()
        .accounts({
          authority: authority.publicKey,
          oldReceiver: receiver.publicKey,
          newReceiver: receiver.publicKey,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      // In Anchor 0.32, passing the same PDA for both old_entry (close) and
      // new_entry (init) triggers a duplicate account / constraint error before
      // the SameReceiver check is reached.
      assert.ok(
        e.message.includes("SameReceiver") ||
        e.message.includes("already in use") ||
        e.message.includes("Simulation failed"),
        `Expected SameReceiver or duplicate account error, got: ${e.message}`
      );
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
      .accounts({ authority: authority.publicKey })
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
      .accounts({ pendingAuthority: newAuth.publicKey })
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
      .accounts({ authority: newAuth.publicKey })
      .signers([newAuth])
      .rpc();
    await program.methods
      .acceptAuthority()
      .accounts({ pendingAuthority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ── 14. Accept authority: no pending ──────────────────────────────────────

  it("accept_authority: fails with no pending transfer", async () => {
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
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

    try {
      await program.methods
        .addReceiver()
        .accounts({
          authority: nobody.publicKey,
          receiver: newReceiver.publicKey,
        })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Additional coverage — error paths
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 16. initialize: cannot reinitialize ─────────────────────────────────────

  it("initialize: fails on second call (Config PDA already exists)", async () => {
    try {
      await program.methods
        .initialize(authority.publicKey)
        .accountsPartial({
          payer: provider.wallet.publicKey,
          program: program.programId,
          programData: programDataPda,
        })
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      // Anchor's init constraint rejects because PDA is already initialized
      assert.match(
        e.message,
        /already in use|custom program error/i,
        "should fail with already-in-use error"
      );
    }
  });

  // ── 17. deposit_token: zero amount ──────────────────────────────────────────

  it("deposit_token: fails with zero amount (SPL Token)", async () => {
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(0))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,
          receiver: receiver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "ZeroAmount");
    }
  });

  // ── 18. deposit_token: non-whitelisted receiver ─────────────────────────────

  it("deposit_token: fails for non-whitelisted receiver", async () => {
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(1_000_000))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,
          receiver: stranger.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.match(
        e.message,
        /account.*does not exist|AccountNotInitialized/i,
        "should fail with account-not-found error"
      );
    }
  });

  // ── 19. deposit_token: when paused ──────────────────────────────────────────

  it("deposit_token: fails when program is paused", async () => {
    // Pause
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(1_000_000))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,
          receiver: receiver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Paused");
    }

    // Unpause for subsequent tests
    await program.methods
      .unpause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ── 20. deposit_token: zero amount with Token-2022 ──────────────────────────

  it("deposit_token: fails with zero amount (Token-2022)", async () => {
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(0))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint: mint2022,
          receiver: receiver.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "ZeroAmount");
    }
  });

  // ── 21. pause: fails if already paused ──────────────────────────────────────

  it("pause: fails if already paused (AlreadyPaused)", async () => {
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .pause()
        .accounts({ authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "AlreadyPaused");
    }

    // Unpause for subsequent tests
    await program.methods
      .unpause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ── 22. unpause: fails if not paused ────────────────────────────────────────

  it("unpause: fails if not paused (NotPaused)", async () => {
    try {
      await program.methods
        .unpause()
        .accounts({ authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "NotPaused");
    }
  });

  // ── 23. add_receiver: rejects zero address ──────────────────────────────────

  it("add_receiver: fails with zero address", async () => {
    try {
      await program.methods
        .addReceiver()
        .accounts({
          authority: authority.publicKey,
          receiver: PublicKey.default,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidReceiver");
    }
  });

  // ── 24. add_receiver: rejects program ID ────────────────────────────────────

  it("add_receiver: fails with program ID as receiver", async () => {
    try {
      await program.methods
        .addReceiver()
        .accounts({
          authority: authority.publicKey,
          receiver: program.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidReceiver");
    }
  });

  // ── 25. transfer_authority: rejects zero address ────────────────────────────

  it("transfer_authority: fails with zero address", async () => {
    try {
      await program.methods
        .transferAuthority(PublicKey.default)
        .accounts({ authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidAuthority");
    }
  });

  // ── 26. transfer_authority: rejects program ID ──────────────────────────────

  it("transfer_authority: fails with program ID as new authority", async () => {
    try {
      await program.methods
        .transferAuthority(program.programId)
        .accounts({ authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidAuthority");
    }
  });

  // ── 27. unauthorized: pause ─────────────────────────────────────────────────

  it("unauthorized: non-authority cannot pause", async () => {
    const nobody = Keypair.generate();
    const sig = await connection.requestAirdrop(
      nobody.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .pause()
        .accounts({ authority: nobody.publicKey })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ── 28. unauthorized: unpause ───────────────────────────────────────────────

  it("unauthorized: non-authority cannot unpause", async () => {
    const nobody = Keypair.generate();
    const sig = await connection.requestAirdrop(
      nobody.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .unpause()
        .accounts({ authority: nobody.publicKey })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ── 29. unauthorized: remove_receiver ───────────────────────────────────────

  it("unauthorized: non-authority cannot remove receiver", async () => {
    const nobody = Keypair.generate();
    const sig = await connection.requestAirdrop(
      nobody.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .removeReceiver()
        .accountsPartial({
          authority: nobody.publicKey,
          whitelistEntry: receiverWhitelistPda,
        })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ── 30. unauthorized: transfer_authority ────────────────────────────────────

  it("unauthorized: non-authority cannot transfer authority", async () => {
    const nobody = Keypair.generate();
    const sig = await connection.requestAirdrop(
      nobody.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .transferAuthority(nobody.publicKey)
        .accounts({ authority: nobody.publicKey })
        .signers([nobody])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ── 31. accept_authority: wrong signer ──────────────────────────────────────

  it("accept_authority: fails if wrong signer (not pending authority)", async () => {
    const intendedAuth = Keypair.generate();
    const wrongSigner = Keypair.generate();
    for (const kp of [intendedAuth, wrongSigner]) {
      const sig = await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }

    // Nominate intendedAuth
    await program.methods
      .transferAuthority(intendedAuth.publicKey)
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    // Wrong signer tries to accept
    try {
      await program.methods
        .acceptAuthority()
        .accounts({ pendingAuthority: wrongSigner.publicKey })
        .signers([wrongSigner])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }

    // Clean up: cancel by re-nominating then accepting with original
    await program.methods
      .transferAuthority(authority.publicKey)
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
    await program.methods
      .acceptAuthority()
      .accounts({ pendingAuthority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ── 32. deposit_native: when paused ─────────────────────────────────────────

  it("deposit_native: fails when program is paused", async () => {
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: receiver.publicKey,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Paused");
    }

    // Unpause
    await program.methods
      .unpause()
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Attack vector tests
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 33. Transfer-hook token without remaining accounts (hook enforcement) ──

  it("deposit_token: transfer-hook token FAILS without remaining accounts", async () => {
    // Attacker omits the hook accounts hoping to bypass the hook.
    // Token-2022 must reject the transfer because the hook program
    // expects its validation PDA and extra accounts.
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(1_000_000))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint: mintHook.publicKey,
          receiver: receiver.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        // Deliberately NOT passing .remainingAccounts(...)
        .signers([depositor])
        .rpc();
      assert.fail("Expected error — hook accounts are missing");
    } catch (e: any) {
      // Token-2022 rejects with insufficient accounts for the transfer hook
      assert.ok(
        e.message.includes("Simulation failed") ||
        e.message.includes("insufficient") ||
        e.message.includes("missing") ||
        e.message.includes("custom program error"),
        `Expected transfer hook failure, got: ${e.message}`
      );
    }
  });

  // ── 34. update_receiver: unauthorized caller ────────────────────────────────

  it("update_receiver: non-authority cannot swap receivers", async () => {
    const attacker = Keypair.generate();
    const attackerReceiver = Keypair.generate();
    const sig = await connection.requestAirdrop(
      attacker.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    // Attacker tries to swap a whitelisted receiver with their own address
    try {
      await program.methods
        .updateReceiver()
        .accounts({
          authority: attacker.publicKey,
          oldReceiver: receiver.publicKey,
          newReceiver: attackerReceiver.publicKey,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ── 35. update_receiver: new receiver is zero address ───────────────────────

  it("update_receiver: fails if new receiver is zero address", async () => {
    try {
      await program.methods
        .updateReceiver()
        .accounts({
          authority: authority.publicKey,
          oldReceiver: receiver.publicKey,
          newReceiver: PublicKey.default,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidReceiver");
    }
  });

  // ── 36. update_receiver: new receiver is program ID ─────────────────────────

  it("update_receiver: fails if new receiver is program ID", async () => {
    try {
      await program.methods
        .updateReceiver()
        .accounts({
          authority: authority.publicKey,
          oldReceiver: receiver.publicKey,
          newReceiver: program.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.include(e.message, "InvalidReceiver");
    }
  });

  // ── 37. deposit_token: insufficient token balance ───────────────────────────

  it("deposit_token: fails if depositor has insufficient token balance", async () => {
    // Depositor has ~998M base units left. Try to transfer way more.
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN("999999999999999"))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,
          receiver: receiver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      // Token program rejects: insufficient funds
      assert.ok(
        e.message.includes("insufficient") ||
        e.message.includes("Simulation failed") ||
        e.message.includes("custom program error") ||
        e.message.includes("Error processing Instruction"),
        `Expected insufficient funds error, got: ${e.message}`
      );
    }
  });

  // ── 38. deposit_native: insufficient SOL ────────────────────────────────────

  it("deposit_native: fails if depositor has insufficient SOL", async () => {
    // Try to transfer 1000 SOL — depositor has ~8 SOL left
    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(1000 * LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: receiver.publicKey,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.ok(
        e.message.includes("insufficient") ||
        e.message.includes("Simulation failed") ||
        e.message.includes("custom program error"),
        `Expected insufficient SOL error, got: ${e.message}`
      );
    }
  });

  // ── 39. deposit_token: wrong token_program for mint ─────────────────────────

  it("deposit_token: fails if token_program does not match mint", async () => {
    // Pass Token-2022 program for a legacy SPL Token mint
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(1_000_000))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,                              // legacy SPL Token mint
          tokenProgram: TOKEN_2022_PROGRAM_ID, // wrong program!
          receiver: receiver.publicKey,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      assert.ok(
        e.message.includes("Simulation failed") ||
        e.message.includes("AnchorError") ||
        e.message.includes("ConstraintTokenOwner") ||
        e.message.includes("ConstraintMintTokenProgram") ||
        e.message.includes("Error processing Instruction"),
        `Expected token program mismatch error, got: ${e.message}`
      );
    }
  });

  // ── 40. remove_receiver: double remove (already closed) ─────────────────────

  it("remove_receiver: fails on already-removed receiver (double remove)", async () => {
    // Whitelist and then remove stranger
    await program.methods
      .addReceiver()
      .accounts({
        authority: authority.publicKey,
        receiver: stranger.publicKey,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .removeReceiver()
      .accountsPartial({
        authority: authority.publicKey,
        whitelistEntry: strangerWhitelistPda,
      })
      .signers([authority])
      .rpc();

    // Try to remove again — PDA is already closed
    try {
      await program.methods
        .removeReceiver()
        .accountsPartial({
          authority: authority.publicKey,
          whitelistEntry: strangerWhitelistPda,
        })
        .signers([authority])
        .rpc();
      assert.fail("Expected error");
    } catch (e: any) {
      // PDA is closed — Anchor fails during account resolution or deserialization
      assert.ok(
        e.message.includes("does not exist") ||
        e.message.includes("AccountNotInitialized") ||
        e.message.includes("maximum depth") ||
        e.message.includes("Simulation failed"),
        `Expected closed-account error, got: ${e.message}`
      );
    }
  });

  // ── 41. Account substitution: whitelisted entry + different receiver ────────

  it("deposit_native: fails when whitelistEntry and receiver don't match", async () => {
    // Attacker passes receiver's valid whitelistEntry PDA but tries to
    // redirect funds to stranger (a non-whitelisted address).
    // The PDA seeds include receiver.key(), so Anchor's seed verification
    // will reject because seeds = [b"whitelist", stranger.key()] != receiverWhitelistPda.
    try {
      await program.methods
        .depositNative(ORDER_ID, new anchor.BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          depositor: depositor.publicKey,
          receiver: stranger.publicKey,          // attacker's address
          whitelistEntry: receiverWhitelistPda,   // valid PDA but for a different receiver
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error — receiver/whitelistEntry mismatch");
    } catch (e: any) {
      // Fails because PDA seeds [b"whitelist", stranger.key()] don't derive
      // to receiverWhitelistPda, OR has_one = receiver check fails.
      assert.ok(
        e.message.includes("ConstraintSeeds") ||
        e.message.includes("NotWhitelisted") ||
        e.message.includes("A seeds constraint was violated") ||
        e.message.includes("Simulation failed"),
        `Expected seed/has_one mismatch, got: ${e.message}`
      );
    }
  });

  it("deposit_token: fails when whitelistEntry and receiver don't match", async () => {
    // Same attack but for token deposits.
    try {
      await program.methods
        .depositToken(ORDER_ID, new anchor.BN(1_000_000))
        .accountsPartial({
          depositor: depositor.publicKey,
          mint,
          receiver: stranger.publicKey,           // attacker's address
          whitelistEntry: receiverWhitelistPda,    // valid PDA but for a different receiver
          tokenProgram: TOKEN_PROGRAM_ID,
          memoProgram: SPL_MEMO_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Expected error — receiver/whitelistEntry mismatch");
    } catch (e: any) {
      assert.ok(
        e.message.includes("ConstraintSeeds") ||
        e.message.includes("NotWhitelisted") ||
        e.message.includes("A seeds constraint was violated") ||
        e.message.includes("Simulation failed"),
        `Expected seed/has_one mismatch, got: ${e.message}`
      );
    }
  });
});
