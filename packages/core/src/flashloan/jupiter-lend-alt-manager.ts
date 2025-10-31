/**
 * Jupiter Lend Address Lookup Table Manager
 * 
 * 管理Jupiter Lend闪电贷的Address Lookup Table (ALT)，用于压缩交易大小
 * 
 * 核心功能：
 * 1. 自动从Jupiter Lend SDK生成的指令中提取账户地址
 * 2. 创建包含这些地址的ALT
 * 3. 加载和缓存ALT账户
 * 4. 智能检测和初始化ALT
 * 
 * 与Solend ALT的区别：
 * - Solend: 静态地址列表（已知的储备账户）
 * - Jupiter Lend: 动态地址（需要从SDK生成的指令中提取）
 */

import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  TransactionInstruction,
} from '@solana/web3.js';
import { createLogger } from '../logger';

const logger = createLogger('JupiterLendALTManager');

/**
 * Jupiter Lend ALT管理器
 */
export class JupiterLendALTManager {
  private connection: Connection;
  private payer: Keypair;
  private altAddress: PublicKey | null = null;
  private altAccount: AddressLookupTableAccount | null = null;
  private cachedAddresses = new Set<string>();
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
    logger.info('🔧 Initializing Jupiter Lend ALT...');

    // 1. 尝试从环境变量加载现有ALT地址
    const existingAltAddress = process.env.JUPITER_LEND_ALT_ADDRESS;
    
    if (existingAltAddress) {
      try {
        this.altAddress = new PublicKey(existingAltAddress);
        logger.info(`✅ Using existing Jupiter Lend ALT: ${this.altAddress.toBase58()}`);
        
        // 加载ALT账户数据
        await this.loadALT();
        return;
      } catch (error: any) {
        logger.warn(`⚠️ Failed to load existing ALT: ${error.message}, will create on first use...`);
      }
    }

    // 2. Jupiter Lend ALT将在第一次构建闪电贷指令时创建
    logger.info('💡 Jupiter Lend ALT will be created on first flash loan use');
  }

  /**
   * 从闪电贷指令中提取账户并创建/扩展ALT
   * 
   * @param borrowIx 借款指令
   * @param repayIx 还款指令
   */
  async ensureALTForInstructions(
    borrowIx: TransactionInstruction,
    repayIx: TransactionInstruction
  ): Promise<void> {
    // 提取所有账户地址
    const addresses = this.extractAddressesFromInstructions([borrowIx, repayIx]);
    
    // 检查是否有新地址需要添加
    const newAddresses = addresses.filter(addr => !this.cachedAddresses.has(addr.toBase58()));
    
    if (newAddresses.length === 0 && this.altAddress) {
      logger.debug('✅ All addresses already in ALT');
      return;
    }

    // 🔒 安全检查：在 dryRun 模式下跳过 ALT 扩展（避免消耗 gas）
    if (this.dryRun) {
      if (!this.altAddress) {
        logger.info(`[DRY RUN] Would create ALT with ${newAddresses.length} addresses`);
      } else if (newAddresses.length > 0) {
        logger.info(`[DRY RUN] Would extend ALT with ${newAddresses.length} addresses: ${newAddresses.slice(0, 3).map(a => a.toBase58().slice(0, 8)).join(', ')}...`);
      }
      return;
    }

    // 如果ALT不存在，创建它
    if (!this.altAddress) {
      await this.createALT(newAddresses);
    } else if (newAddresses.length > 0) {
      // 扩展现有ALT
      await this.extendALT(newAddresses);
    }
  }

  /**
   * 从指令中提取所有账户地址
   */
  private extractAddressesFromInstructions(
    instructions: TransactionInstruction[]
  ): PublicKey[] {
    const addressSet = new Set<string>();

    for (const ix of instructions) {
      // 添加程序ID
      addressSet.add(ix.programId.toBase58());

      // 添加所有账户（排除签名者，因为签名者不能放入ALT）
      for (const key of ix.keys) {
        if (!key.isSigner) {
          addressSet.add(key.pubkey.toBase58());
        }
      }
    }

    return Array.from(addressSet).map(addr => new PublicKey(addr));
  }

  /**
   * 创建新的ALT
   */
  private async createALT(addresses: PublicKey[]): Promise<void> {
    try {
      logger.info(`🆕 Creating Jupiter Lend ALT with ${addresses.length} addresses...`);

      // 获取当前slot
      const slot = await this.connection.getSlot();

      // 创建ALT指令
      const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
        authority: this.payer.publicKey,
        payer: this.payer.publicKey,
        recentSlot: slot,
      });

      this.altAddress = altAddress;
      logger.info(`📋 Jupiter Lend ALT address: ${altAddress.toBase58()}`);

      // 发送创建交易（验证成功）
      const createTx = await this.buildAndSendTransaction([createIx], true);
      logger.info(`✅ ALT created: ${createTx}`);

      // 等待1个slot（warmup period）
      await this.waitForSlots(1);

      // 再次验证 ALT 账户是否存在
      const accountInfo = await this.connection.getAccountInfo(this.altAddress);
      if (!accountInfo) {
        throw new Error(`ALT account ${this.altAddress.toBase58()} not found after creation and warmup`);
      }

      // 扩展ALT（添加地址）
      await this.extendALT(addresses);

      // 提示保存地址
      logger.info('');
      logger.info('💡 To avoid recreating the ALT next time, add this to your .env:');
      logger.info(`   JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`);
      logger.info('');

    } catch (error: any) {
      // 如果创建失败，清除 ALT 地址
      if (error.message.includes('not found') || error.message.includes('failed')) {
        logger.warn('⚠️ ALT creation failed, clearing ALT address');
        this.altAddress = null;
        this.altAccount = null;
        this.cachedAddresses.clear();
      }
      
      logger.error(`❌ Failed to create Jupiter Lend ALT: ${error.message}`);
      throw error;
    }
  }

  /**
   * 扩展现有ALT
   */
  private async extendALT(addresses: PublicKey[]): Promise<void> {
    if (!this.altAddress) {
      throw new Error('ALT address not set');
    }

    if (addresses.length === 0) {
      return;
    }

    try {
      // 🔍 先验证 ALT 账户是否存在且有效
      const accountInfo = await this.connection.getAccountInfo(this.altAddress);
      if (!accountInfo) {
        throw new Error(`ALT account ${this.altAddress.toBase58()} does not exist. Please recreate ALT.`);
      }

      // 验证 ALT 账户所有者
      const ALT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
      if (!accountInfo.owner.equals(ALT_PROGRAM_ID)) {
        throw new Error(
          `Invalid ALT owner: expected ${ALT_PROGRAM_ID.toBase58()}, ` +
          `got ${accountInfo.owner.toBase58()}. ALT may not be initialized correctly.`
        );
      }

      logger.info(`📤 Extending Jupiter Lend ALT with ${addresses.length} new addresses...`);

      // 分批扩展（每批最多20个地址）
      const batchSize = 20;
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        
        const extendIx = AddressLookupTableProgram.extendLookupTable({
          payer: this.payer.publicKey,
          authority: this.payer.publicKey,
          lookupTable: this.altAddress,
          addresses: batch,
        });

        const extendTx = await this.buildAndSendTransaction([extendIx], true);
        logger.info(`✅ Extended ALT (batch ${Math.floor(i / batchSize) + 1}): ${extendTx}`);
      }

      // 等待warmup
      await this.waitForSlots(1);

      // 更新缓存
      for (const addr of addresses) {
        this.cachedAddresses.add(addr.toBase58());
      }

      // 重新加载ALT
      await this.loadALT();

    } catch (error: any) {
      logger.error(`❌ Failed to extend Jupiter Lend ALT: ${error.message}`);
      
      // 如果是 ALT 不存在或无效，清除 ALT 地址，下次重新创建
      if (error.message.includes('does not exist') || error.message.includes('Invalid ALT owner')) {
        logger.warn('⚠️ Clearing invalid ALT address, will recreate on next use');
        this.altAddress = null;
        this.altAccount = null;
        this.cachedAddresses.clear();
      }
      
      throw error;
    }
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

      // 更新缓存
      this.cachedAddresses.clear();
      for (const addr of this.altAccount.state.addresses) {
        this.cachedAddresses.add(addr.toBase58());
      }

      logger.info(
        `✅ Loaded Jupiter Lend ALT: ${this.altAddress.toBase58().slice(0, 8)}... ` +
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
    instructions: any[],
    verifySuccess: boolean = true
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
    const confirmation = await this.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    // 验证交易是否成功
    if (verifySuccess) {
      const txStatus = await this.connection.getSignatureStatus(signature);
      
      if (!txStatus || !txStatus.value) {
        throw new Error(`Transaction ${signature} not found`);
      }

      if (txStatus.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(txStatus.value.err)}`
        );
      }

      // 如果是 ALT 创建交易，验证 ALT 账户是否存在
      if (this.altAddress) {
        const accountInfo = await this.connection.getAccountInfo(this.altAddress);
        if (!accountInfo) {
          throw new Error(`ALT account ${this.altAddress.toBase58()} not found after creation`);
        }

        // 验证 ALT 账户所有者
        const ALT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
        if (!accountInfo.owner.equals(ALT_PROGRAM_ID)) {
          throw new Error(
            `Invalid ALT owner: expected ${ALT_PROGRAM_ID.toBase58()}, ` +
            `got ${accountInfo.owner.toBase58()}`
          );
        }

        logger.debug(`✅ ALT account verified: ${this.altAddress.toBase58()}`);
      }
    }

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

