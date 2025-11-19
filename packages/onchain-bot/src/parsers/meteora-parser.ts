// src/parsers/meteora-parser.ts

import { PoolParser, ParsedPoolState } from './types';
import { PublicKey } from '@solana/web3.js';

export class MeteoraParser implements PoolParser {
  parse(data: Buffer): ParsedPoolState {
    try {
      // Validate data length for Meteora DLMM (LbPair account)
      // Minimum size for essential fields
      if (data.length < 200) {
        console.warn(`Invalid account data length: ${data.length} for Meteora DLMM`);
        return this.getEmptyState();
      }

      let offset = 8; // Skip discriminator (8 bytes)

      // Parse authority (PublicKey - 32 bytes)
      offset += 32;

      // Parse tokenMintX and tokenMintY (PublicKeys - 32 bytes each)
      offset += 32; // tokenMintX
      offset += 32; // tokenMintY

      // Parse tokenVaultX and tokenVaultY (PublicKeys - 32 bytes each)
      const vaultA = new PublicKey(data.slice(offset, offset + 32)); offset += 32; // tokenVaultX
      const vaultB = new PublicKey(data.slice(offset, offset + 32)); offset += 32; // tokenVaultY

      // Parse active bin id (i32 - 4 bytes)
      const activeId = data.readInt32LE(offset); offset += 4;

      // Parse bin step (u16 - 2 bytes)
      const binStep = data.readUInt16LE(offset); offset += 2;

      // Skip other fields (binStep is already read)
      offset += 2; // pad (u16)

      // Parse reserveX and reserveY (u64 - 8 bytes each)
      const reserveX = data.readBigUInt64LE(offset); offset += 8;
      const reserveY = data.readBigUInt64LE(offset); offset += 8;

      // Calculate price based on activeId and binStep
      // Price = (1 + binStep/10000) ^ activeId
      // This is a simplified version - actual price calculation depends on which token is base/quote
      const price = Math.pow(1 + binStep / 10000, activeId);

      // Calculate approximate liquidity from reserves
      // For a more accurate liquidity calculation, we should consider all active bins
      const liquidity = Number(reserveX) + Number(reserveY);

      return {
        baseReserve: Number(reserveX),
        quoteReserve: Number(reserveY),
        liquidity: BigInt(Math.floor(liquidity)),
        tickCurrent: activeId, // Using activeId as tickCurrent for consistency
        tickSpacing: binStep,  // Using binStep as tickSpacing for consistency
        vaultA,
        vaultB,
        price,
      };
    } catch (error) {
      console.error(`Failed to parse Meteora DLMM: ${error}`);
      return this.getEmptyState();
    }
  }

  private getEmptyState(): ParsedPoolState {
    return {};
  }
}