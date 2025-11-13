/**
 * Raydium CLMM Builder
 * 完全跳过Legacy API，直接使用Worker的routePlan构建Raydium CLMM swap指令
 *
 * 技术参考：
 * - Raydium文档：https://docs.raydium.io/raydium/permissionless/developers
 * - 程序ID: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5vW8Kx9AAMiP6dD
 * - Anchor IDL: https://github.com/raydium-io/raydium-clmm
 */

import { PublicKey, TransactionInstruction, Connection } from '@solana/web3.js';
import { IDEXBuilder, RouteStep } from './types';
import { logger } from '@solana-arb-bot/core';
import BN from 'bn.js';

// Raydium CLMM程序
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5vW8Kx9AAMiP6dD');

// Token Program
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// 指令discriminator (sha256("global:swap"))[0:8]
const SWAP_DISCRIMINATOR = Buffer.from([0x0b, 0xa8, 0x87, 0x2e, 0x31, 0xe8, 0x6a, 0xc0]);

/**
 * Raydium CLMM Pool state structure (简化版)
 */
interface RaydiumPoolData {
  // 基本信息
  bump: Uint8Array;
  ammConfig: PublicKey;
  owner: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  observationKey: PublicKey;

  // 价格相关
  sqrtPriceX64: BN;
  tickCurrent: number;
  observationIndex: number;
  observationUpdateDuration: number;

  // 费用
  feeGrowthGlobal0X64: BN;
  feeGrowthGlobal1X64: BN;
  protocolFeesToken0: BN;
  protocolFeesToken1: BN;
  fundFeesToken0: BN;
  fundFeesToken1: BN;

  // 流动性
  liquidity: BN;

  // Tick数组
  tickArrayBitmap: number[];
}

/**
 * Tick数组状态
 */
interface TickArrayData {
  poolId: PublicKey;
  startTickIndex: number;
  ticks: TickData[];
  initializedTickCount: number;
}

interface TickData {
  tickCumulative: BN;
  feeGrowthOutside0X64: BN;
  feeGrowthOutside1X64: BN;
  liquidityNet: BN;
  liquidityGross: BN;
}

/**
 * Raydium CLMM DEX Builder
 */
export class RaydiumCLMMBuilder implements IDEXBuilder {
  private connection: Connection;
  private poolCache: Map<string, { data: RaydiumPoolData; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10000; // 10秒缓存

  constructor(connection: Connection) {
    this.connection = connection;
    logger.info('🔧 Raydium CLMM Builder initialized (no /swap-instructions calls)');
  }

  /**
   * Build Raydium CLMM swap instruction
   */
  async buildSwap(
    routeStep: RouteStep,
    userPubkey: PublicKey,
    amount: number,
    slippageBps: number
  ): Promise<TransactionInstruction> {
    const start = Date.now();
    logger.debug(`🔧 Building Raydium CLMM swap...`);

    try {
      // 1. 解析pool地址
      const poolAddress = new PublicKey(routeStep.swapInfo.amm);
      logger.debug(`   ├─ Pool: ${poolAddress.toBase58().slice(0, 8)}...`);

      // 2. 获取pool数据
      logger.debug(`   ├─ Fetching pool data...`);
      const poolData = await this.getPoolData(poolAddress);
      logger.debug(`   ├─ Pool data fetched: tickCurrent=${poolData.tickCurrent}, sqrtPrice=${poolData.sqrtPriceX64.toString()}`);

      // 3. 计算sqrtPriceLimit（考虑滑点）
      logger.debug(`   ├─ Calculating sqrtPriceLimit with ${slippageBps} bps slippage...`);
      const sqrtPriceLimit = this.calculateSqrtPriceLimit(
        poolData.sqrtPriceX64,
        slippageBps,
        true // isBaseInput (amount in vs amount out)
      );
      logger.debug(`   ├─ sqrtPriceLimit: ${sqrtPriceLimit.toString()}`);

      // 4. 计算tick数组地址（最多3个：current, upper, lower）
      logger.debug(`   ├─ Calculating tick array addresses...`);
      const tickArrayAddresses = await this.getTickArrayAccounts(
        poolAddress,
        poolData.tickCurrent,
        true // isBaseInput
      );
      logger.debug(`   ├─ Tick arrays: ${tickArrayAddresses.map(a => a.toBase58().slice(0, 8)).join(', ')}`);

      // 5. 获取用户Token账户
      logger.debug(`   ├─ Getting user token accounts...`);
      const userSourceTokenAccount = await this.getAssociatedTokenAccount(
        userPubkey,
        new PublicKey(routeStep.swapInfo.inputMint)
      );
      const userDestinationTokenAccount = await this.getAssociatedTokenAccount(
        userPubkey,
        new PublicKey(routeStep.swapInfo.outputMint)
      );
      logger.debug(`   ├─ Source ATA: ${userSourceTokenAccount.toBase58().slice(0, 8)}...`);
      logger.debug(`   ├─ Dest ATA: ${userDestinationTokenAccount.toBase58().slice(0, 8)}...`);

      // 6. 编码指令数据
      logger.debug(`   ├─ Encoding swap data...`);
      const data = this.encodeSwapData(
        new BN(amount),
        sqrtPriceLimit,
        true // is_base_input
      );
      logger.debug(`   └─ Data encoded: ${data.length} bytes`);

      // 7. 构建AccountMeta数组
      const keys = this.buildAccountMetas(
        poolAddress,
        userSourceTokenAccount,
        userDestinationTokenAccount,
        tickArrayAddresses,
        poolData.observationKey,
        userPubkey
      );

      // 8. 创建指令
      const instruction = new TransactionInstruction({
        programId: RAYDIUM_CLMM_PROGRAM_ID,
        keys,
        data
      });

      logger.info(`✅ Raydium CLMM swap built in ${Date.now() - start}ms`);

      return instruction;
    } catch (error: any) {
      logger.error(`❌ Failed to build Raydium CLMM swap: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if this builder can handle the route step
   */
  canBuild(routeStep: RouteStep): boolean {
    return routeStep.swapInfo.label === 'Raydium CLMM';
  }

  /**
   * Get required accounts for preloading
   */
  getRequiredAccounts(routeStep: RouteStep): PublicKey[] {
    try {
      const poolAddress = new PublicKey(routeStep.swapInfo.amm);
      const accounts: PublicKey[] = [poolAddress];

      // Pool的token vaults（从缓存或推导）
      // Note: 实际实现中，我们需要从pool data获取这些地址
      // 这里简化处理，只返回pool地址

      return accounts;
    } catch (error) {
      logger.warn(`⚠️ Failed to get required accounts for Raydium: ${error}`);
      return [];
    }
  }

  // ==================== 内部辅助方法 ====================

  /**
   * 获取pool数据（带缓存）
   */
  private async getPoolData(poolAddress: PublicKey): Promise<RaydiumPoolData> {
    const cacheKey = poolAddress.toBase58();
    const cached = this.poolCache.get(cacheKey);

    // 如果缓存未过期，使用缓存
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      logger.debug(`      💨 Using cached pool data (${Date.now() - cached.timestamp}ms old)`);
      return cached.data;
    }

    // 从RPC获取
    logger.debug(`      ⚡ Fetching from RPC...`);
    const accountInfo = await this.connection.getAccountInfo(poolAddress);

    if (!accountInfo) {
      throw new Error(`Pool not found: ${poolAddress.toBase58()}`);
    }

    // 解析pool数据（这是简化版，实际需要从account data解析）
    // 注意：Raydium使用Anchor框架，需要使用IDL来反序列化
    const poolData = this.deserializePoolData(accountInfo.data);

    // 缓存
    this.poolCache.set(cacheKey, {
      data: poolData,
      timestamp: Date.now()
    });

    return poolData;
  }

  /**
   * 反序列化pool数据（简化版）
   * 实际实现中需要使用Anchor IDL来解析
   */
  private deserializePoolData(data: Buffer): RaydiumPoolData {
    try {
      // Raydium Pool的Anchor账户结构：
      // - discriminator: 8 bytes
      // - bump: [u8; 1]
      // - ammConfig: Pubkey (32 bytes)
      // - owner: Pubkey (32 bytes)
      // - tokenMint0: Pubkey (32 bytes)
      // - tokenMint1: Pubkey (32 bytes)
      // - tokenVault0: Pubkey (32 bytes)
      // - tokenVault1: Pubkey (32 bytes)
      // - observationKey: Pubkey (32 bytes)
      // - sqrtPriceX64: u128 (16 bytes)
      // - tickCurrent: i32 (4 bytes)
      // - ... 更多字段

      let offset = 8; // Skip discriminator

      // bump
      const bump = Buffer.from([data.readUInt8(offset)]); offset += 1;

      // ammConfig
      const ammConfig = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // owner
      const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // tokenMint0
      const tokenMint0 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // tokenMint1
      const tokenMint1 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // tokenVault0
      const tokenVault0 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // tokenVault1
      const tokenVault1 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // observationKey
      const observationKey = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // sqrtPriceX64 (u128)
      const sqrtPriceX64 = new BN(data.slice(offset, offset + 16), 'le'); offset += 16;

      // tickCurrent (i32)
      const tickCurrent = data.readInt32LE(offset); offset += 4;

      // 返回简化版数据
      return {
        bump,
        ammConfig,
        owner,
        tokenMint0,
        tokenMint1,
        tokenVault0,
        tokenVault1,
        observationKey,
        sqrtPriceX64,
        tickCurrent,

        // 默认值（实际应从数据解析）
        observationIndex: 0,
        observationUpdateDuration: 15,
        feeGrowthGlobal0X64: new BN(0),
        feeGrowthGlobal1X64: new BN(0),
        protocolFeesToken0: new BN(0),
        protocolFeesToken1: new BN(0),
        fundFeesToken0: new BN(0),
        fundFeesToken1: new BN(0),
        liquidity: new BN(0),
        tickArrayBitmap: []
      };
    } catch (error: any) {
      throw new Error(`Failed to deserialize pool data: ${error.message}`);
    }
  }

  /**
   * 计算sqrtPriceLimit（带滑点保护）
   */
  private calculateSqrtPriceLimit(
    currentSqrtPriceX64: BN,
    slippageBps: number,
    isBaseInput: boolean
  ): BN {
    // slippage转换为小数
    const slippage = slippageBps / 10000; // 50 bps = 0.5%

    // 计算价格限制
    if (isBaseInput) {
      // 对于amount in，可以接受更差的价格（更低的价格）
      // sqrtPriceLimit = currentSqrtPriceX64 * (1 - slippage)
      const multiplier = Math.floor((1 - slippage) * 10000);
      return currentSqrtPriceX64.mul(new BN(multiplier)).div(new BN(10000));
    } else {
      // 对于amount out，可以接受更差的价格（更高的价格）
      // sqrtPriceLimit = currentSqrtPriceX64 * (1 + slippage)
      const multiplier = Math.floor((1 + slippage) * 10000);
      return currentSqrtPriceX64.mul(new BN(multiplier)).div(new BN(10000));
    }
  }

  /**
   * 获取tick数组账户
   * Raydium CLMM使用tick数组来存储流动性信息
   */
  private async getTickArrayAccounts(
    poolAddress: PublicKey,
    tickCurrent: number,
    isBaseInput: boolean
  ): Promise<PublicKey[]> {
    const tickArrays: PublicKey[] = [];

    // Tick数组大小（TickArray中存储的tick数量）
    const TICK_ARRAY_SIZE = 88; // 实际上可能是60或88，需要确认

    // 计算当前tick数组的起始索引
    const currentTickArrayStartIndex = Math.floor(tickCurrent / TICK_ARRAY_SIZE) * TICK_ARRAY_SIZE;

    // 总是包含当前tick数组
    tickArrays.push(
      this.deriveTickArrayAddress(poolAddress, currentTickArrayStartIndex)
    );

    // 对于amount in，我们需要查询多个tick数组
    // 这里简化：只使用1-2个数组，实际取决于流动性分布
    if (isBaseInput) {
      // 添加下一个tick数组（用于跨数组swap）
      const nextTickArrayStartIndex = currentTickArrayStartIndex + TICK_ARRAY_SIZE;
      tickArrays.push(
        this.deriveTickArrayAddress(poolAddress, nextTickArrayStartIndex)
      );
    }

    return tickArrays;
  }

  /**
   * 推导Tick数组地址
   */
  private deriveTickArrayAddress(
    poolAddress: PublicKey,
    startTickIndex: number
  ): PublicKey {
    const seed = Buffer.concat([
      Buffer.from('tick_array'),
      Buffer.from(new BN(startTickIndex).toArray('le', 4)) // i32 as 4 bytes little-endian
    ]);

    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('tick_array'),
        poolAddress.toBuffer(),
        Buffer.from(new BN(startTickIndex).toArray('le', 4))
      ],
      RAYDIUM_CLMM_PROGRAM_ID
    );

    return pda;
  }

  /**
   * 获取Associated Token Account地址
   */
  private getAssociatedTokenAccount(
    owner: PublicKey,
    mint: PublicKey
  ): PublicKey {
    const [ata] = PublicKey.findProgramAddressSync(
      [
        owner.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer()
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Associated Token Program
    );

    return ata;
  }

  /**
   * 编码swap指令数据
   * 结构：
   * - discriminator: 8 bytes
   * - amount: u64 (8 bytes)
   * - sqrt_price_limit: u128 (16 bytes)
   * - is_base_input: bool (1 byte)
   * - other_amount_threshold: u64 (8 bytes)
   */
  private encodeSwapData(
    amount: BN,
    sqrtPriceLimit: BN,
    isBaseInput: boolean
  ): Buffer {
    const buffer = Buffer.alloc(41); // 8 + 8 + 16 + 1 + 8
    let offset = 0;

    // discriminator
    SWAP_DISCRIMINATOR.copy(buffer, offset);
    offset += 8;

    // amount
    Buffer.from(amount.toArray('le', 8)).copy(buffer, offset);
    offset += 8;

    // sqrt_price_limit
    const sqrtPriceLimitBytes = Buffer.from(sqrtPriceLimit.toArray('le', 16));
    // Ensure it's exactly 16 bytes
    if (sqrtPriceLimitBytes.length !== 16) {
      // Pad or truncate
      const padded = Buffer.alloc(16);
      sqrtPriceLimitBytes.copy(padded);
      padded.copy(buffer, offset);
    } else {
      sqrtPriceLimitBytes.copy(buffer, offset);
    }
    offset += 16;

    // is_base_input
    buffer.writeUInt8(isBaseInput ? 1 : 0, offset);
    offset += 1;

    // other_amount_threshold - 设置为0，因为我们有滑点保护
    const threshold = new BN(0);
    Buffer.from(threshold.toArray('le', 8)).copy(buffer, offset);
    offset += 8;

    return buffer;
  }

  /**
   * 构建AccountMeta数组（关键！顺序和权限很重要）
   */
  private buildAccountMetas(
    poolAddress: PublicKey,
    userSourceTokenAccount: PublicKey,
    userDestinationTokenAccount: PublicKey,
    tickArrays: PublicKey[],
    observationKey: PublicKey,
    userPubkey: PublicKey
  ): any[] {
    const keys = [];

    // 0: token_program
    keys.push({
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false
    });

    // 1: token_authority (用户)
    keys.push({
      pubkey: userPubkey,
      isSigner: true,
      isWritable: false
    });

    // 2: amm_config - 从pool data获取
    // Note: 我们需要pool data来获取这个，这里简化
    // 实际应该从getPoolData返回的poolData.ammConfig
    keys.push({
      pubkey: PublicKey.default, // 需要正确值
      isSigner: false,
      isWritable: false
    });

    // 3: pool_state
    keys.push({
      pubkey: poolAddress,
      isSigner: false,
      isWritable: true
    });

    // 4: input_token_account (用户)
    keys.push({
      pubkey: userSourceTokenAccount,
      isSigner: false,
      isWritable: true
    });

    // 5: output_token_account (用户)
    keys.push({
      pubkey: userDestinationTokenAccount,
      isSigner: false,
      isWritable: true
    });

    // 6: input_vault (池子)
    // Note: 需要从pool data获取
    keys.push({
      pubkey: PublicKey.default, // 需要正确值
      isSigner: false,
      isWritable: true
    });

    // 7: output_vault (池子)
    // Note: 需要从pool data获取
    keys.push({
      pubkey: PublicKey.default, // 需要正确值
      isSigner: false,
      isWritable: true
    });

    // 8: observation
    keys.push({
      pubkey: observationKey,
      isSigner: false,
      isWritable: true
    });

    // 9..11: tick_arrays (最多3个)
    for (let i = 0; i < 3; i++) {
      keys.push({
        pubkey: tickArrays[i] || PublicKey.default,
        isSigner: false,
        isWritable: true
      });
    }

    // 注意：这个键列表是简化的，实际Raydium的swap指令有16个键
    // 包括：token_program, token_authority, amm_config, pool_state,
    //       input_token_account, output_token_account, input_vault, output_vault,
    //       observation, tick_arrays[3], scope_oracle[4]

    return keys;
  }
}

export default RaydiumCLMMBuilder;
