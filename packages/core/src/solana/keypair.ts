/**
 * 密钥管理器
 * 
 * 负责加载、验证和管理 Solana 密钥对
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

const keypairLogger = logger.child({ module: 'KeypairManager' });

/**
 * 密钥加载选项
 */
export interface KeypairLoadOptions {
  /** 密钥文件路径（优先级高于环境变量） */
  filePath?: string;
  /** 环境变量名称（默认: SOLANA_KEYPAIR_PATH 或 SOLANA_PRIVATE_KEY） */
  envVar?: string;
  /** 是否从环境变量直接读取Base58私钥（而非文件路径） */
  fromEnvBase58?: boolean;
}

/**
 * 密钥管理器类
 */
export class KeypairManager {
  /**
   * 智能加载密钥对（支持多种来源）
   * 优先级：filePath > 环境变量(SOLANA_KEYPAIR_PATH) > 环境变量(SOLANA_PRIVATE_KEY base58)
   * @param options 加载选项
   * @returns Keypair对象
   */
  static load(options?: KeypairLoadOptions): Keypair {
    // 优先级1: 显式指定文件路径
    if (options?.filePath) {
      return this.loadFromFile(options.filePath);
    }

    // 优先级2: 从环境变量读取文件路径
    const envKeypairPath = options?.envVar 
      ? process.env[options.envVar]
      : process.env.SOLANA_KEYPAIR_PATH;
    
    if (envKeypairPath && !options?.fromEnvBase58) {
      return this.loadFromFile(envKeypairPath);
    }

    // 优先级3: 从环境变量读取Base58私钥
    const envPrivateKey = options?.envVar && options?.fromEnvBase58
      ? process.env[options.envVar]
      : process.env.SOLANA_PRIVATE_KEY;
    
    if (envPrivateKey) {
      return this.fromBase58(envPrivateKey);
    }

    // 如果没有找到任何密钥源，抛出错误
    throw new Error(
      'No keypair source found. Please provide one of:\n' +
      '  - filePath option\n' +
      '  - SOLANA_KEYPAIR_PATH environment variable (file path)\n' +
      '  - SOLANA_PRIVATE_KEY environment variable (base58 private key)'
    );
  }

  /**
   * 从文件加载密钥对
   * @param filePath 密钥文件路径
   * @returns Keypair对象
   */
  static loadFromFile(filePath: string): Keypair {
    try {
      const absolutePath = path.resolve(filePath);
      
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Keypair file not found: ${absolutePath}`);
      }

      const secretKeyString = fs.readFileSync(absolutePath, 'utf-8');
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      const keypair = Keypair.fromSecretKey(secretKey);

      keypairLogger.info(`Keypair loaded: ${keypair.publicKey.toBase58()}`);
      return keypair;
    } catch (error) {
      keypairLogger.error(`Failed to load keypair: ${error}`);
      throw error;
    }
  }

  /**
   * 从加密文件加载密钥对（简化版，生产环境需要更强的加密）
   * @param filePath 密钥文件路径
   * @param password 密码（预留，暂未实现加密）
   * @returns Keypair对象
   */
  static loadEncrypted(filePath: string, password: string): Keypair {
    // 简化实现：暂时与 loadFromFile 相同
    // 生产环境应使用 argon2 或类似库进行加密
    keypairLogger.warn('Encrypted keypair loading not implemented, using plain file');
    return this.loadFromFile(filePath);
  }

  /**
   * 验证密钥对
   * @param keypair 要验证的密钥对
   * @returns 是否有效
   */
  static validateKeypair(keypair: Keypair): boolean {
    try {
      // 检查公钥是否有效
      const pubkey = keypair.publicKey.toBase58();
      
      if (pubkey.length === 0) {
        return false;
      }

      // 验证secretKey存在且长度正确
      if (!keypair.secretKey || keypair.secretKey.length !== 64) {
        return false;
      }

      return true;
    } catch (error) {
      keypairLogger.error(`Keypair validation failed: ${error}`);
      return false;
    }
  }

  /**
   * 获取账户余额
   * @param connection Solana 连接
   * @param keypair 密钥对
   * @returns 余额（SOL）
   */
  static async getBalance(connection: Connection, keypair: Keypair): Promise<number> {
    try {
      const balance = await connection.getBalance(keypair.publicKey);
      const balanceInSOL = balance / LAMPORTS_PER_SOL;
      
      keypairLogger.debug(`Balance for ${keypair.publicKey.toBase58()}: ${balanceInSOL} SOL`);
      return balanceInSOL;
    } catch (error) {
      keypairLogger.error(`Failed to get balance: ${error}`);
      throw error;
    }
  }

  /**
   * 检查账户是否有足够余额
   * @param connection Solana 连接
   * @param keypair 密钥对
   * @param minBalanceSOL 最小余额（SOL）
   * @returns 是否有足够余额
   */
  static async hasSufficientBalance(
    connection: Connection,
    keypair: Keypair,
    minBalanceSOL: number
  ): Promise<boolean> {
    const balance = await this.getBalance(connection, keypair);
    return balance >= minBalanceSOL;
  }

  /**
   * 生成新的密钥对
   * @returns 新的Keypair
   */
  static generate(): Keypair {
    const keypair = Keypair.generate();
    keypairLogger.info(`Generated new keypair: ${keypair.publicKey.toBase58()}`);
    return keypair;
  }

  /**
   * 保存密钥对到文件
   * @param keypair 密钥对
   * @param filePath 保存路径
   */
  static saveToFile(keypair: Keypair, filePath: string): void {
    try {
      const absolutePath = path.resolve(filePath);
      const secretKey = Array.from(keypair.secretKey);
      fs.writeFileSync(absolutePath, JSON.stringify(secretKey));
      
      keypairLogger.info(`Keypair saved to ${absolutePath}`);
    } catch (error) {
      keypairLogger.error(`Failed to save keypair: ${error}`);
      throw error;
    }
  }

  /**
   * 从 base58 私钥字符串创建密钥对
   * @param base58PrivateKey Base58编码的私钥
   * @returns Keypair对象
   */
  static fromBase58(base58PrivateKey: string): Keypair {
    try {
      const bs58 = require('bs58');
      const decoded = bs58.decode(base58PrivateKey);
      
      // 处理32字节或64字节的私钥
      let secretKey: Uint8Array;
      if (decoded.length === 64) {
        // 完整的64字节密钥对
        secretKey = decoded;
      } else if (decoded.length === 32) {
        // 仅32字节私钥，需要生成完整密钥对
        const keypair = Keypair.fromSeed(decoded);
        secretKey = keypair.secretKey;
      } else {
        throw new Error(`Invalid private key length: ${decoded.length} bytes (expected 32 or 64)`);
      }
      
      const keypair = Keypair.fromSecretKey(secretKey);
      keypairLogger.info(`Keypair loaded from base58: ${keypair.publicKey.toBase58()}`);
      return keypair;
    } catch (error) {
      keypairLogger.error(`Failed to create keypair from base58: ${error}`);
      throw error;
    }
  }

  /**
   * 从环境变量加载密钥对
   * @param envVarName 环境变量名称（默认: SOLANA_KEYPAIR_PATH 或 SOLANA_PRIVATE_KEY）
   * @param isBase58 是否为Base58格式私钥（默认false，表示文件路径）
   * @returns Keypair对象
   */
  static loadFromEnv(envVarName?: string, isBase58: boolean = false): Keypair {
    const varName = envVarName || (isBase58 ? 'SOLANA_PRIVATE_KEY' : 'SOLANA_KEYPAIR_PATH');
    const value = process.env[varName];
    
    if (!value) {
      throw new Error(`Environment variable ${varName} is not set`);
    }

    if (isBase58) {
      return this.fromBase58(value);
    } else {
      return this.loadFromFile(value);
    }
  }
}

export default KeypairManager;


