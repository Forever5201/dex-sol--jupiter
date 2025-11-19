// src/parsers/whirlpool-parser.ts

import { PoolParser, ParsedPoolState } from './types';
import { PublicKey } from '@solana/web3.js';

export class WhirlpoolParser implements PoolParser {
  parse(data: Buffer): ParsedPoolState {
    try {
      // Validate data length for Whirlpool (at least 400 bytes for core fields)
      if (data.length < 400) {
        console.warn(`Invalid account data length: ${data.length} for Whirlpool`);
        return this.getEmptyState();
      }

      let offset = 8; // Skip discriminator (8 bytes)

      // Skip common fields (WhirlpoolsConfig, fee, protocol fee, vault bump, tick spacing, etc.)
      offset += 32; // WhirlpoolsConfig (PublicKey) - 32 bytes
      offset += 32; // whirlpoolBump (u8) packed with other bytes
      offset += 1; // whirlpoolBump (u8) 
      offset += 2; // tickSpacing (u16)
      offset += 1; // feeTierIndexSeed (u8)

      // Parse vault addresses
      const vaultA = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const vaultB = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // Skip token mint addresses and bump seeds
      offset += 32; // tokenMintA
      offset += 32; // tokenMintB
      offset += 32; // tokenVaultA
      offset += 32; // tokenVaultB
      offset += 8; // feeAccount

      // Parse authority (PublicKey)
      offset += 32;

      // Skip other fields
      offset += 3; // WhirlpoolBump and padding
      offset += 1; // WhirlpoolBump

      // Parse sqrtPrice (u128 - 16 bytes)
      const sqrtPriceLow = data.readBigUInt64LE(offset); offset += 8;
      const sqrtPriceHigh = data.readBigUInt64LE(offset); offset += 8;
      const sqrtPrice = (sqrtPriceHigh << BigInt(64)) | sqrtPriceLow;

      // Parse tickCurrentIndex (i32 - 4 bytes)
      const tickCurrentIndex = data.readInt32LE(offset); offset += 4;

      // Parse liquidity (u128 - 16 bytes)
      const liquidityLow = data.readBigUInt64LE(offset); offset += 8;
      const liquidityHigh = data.readBigUInt64LE(offset); offset += 8;
      const liquidity = (liquidityHigh << BigInt(64)) | liquidityLow;

      // Parse tickSpacing (u16 - 2 bytes)
      const tickSpacing = data.readUInt16LE(offset); offset += 2;

      // Skip protocol fee rate (u16) and fee growth (u128 each)
      offset += 2; // protocolFeeRatePercentage
      offset += 16; // feeGrowthGlobalA
      offset += 16; // feeGrowthGlobalB

      // Parse token mint decimals
      const tokenDecimalA = data[offset]; offset += 1;
      const tokenDecimalB = data[offset]; offset += 1;

      // Skip more fields
      offset += 4; // startTime

      // Calculate price from sqrtPrice
      // sqrtPrice is in Q64.64 format: sqrt_price * 2^64
      const sqrtPriceNumber = Number(sqrtPrice) / Math.pow(2, 64);
      const price = sqrtPriceNumber * sqrtPriceNumber;

      return {
        liquidity,
        tickCurrent: tickCurrentIndex,
        sqrtPrice,
        tickSpacing,
        vaultA,
        vaultB,
        price,
        // For now, we return 0 as base/quote reserves since CLMM doesn't use traditional reserves
        baseReserve: 0,
        quoteReserve: 0,
      };
    } catch (error) {
      console.error(`Failed to parse Whirlpool: ${error}`);
      return this.getEmptyState();
    }
  }

  private getEmptyState(): ParsedPoolState {
    return {};
  }
}