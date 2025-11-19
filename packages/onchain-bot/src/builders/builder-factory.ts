/**
 * 交易构建器工厂
 *
 * 管理和选择适当的交易构建器，并支持LUT功能
 */

import { InstructionBuilder } from './instruction-builder';
import { PriceData } from '../parsers/raydium';
import { OrcaWhirlpoolBuilder } from './orca-whirlpool-builder';
import { RaydiumCLMMBuilder } from './raydium-clmm-builder';
import { MeteoraDLMMBuilder } from './meteora-dlmm-builder';
import { LUTManager } from './lut-manager';
import { Connection, PublicKey } from '@solana/web3.js';
import { createLogger } from '@solana-arb-bot/core';

const logger = createLogger('BuilderFactory');

export class BuilderFactory {
  private static orcaBuilder: OrcaWhirlpoolBuilder = new OrcaWhirlpoolBuilder();
  private static raydiumBuilder: RaydiumCLMMBuilder = new RaydiumCLMMBuilder();
  private static meteoraBuilder: MeteoraDLMMBuilder = new MeteoraDLMMBuilder();
  private static lutManager: LUTManager | null = null;

  /**
   * 初始化LUT管理器
   * @param connection Solana连接
   * @param payer 交易支付者
   */
  static initializeLUTManager(connection: Connection, payer: PublicKey): void {
    this.lutManager = new LUTManager({
      connection,
      payer,
      expirySeconds: 3600, // 1小时过期
      maxAddresses: 256,   // 最大地址数
    });

    logger.info('LUT Manager initialized');
  }

  /**
   * 根据价格数据获取适当的构建器
   * @param pool 价格数据
   * @returns InstructionBuilder 交易构建器
   */
  static getBuilder(pool: PriceData): InstructionBuilder | null {
    if (this.orcaBuilder.canBuild(pool)) {
      logger.debug(`Selecting Orca Whirlpool builder for ${pool.poolAddress}`);
      return this.orcaBuilder;
    } else if (this.raydiumBuilder.canBuild(pool)) {
      logger.debug(`Selecting Raydium CLMM builder for ${pool.poolAddress}`);
      return this.raydiumBuilder;
    } else if (this.meteoraBuilder.canBuild(pool)) {
      logger.debug(`Selecting Meteora DLMM builder for ${pool.poolAddress}`);
      return this.meteoraBuilder;
    }

    logger.warn(`No suitable builder found for pool: ${pool.dex} (${pool.poolAddress})`);
    return null;
  }

  /**
   * 检查是否有可用的构建器
   * @param pool 价格数据
   * @returns boolean 是否有可用的构建器
   */
  static hasBuilder(pool: PriceData): boolean {
    return this.getBuilder(pool) !== null;
  }

  /**
   * 获取LUT管理器
   * @returns LUTManager 或 null（如果未初始化）
   */
  static getLUTManager(): LUTManager | null {
    return this.lutManager;
  }

  /**
   * 获取所有支持的DEX类型
   * @returns string[] 支持的DEX类型列表
   */
  static getSupportedDEXs(): string[] {
    return [
      'Orca Whirlpool',
      'Raydium CLMM',
      'Meteora DLMM'
    ];
  }
}

export default BuilderFactory;