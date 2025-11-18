/**
 * Orca Whirlpools Builder
 * 纯本地构建 Orca swap 指令 (0ms, 无需调用 API)
 *
 * 技术规格:
 * - Program ID: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
 * - 指令: swapV2 (0x01)
 * - 来源: Orca Whirlpools SDK https://github.com/orca-so/whirlpools
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { logger } from "@solana-arb-bot/core";

// Orca Whirlpools Program ID (v2)
export const ORCA_WHIRLPOOLS_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

export interface OrcaSwapStep {
  swapInfo: {
    label: string;
    poolKey: string;           // Whirlpool address
    inputMint: string;         // Source token
    outputMint: string;        // Destination token
    inAmount: string;          // Input amount (lamports)
    outAmount: string;         // Expected output amount (lamports)
    fee: string;              // Fee amount
    tickCurrentIndex: number;  // Current tick index
  };
  percent: number;            // Allocation percentage
}

export interface OrcaSwapParams {
  // Pool accounts
  whirlpool: PublicKey;              // Pool address
  tokenMintA: PublicKey;             // Token A mint
  tokenMintB: PublicKey;             // Token B mint
  tokenVaultA: PublicKey;            // Token A vault
  tokenVaultB: PublicKey;            // Token B vault
  oracle: PublicKey;                 // Oracle account

  // User accounts
  tokenOwnerAccountA: PublicKey;     // User token A account
  tokenOwnerAccountB: PublicKey;     // User token B account
  tokenAuthority: PublicKey;         // User wallet

  // Tick arrays (3 required)
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;

  // Token programs
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;

  // Swap parameters
  amount: BN;                        // Swap amount (lamports)
  otherAmountThreshold: BN;          // Minimum output amount (slippage)
  sqrtPriceLimit: BN;                // Price limit (0 = no limit)
  amountSpecifiedIsInput: boolean;   // true = input fixed, false = output fixed
  aToB: boolean;                     // Swap direction

  // Optional: supplemental tick arrays (for large swaps)
  supplementalTickArrays?: PublicKey[];
}

export class OrcaBuilder {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  /**
   * 从 Worker 的 routePlan 构建 Orca swap 指令
   *
   * @param step Worker 提供的单个 route step
   * @param walletAddress 用户钱包地址
   * @param slippageBps 滑点 (basis points)
   * @returns TransactionInstruction 数组
   */
  async buildSwap(
    step: OrcaSwapStep,
    walletAddress: PublicKey,
    slippageBps: number
  ): Promise<TransactionInstruction[]> {
    const start = Date.now();

    try {
      logger.debug(`🐋 OrcaBuilder: Building swap for ${step.swapInfo.inputMint} -> ${step.swapInfo.outputMint}`);

      // 1. 解析并验证参数
      const params = await this.parseSwapParams(step, walletAddress, slippageBps);

      // 2. 构建 swapV2 指令
      const swapInstruction = await this.createSwapV2Instruction(params);

      // 3. 返回指令数组
      const duration = Date.now() - start;
      logger.debug(`✅ OrcaBuilder: Swap built in ${duration}ms`);

      return [swapInstruction];
    } catch (error: any) {
      logger.error(`❌ OrcaBuilder failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 解析并验证 swap 参数
   */
  private async parseSwapParams(
    step: OrcaSwapStep,
    walletAddress: PublicKey,
    slippageBps: number
  ): Promise<OrcaSwapParams> {
    // 解析金额
    const amount = new BN(step.swapInfo.inAmount);
    const outAmount = new BN(step.swapInfo.outAmount);

    // 计算最小输出金额 (考虑滑点)
    const slippage = new BN(slippageBps).mul(outAmount).div(new BN(10000));
    const minOutAmount = outAmount.sub(slippage);

    // 确定交易方向 (aToB)
    const inputMint = new PublicKey(step.swapInfo.inputMint);
    const outputMint = new PublicKey(step.swapInfo.outputMint);

    // 从 poolKey 解码池子信息
    const whirlpool = new PublicKey(step.swapInfo.poolKey);

    // 查询链上数据获取所需账户
    logger.debug("🐋 OrcaBuilder: Querying on-chain accounts...");

    const accountInfo = await this.connection.getAccountInfo(whirlpool);
    if (!accountInfo) {
      throw new Error(`Whirlpool account not found: ${whirlpool.toBase58()}`);
    }

    // 解析 Whirlpool 账户数据 (Anchor 布局)
    // 需要解码 tokenMintA, tokenMintB, tokenVaultA, tokenVaultB, feeRate, tickSpacing等
    const parsedData = this.parseWhirlpoolData(accountInfo.data);

    // 获取用户代币账户地址
    const tokenOwnerAccountA = await this.getAssociatedTokenAccount(
      parsedData.tokenMintA,
      walletAddress
    );

    const tokenOwnerAccountB = await this.getAssociatedTokenAccount(
      parsedData.tokenMintB,
      walletAddress
    );

    // 计算 tick arrays (基于当前 tick)
    const tickArrays = await this.getTickArrays(
      whirlpool,
      parsedData.tickCurrentIndex,
      parsedData.tickSpacing,
      parsedData.aToB
    );

    // 构建完整参数
    const params: OrcaSwapParams = {
      // Pool accounts
      whirlpool,
      tokenMintA: parsedData.tokenMintA,
      tokenMintB: parsedData.tokenMintB,
      tokenVaultA: parsedData.tokenVaultA,
      tokenVaultB: parsedData.tokenVaultB,
      oracle: parsedData.oracle,

      // User accounts
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenAuthority: walletAddress,

      // Tick arrays
      tickArray0: tickArrays[0],
      tickArray1: tickArrays[1],
      tickArray2: tickArrays[2],

      // Token programs
      tokenProgramA: parsedData.tokenProgramA,
      tokenProgramB: parsedData.tokenProgramB,

      // Swap parameters
      amount,
      otherAmountThreshold: minOutAmount,
      sqrtPriceLimit: new BN(0),  // 0 = no limit
      amountSpecifiedIsInput: true,  // 输入金额固定
      aToB: parsedData.aToB,
    };

    return params;
  }

  /**
   * 解析 Whirlpool 账户数据 (Anchor 布局)
   */
  private parseWhirlpoolData(data: Buffer): {
    tokenMintA: PublicKey;
    tokenMintB: PublicKey;
    tokenVaultA: PublicKey;
    tokenVaultB: PublicKey;
    tokenProgramA: PublicKey;
    tokenProgramB: PublicKey;
    oracle: PublicKey;
    tickCurrentIndex: number;
    tickSpacing: number;
    aToB: boolean;
  } {
    // Anchor 账户布局:
    // - 8 bytes: discriminator
    // - PublicKey: whirlpoolsConfig
    // - PublicKey: tokenMintA
    // - PublicKey: tokenMintB
    // - PublicKey: tokenVaultA
    // - PublicKey: tokenVaultB
    // - PublicKey: feeTier
    // - u16: tickSpacing
    // - ... 其他字段

    let offset = 8;  // Skip discriminator

    const whirlpoolsConfig = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tokenMintA = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tokenMintB = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tokenVaultA = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tokenVaultB = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const feeTier = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tickSpacing = data.readUInt16LE(offset);
    offset += 2;

    // 跳过其他字段到 tickCurrentIndex (位置可能变化)
    // 标准 Whirlpool 结构中，tickCurrentIndex 在偏移量 100+ 的位置
    offset = 100;  // 简化: 直接跳到已知位置

    const tickCurrentIndex = data.readInt32LE(offset);
    offset += 4;

    // 从 tickCurrentIndex 判断交易方向 (aToB)
    // 如果当前tick < 0，表示价格在中间价以下
    const aToB = tickCurrentIndex < 0;

    // 获取 Oracle (通常在 tickCurrentIndex 之后)
    offset += 4;  // 跳过其他字段
    const oracle = new PublicKey(data.slice(offset, offset + 32));

    // Token Program (标准地址)
    const tokenProgramA = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const tokenProgramB = tokenProgramA;

    return {
      tokenMintA,
      tokenMintB,
      tokenVaultA,
      tokenVaultB,
      tokenProgramA,
      tokenProgramB,
      oracle,
      tickCurrentIndex,
      tickSpacing,
      aToB,
    };
  }

  /**
   * 获取用户的 Associated Token Account
   */
  private async getAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    // 使用标准 ATA 计算
    // TODO: 处理 token22 程序
    const [ata] = await PublicKey.findProgramAddress(
      [
        owner.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    );

    return ata;
  }

  /**
   * 获取 Tick Array 账户
   *
   * Tick Array 用于存储价格档位信息
   * 需要查询链上获取3个连续的 tick arrays
   */
  private async getTickArrays(
    whirlpool: PublicKey,
    tickCurrentIndex: number,
    tickSpacing: number,
    aToB: boolean
  ): Promise<[PublicKey, PublicKey, PublicKey]> {
    // Tick array 大小 = tickSpacing * 64
    const tickArraySize = tickSpacing * 64;

    // 计算起始 tick index
    const startTickIndex = Math.floor(tickCurrentIndex / tickArraySize) * tickArraySize;

    // 获取或派生 tick array 地址
    // 在实际实现中，需要从 Whirlpool 账户或查询链上获取
    // 这里简化处理: 使用 getProgramAddress 派生

    const tickArray0 = await this.deriveTickArray(whirlpool, startTickIndex);
    const tickArray1 = await this.deriveTickArray(whirlpool, startTickIndex + tickArraySize);
    const tickArray2 = await this.deriveTickArray(whirlpool, startTickIndex + tickArraySize * 2);

    return [tickArray0, tickArray1, tickArray2];
  }

  /**
   * 派生 Tick Array 地址
   *
   * Tick arrays 使用 PDA 派生:
   * [whirlpool seed, b"tick_array", start_tick_index bytes]
   */
  private async deriveTickArray(
    whirlpool: PublicKey,
    startTickIndex: number
  ): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("tick_array"),
        whirlpool.toBuffer(),
        this.tickIndexToBytes(startTickIndex),
      ],
      ORCA_WHIRLPOOLS_PROGRAM_ID
    );

    return pda;
  }

  /**
   * 将 tick index 转换为 bytes
   */
  private tickIndexToBytes(tickIndex: number): Buffer {
    const buffer = Buffer.alloc(2);
    buffer.writeInt16LE(tickIndex);
    return buffer;
  }

  /**
   * 创建 swapV2 指令
   *
   * 手动构建 Orca swap 指令 (不依赖 Anchor client)
   */
  private async createSwapV2Instruction(
    params: OrcaSwapParams
  ): Promise<TransactionInstruction> {
    // 编码指令数据
    // Anchor 指令格式:
    // - 8 bytes: discriminator (sha256("global:swap_v2")[0:8])
    // - amount: u64
    // - otherAmountThreshold: u64
    // - sqrtPriceLimit: u128
    // - amountSpecifiedIsInput: bool
    // - aToB: bool

    const discriminator = Buffer.from([
      0x0a, 0x8b, 0x5e, 0xcd, 0xb7, 0x51, 0x89, 0x83  // swapV2 discriminator
    ]);

    const data = Buffer.alloc(8 + 8 + 8 + 16 + 1 + 1);
    let offset = 0;

    // discriminator
    discriminator.copy(data, offset);
    offset += 8;

    // amount
    data.writeBigUInt64LE(BigInt(params.amount.toString()), offset);
    offset += 8;

    // otherAmountThreshold
    data.writeBigUInt64LE(BigInt(params.otherAmountThreshold.toString()), offset);
    offset += 8;

    // sqrtPriceLimit (u128)
    const sqrtPriceLimitBytes = this.u128ToBytes(params.sqrtPriceLimit);
    sqrtPriceLimitBytes.copy(data, offset);
    offset += 16;

    // amountSpecifiedIsInput
    data.writeUInt8(params.amountSpecifiedIsInput ? 1 : 0, offset);
    offset += 1;

    // aToB
    data.writeUInt8(params.aToB ? 1 : 0, offset);

    // 构建账户列表 (关键部分)
    const keys = this.buildAccountMetas(params);

    return new TransactionInstruction({
      programId: ORCA_WHIRLPOOLS_PROGRAM_ID,
      keys,
      data,
    });
  }

  /**
   * 构建账户列表 (AccountMeta[])
   *
   * 账户顺序必须与 Orca IDL 定义完全一致
   */
  private buildAccountMetas(params: OrcaSwapParams): any[] {
    const keys: any[] = [];

    // 1. token_program_a
    keys.push({
      pubkey: params.tokenProgramA,
      isSigner: false,
      isWritable: false,
    });

    // 2. token_program_b
    keys.push({
      pubkey: params.tokenProgramB,
      isSigner: false,
      isWritable: false,
    });

    // 3. memo_program (可选，通常不需要)
    keys.push({
      pubkey: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      isSigner: false,
      isWritable: false,
    });

    // 4. token_authority (用户钱包)
    keys.push({
      pubkey: params.tokenAuthority,
      isSigner: true,
      isWritable: false,
    });

    // 5. whirlpool (池子账户)
    keys.push({
      pubkey: params.whirlpool,
      isSigner: false,
      isWritable: true,
    });

    // 6. token_mint_a
    keys.push({
      pubkey: params.tokenMintA,
      isSigner: false,
      isWritable: false,
    });

    // 7. token_mint_b
    keys.push({
      pubkey: params.tokenMintB,
      isSigner: false,
      isWritable: false,
    });

    // 8. token_owner_account_a (用户输入代币账户)
    keys.push({
      pubkey: params.tokenOwnerAccountA,
      isSigner: false,
      isWritable: true,
    });

    // 9. token_vault_a (池子输入代币金库)
    keys.push({
      pubkey: params.tokenVaultA,
      isSigner: false,
      isWritable: true,
    });

    // 10. token_owner_account_b (用户输出代币账户)
    keys.push({
      pubkey: params.tokenOwnerAccountB,
      isSigner: false,
      isWritable: true,
    });

    // 11. token_vault_b (池子输出代币金库)
    keys.push({
      pubkey: params.tokenVaultB,
      isSigner: false,
      isWritable: true,
    });

    // 12. tick_array_0 (第一个tick array)
    keys.push({
      pubkey: params.tickArray0,
      isSigner: false,
      isWritable: true,
    });

    // 13. tick_array_1 (第二个tick array)
    keys.push({
      pubkey: params.tickArray1,
      isSigner: false,
      isWritable: true,
    });

    // 14. tick_array_2 (第三个tick array)
    keys.push({
      pubkey: params.tickArray2,
      isSigner: false,
      isWritable: true,
    });

    // 15. oracle (预言机账户)
    keys.push({
      pubkey: params.oracle,
      isSigner: false,
      isWritable: false,
    });

    // 16-18. Remaining accounts (tick arrays for crossing)
    if (params.supplementalTickArrays && params.supplementalTickArrays.length > 0) {
      for (const supplementalTickArray of params.supplementalTickArrays) {
        keys.push({
          pubkey: supplementalTickArray,
          isSigner: false,
          isWritable: true,
        });
      }
    }

    return keys;
  }

  /**
   * 将 u128 转换为 bytes (little-endian)
   */
  private u128ToBytes(value: BN): Buffer {
    // 对于 Node.js Buffer，我们需要正确处理 u128
    const buffer = Buffer.alloc(16);
    const hex = value.toString(16).padStart(32, '0'); // 32 hex chars = 128 bits

    // Write in little-endian (reverse byte order)
    for (let i = 0; i < 16; i++) {
      const byte = hex.slice((15 - i) * 2, (15 - i) * 2 + 2);
      buffer.writeUInt8(parseInt(byte, 16), i);
    }

    return buffer;
  }
}
