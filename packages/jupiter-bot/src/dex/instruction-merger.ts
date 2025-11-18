/**
 * InstructionMerger - 合并多个DEX的指令为完整交易
 * 完全跳过Legacy API，直接使用本地构建的指令
 */

import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { Connection } from '@solana/web3.js';
import { logger } from '@solana-arb-bot/core';

export interface MergeOptions {
  // 是否启用计算预算合并优化
  mergeComputeBudget?: boolean;
  // 是否启用地址去重
  deduplicateAccounts?: boolean;
  // 是否验证交易大小
  validateSize?: boolean;
}

export interface MergedResult {
  transaction: VersionedTransaction;
  instructions: TransactionInstruction[];
  rawSize: number;
  altSize: number;
  totalSize: number;
  lookupTables: AddressLookupTableAccount[];
}

export class InstructionMerger {
  private connection: Connection;
  private recentBlockhash?: string;
  private lastBlockhashUpdate: number = 0;
  private readonly BLOCKHASH_CACHE_TTL = 10000; // 10秒

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * 合并所有指令为完整交易
   */
  async merge(
    payerKey: PublicKey,
    computeBudget: { maxComputeUnits?: number; microLamports?: number },
    setupInstructions: TransactionInstruction[],
    mainInstructions: TransactionInstruction[],
    cleanupInstructions: TransactionInstruction[],
    addressLookupTableAddresses: string[]
  ): Promise<MergedResult> {
    const start = Date.now();
    logger.debug('🔧 Starting instruction merge...');

    try {
      // 1. 构建计算预算指令
      logger.debug(`   ├─ Building compute budget: CU=${computeBudget.maxComputeUnits || 1400000}, price=${computeBudget.microLamports || 0}`);
      const computeBudgetInstructions = this.buildComputeBudgetInstructions(
        computeBudget.maxComputeUnits,
        computeBudget.microLamports
      );

      // 2. 加载地址查找表账户
      logger.debug(`   ├─ Loading ${addressLookupTableAddresses.length} ALTs...`);
      const lookupTables = await this.loadAddressLookupTables(addressLookupTableAddresses);
      logger.debug(`   ├─ Loaded ${lookupTables.length} ALTs successfully`);

      // 3. 合并所有指令（顺序很重要）
      const allInstructions = [
        ...computeBudgetInstructions,
        ...setupInstructions,
        ...mainInstructions,
        ...cleanupInstructions
      ];

      logger.debug(`   ├─ Total instructions: ${allInstructions.length}`);
      logger.debug(`   ├─ Setup: ${setupInstructions.length}`);
      logger.debug(`   ├─ Main: ${mainInstructions.length}`);
      logger.debug(`   └─ Cleanup: ${cleanupInstructions.length}`);

      // 4. 获取最新blockhash
      logger.debug('   └─ Fetching recent blockhash...');
      const blockhash = await this.getRecentBlockhash();
      logger.debug(`      └─ Blockhash: ${blockhash.slice(0, 16)}...`);

      // 5. 构建V0 Message
      const messageV0 = new TransactionMessage({
        payerKey,
        recentBlockhash: blockhash,
        instructions: allInstructions
      }).compileToV0Message(lookupTables);

      // 6. 创建交易
      const transaction = new VersionedTransaction(messageV0);

      // 7. 计算大小
      const rawSize = transaction.serialize().length;
      const altSize = this.calculateALTSize(allInstructions, lookupTables);
      const totalSize = rawSize + altSize;

      logger.info(
        `✅ Instruction merge complete: ${Date.now() - start}ms, ` +
        `size: ${rawSize} bytes (raw) + ${altSize} bytes (ALTs) = ${totalSize} bytes`
      );

      logger.debug(`   └─ Instructions breakdown:`);
      logger.debug(`      ├─ Compute Budget: ${computeBudgetInstructions.length}`);
      logger.debug(`      ├─ Setup: ${setupInstructions.length}`);
      logger.debug(`      ├─ Main: ${mainInstructions.length}`);
      logger.debug(`      └─ Cleanup: ${cleanupInstructions.length}`);

      return {
        transaction,
        instructions: allInstructions,
        rawSize,
        altSize,
        totalSize,
        lookupTables
      };
    } catch (error: any) {
      logger.error(`❌ Instruction merge failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 构建计算预算指令（合并优化）
   */
  private buildComputeBudgetInstructions(
    maxComputeUnits?: number,
    microLamports?: number
  ): TransactionInstruction[] {
    const instructions: TransactionInstruction[] = [];

    // 1. Compute Unit Limit
    if (maxComputeUnits) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: maxComputeUnits })
      );
    }

    // 2. Compute Unit Price
    if (microLamports) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
      );
    }

    return instructions;
  }

  /**
   * 加载地址查找表账户
   */
  private async loadAddressLookupTables(
    addresses: string[]
  ): Promise<AddressLookupTableAccount[]> {
    if (!addresses || addresses.length === 0) {
      return [];
    }

    try {
      const pubkeys = addresses.map(addr => new PublicKey(addr));

      // 批量获取account信息
      const accounts = await this.connection.getMultipleAccountsInfo(pubkeys);

      const lookupTables: AddressLookupTableAccount[] = [];

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        if (!account) {
          logger.warn(`⚠️ ALT not found: ${addresses[i]}`);
          continue;
        }

        try {
          const lookupTable = new AddressLookupTableAccount({
            key: pubkeys[i],
            state: AddressLookupTableAccount.deserialize(account.data)
          });

          lookupTables.push(lookupTable);

          logger.debug(
            `   ✓ ALT loaded: ${addresses[i].slice(0, 8)}... ` +
            `(${lookupTable.state.addresses.length} addresses)`
          );
        } catch (error: any) {
          logger.warn(`⚠️ Failed to deserialize ALT ${addresses[i]}: ${error.message}`);
        }
      }

      return lookupTables;
    } catch (error: any) {
      logger.error(`❌ Failed to load ALTs: ${error.message}`);
      // 降级处理：返回空数组，交易可能更大但可执行
      return [];
    }
  }

  /**
   * 获取最近blockhash（带缓存）
   */
  private async getRecentBlockhash(): Promise<string> {
    const now = Date.now();

    // 如果blockhash未过期，使用缓存
    if (this.recentBlockhash && (now - this.lastBlockhashUpdate < this.BLOCKHASH_CACHE_TTL)) {
      logger.debug(`   💨 Using cached blockhash (${now - this.lastBlockhashUpdate}ms old)`);
      return this.recentBlockhash;
    }

    // 从RPC获取新blockhash
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

    this.recentBlockhash = blockhash;
    this.lastBlockhashUpdate = now;

    logger.debug(`   ⚡ Fetched fresh blockhash from RPC`);

    return blockhash;
  }

  /**
   * 计算ALT贡献的大小
   */
  private calculateALTSize(
    instructions: TransactionInstruction[],
    lookupTables: AddressLookupTableAccount[]
  ): number {
    if (lookupTables.length === 0) {
      return 0;
    }

    // 每个ALT地址在交易中的节省
    const bytesPerALTAddress = 32; // PublicKey大小
    const bytesPerALTIndex = 1;    // u8索引大小

    let totalSavings = 0;
    let altAddressesUsed = 0;

    // 统计使用到的ALT地址数量
    for (const instruction of instructions) {
      for (const key of instruction.keys) {
        // 检查这个地址是否在任何一个ALT中
        for (const lookupTable of lookupTables) {
          const idx = lookupTable.state.addresses.findIndex(addr =>
            addr.equals(key.pubkey)
          );

          if (idx >= 0) {
            altAddressesUsed++;
            totalSavings += bytesPerALTAddress - bytesPerALTIndex;
          }
        }
      }
    }

    logger.debug(
      `   └─ ALT optimization: ${altAddressesUsed} addresses compressed, ` +
      `saved ${totalSavings} bytes`
    );

    // ALT本身也有开销（metadata）
    const altOverhead = lookupTables.length * 56; // 估算的ALT overhead

    return Math.max(totalSavings - altOverhead, 0);
  }

  /**
   * 验证交易大小
   */
  validateTransactionSize(transaction: VersionedTransaction, maxSize = 1232): boolean {
    const size = transaction.serialize().length;

    if (size > maxSize) {
      logger.error(
        `❌ Transaction too large: ${size} bytes > ${maxSize} bytes limit`
      );
      return false;
    }

    logger.info(`✅ Transaction size OK: ${size}/${maxSize} bytes`);
    return true;
  }

  /**
   * 估算交易大小（用于策略选择）
   */
  estimateSize(
    instructions: TransactionInstruction[],
    lookupTableAddresses: string[]
  ): number {
    // 简化的估算，实际大小会在编译时确定
    const baseSize = 32 + 64; // Header + signatures
    const ixSize = instructions.reduce((sum, ix) => sum + ix.data.length + ix.keys.length * 34, 0);
    const altSize = lookupTableAddresses.length * 32;

    return baseSize + ixSize + altSize;
  }
}

export default InstructionMerger;
