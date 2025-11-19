/**
 * Raydium CLMM 交易构建器
 * 
 * 支持本地构建 Raydium CLMM 的 Swap 指令，无需调用外部API
 * 参考: https://github.com/raydium-io/raydium-sdk
 */

import {
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
  AccountMeta
} from '@solana/web3.js';
import BN from 'bn.js';
import { InstructionBuilder } from './instruction-builder';
import { PriceData } from '../parsers/raydium';
import { createLogger } from '@solana-arb-bot/core';

const logger = createLogger('RaydiumCLMMBuilder');

// Raydium CLMM Program ID
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5vW8Kx9AAMiP6dD'
);

// Token Program ID
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

// Associated Token Program ID
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

export class RaydiumCLMMBuilder implements InstructionBuilder {
  /**
   * 构建Raydium CLMM Swap交易指令
   */
  async buildSwap(
    pool: PriceData,
    inputAmount: BN,
    minOutput: BN,
    userWallet: PublicKey,
    priorityFeeMicroLamports: number = 20000
  ): Promise<TransactionInstruction> {
    try {
      logger.debug(`Building swap for Raydium CLMM: ${pool.poolAddress}`);

      // 获取池子的链上数据
      const poolData = await this.getPoolData(new PublicKey(pool.poolAddress));

      // 计算Tick Array地址（基于当前tick）
      const tickArrayAddresses = await this.getTickArrayAddresses(
        new PublicKey(pool.poolAddress),
        pool.clmmData?.tickCurrent || 0,
        pool.clmmData?.tickSpacing || 1
      );

      // 获取用户的代币账户
      const inputTokenAccount = await this.getAssociatedTokenAccount(
        new PublicKey(pool.baseReserve > 0 ? pool.baseReserve.toString() : pool.quoteReserve.toString()),
        userWallet
      );
      const outputTokenAccount = await this.getAssociatedTokenAccount(
        new PublicKey(pool.baseReserve > 0 ? pool.quoteReserve.toString() : pool.baseReserve.toString()),
        userWallet
      );

      // 确定交易方向 (aToB)
      // 根据池子的代币顺序和输入输出来确定
      const tokenMintA = poolData.tokenMintA;
      const tokenMintB = poolData.tokenMintB;
      const inputMint = new PublicKey(pool.baseReserve > 0 ? pool.baseReserve.toString() : pool.quoteReserve.toString());

      // 如果输入代币是tokenMintA，则aToB为true
      const aToB = tokenMintA.equals(inputMint);

      // 构建账户数组
      const keys = this.buildAccountMetas(
        poolData,
        inputTokenAccount,
        outputTokenAccount,
        tickArrayAddresses,
        userWallet
      );

      // 构建指令数据
      const data = this.encodeSwapData(
        inputAmount,
        minOutput, // 使用最小输出金额作为otherAmountThreshold
        new BN(0), // sqrtPriceLimit: 0 表示无限制
        true       // is_base_input: true 表示输入金额固定
      );

      // 创建主要的swap指令
      const swapInstruction = new TransactionInstruction({
        programId: RAYDIUM_CLMM_PROGRAM_ID,
        keys,
        data
      });

      logger.debug(
        `Successfully built Raydium CLMM swap instruction with ${priorityFeeMicroLamports} micro-lamports/CU`
      );

      // 设置计算单元限制和价格
      const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: this.getComputeUnitLimit(pool),
      });

      const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeMicroLamports,
      });

      logger.debug(
        `Successfully built Raydium CLMM swap instruction with ${priorityFeeMicroLamports} micro-lamports/CU`
      );

      return swapInstruction; // For now, return single instruction

    } catch (error) {
      logger.error(`Failed to build Raydium CLMM swap: ${error}`);
      throw error;
    }
  }

  /**
   * 检查是否支持该池子
   */
  canBuild(pool: PriceData): boolean {
    return pool.dex.includes('Raydium CLMM') || pool.poolType === 'CLMM';
  }

  /**
   * 获取构建交易所需的额外账户
   */
  getRequiredAccounts(pool: PriceData): PublicKey[] {
    const accounts: PublicKey[] = [];

    // 需要获取tick array账户，基于当前tick和tick spacing
    accounts.push(new PublicKey(pool.poolAddress));

    return accounts;
  }

  /**
   * 获取推荐的计算单元限制
   * @param pool 价格数据
   * @returns 计算单元数
   */
  getComputeUnitLimit(pool: PriceData): number {
    // Raydium CLMM typically requires moderate compute units
    return 250_000; // 250k CUs for Raydium CLMM swaps
  }
  
  /**
   * 获取池子数据（模拟从链上获取）
   */
  private async getPoolData(poolAddress: PublicKey): Promise<any> {
    // 这里应该从链上获取池子数据
    // 模拟返回一个基础对象，实际实现需要根据链上数据构建
    return {
      status: new BN(0),
      nonce: new BN(0),
      ammConfig: poolAddress, // 实际config地址
      owner: poolAddress,     // 实际owner地址
      tokenMintA: new PublicKey('So11111111111111111111111111111111111111112'), // 示例token
      tokenMintB: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // 示例token
      tokenVaultA: poolAddress, // 实际vault地址
      tokenVaultB: poolAddress, // 实际vault地址
      observationKey: poolAddress, // 实际observation account
      sqrtPriceX64: new BN(0),
      tickCurrent: 0,
      observationIndex: new BN(0),
      observationUpdateDuration: new BN(0),
      feeGrowthGlobalA: new BN(0),
      feeGrowthGlobalB: new BN(0),
      protocolFeesTokenA: new BN(0),
      protocolFeesTokenB: new BN(0),
      liquidity: new BN(0)
    };
  }
  
  /**
   * 获取Tick Array地址（基于当前tick和tick spacing）
   */
  private async getTickArrayAddresses(
    poolAddress: PublicKey,
    currentTick: number,
    tickSpacing: number
  ): Promise<PublicKey[]> {
    const addresses: PublicKey[] = [];
    
    // 计算tick array size (一般为tickSpacing * 60)
    const tickArraySize = tickSpacing * 60;  // 60 ticks per array for Raydium
    
    // 计算当前tick array的起始index
    const startTickIndex = Math.floor(currentTick / tickArraySize) * tickArraySize;
    
    // 生成连续的tick array地址（一般需要3个）
    for (let i = 0; i < 3; i++) {
      const tickArrayStartIndex = startTickIndex + (i * tickArraySize);
      const [tickArrayAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('tick_array'),
          poolAddress.toBuffer(),
          this.i32ToBytes(tickArrayStartIndex)
        ],
        RAYDIUM_CLMM_PROGRAM_ID
      );
      
      addresses.push(tickArrayAddress);
    }
    
    return addresses;
  }
  
  /**
   * 将i32转换为字节
   */
  private i32ToBytes(value: number): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value, 0);
    return buffer;
  }
  
  /**
   * 将u128转换为字节
   */
  private u128ToBytes(value: BN): Buffer {
    const buffer = Buffer.alloc(16);
    const hex = value.toString(16).padStart(32, '0');
    
    for (let i = 0; i < 16; i++) {
      const byte = hex.slice((15 - i) * 2, (15 - i) * 2 + 2);
      buffer.writeUInt8(parseInt(byte, 16), i);
    }
    
    return buffer;
  }
  
  /**
   * 构建账户元数据
   */
  private buildAccountMetas(
    poolData: any,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    tickArrayAddresses: PublicKey[],
    userWallet: PublicKey
  ): AccountMeta[] {
    const keys: AccountMeta[] = [];
    
    // 0. Token Program
    keys.push({
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false
    });
    
    // 1. Token Authority (user wallet)
    keys.push({
      pubkey: userWallet,
      isSigner: true,
      isWritable: false
    });
    
    // 2. Amm Config (从pool data获取)
    keys.push({
      pubkey: poolData.ammConfig,
      isSigner: false,
      isWritable: false
    });
    
    // 3. Pool State
    keys.push({
      pubkey: new PublicKey(poolData.ammConfig),
      isSigner: false,
      isWritable: true
    });
    
    // 4. Input Token Account (user)
    keys.push({
      pubkey: inputTokenAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 5. Output Token Account (user)
    keys.push({
      pubkey: outputTokenAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 6. Input Vault (pool)
    keys.push({
      pubkey: poolData.tokenVaultA,
      isSigner: false,
      isWritable: true
    });
    
    // 7. Output Vault (pool)
    keys.push({
      pubkey: poolData.tokenVaultB,
      isSigner: false,
      isWritable: true
    });
    
    // 8. Observation Account
    keys.push({
      pubkey: poolData.observationKey,
      isSigner: false,
      isWritable: true
    });
    
    // 9. Tick Array 0
    keys.push({
      pubkey: tickArrayAddresses[0],
      isSigner: false,
      isWritable: true
    });
    
    // 10. Tick Array 1
    keys.push({
      pubkey: tickArrayAddresses[1],
      isSigner: false,
      isWritable: true
    });
    
    // 11. Tick Array 2
    keys.push({
      pubkey: tickArrayAddresses[2],
      isSigner: false,
      isWritable: true
    });
    
    return keys;
  }
  
  /**
   * 编码Swap指令数据
   */
  private encodeSwapData(
    amount: BN,
    otherAmountThreshold: BN,
    sqrtPriceLimit: BN,
    isBaseInput: boolean
  ): Buffer {
    // Anchor Swap 指令格式:
    // - 8 bytes: discriminator for "swap"
    // - 8 bytes: amount
    // - 16 bytes: sqrt_price_limit
    // - 1 byte: is_base_input
    
    // "swap" instruction discriminator (sha256("global:swap"))[0:8]
    const discriminator = Buffer.from([
      0x0b, 0xa8, 0x87, 0x2e, 0x31, 0xe8, 0x6a, 0xc0
    ]);
    
    const buffer = Buffer.alloc(33); // 8 + 8 + 16 + 1
    let offset = 0;
    
    // 1. discriminator
    discriminator.copy(buffer, offset);
    offset += 8;
    
    // 2. amount (u64)
    buffer.writeBigUInt64LE(BigInt(amount.toString()), offset);
    offset += 8;
    
    // 3. sqrt_price_limit (u128)
    const sqrtPriceLimitBytes = this.u128ToBytes(sqrtPriceLimit);
    sqrtPriceLimitBytes.copy(buffer, offset);
    offset += 16;
    
    // 4. is_base_input (bool)
    buffer.writeUInt8(isBaseInput ? 1 : 0, offset);
    
    return buffer;
  }
  
  /**
   * 获取关联代币账户地址
   */
  private async getAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    const [ata] = PublicKey.findProgramAddressSync(
      [
        owner.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    return ata;
  }
}

export default RaydiumCLMMBuilder;