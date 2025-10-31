/**
 * Solend Address Lookup Table Manager
 * 
 * 管理Solend闪电贷的Address Lookup Table (ALT)，用于压缩交易大小
 * 
 * 核心功能：
 * 1. 创建包含Solend账户的ALT
 * 2. 扩展ALT（添加新的Solend储备账户）
 * 3. 加载和缓存ALT账户
 * 4. 自动检测和初始化ALT
 */

import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createLogger } from '../logger';
import { SOLEND_RESERVES } from './solend-adapter';

const logger = createLogger('SolendALTManager');

/**
 * Solend Program ID
 */
const SOLEND_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');

/**
 * Solend ALT配置键（存储在本地，避免每次重新创建）
 */
const SOLEND_ALT_CONFIG_KEY = 'solend_alt_address';

/**
 * Solend ALT管理器
 */
export class SolendALTManager {
  private connection: Connection;
  private payer: Keypair;
  private altAddress: PublicKey | null = null;
  private altAccount: AddressLookupTableAccount | null = null;
  private initPromise: Promise<void> | null = null;
  private dryRun: boolean = false;

  constructor(connection: Connection, payer: Keypair, dryRun: boolean = false) {
    this.connection = connection;
    this.payer = payer;
    this.dryRun = dryRun;
  }

  /**
   * 初始化ALT（创建或加载现有的）
   */
  async initialize(): Promise<void> {
    // 避免重复初始化
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    logger.info('🔧 Initializing Solend ALT...');

    // 1. 尝试从环境变量或配置文件加载现有ALT地址
    const existingAltAddress = process.env.SOLEND_ALT_ADDRESS;
    
    if (existingAltAddress) {
      try {
        this.altAddress = new PublicKey(existingAltAddress);
        logger.info(`✅ Using existing Solend ALT: ${this.altAddress.toBase58()}`);
        
        // 加载ALT账户数据
        await this.loadALT();
        return;
      } catch (error: any) {
        logger.warn(`⚠️ Failed to load existing ALT: ${error.message}, creating new one...`);
      }
    }

    // 2. 如果没有现有ALT，创建新的
    await this.createAndExtendALT();
  }

  /**
   * 创建新的ALT并添加所有Solend账户
   */
  private async createAndExtendALT(): Promise<void> {
    try {
      // 🔒 安全检查：在 dryRun 模式下跳过 ALT 创建（避免消耗 gas）
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would create Solend ALT with ${this.collectSolendAddresses().length} addresses`);
        // 设置一个虚拟地址用于测试（不会实际使用）
        this.altAddress = new PublicKey('11111111111111111111111111111111');
        return;
      }

      logger.info('🆕 Creating new Solend ALT...');

      // 获取当前slot
      const slot = await this.connection.getSlot();

      // 创建ALT指令
      const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
        authority: this.payer.publicKey,
        payer: this.payer.publicKey,
        recentSlot: slot,
      });

      this.altAddress = altAddress;
      logger.info(`📋 ALT address will be: ${altAddress.toBase58()}`);

      // 收集所有Solend账户地址
      const solendAddresses = this.collectSolendAddresses();
      logger.info(`📦 Collected ${solendAddresses.length} Solend addresses to add`);

      // 创建扩展指令（分批，每批最多20个地址）
      const extendInstructions = [];
      const batchSize = 20;
      
      for (let i = 0; i < solendAddresses.length; i += batchSize) {
        const batch = solendAddresses.slice(i, i + batchSize);
        const extendIx = AddressLookupTableProgram.extendLookupTable({
          payer: this.payer.publicKey,
          authority: this.payer.publicKey,
          lookupTable: altAddress,
          addresses: batch,
        });
        extendInstructions.push(extendIx);
      }

      // 发送创建ALT的交易
      logger.info('📤 Sending create ALT transaction...');
      const createTx = await this.buildAndSendTransaction([createIx]);
      logger.info(`✅ ALT created: ${createTx}`);

      // 等待1个slot（warmup period）
      logger.info('⏳ Waiting for warmup period (1 slot)...');
      await this.waitForSlots(1);

      // 发送扩展ALT的交易（可能需要多笔）
      for (let i = 0; i < extendInstructions.length; i++) {
        logger.info(`📤 Extending ALT (batch ${i + 1}/${extendInstructions.length})...`);
        const extendTx = await this.buildAndSendTransaction([extendInstructions[i]]);
        logger.info(`✅ ALT extended: ${extendTx}`);
      }

      // 再次等待warmup
      logger.info('⏳ Waiting for final warmup...');
      await this.waitForSlots(1);

      // 加载ALT账户
      await this.loadALT();

      // 保存ALT地址到环境变量提示
      logger.info('');
      logger.info('🎉 Solend ALT created successfully!');
      logger.info('');
      logger.info('💡 To avoid recreating the ALT next time, add this to your .env:');
      logger.info(`   SOLEND_ALT_ADDRESS=${altAddress.toBase58()}`);
      logger.info('');

    } catch (error: any) {
      logger.error(`❌ Failed to create Solend ALT: ${error.message}`);
      throw error;
    }
  }

  /**
   * 收集所有Solend相关地址
   */
  private collectSolendAddresses(): PublicKey[] {
    const addresses = new Set<string>();

    // 添加Solend Program ID
    addresses.add(SOLEND_PROGRAM_ID.toBase58());

    // 添加Token Program ID（闪电贷必需）
    addresses.add(TOKEN_PROGRAM_ID.toBase58());

    // 添加系统Sysvar账户（闪电贷必需）
    addresses.add(SYSVAR_CLOCK_PUBKEY.toBase58());
    addresses.add(SYSVAR_RENT_PUBKEY.toBase58());

    // 添加所有储备的地址
    for (const reserve of Object.values(SOLEND_RESERVES)) {
      addresses.add(reserve.address.toBase58());
      addresses.add(reserve.liquiditySupply.toBase58());
      addresses.add(reserve.liquidityFeeReceiver.toBase58());
      addresses.add(reserve.lendingMarket.toBase58());
      addresses.add(reserve.lendingMarketAuthority.toBase58());
    }

    // 转换为PublicKey数组并去重
    return Array.from(addresses).map(addr => new PublicKey(addr));
  }

  /**
   * 加载ALT账户数据
   */
  private async loadALT(): Promise<void> {
    if (!this.altAddress) {
      throw new Error('ALT address not set');
    }

    try {
      const accountInfo = await this.connection.getAccountInfo(this.altAddress);
      
      if (!accountInfo) {
        throw new Error('ALT account not found');
      }

      this.altAccount = new AddressLookupTableAccount({
        key: this.altAddress,
        state: AddressLookupTableAccount.deserialize(accountInfo.data),
      });

      logger.info(
        `✅ Loaded Solend ALT: ${this.altAddress.toBase58().slice(0, 8)}... ` +
        `(${this.altAccount.state.addresses.length} addresses)`
      );

    } catch (error: any) {
      logger.error(`❌ Failed to load ALT: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取ALT账户（用于构建交易）
   */
  getALTAccount(): AddressLookupTableAccount | null {
    return this.altAccount;
  }

  /**
   * 获取ALT地址
   */
  getALTAddress(): PublicKey | null {
    return this.altAddress;
  }

  /**
   * 构建并发送交易
   */
  private async buildAndSendTransaction(
    instructions: any[]
  ): Promise<string> {
    // 🔒 安全检查：在 dryRun 模式下拒绝发送任何交易
    if (this.dryRun) {
      const simulatedSig = 'DRY_RUN_' + Buffer.from(Math.random().toString()).toString('base64').slice(0, 32);
      logger.info(`[DRY RUN] Would send transaction (simulated signature: ${simulatedSig})`);
      throw new Error(`[DRY RUN] Cannot send transaction in dry run mode. Simulated signature: ${simulatedSig}`);
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: this.payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([this.payer]);

    const signature = await this.connection.sendTransaction(tx, {
      maxRetries: 3,
    });

    // 等待确认
    await this.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    return signature;
  }

  /**
   * 等待指定数量的slots
   */
  private async waitForSlots(count: number): Promise<void> {
    const startSlot = await this.connection.getSlot();
    const targetSlot = startSlot + count;

    while (true) {
      const currentSlot = await this.connection.getSlot();
      if (currentSlot >= targetSlot) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 400)); // Solana slot ~400ms
    }
  }

  /**
   * 检查ALT是否已初始化
   */
  isInitialized(): boolean {
    return this.altAccount !== null;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    address: string | null;
    addressCount: number;
    initialized: boolean;
  } {
    return {
      address: this.altAddress?.toBase58() || null,
      addressCount: this.altAccount?.state.addresses.length || 0,
      initialized: this.isInitialized(),
    };
  }
}

