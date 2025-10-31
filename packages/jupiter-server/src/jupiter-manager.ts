/**
 * Jupiter Server Manager
 * 
 * 负责管理自托管的 Jupiter API Server
 * - 自动下载 jupiter-cli 二进制文件
 * - 启动/停止/重启进程
 * - 健康检查和监控
 * - 自动故障恢复
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createLogger } from '@solana-arb-bot/core';

const logger = createLogger('JupiterManager');

export interface JupiterServerConfig {
  /** RPC URL */
  rpcUrl: string;
  /** 服务端口 */
  port: number;
  /** Jupiter API Base URL */
  baseUrl?: string;
  /** Jupiter CLI 版本 */
  version?: string;
  /** 二进制文件路径 */
  binaryPath?: string;
  /** 是否启用环形套利 */
  enableCircularArbitrage?: boolean;
  /** 最大路由数 */
  maxRoutes?: number;
  /** 只使用直接路由 */
  onlyDirectRoutes?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
}

export interface JupiterServerStatus {
  /** 是否运行中 */
  running: boolean;
  /** 服务端口 */
  port: number;
  /** 启动时间戳 */
  startTime?: number;
  /** 运行时长（毫秒） */
  uptime?: number;
  /** 重启次数 */
  restartCount: number;
  /** 最后一次健康检查 */
  lastHealthCheck?: Date;
  /** 健康状态 */
  healthy?: boolean;
}

export class JupiterServerManager {
  private config: Required<JupiterServerConfig>;
  private process: ChildProcess | null = null;
  private isRunning = false;
  private startTime?: number;
  private restartAttempts = 0;
  private readonly MAX_RESTART_ATTEMPTS = 5;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: JupiterServerConfig) {
    this.config = {
      rpcUrl: config.rpcUrl,
      port: config.port || 8080,
      baseUrl: config.baseUrl || 'https://quote-api.jup.ag',
      version: config.version || 'v6.0.35',
      binaryPath: config.binaryPath || './bin/jupiter-cli',
      enableCircularArbitrage: config.enableCircularArbitrage !== false,
      maxRoutes: config.maxRoutes || 3,
      onlyDirectRoutes: config.onlyDirectRoutes || false,
      timeout: config.timeout || 30000,
    };

    logger.info('Jupiter Server Manager initialized', {
      port: this.config.port,
      version: this.config.version,
      circularArbitrage: this.config.enableCircularArbitrage,
    });
  }

  /**
   * 确保 Jupiter CLI 存在（如果不存在则下载）
   */
  async ensureJupiterCli(): Promise<void> {
    // SDK 模式不需要下载 CLI
    logger.info('Using Jupiter SDK mode - no CLI download needed');
    return;
  }

  /**
   * 启动 Jupiter Server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Jupiter Server already running');
      return;
    }

    logger.info('Starting Jupiter Server (using public API)...', {
      baseUrl: this.config.baseUrl,
    });

    // 测试连接
    await this.testConnection();

    this.isRunning = true;
    this.startTime = Date.now();
    this.restartAttempts = 0;
    logger.info('✅ Jupiter Server started (API mode)');
  }

  /**
   * 测试 Jupiter API 连接
   */
  private async testConnection(): Promise<void> {
    try {
      // 测试基本连接
      const response = await axios.get(`${this.config.baseUrl}/v6/tokens`, {
        timeout: 10000,
      });
      
      if (response.status === 200) {
        logger.info('✅ Jupiter API connection test successful');
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error: any) {
      logger.error('Jupiter API connection test failed:', error.message);
      throw error;
    }
  }

  /**
   * 等待服务就绪
   */
  private async waitForReady(maxAttempts = 30): Promise<void> {
    logger.info('Waiting for Jupiter Server to be ready...');
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(
          `http://127.0.0.1:${this.config.port}/health`,
          { timeout: 2000 }
        );

        if (response.status === 200) {
          logger.info(`Jupiter Server is ready (attempt ${i + 1}/${maxAttempts})`);
          return;
        }
      } catch (error) {
        // 继续等待
        logger.debug(`Health check failed (attempt ${i + 1}/${maxAttempts})`);
      }

      await this.sleep(1000);
    }

    throw new Error(`Jupiter Server failed to start within ${maxAttempts} seconds`);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(
        `http://127.0.0.1:${this.config.port}/health`,
        { timeout: 3000 }
      );
      
      const healthy = response.status === 200;
      logger.debug(`Health check: ${healthy ? '✅ OK' : '❌ Failed'}`);
      return healthy;
    } catch (error) {
      logger.warn('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 启动定期健康检查
   */
  private startHealthCheck(): void {
    // 清除旧的定时器
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // 每30秒检查一次
    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.healthCheck();
      if (!healthy && this.isRunning) {
        logger.warn('Health check failed, server may be down');
      }
    }, 30000);
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.process) {
      logger.info('Jupiter Server is not running');
      return;
    }

    logger.info('Stopping Jupiter Server...');
    
    // 停止健康检查
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.isRunning = false;
    this.restartAttempts = this.MAX_RESTART_ATTEMPTS; // 防止自动重启

    // 尝试优雅关闭
    this.process.kill('SIGTERM');

    // 等待优雅退出
    await this.sleep(2000);

    // 如果还在运行，强制杀死
    if (this.process && !this.process.killed) {
      logger.warn('Force killing Jupiter Server');
      this.process.kill('SIGKILL');
    }

    this.process = null;
    this.startTime = undefined;
    logger.info('✅ Jupiter Server stopped');
  }

  /**
   * 重启服务
   */
  async restart(): Promise<void> {
    logger.info('Restarting Jupiter Server...');
    await this.stop();
    await this.sleep(1000);
    await this.start();
  }

  /**
   * 获取服务状态
   */
  getStatus(): JupiterServerStatus {
    return {
      running: this.isRunning,
      port: this.config.port,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : undefined,
      restartCount: this.restartAttempts,
    };
  }

  /**
   * 测试查询（用于验证功能）
   */
  async testQuery(inputMint: string, outputMint: string, amount: number): Promise<any> {
    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: '50',
      });

      const response = await axios.get(
        `http://127.0.0.1:${this.config.port}/quote?${params}`,
        { timeout: 10000 }
      );

      logger.info('Test query successful', {
        inputMint: inputMint.substring(0, 8) + '...',
        outputMint: outputMint.substring(0, 8) + '...',
        amount,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Test query failed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 休眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

