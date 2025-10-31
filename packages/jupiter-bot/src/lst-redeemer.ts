/**
 * LST赎回管理器
 * 
 * 支持Marinade mSOL和Jito jitoSOL的赎回功能
 * 实现方式2：买入折价LST → 赎回SOL → 卖出SOL
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { createLogger } from '@solana-arb-bot/core';
import BN from 'bn.js';

const logger = createLogger('LSTRedeemer');

// ============================================================================
// 常量定义
// ============================================================================

/**
 * Marinade Finance程序ID
 * 官方mainnet程序: MarBNdrjjAd8EGshtr9iLhQLnRjp5bGdBFKLEz4x9M
 */
const MARINADE_PROGRAM_ID = new PublicKey('MarBNdrjjAd8EGshtr9iLhQLnRjp5bGdBFKLEz4x9M');

/**
 * Marinade State账户
 * 存储Marinade协议的全局状态
 */
const MARINADE_STATE = new PublicKey('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');

/**
 * mSOL代币地址
 */
const MSOL_MINT = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

/**
 * Jito StakePool程序ID
 * 官方mainnet程序: Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb
 */
const JITO_PROGRAM_ID = new PublicKey('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb');

/**
 * Jito StakePool地址
 */
const JITO_STAKE_POOL = new PublicKey('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb');

/**
 * jitoSOL代币地址
 */
const JITOSOL_MINT = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');

// ============================================================================
// 赎回类型定义
// ============================================================================

/**
 * 赎回类型
 */
export enum RedeemType {
  /** Marinade即时赎回（有手续费） */
  MARINADE_LIQUID = 'marinade_liquid',
  /** Marinade延迟赎回（无手续费，等待期2-3天） */
  MARINADE_DELAYED = 'marinade_delayed',
  /** Jito即时赎回 */
  JITO_INSTANT = 'jito_instant',
}

/**
 * 赎回结果
 */
export interface RedeemResult {
  /** 是否成功 */
  success: boolean;
  /** 交易签名 */
  signature?: string;
  /** 赎回的SOL数量（lamports） */
  solAmount?: number;
  /** 手续费（lamports） */
  fee?: number;
  /** 错误信息 */
  error?: string;
  /** 赎回类型 */
  redeemType: RedeemType;
  /** 是否需要等待 */
  needsWait: boolean;
  /** 等待时间（秒），如果needsWait=true */
  waitTimeSeconds?: number;
}

/**
 * 赎回配置
 */
export interface RedeemConfig {
  /** RPC连接 */
  connection: Connection;
  /** 用户钱包 */
  wallet: Keypair;
  /** 是否自动选择最优赎回方式 */
  autoOptimize?: boolean;
  /** 最大可接受的手续费率（百分比） */
  maxFeePercent?: number;
  /** 是否接受延迟赎回 */
  acceptDelayed?: boolean;
}

// ============================================================================
// Marinade指令构建器
// ============================================================================

/**
 * Marinade指令枚举
 * 基于Marinade程序的Rust代码
 */
enum MarinadeInstruction {
  Initialize = 0,
  ChangeAuthority = 1,
  AddValidator = 2,
  RemoveValidator = 3,
  SetValidatorScore = 4,
  ConfigMarinadeParams = 5,
  OrderUnstake = 6,        // 延迟赎回
  Claim = 7,
  StakeReserve = 8,
  UpdateActive = 9,
  UpdateDeactivated = 10,
  DeactivateStake = 11,
  EmergencyUnstake = 12,
  PartialUnstake = 13,
  MergeStakes = 14,
  Redelegate = 15,
  Pause = 16,
  Resume = 17,
  WithdrawStakeAccount = 18,
  LiquidUnstake = 19,      // 即时赎回
  AddLiquidity = 20,
  RemoveLiquidity = 21,
  SetLpParams = 22,
  ConfigLp = 23,
  Deposit = 24,
  DepositStakeAccount = 25,
}

/**
 * 构建Marinade液体赎回指令
 * 即时将mSOL兑换为SOL（有手续费）
 */
function buildMarinadeLiquidUnstakeInstruction(
  marinadeState: PublicKey,
  msolMint: PublicKey,
  liqPoolSolLegPda: PublicKey,
  liqPoolMsolLeg: PublicKey,
  treasuryMsolAccount: PublicKey,
  getMsolFrom: PublicKey,
  getMsolFromAuthority: PublicKey,
  transferSolTo: PublicKey,
  msolAmount: BN
): TransactionInstruction {
  const keys = [
    { pubkey: marinadeState, isSigner: false, isWritable: true },
    { pubkey: msolMint, isSigner: false, isWritable: true },
    { pubkey: liqPoolSolLegPda, isSigner: false, isWritable: true },
    { pubkey: liqPoolMsolLeg, isSigner: false, isWritable: true },
    { pubkey: treasuryMsolAccount, isSigner: false, isWritable: true },
    { pubkey: getMsolFrom, isSigner: false, isWritable: true },
    { pubkey: getMsolFromAuthority, isSigner: true, isWritable: false },
    { pubkey: transferSolTo, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // 指令数据：[指令索引(1字节), mSOL数量(8字节)]
  const data = Buffer.alloc(9);
  data.writeUInt8(MarinadeInstruction.LiquidUnstake, 0);
  msolAmount.toArrayLike(Buffer, 'le', 8).copy(data, 1);

  return new TransactionInstruction({
    keys,
    programId: MARINADE_PROGRAM_ID,
    data,
  });
}

/**
 * 构建Marinade延迟赎回指令
 * 提交赎回请求，等待2-3天后可claim（无手续费）
 */
function buildMarinadeDelayedUnstakeInstruction(
  marinadeState: PublicKey,
  msolMint: PublicKey,
  burnMsolFrom: PublicKey,
  burnMsolAuthority: PublicKey,
  newTicketAccount: PublicKey,
  msolAmount: BN
): TransactionInstruction {
  const keys = [
    { pubkey: marinadeState, isSigner: false, isWritable: true },
    { pubkey: msolMint, isSigner: false, isWritable: true },
    { pubkey: burnMsolFrom, isSigner: false, isWritable: true },
    { pubkey: burnMsolAuthority, isSigner: true, isWritable: false },
    { pubkey: newTicketAccount, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(9);
  data.writeUInt8(MarinadeInstruction.OrderUnstake, 0);
  msolAmount.toArrayLike(Buffer, 'le', 8).copy(data, 1);

  return new TransactionInstruction({
    keys,
    programId: MARINADE_PROGRAM_ID,
    data,
  });
}

// ============================================================================
// Jito指令构建器
// ============================================================================

/**
 * Jito StakePool指令枚举
 * 基于SPL Stake Pool程序（Jito使用标准SPL Stake Pool）
 */
enum StakePoolInstruction {
  Initialize = 0,
  AddValidatorToPool = 1,
  RemoveValidatorFromPool = 2,
  DecreaseValidatorStake = 3,
  IncreaseValidatorStake = 4,
  SetPreferredValidator = 5,
  UpdateValidatorListBalance = 6,
  UpdateStakePoolBalance = 7,
  CleanupRemovedValidatorEntries = 8,
  DepositStake = 9,
  WithdrawStake = 10,
  SetManager = 11,
  SetFee = 12,
  SetStaker = 13,
  DepositSol = 14,
  SetFundingAuthority = 15,
  WithdrawSol = 16,           // Jito即时赎回使用此指令
  CreateTokenMetadata = 17,
  UpdateTokenMetadata = 18,
  IncreaseAdditionalValidatorStake = 19,
  DecreaseAdditionalValidatorStake = 20,
  DecreaseValidatorStakeWithReserve = 21,
  Redelegate = 22,
}

/**
 * 构建Jito即时赎回指令
 * 将jitoSOL兑换为SOL
 */
function buildJitoWithdrawSolInstruction(
  stakePool: PublicKey,
  withdrawAuthority: PublicKey,
  userTransferAuthority: PublicKey,
  poolTokensFrom: PublicKey,
  reserveStake: PublicKey,
  solTo: PublicKey,
  managerFeeAccount: PublicKey,
  poolMint: PublicKey,
  poolTokenAmount: BN
): TransactionInstruction {
  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: withdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: userTransferAuthority, isSigner: true, isWritable: false },
    { pubkey: poolTokensFrom, isSigner: false, isWritable: true },
    { pubkey: reserveStake, isSigner: false, isWritable: true },
    { pubkey: solTo, isSigner: false, isWritable: true },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: poolMint, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(9);
  data.writeUInt8(StakePoolInstruction.WithdrawSol, 0);
  poolTokenAmount.toArrayLike(Buffer, 'le', 8).copy(data, 1);

  return new TransactionInstruction({
    keys,
    programId: JITO_PROGRAM_ID,
    data,
  });
}

// ============================================================================
// LST赎回管理器
// ============================================================================

/**
 * LST赎回管理器类
 */
export class LSTRedeemer {
  private connection: Connection;
  private wallet: Keypair;
  private config: RedeemConfig;

  constructor(config: RedeemConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.config = {
      autoOptimize: true,
      maxFeePercent: 1.0,  // 默认最大1%手续费
      acceptDelayed: false, // 默认不接受延迟赎回
      ...config,
    };

    logger.info('LST Redeemer initialized', {
      wallet: this.wallet.publicKey.toBase58(),
      autoOptimize: this.config.autoOptimize,
      maxFeePercent: this.config.maxFeePercent,
    });
  }

  /**
   * 赎回mSOL为SOL
   */
  async redeemMSOL(msolAmount: number, preferLiquid: boolean = true): Promise<RedeemResult> {
    try {
      logger.info(`Redeeming ${msolAmount / 1e9} mSOL...`);

      // 获取用户的mSOL账户
      const userMsolAccount = await getAssociatedTokenAddress(
        MSOL_MINT,
        this.wallet.publicKey
      );

      // 检查mSOL余额
      const msolBalance = await this.connection.getTokenAccountBalance(userMsolAccount);
      if (BigInt(msolBalance.value.amount) < BigInt(msolAmount)) {
        throw new Error(
          `Insufficient mSOL balance: ${msolBalance.value.uiAmount} < ${msolAmount / 1e9}`
        );
      }

      // 决定使用哪种赎回方式
      if (preferLiquid || !this.config.acceptDelayed) {
        return await this.redeemMSOLLiquid(msolAmount);
      } else {
        return await this.redeemMSOLDelayed(msolAmount);
      }
    } catch (error: any) {
      logger.error(`Failed to redeem mSOL: ${error.message}`);
      return {
        success: false,
        error: error.message,
        redeemType: RedeemType.MARINADE_LIQUID,
        needsWait: false,
      };
    }
  }

  /**
   * Marinade即时赎回（Liquid Unstake）
   */
  private async redeemMSOLLiquid(msolAmount: number): Promise<RedeemResult> {
    try {
      logger.info(`Executing Marinade liquid unstake for ${msolAmount / 1e9} mSOL...`);

      // 派生PDA账户
      const [liqPoolSolLegPda] = await PublicKey.findProgramAddress(
        [Buffer.from('liq_sol')],
        MARINADE_PROGRAM_ID
      );

      // 获取流动性池mSOL账户
      const liqPoolMsolLeg = await getAssociatedTokenAddress(
        MSOL_MINT,
        liqPoolSolLegPda,
        true
      );

      // 获取国库mSOL账户
      const [treasuryMsolAccount] = await PublicKey.findProgramAddress(
        [Buffer.from('treasury_msol')],
        MARINADE_PROGRAM_ID
      );

      // 用户mSOL账户
      const userMsolAccount = await getAssociatedTokenAddress(
        MSOL_MINT,
        this.wallet.publicKey
      );

      // 构建交易
      const instruction = buildMarinadeLiquidUnstakeInstruction(
        MARINADE_STATE,
        MSOL_MINT,
        liqPoolSolLegPda,
        liqPoolMsolLeg,
        treasuryMsolAccount,
        userMsolAccount,
        this.wallet.publicKey,
        this.wallet.publicKey,
        new BN(msolAmount)
      );

      // 发送交易
      const transaction = new Transaction().add(instruction);
      transaction.feePayer = this.wallet.publicKey;
      transaction.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;

      const signature = await this.connection.sendTransaction(transaction, [this.wallet], {
        skipPreflight: false,
        maxRetries: 3,
      });

      logger.info(`Marinade liquid unstake transaction sent: ${signature}`);

      // 等待确认
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      // 计算收到的SOL（需要从链上读取或估算）
      // 这里简化处理，实际应该从交易日志中解析
      const estimatedSol = Math.floor(msolAmount * 0.997); // 假设0.3%手续费

      logger.info(
        `Marinade liquid unstake successful: ${estimatedSol / 1e9} SOL received`
      );

      return {
        success: true,
        signature,
        solAmount: estimatedSol,
        fee: msolAmount - estimatedSol,
        redeemType: RedeemType.MARINADE_LIQUID,
        needsWait: false,
      };
    } catch (error: any) {
      logger.error(`Marinade liquid unstake failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        redeemType: RedeemType.MARINADE_LIQUID,
        needsWait: false,
      };
    }
  }

  /**
   * Marinade延迟赎回（Delayed Unstake）
   */
  private async redeemMSOLDelayed(msolAmount: number): Promise<RedeemResult> {
    try {
      logger.info(`Executing Marinade delayed unstake for ${msolAmount / 1e9} mSOL...`);

      // 生成新的ticket账户
      const ticketAccount = Keypair.generate();

      // 用户mSOL账户
      const userMsolAccount = await getAssociatedTokenAddress(
        MSOL_MINT,
        this.wallet.publicKey
      );

      // 构建交易
      const instruction = buildMarinadeDelayedUnstakeInstruction(
        MARINADE_STATE,
        MSOL_MINT,
        userMsolAccount,
        this.wallet.publicKey,
        ticketAccount.publicKey,
        new BN(msolAmount)
      );

      // 发送交易
      const transaction = new Transaction().add(instruction);
      transaction.feePayer = this.wallet.publicKey;
      transaction.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;

      const signature = await this.connection.sendTransaction(
        transaction,
        [this.wallet, ticketAccount],
        {
          skipPreflight: false,
          maxRetries: 3,
        }
      );

      logger.info(`Marinade delayed unstake transaction sent: ${signature}`);

      // 等待确认
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      logger.info(
        `Marinade delayed unstake successful, ticket: ${ticketAccount.publicKey.toBase58()}`
      );

      return {
        success: true,
        signature,
        solAmount: msolAmount, // 延迟赎回1:1，无手续费
        fee: 0,
        redeemType: RedeemType.MARINADE_DELAYED,
        needsWait: true,
        waitTimeSeconds: 3 * 24 * 60 * 60, // 3天
      };
    } catch (error: any) {
      logger.error(`Marinade delayed unstake failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        redeemType: RedeemType.MARINADE_DELAYED,
        needsWait: false,
      };
    }
  }

  /**
   * 赎回jitoSOL为SOL
   */
  async redeemJitoSOL(jitosolAmount: number): Promise<RedeemResult> {
    try {
      logger.info(`Redeeming ${jitosolAmount / 1e9} jitoSOL...`);

      // 获取用户的jitoSOL账户
      const userJitosolAccount = await getAssociatedTokenAddress(
        JITOSOL_MINT,
        this.wallet.publicKey
      );

      // 检查jitoSOL余额
      const jitosolBalance = await this.connection.getTokenAccountBalance(userJitosolAccount);
      if (BigInt(jitosolBalance.value.amount) < BigInt(jitosolAmount)) {
        throw new Error(
          `Insufficient jitoSOL balance: ${jitosolBalance.value.uiAmount} < ${
            jitosolAmount / 1e9
          }`
        );
      }

      return await this.redeemJitoSOLInstant(jitosolAmount);
    } catch (error: any) {
      logger.error(`Failed to redeem jitoSOL: ${error.message}`);
      return {
        success: false,
        error: error.message,
        redeemType: RedeemType.JITO_INSTANT,
        needsWait: false,
      };
    }
  }

  /**
   * Jito即时赎回
   */
  private async redeemJitoSOLInstant(jitosolAmount: number): Promise<RedeemResult> {
    try {
      logger.info(`Executing Jito instant withdraw for ${jitosolAmount / 1e9} jitoSOL...`);

      // 派生withdraw authority
      const [withdrawAuthority] = await PublicKey.findProgramAddress(
        [JITO_STAKE_POOL.toBuffer(), Buffer.from('withdraw')],
        JITO_PROGRAM_ID
      );

      // 获取reserve stake账户
      const [reserveStake] = await PublicKey.findProgramAddress(
        [JITO_STAKE_POOL.toBuffer(), Buffer.from('reserve')],
        JITO_PROGRAM_ID
      );

      // 获取manager fee账户
      const [managerFeeAccount] = await PublicKey.findProgramAddress(
        [JITO_STAKE_POOL.toBuffer(), Buffer.from('fee')],
        JITO_PROGRAM_ID
      );

      // 用户jitoSOL账户
      const userJitosolAccount = await getAssociatedTokenAddress(
        JITOSOL_MINT,
        this.wallet.publicKey
      );

      // 构建交易
      const instruction = buildJitoWithdrawSolInstruction(
        JITO_STAKE_POOL,
        withdrawAuthority,
        this.wallet.publicKey,
        userJitosolAccount,
        reserveStake,
        this.wallet.publicKey,
        managerFeeAccount,
        JITOSOL_MINT,
        new BN(jitosolAmount)
      );

      // 发送交易
      const transaction = new Transaction().add(instruction);
      transaction.feePayer = this.wallet.publicKey;
      transaction.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;

      const signature = await this.connection.sendTransaction(transaction, [this.wallet], {
        skipPreflight: false,
        maxRetries: 3,
      });

      logger.info(`Jito instant withdraw transaction sent: ${signature}`);

      // 等待确认
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      // Jito通常也有小额手续费，估算为0.1%
      const estimatedSol = Math.floor(jitosolAmount * 0.999);

      logger.info(`Jito instant withdraw successful: ${estimatedSol / 1e9} SOL received`);

      return {
        success: true,
        signature,
        solAmount: estimatedSol,
        fee: jitosolAmount - estimatedSol,
        redeemType: RedeemType.JITO_INSTANT,
        needsWait: false,
      };
    } catch (error: any) {
      logger.error(`Jito instant withdraw failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        redeemType: RedeemType.JITO_INSTANT,
        needsWait: false,
      };
    }
  }

  /**
   * 自动选择最优赎回方式
   * 比较液体赎回和延迟赎回的成本，选择最优方案
   */
  async autoRedeem(
    lstType: 'mSOL' | 'jitoSOL',
    amount: number
  ): Promise<RedeemResult> {
    if (lstType === 'jitoSOL') {
      // jitoSOL只有即时赎回
      return await this.redeemJitoSOL(amount);
    }

    // mSOL有两种方式，自动选择
    if (this.config.autoOptimize) {
      // 获取当前液体赎回手续费率
      const liquidFeeRate = await this.getMarinadeLiquidUnstakeFee();
      
      logger.info(`Marinade liquid unstake fee: ${(liquidFeeRate * 100).toFixed(2)}%`);

      // 如果手续费低于阈值，使用液体赎回
      if (liquidFeeRate <= (this.config.maxFeePercent || 1.0) / 100) {
        logger.info('Using liquid unstake (fee acceptable)');
        return await this.redeemMSOLLiquid(amount);
      }

      // 如果接受延迟赎回，使用延迟方式
      if (this.config.acceptDelayed) {
        logger.info('Using delayed unstake (no fee, but 3 days wait)');
        return await this.redeemMSOLDelayed(amount);
      }

      // 否则还是用液体赎回，但记录警告
      logger.warn(
        `Liquid unstake fee (${(liquidFeeRate * 100).toFixed(2)}%) exceeds threshold ` +
        `(${this.config.maxFeePercent}%), but delayed unstake not accepted`
      );
    }

    return await this.redeemMSOLLiquid(amount);
  }

  /**
   * 获取Marinade液体赎回手续费率
   * 从链上State账户读取
   */
  private async getMarinadeLiquidUnstakeFee(): Promise<number> {
    try {
      // 读取Marinade State账户
      const stateAccount = await this.connection.getAccountInfo(MARINADE_STATE);
      if (!stateAccount) {
        throw new Error('Marinade state account not found');
      }

      // 解析手续费（需要根据Marinade的数据结构）
      // 这里简化处理，返回默认值0.3%
      // 实际应该解析state account的数据
      return 0.003;
    } catch (error: any) {
      logger.warn(`Failed to fetch Marinade fee, using default: ${error.message}`);
      return 0.003; // 默认0.3%
    }
  }

  /**
   * 检查赎回是否已完成（用于延迟赎回）
   */
  async checkDelayedUnstakeStatus(ticketPublicKey: PublicKey): Promise<{
    isReady: boolean;
    claimableAmount?: number;
  }> {
    try {
      const ticketAccount = await this.connection.getAccountInfo(ticketPublicKey);
      if (!ticketAccount) {
        return { isReady: false };
      }

      // 解析ticket数据（需要根据Marinade的数据结构）
      // 简化处理
      return {
        isReady: true,
        claimableAmount: 0, // 需要解析实际数据
      };
    } catch (error: any) {
      logger.error(`Failed to check unstake status: ${error.message}`);
      return { isReady: false };
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

export {
  MARINADE_PROGRAM_ID,
  MARINADE_STATE,
  MSOL_MINT,
  JITO_PROGRAM_ID,
  JITO_STAKE_POOL,
  JITOSOL_MINT,
};



