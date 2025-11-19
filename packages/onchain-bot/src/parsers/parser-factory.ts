// src/parsers/parser-factory.ts

import { PoolParser } from './types';
import { RaydiumParser } from './raydium-parser';
import { OrcaParser } from './orca-parser';
import { ClmmParser } from './clmm-parser';
import { WhirlpoolParser } from './whirlpool-parser';
import { MeteoraParser } from './meteora-parser';

export class ParserFactory {
  private static parsers = new Map<string, PoolParser>();

  static {
    // Register all supported parsers
    this.parsers.set('Raydium', new RaydiumParser());
    this.parsers.set('Orca', new OrcaParser());
    this.parsers.set('Whirlpool', new WhirlpoolParser());
    this.parsers.set('Raydium CLMM', new ClmmParser());
    this.parsers.set('Meteora DLMM', new MeteoraParser());
    // Add more parsers as they are created:
    // this.parsers.set('Phoenix', new PhoenixParser());
    // this.parsers.set('Jupiter', new JupiterParser());
  }

  static getParser(dexName: string): PoolParser | null {
    const parser = this.parsers.get(dexName);
    if (!parser) {
      console.warn(`No parser available for DEX: ${dexName}`);
      return null;
    }
    return parser;
  }

  static registerParser(dexName: string, parser: PoolParser): void {
    this.parsers.set(dexName, parser);
  }

  static isSupported(dexName: string): boolean {
    return this.parsers.has(dexName);
  }

  static getSupportedDexes(): string[] {
    return Array.from(this.parsers.keys());
  }
}