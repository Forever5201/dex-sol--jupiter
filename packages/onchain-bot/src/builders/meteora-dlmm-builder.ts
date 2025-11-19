/**
 * Meteora DLMM 交易构建器
 * 
 * 支持本地构建 Meteora DLMM 的 Swap 指令，无需调用外部API
 * 参考: Meteora DLMM IDL and SDK
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

const logger = createLogger('MeteoraDLMMBuilder');

// Meteora DLMM Program ID
const METEORA_DLMM_PROGRAM_ID = new PublicKey(
  'LbistaQB9TA5RR6yn2712n76uqE52v5p9yZnF62643J'
);

// Token Program ID
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

// Associated Token Program ID
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

export class MeteoraDLMMBuilder implements InstructionBuilder {
  /**
   * 构建Meteora DLMM Swap交易指令
   */
  async buildSwap(
    pool: PriceData,
    inputAmount: BN,
    minOutput: BN,
    userWallet: PublicKey,
    priorityFeeMicroLamports: number = 20000
  ): Promise<TransactionInstruction> {
    try {
      logger.debug(`Building swap for Meteora DLMM: ${pool.poolAddress}`);

      // 获取池子的链上数据
      const poolData = await this.getPoolData(new PublicKey(pool.poolAddress));

      // 计算Bin Array地址（基于当前activeId）
      const binArrayAddresses = await this.getBinArrayAddresses(
        new PublicKey(pool.poolAddress),
        pool.extraParams?.activeId || 0,
        pool.binStep || 1
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

      // 确定交易方向 (xToY)
      // 根据池子的代币顺序和输入输出来确定
      const tokenXMint = poolData.tokenXMint;
      const tokenYMint = poolData.tokenYMint;
      const inputMint = new PublicKey(pool.baseReserve > 0 ? pool.baseReserve.toString() : pool.quoteReserve.toString());

      // 如果输入代币是tokenXMint，则xToY为true
      const xToY = tokenXMint.equals(inputMint);

      // 构建账户数组
      const keys = this.buildAccountMetas(
        poolData,
        inputTokenAccount,
        outputTokenAccount,
        binArrayAddresses,
        userWallet
      );

      // 构建指令数据
      const data = this.encodeSwapData(
        inputAmount,
        minOutput, // 使用最小输出金额作为minOutAmount
        xToY       // 交易方向
      );

      // 创建主要的swap指令
      const swapInstruction = new TransactionInstruction({
        programId: METEORA_DLMM_PROGRAM_ID,
        keys,
        data
      });

      // 设置计算单元限制和价格
      const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: this.getComputeUnitLimit(pool),
      });

      const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeMicroLamports,
      });

      logger.debug(
        `Successfully built Meteora DLMM swap instruction with ${priorityFeeMicroLamports} micro-lamports/CU`
      );

      // 设置计算单元限制和价格
      const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: this.getComputeUnitLimit(pool),
      });

      const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeMicroLamports,
      });

      logger.debug(
        `Successfully built Meteora DLMM swap instruction with ${priorityFeeMicroLamports} micro-lamports/CU`
      );

      return swapInstruction; // For now, return single instruction

    } catch (error) {
      logger.error(`Failed to build Meteora DLMM swap: ${error}`);
      throw error;
    }
  }

  /**
   * 检查是否支持该池子
   */
  canBuild(pool: PriceData): boolean {
    return pool.dex.includes('Meteora') || pool.dex.includes('DLMM') || pool.poolType === 'DLMM';
  }

  /**
   * 获取构建交易所需的额外账户
   */
  getRequiredAccounts(pool: PriceData): PublicKey[] {
    const accounts: PublicKey[] = [];

    // 需要获取bin array账户，基于当前activeId和bin step
    accounts.push(new PublicKey(pool.poolAddress));

    return accounts;
  }

  /**
   * 获取推荐的计算单元限制
   * @param pool 价格数据
   * @returns 计算单元数
   */
  getComputeUnitLimit(pool: PriceData): number {
    // Meteora DLMM typically requires more compute units due to bin calculations
    return 400_000; // 400k CUs for Meteora DLMM swaps
  }
  
  /**
   * 获取池子数据（模拟从链上获取）
   */
  private async getPoolData(poolAddress: PublicKey): Promise<any> {
    // 这里应该从链上获取池子数据
    // 模拟返回一个基础对象，实际实现需要根据链上数据构建
    return {
      config: poolAddress, // 实际config地址
      tokenXMint: new PublicKey('So11111111111111111111111111111111111111112'), // 示例token
      tokenYMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // 示例token
      tokenXVault: poolAddress, // 实际vault地址
      tokenYVault: poolAddress, // 实际vault地址
      tokenXDepositAuthority: poolAddress,
      tokenYDepositAuthority: poolAddress,
      feeZTokenXAccount: poolAddress,
      feeZTokenYAccount: poolAddress,
      rewardTokenVaults: [poolAddress],
      oracle: poolAddress, // 实际oracle地址
      activeId: 0,
      binStep: 1,
      maxBinId: 0,
      minBinId: 0,
      protocolShare: new BN(0),
      lookUpTable: poolAddress
    };
  }
  
  /**
   * 获取Bin Array地址（基于当前activeId和bin step）
   */
  private async getBinArrayAddresses(
    poolAddress: PublicKey,
    activeId: number,
    binStep: number
  ): Promise<PublicKey[]> {
    const addresses: PublicKey[] = [];
    
    // 计算bin array大小 (一般为60 bins per array)
    const binArraySize = 60;
    
    // 计算当前bin array的起始id
    const startBinId = Math.floor(activeId / binArraySize) * binArraySize;
    
    // 生成连续的bin array地址（一般需要最多5个，取决于交易大小）
    for (let i = 0; i < 5; i++) {
      const binArrayStartId = startBinId + (i * binArraySize);
      const [binArrayAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('bin_array'),
          poolAddress.toBuffer(),
          this.i32ToBytes(binArrayStartId)
        ],
        METEORA_DLMM_PROGRAM_ID
      );
      
      addresses.push(binArrayAddress);
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
   * 将u64转换为字节
   */
  private u64ToBytes(value: BN): Buffer {
    const buffer = Buffer.alloc(8);
    const hex = value.toString(16).padStart(16, '0');
    
    for (let i = 0; i < 8; i++) {
      const byte = hex.slice((7 - i) * 2, (7 - i) * 2 + 2);
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
    binArrayAddresses: PublicKey[],
    userWallet: PublicKey
  ): AccountMeta[] {
    const keys: AccountMeta[] = [];
    
    // 0. Program
    keys.push({
      pubkey: METEORA_DLMM_PROGRAM_ID,
      isSigner: false,
      isWritable: false
    });
    
    // 1. LB Pair (pool)
    keys.push({
      pubkey: new PublicKey(poolData.config),
      isSigner: false,
      isWritable: true
    });
    
    // 2. User (Authority)
    keys.push({
      pubkey: userWallet,
      isSigner: true,
      isWritable: false
    });
    
    // 3. Token X Mint
    keys.push({
      pubkey: poolData.tokenXMint,
      isSigner: false,
      isWritable: false
    });
    
    // 4. Token Y Mint
    keys.push({
      pubkey: poolData.tokenYMint,
      isSigner: false,
      isWritable: false
    });
    
    // 5. Token X User Account (Input)
    keys.push({
      pubkey: inputTokenAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 6. Token Y User Account (Output)
    keys.push({
      pubkey: outputTokenAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 7. Token X Vault
    keys.push({
      pubkey: poolData.tokenXVault,
      isSigner: false,
      isWritable: true
    });
    
    // 8. Token Y Vault
    keys.push({
      pubkey: poolData.tokenYVault,
      isSigner: false,
      isWritable: true
    });
    
    // 9. Token X Deposit Authority
    keys.push({
      pubkey: poolData.tokenXDepositAuthority,
      isSigner: false,
      isWritable: false
    });
    
    // 10. Token Y Deposit Authority
    keys.push({
      pubkey: poolData.tokenYDepositAuthority,
      isSigner: false,
      isWritable: false
    });
    
    // 11. Fee Owner X
    keys.push({
      pubkey: poolData.feeZTokenXAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 12. Fee Owner Y
    keys.push({
      pubkey: poolData.feeZTokenYAccount,
      isSigner: false,
      isWritable: true
    });
    
    // 13. LB Pair Oracle
    keys.push({
      pubkey: poolData.oracle,
      isSigner: false,
      isWritable: true
    });
    
    // 14. Token Program
    keys.push({
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false
    });
    
    // 15. Bin Array 0
    keys.push({
      pubkey: binArrayAddresses[0],
      isSigner: false,
      isWritable: true
    });
    
    // 16. Bin Array 1
    keys.push({
      pubkey: binArrayAddresses[1],
      isSigner: false,
      isWritable: true
    });
    
    // 17. Bin Array 2
    keys.push({
      pubkey: binArrayAddresses[2],
      isSigner: false,
      isWritable: true
    });
    
    // 18. Bin Array 3
    keys.push({
      pubkey: binArrayAddresses[3],
      isSigner: false,
      isWritable: true
    });
    
    // 19. Bin Array 4
    keys.push({
      pubkey: binArrayAddresses[4],
      isSigner: false,
      isWritable: true
    });
    
    return keys;
  }
  
  /**
   * 编码Swap指令数据
   */
  private encodeSwapData(
    amountIn: BN,
    minAmountOut: BN,
    xToY: boolean
  ): Buffer {
    // Meteora DLMM Swap 指令格式:
    // - 8 bytes: discriminator for "swap"
    // - 8 bytes: amount_in
    // - 8 bytes: min_amount_out
    // - 1 byte: x_to_y (direction)
    
    // "swap" instruction discriminator (this needs to match Meteora's IDL)
    // We'll use a placeholder for now, in practice would be first 8 bytes of SHA256("global:swap")
    const discriminator = Buffer.from([
      0x0b, 0xa8, 0x87, 0x2e, 0x31, 0xe8, 0x6a, 0xc0  // This is for Raydium, need to find Meteora's
    ]);
    
    // Correct discriminator for Meteora DLMM swap
    // (Would be first 8 bytes of SHA256("global:swap_in_base_out_quote") or similar)
    const meteoraDiscriminator = Buffer.from([
      0x92, 0xb5, 0xb7, 0x38, 0x8a, 0x1b, 0x46, 0x7f  // Placeholder - would be actual discriminator
    ]);
    
    const buffer = Buffer.alloc(25); // 8 + 8 + 8 + 1
    let offset = 0;
    
    // 1. discriminator
    meteoraDiscriminator.copy(buffer, offset);
    offset += 8;
    
    // 2. amount_in (u64)
    const amountInBytes = this.u64ToBytes(amountIn);
    amountInBytes.copy(buffer, offset);
    offset += 8;
    
    // 3. min_amount_out (u64)
    const minAmountOutBytes = this.u64ToBytes(minAmountOut);
    minAmountOutBytes.copy(buffer, offset);
    offset += 8;
    
    // 4. x_to_y (bool)
    buffer.writeUInt8(xToY ? 1 : 0, offset);
    
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

export default MeteoraDLMMBuilder;