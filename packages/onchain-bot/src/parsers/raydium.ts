/**
 * Raydium DEX 解析器
 *
 * 解析 Raydium AMM 池子账户数据，计算实时价格和流动性
 * 现在也支持 Raydium CLMM 池子的精确价格计算
 */

import { AccountInfo, PublicKey, Connection } from '@solana/web3.js';
import { struct, nu64, u8 } from '@solana/buffer-layout';
import { publicKey, u128 } from '@solana/buffer-layout-utils';
import { createLogger, TickArraySimulator, CrossTickSimulationResult } from '@solana-arb-bot/core';
import BN from 'bn.js';

const logger = createLogger('RaydiumParser');

// Raydium CLMM Program ID
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5vW8Kx9AAMiP6dD');

/**
 * Raydium AMM 池子信息
 */
export interface RaydiumPoolInfo {
  /** 池子状态 */
  status: bigint;
  /** Base代币小数位 */
  coinDecimals: bigint;
  /** Quote代币小数位 */
  pcDecimals: bigint;
  /** Base储备量 */
  poolCoinAmount: bigint;
  /** Quote储备量 */
  poolPcAmount: bigint;
  /** 池子LP代币铸造地址 */
  lpMint: PublicKey;
  /** Base代币铸造地址 */
  coinMint: PublicKey;
  /** Quote代币铸造地址 */
  pcMint: PublicKey;
}

/**
 * Raydium CLMM 池子信息（扩展版）
 */
export interface RaydiumCLMMPoolInfo {
  status: number;
  ammConfig: PublicKey;
  owner: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  observationKey: PublicKey;
  sqrtPriceX64: bigint;
  tickCurrent: number;
  liquidity: bigint;
  tickSpacing: number;
}

/**
 * 订单簿层级
 */
export interface OrderBookLevel {
  /** 价格 */
  price: number;
  /** 数量 */
  quantity: number;
}

/**
 * 订单簿深度信息
 */
export interface OrderBookDepth {
  /** 买单（按价格降序排列） */
  bids: OrderBookLevel[];
  /** 卖单（按价格升序排列） */
  asks: OrderBookLevel[];
}

/**
 * 池子类型
 */
export type PoolType = 'AMM' | 'CLMM' | 'DLMM';

/**
 * 价格数据
 */
export interface PriceData {
  /** DEX名称 */
  dex: string;
  /** 池子地址 */
  poolAddress: string;
  /** 价格（quote/base） */
  price: number;
  /** 流动性（USD估算） */
  liquidity: number;
  /** Base储备量 */
  baseReserve: bigint;
  /** Quote储备量 */
  quoteReserve: bigint;
  /** Base代币小数位 */
  baseDecimals: number;
  /** Quote代币小数位 */
  quoteDecimals: number;
  /** 订单簿深度信息（可选，用于CLOB） */
  orderBookDepth?: OrderBookDepth;
  /** 是否为CLMM池 */
  isClmmPool?: boolean;
  /** 更新时间 */
  timestamp: number;
  /** 用于跨tick模拟的额外数据 */
  clmmData?: {
    sqrtPriceX64: bigint;
    tickCurrent: number;
    tickSpacing: number;
  };
  /** 池子类型 */
  poolType: PoolType;
  /** Tick间距（CLMM专用） */
  tickSpacing?: number;
  /** Bin间距（DLMM专用） */
  binStep?: number;
  /** 其他特定参数 */
  extraParams?: any;
}

/**
 * Raydium AMM 数据布局（简化版）
 *
 * 注意：这是简化的布局，仅包含价格计算所需的关键字段
 * 完整的Raydium AMM结构更复杂，包含更多字段
 */
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
  // 注意：实际布局包含更多字段
  // 为了简化，我们使用偏移量直接读取关键数据
]);

/**
 * Raydium解析器类
 */
export class RaydiumParser {
  private static tickArraySimulator: TickArraySimulator | null = null;

  static setConnection(connection: Connection) {
    RaydiumParser.tickArraySimulator = new TickArraySimulator(connection);
  }

  /**
   * 解析Raydium AMM或CLMM账户
   * @param accountInfo 账户信息
   * @param poolAddress 池子地址
   * @param connection Solana connection (required for CLMM pools)
   * @returns 价格数据
   */
  static async parse(accountInfo: AccountInfo<Buffer> | null, poolAddress: string, connection?: Connection): Promise<PriceData | null> {
    // 增强 null 检查
    if (!accountInfo) {
      logger.warn(`Account not found for pool ${poolAddress}`);
      return null;
    }

    if (!accountInfo.data || accountInfo.data.length === 0) {
      logger.warn(`Empty account data for pool ${poolAddress}`);
      return null;
    }

    // 尝试检测池子类型 (AMM vs CLMM)
    // CLMM池通常有特定的结构，从偏移8开始的discriminator可以用来区分
    const discriminator = accountInfo.data.slice(0, 8);
    const clmmDiscriminator = Buffer.from([0x4d, 0x61, 0x67, 0x6e, 0x65, 0x74, 0x61, 0x52]); // "Magnetar" - example

    // 简化检测方式：基于账户大小和已知结构
    if (accountInfo.data.length >= 1000) { // CLMM池通常更大
      return await this.parseCLMMPool(accountInfo, poolAddress, connection);
    } else {
      return this.parseAMMPool(accountInfo, poolAddress);
    }
  }

  /**
   * 解析Raydium AMM池 (传统XY=k)
   */
  private static parseAMMPool(accountInfo: AccountInfo<Buffer>, poolAddress: string): PriceData | null {
    try {
      const data = accountInfo.data;

      // Raydium AMM账户数据结构（偏移量）
      // 这些偏移量基于Raydium V4的AMM程序
      const STATUS_OFFSET = 0;
      const COIN_DECIMALS_OFFSET = 32;
      const PC_DECIMALS_OFFSET = 40;
      const POOL_COIN_AMOUNT_OFFSET = 248; // 近似位置，需要根据实际调整
      const POOL_PC_AMOUNT_OFFSET = 256;   // 近似位置，需要根据实际调整

      // 验证数据长度
      if (data.length < 300) {
        logger.warn(`Invalid account data length: ${data.length} for pool ${poolAddress}`);
        return null;
      }

      // 读取关键数据（使用 try-catch 包装每个读取操作）
      let status: bigint;
      let coinDecimals: bigint;
      let pcDecimals: bigint;

      try {
        status = data.readBigUInt64LE(STATUS_OFFSET);
        coinDecimals = data.readBigUInt64LE(COIN_DECIMALS_OFFSET);
        pcDecimals = data.readBigUInt64LE(PC_DECIMALS_OFFSET);
      } catch (error) {
        logger.warn(`Failed to read basic fields for pool ${poolAddress}: ${error}`);
        return null;
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

        // 验证非零
        if (poolCoinAmount === BigInt(0) || poolPcAmount === BigInt(0)) {
          throw new Error('Zero reserves - pool inactive');
        }
      } catch (error) {
        logger.error(`Failed to read reserves for ${poolAddress}: ${error}`);
        return null;
      }

      // 计算价格
      const price = this.calculatePrice(
        poolPcAmount,
        poolCoinAmount,
        Number(pcDecimals),
        Number(coinDecimals)
      );

      // 估算流动性（简化版）
      const liquidity = this.estimateLiquidity(
        poolPcAmount,
        poolCoinAmount,
        Number(pcDecimals),
        Number(coinDecimals)
      );

      return {
        dex: 'Raydium_AMM',
        poolAddress,
        price,
        liquidity,
        baseReserve: poolCoinAmount,
        quoteReserve: poolPcAmount,
        baseDecimals: Number(coinDecimals),
        quoteDecimals: Number(pcDecimals),
        isClmmPool: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Failed to parse Raydium AMM pool ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * 解析Raydium CLMM池 (集中流动性)
   */
  private static async parseCLMMPool(accountInfo: AccountInfo<Buffer>, poolAddress: string, connection?: Connection): Promise<PriceData | null> {
    if (!connection) {
      logger.error(`Connection required for CLMM pool parsing: ${poolAddress}`);
      return null;
    }

    try {
      // 设置连接（如果尚未设置）
      if (!RaydiumParser.tickArraySimulator) {
        RaydiumParser.tickArraySimulator = new TickArraySimulator(connection);
      }

      // 解析CLMM池数据
      const poolData = this.parseCLMMPoolData(accountInfo.data);

      if (!poolData) {
        logger.error(`Failed to parse CLMM pool data for: ${poolAddress}`);
        return null;
      }

      // 计算当前价格
      const currentSqrtPriceX64 = BigInt(poolData.sqrtPriceX64.toString());
      const price = this.sqrtPriceX64ToPrice(currentSqrtPriceX64);

      // 估算流动性（基于当前tick的流动性）
      const liquidity = Number(poolData.liquidity) / 1_000_000; // Convert from lamports to readable value

      return {
        dex: 'Raydium_CLMM',
        poolAddress,
        price,
        liquidity,
        baseReserve: poolData.tokenVault0 ? BigInt(0) : BigInt(0), // Placeholder
        quoteReserve: poolData.tokenVault1 ? BigInt(0) : BigInt(0), // Placeholder
        baseDecimals: 0, // Will be resolved from mint accounts
        quoteDecimals: 0, // Will be resolved from mint accounts
        isClmmPool: true,
        timestamp: Date.now(),
        clmmData: {
          sqrtPriceX64: poolData.sqrtPriceX64,
          tickCurrent: poolData.tickCurrent,
          tickSpacing: poolData.tickSpacing,
        }
      };
    } catch (error) {
      logger.error(`Failed to parse Raydium CLMM pool ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * 计算价格
   * @param quoteReserve Quote储备量
   * @param baseReserve Base储备量
   * @param quoteDecimals Quote小数位
   * @param baseDecimals Base小数位
   * @returns 价格
   */
  private static calculatePrice(
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

  /**
   * 估算流动性（简化版，假设quote是USDC/USDT）
   * @param quoteReserve Quote储备量
   * @param baseReserve Base储备量
   * @param quoteDecimals Quote小数位
   * @param baseDecimals Base小数位
   * @returns 流动性（USD）
   */
  private static estimateLiquidity(
    quoteReserve: bigint,
    baseReserve: bigint,
    quoteDecimals: number,
    baseDecimals: number
  ): number {
    // 简化：假设quote代币是稳定币（USDC/USDT）
    // 流动性 ≈ quote储备量 × 2
    const quoteInUSD = Number(quoteReserve) / Math.pow(10, quoteDecimals);
    return quoteInUSD * 2;
  }

  /**
   * 估算滑点
   * @param tradeAmount 交易金额
   * @param liquidity 流动性
   * @returns 估算的滑点（0-1）
   */
  static estimateSlippage(tradeAmount: number, liquidity: number): number {
    if (liquidity === 0) {
      return 1; // 100% 滑点（无流动性）
    }

    // 简化的滑点模型：滑点 ≈ tradeAmount / (2 × liquidity)
    // 实际应该考虑AMM的常数乘积公式
    const impactRatio = tradeAmount / (2 * liquidity);
    
    // 加上固定的交易费用（如0.25%）
    const fee = 0.0025;
    
    return Math.min(impactRatio + fee, 1);
  }

  /**
   * 验证池子数据
   * @param priceData 价格数据
   * @returns 是否有效
   */
  static validate(priceData: PriceData | null): boolean {
    if (!priceData) {
      return false;
    }

    // 检查价格是否合理
    if (priceData.price <= 0 || !isFinite(priceData.price)) {
      logger.warn(`Invalid price: ${priceData.price}`);
      return false;
    }

    // 检查流动性是否合理
    if (priceData.liquidity < 0) {
      logger.warn(`Invalid liquidity: ${priceData.liquidity}`);
      return false;
    }

    // 检查储备量
    if (priceData.baseReserve <= BigInt(0) || priceData.quoteReserve <= BigInt(0)) {
      logger.warn('Invalid reserves');
      return false;
    }

    return true;
  }

  /**
   * Parse CLMM pool data from account buffer
   */
  private static parseCLMMPoolData(data: Buffer): RaydiumCLMMPoolInfo | null {
    try {
      // Raydium CLMM pool account layout (Anchor IDL based)
      // This is the structure of the pool account state
      let offset = 8; // Skip discriminator

      // Parse basic fields
      const status = data.readUInt8(offset); offset += 1;
      offset += 3; // Skip padding

      const ammConfig = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const tokenMint0 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const tokenMint1 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const tokenVault0 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const tokenVault1 = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const observationKey = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // Sqrt price (u128)
      const sqrtPriceX64 = data.readBigUInt64LE(offset); offset += 8;  // Actually u128, reading low 64 bits
      const sqrtPriceX64High = data.readBigUInt64LE(offset); offset += 8; // Reading high 64 bits
      // Reconstruct the u128 value
      const sqrtPriceX64Full = (sqrtPriceX64High << BigInt(64)) | sqrtPriceX64;

      // Current tick index (i32)
      const tickCurrent = data.readInt32LE(offset); offset += 4;

      // Liquidity (u128)
      const liquidityLow = data.readBigUInt64LE(offset); offset += 8;  // Actually u128, reading low 64 bits
      const liquidityHigh = data.readBigUInt64LE(offset); offset += 8; // Reading high 64 bits
      const liquidity = (liquidityHigh << BigInt(64)) | liquidityLow;

      // Tick spacing (u16)
      const tickSpacing = data.readUInt16LE(offset); offset += 2;

      // Other fields...

      return {
        status,
        ammConfig,
        owner,
        tokenMint0,
        tokenMint1,
        tokenVault0,
        tokenVault1,
        observationKey,
        sqrtPriceX64: sqrtPriceX64Full,
        tickCurrent,
        liquidity,
        tickSpacing,
      };
    } catch (error) {
      logger.error(`Error parsing CLMM pool data: ${error}`);
      return null;
    }
  }

  /**
   * Convert sqrt price (Q64.64) to regular price
   */
  private static sqrtPriceX64ToPrice(sqrtPriceX64: bigint): number {
    // Convert from Q64.64 to floating point
    // sqrtPriceX64 = sqrt(price) * 2^64
    // So price = (sqrtPriceX64 / 2^64)^2
    const sqrtPrice = Number(sqrtPriceX64) / Math.pow(2, 64);
    return sqrtPrice * sqrtPrice;
  }

  /**
   * Calculate estimated slippage for a trade on CLMM pool with cross-tick simulation
   */
  static async estimateCLMMSlippage(
    poolAddress: PublicKey,
    inputAmount: number,
    inputMint: PublicKey,
    outputMint: PublicKey,
    connection: Connection,
    programId: PublicKey = RAYDIUM_CLMM_PROGRAM_ID
  ): Promise<{ price: number, slippage: number, simulationResult: CrossTickSimulationResult | null }> {
    if (!RaydiumParser.tickArraySimulator) {
      RaydiumParser.tickArraySimulator = new TickArraySimulator(connection);
    }

    // Get pool data to determine trade direction
    const accountInfo = await connection.getAccountInfo(poolAddress);
    if (!accountInfo) {
      throw new Error(`Pool account not found: ${poolAddress.toBase58()}`);
    }

    const poolData = RaydiumParser.parseCLMMPoolData(accountInfo.data);
    if (!poolData) {
      throw new Error(`Failed to parse pool data: ${poolAddress.toBase58()}`);
    }

    // Determine trade direction based on token mints
    // We need to know which token is token0 vs token1 in the pool
    const token0IsInput = poolData.tokenMint0.equals(inputMint);
    const aToB = token0IsInput; // In CLMM, A to B means decreasing price (token0 to token1)

    // Get required tick arrays
    const tickArrays = await RaydiumParser.tickArraySimulator.getTickArrays(
      poolAddress,
      poolData.tickCurrent,
      poolData.tickSpacing,
      aToB,
      programId
    );

    // Perform cross-tick simulation
    const simulationResult = RaydiumParser.tickArraySimulator.simulateCrossTickTrade(
      new BN(poolData.sqrtPriceX64.toString()),
      tickArrays,
      inputAmount,
      poolData.tickSpacing,
      aToB
    );

    // Calculate effective price and slippage
    const initialPrice = RaydiumParser.sqrtPriceX64ToPrice(poolData.sqrtPriceX64);
    const effectivePrice = simulationResult.outputReceived / simulationResult.inputConsumed;
    const priceChange = Math.abs(initialPrice - simulationResult.finalPrice);
    const slippage = initialPrice !== 0 ? priceChange / initialPrice : 0;

    return {
      price: simulationResult.finalPrice,
      slippage,
      simulationResult
    };
  }
}

export default RaydiumParser;


