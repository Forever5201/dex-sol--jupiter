// src/parsers/types.ts

import { PublicKey } from '@solana/web3.js';
import { TokenAccount } from './spl-token';

// Common parsed state for all DEX pools
export interface ParsedPoolState {
  // Basic AMM reserves
  baseReserve?: number;
  quoteReserve?: number;
  
  // CLMM specific fields
  liquidity?: bigint;
  tickCurrent?: number;
  sqrtPrice?: bigint;
  tickSpacing?: number;
  
  // Order book specific fields
  bids?: TokenAccount[];
  asks?: TokenAccount[];
  
  // General fields
  vaultA?: PublicKey;
  vaultB?: PublicKey;
  feeRate?: number;
  price?: number;
  volume24h?: number;
  tvl?: number;
}

// Interface for pool parsers
export interface PoolParser {
  parse(data: Buffer): ParsedPoolState;
}