// src/parsers/raydium-parser.ts

import { PoolParser, ParsedPoolState } from './types';
import { struct, nu64 } from '@solana/buffer-layout';
import { publicKey } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';

// Raydium AMM 数据布局（简化版）
const RAYDIUM_AMM_LAYOUT = struct<any>([
  nu64('status'),
  nu64('nonce'),
  nu64('orderNum'),
  nu64('depth'),
  nu64('coinDecimals'),
  nu64('pcDecimals'),
  nu64('state'),
  nu64('resetFlag'),
  nu64('minSize'),
  nu64('volMaxCutRatio'),
  nu64('amountWaveRatio'),
  nu64('coinLotSize'),
  nu64('pcLotSize'),
  nu64('minPriceMultiplier'),
  nu64('maxPriceMultiplier'),
  nu64('systemDecimalsValue'),
]);

export class RaydiumParser implements PoolParser {
  parse(data: Buffer): ParsedPoolState {
    try {
      // 验证数据长度
      if (data.length < 300) {
        console.warn(`Invalid account data length: ${data.length} for Raydium pool`);
        return this.getEmptyState();
      }

      // 读取关键数据（使用偏移量方法）
      const STATUS_OFFSET = 0;
      const COIN_DECIMALS_OFFSET = 32;
      const PC_DECIMALS_OFFSET = 40;
      const POOL_COIN_AMOUNT_OFFSET = 248; // 近似位置，需要根据实际调整
      const POOL_PC_AMOUNT_OFFSET = 256;   // 近似位置，需要根据实际调整
      const VAULT_A_OFFSET = 160; // 近似位置 for token_vault_a
      const VAULT_B_OFFSET = 192; // 近似 position for token_vault_b

      // 读取基础数据
      let status: bigint;
      let coinDecimals: bigint;
      let pcDecimals: bigint;

      try {
        status = data.readBigUInt64LE(STATUS_OFFSET);
        coinDecimals = data.readBigUInt64LE(COIN_DECIMALS_OFFSET);
        pcDecimals = data.readBigUInt64LE(PC_DECIMALS_OFFSET);
      } catch (error) {
        console.warn(`Failed to read basic fields for Raydium pool: ${error}`);
        return this.getEmptyState();
      }

      // 读取储备量（安全读取，带边界检查）
      let poolCoinAmount: bigint;
      let poolPcAmount: bigint;

      try {
        // 检查缓冲区大小
        if (data.length < POOL_PC_AMOUNT_OFFSET + 8) {
          throw new Error(`Buffer too small: ${data.length} bytes`);
        }

        poolCoinAmount = data.readBigUInt64LE(POOL_COIN_AMOUNT_OFFSET);
        poolPcAmount = data.readBigUInt64LE(POOL_PC_AMOUNT_OFFSET);

        // 如果储备量为0，返回空状态
        if (poolCoinAmount === BigInt(0) || poolPcAmount === BigInt(0)) {
          console.warn('Zero reserves - pool inactive');
          return this.getEmptyState();
        }
      } catch (error) {
        console.error(`Failed to read reserves: ${error}`);
        return this.getEmptyState();
      }

      // 读取vault地址（如果可能）
      let vaultA: PublicKey | undefined;
      let vaultB: PublicKey | undefined;
      
      try {
        if (data.length >= VAULT_B_OFFSET + 32) {
          vaultA = new PublicKey(data.slice(VAULT_A_OFFSET, VAULT_A_OFFSET + 32));
          vaultB = new PublicKey(data.slice(VAULT_B_OFFSET, VAULT_B_OFFSET + 32));
        }
      } catch (error) {
        console.warn(`Failed to read vault addresses: ${error}`);
        // This is optional, so we continue without them
      }

      // 计算价格
      const price = this.calculatePrice(
        poolPcAmount,
        poolCoinAmount,
        Number(pcDecimals),
        Number(coinDecimals)
      );

      return {
        baseReserve: Number(poolCoinAmount),
        quoteReserve: Number(poolPcAmount),
        vaultA,
        vaultB,
        price,
      };
    } catch (error) {
      console.error(`Failed to parse Raydium pool: ${error}`);
      return this.getEmptyState();
    }
  }

  private getEmptyState(): ParsedPoolState {
    return {};
  }

  private calculatePrice(
    quoteReserve: bigint,
    baseReserve: bigint,
    quoteDecimals: number,
    baseDecimals: number
  ): number {
    if (baseReserve === BigInt(0)) {
      return 0;
    }

    // 调整小数位
    const adjustedQuote = Number(quoteReserve) / Math.pow(10, quoteDecimals);
    const adjustedBase = Number(baseReserve) / Math.pow(10, baseDecimals);

    // 价格 = quote / base
    return adjustedQuote / adjustedBase;
  }
}