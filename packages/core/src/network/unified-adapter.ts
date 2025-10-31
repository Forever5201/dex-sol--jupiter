/**
 * 🌐 统一网络适配器系统
 * 
 * 这是系统唯一的网络配置中心，确保所有网络请求都使用统一的配置
 * 
 * 🎯 核心原则：
 * - 单一配置源：从环境变量统一读取
 * - 自动注入：新代码自动使用系统配置
 * - 零配置：开发者无需关心代理细节
 * 
 * 📦 支持的网络类型：
 * - HTTP/HTTPS 请求 (axios)
 * - WebSocket 连接
 * - Solana RPC 连接
 * - Worker 线程网络请求
 * 
 * 🔧 使用方式：
 * ```typescript
 * import { NetworkAdapter } from '@solana-arb-bot/core';
 * 
 * // 方式1: 使用预配置的 axios 实例（推荐）
 * const response = await NetworkAdapter.axios.get('https://api.example.com');
 * 
 * // 方式2: 创建 Solana Connection
 * const connection = NetworkAdapter.createConnection('https://api.mainnet-beta.solana.com');
 * 
 * // 方式3: 创建自定义 axios 实例
 * const customAxios = NetworkAdapter.createAxios({ timeout: 5000 });
 * ```
 */

import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Connection, ConnectionConfig } from '@solana/web3.js';
import { autoSetupProxyEnv } from './windows-proxy-detector';

/**
 * 代理类型
 */
type ProxyProtocol = 'http' | 'https' | 'socks5';

/**
 * 网络适配器配置
 */
interface NetworkAdapterConfig {
  /** HTTP 代理地址 */
  httpProxy?: string;
  /** HTTPS 代理地址 */
  httpsProxy?: string;
  /** WebSocket 代理地址 */
  wsProxy?: string;
  /** 不使用代理的地址列表 */
  noProxy?: string[];
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 是否启用连接池优化 */
  enablePooling?: boolean;
}

/**
 * 统一网络适配器类
 * 
 * 单例模式，确保全局唯一配置
 */
class UnifiedNetworkAdapter {
  private static instance: UnifiedNetworkAdapter;
  
  // 配置
  private config: NetworkAdapterConfig;
  
  // Agent池
  private httpAgent?: HttpAgent | HttpsProxyAgent<string> | SocksProxyAgent;
  private httpsAgent?: HttpsAgent | HttpsProxyAgent<string> | SocksProxyAgent;
  
  // 全局axios实例
  private globalAxiosInstance: AxiosInstance;
  
  // 初始化标记
  private initialized = false;

  private constructor() {
    // 🌐 自动检测并设置 Windows 系统代理（如果环境变量未设置）
    autoSetupProxyEnv();
    
    this.config = this.loadConfig();
    this.initializeAgents();
    this.globalAxiosInstance = this.createGlobalAxiosInstance();
    this.initialized = true;
    this.logConfiguration();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): UnifiedNetworkAdapter {
    if (!UnifiedNetworkAdapter.instance) {
      UnifiedNetworkAdapter.instance = new UnifiedNetworkAdapter();
    }
    return UnifiedNetworkAdapter.instance;
  }

  /**
   * 从环境变量加载配置
   */
  private loadConfig(): NetworkAdapterConfig {
    const config: NetworkAdapterConfig = {
      httpProxy: process.env.HTTP_PROXY || process.env.http_proxy,
      httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy,
      wsProxy: process.env.WS_PROXY || process.env.ws_proxy,
      noProxy: [],
      defaultTimeout: parseInt(process.env.NETWORK_TIMEOUT || '10000', 10),
      enablePooling: process.env.ENABLE_CONNECTION_POOLING !== 'false',
    };

    // 解析 NO_PROXY
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (noProxy) {
      config.noProxy = noProxy.split(',').map((s) => s.trim());
    }

    // 智能降级：如果没有设置 HTTPS_PROXY，使用 HTTP_PROXY
    if (!config.httpsProxy && config.httpProxy) {
      config.httpsProxy = config.httpProxy;
    }

    // 智能降级：如果没有设置 WS_PROXY，使用 HTTP_PROXY
    if (!config.wsProxy && config.httpProxy) {
      config.wsProxy = config.httpProxy;
    }

    return config;
  }

  /**
   * 初始化 HTTP/HTTPS Agent
   */
  private initializeAgents(): void {
    const poolOptions = this.config.enablePooling
      ? {
          keepAlive: true,
          keepAliveMsecs: 500,
          maxSockets: 20,
          maxFreeSockets: 20,
          scheduling: 'lifo' as const,
        }
      : {};

    // HTTP Agent
    if (this.config.httpProxy) {
      this.httpAgent = this.createProxyAgent(this.config.httpProxy, poolOptions);
    }

    // HTTPS Agent
    if (this.config.httpsProxy) {
      this.httpsAgent = this.createProxyAgent(this.config.httpsProxy, poolOptions);
    }
  }

  /**
   * 创建代理 Agent
   */
  private createProxyAgent(
    proxyUrl: string,
    options: any = {}
  ): HttpsProxyAgent<string> | SocksProxyAgent {
    const baseOptions = {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      timeout: this.config.defaultTimeout,
      ...options,
    };

    if (proxyUrl.startsWith('socks')) {
      return new SocksProxyAgent(proxyUrl, baseOptions);
    } else {
      return new HttpsProxyAgent(proxyUrl, baseOptions);
    }
  }

  /**
   * 创建全局 axios 实例
   */
  private createGlobalAxiosInstance(): AxiosInstance {
    const instance = axios.create({
      timeout: this.config.defaultTimeout,
      headers: {
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Solana-Arb-Bot/1.0',
      },
      httpsAgent: this.httpsAgent || undefined,
      httpAgent: this.httpAgent || undefined,
      proxy: false, // 禁用 axios 自动代理，使用我们的 agent
      validateStatus: (status: number) => status < 500,
      maxRedirects: 5,
    });

    // 添加请求拦截器（用于日志和监控）
    instance.interceptors.request.use(
      (config) => {
        // 可以在这里添加全局请求日志
        return config;
      },
      (error) => Promise.reject(error)
    );

    // 添加响应拦截器（用于错误处理）
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        // 可以在这里添加全局错误处理
        return Promise.reject(error);
      }
    );

    return instance;
  }

  /**
   * 检查 URL 是否应该绕过代理
   */
  private shouldBypassProxy(url: string): boolean {
    if (!this.config.noProxy || this.config.noProxy.length === 0) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      return this.config.noProxy.some((pattern) => {
        // 精确匹配
        if (pattern === hostname) return true;
        // 通配符匹配
        if (pattern.startsWith('*.') && hostname.endsWith(pattern.slice(1))) return true;
        // 子域匹配
        if (hostname.endsWith(`.${pattern}`)) return true;
        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * 日志配置信息
   */
  private logConfiguration(): void {
    if (this.isProxyEnabled()) {
      console.log('🌐 [NetworkAdapter] 代理配置已启用');
      console.log(`   ├─ HTTP:  ${this.maskProxyUrl(this.config.httpProxy)}`);
      console.log(`   ├─ HTTPS: ${this.maskProxyUrl(this.config.httpsProxy)}`);
      console.log(`   ├─ WS:    ${this.maskProxyUrl(this.config.wsProxy)}`);
      console.log(`   ├─ 连接池: ${this.config.enablePooling ? '已启用' : '已禁用'}`);
      console.log(`   └─ 超时:  ${this.config.defaultTimeout}ms`);
    } else {
      console.log('🌐 [NetworkAdapter] 直连模式（无代理）');
      console.log(`   ├─ 连接池: ${this.config.enablePooling ? '已启用' : '已禁用'}`);
      console.log(`   └─ 超时:  ${this.config.defaultTimeout}ms`);
    }
  }

  /**
   * 掩码代理 URL（隐藏敏感信息）
   */
  private maskProxyUrl(url?: string): string {
    if (!url) return '(未配置)';
    
    try {
      const urlObj = new URL(url);
      if (urlObj.username || urlObj.password) {
        return `${urlObj.protocol}//*****:*****@${urlObj.host}`;
      }
      return url;
    } catch {
      return url;
    }
  }

  // ============================================
  // 公共 API
  // ============================================

  /**
   * 获取全局 axios 实例（推荐使用）
   * 
   * @example
   * const response = await NetworkAdapter.axios.get('https://api.example.com');
   */
  get axios(): AxiosInstance {
    return this.globalAxiosInstance;
  }

  /**
   * 创建自定义配置的 axios 实例
   * 
   * @param config 自定义配置（会自动合并代理配置）
   * @returns 配置好代理的 axios 实例
   * 
   * @example
   * const customAxios = NetworkAdapter.createAxios({
   *   timeout: 5000,
   *   headers: { 'X-Custom': 'value' }
   * });
   */
  createAxios(config: AxiosRequestConfig = {}): AxiosInstance {
    return axios.create({
      ...config,
      httpsAgent: this.httpsAgent || config.httpsAgent,
      httpAgent: this.httpAgent || config.httpAgent,
      proxy: false,
      timeout: config.timeout || this.config.defaultTimeout,
    });
  }

  /**
   * 创建 Solana Connection
   * 
   * @param endpoint RPC 端点 URL
   * @param commitmentOrConfig commitment 级别或完整配置
   * @returns 配置好代理的 Connection
   * 
   * @example
   * const connection = NetworkAdapter.createConnection(
   *   'https://api.mainnet-beta.solana.com',
   *   'confirmed'
   * );
   */
  createConnection(
    endpoint: string,
    commitmentOrConfig?: ConnectionConfig | 'processed' | 'confirmed' | 'finalized'
  ): Connection {
    const config: ConnectionConfig =
      typeof commitmentOrConfig === 'string'
        ? { commitment: commitmentOrConfig }
        : commitmentOrConfig || {};

    // 如果需要绕过代理，使用默认配置
    if (this.shouldBypassProxy(endpoint)) {
      return new Connection(endpoint, config);
    }

    // 使用代理配置
    if (this.httpsAgent) {
      // Node.js 18+ 原生 fetch 不支持 agent 参数
      // 需要使用 node-fetch 或 undici
      let customFetch: any;
      
      try {
        // 尝试使用 node-fetch（如果已安装）
        const nodeFetch = require('node-fetch');
        customFetch = (input: any, init?: any) => {
        const fetchOptions = {
          ...init,
          agent: this.httpsAgent,
        };
          return nodeFetch(input, fetchOptions);
      };
      } catch (error) {
        // 如果 node-fetch 未安装，尝试使用 undici（Node.js 18+ 内置）
        try {
          const { fetch: undiciFetch } = require('undici');
          // undici 不支持 agent，但可以通过 dispatcher 配置代理
          // 这里我们回退到原生 fetch（可能无法使用代理）
          console.warn('⚠️ [NetworkAdapter] node-fetch not available, proxy may not work with native fetch');
          customFetch = fetch;
        } catch {
          // 如果都没有，使用原生 fetch（代理可能不工作）
          console.warn('⚠️ [NetworkAdapter] Cannot use proxy: node-fetch not available');
          customFetch = fetch;
        }
      }

      return new Connection(endpoint, {
        ...config,
        fetch: customFetch as any,
      });
    }

    return new Connection(endpoint, config);
  }

  /**
   * 获取 WebSocket 代理 Agent
   * 
   * @param url WebSocket URL
   * @returns WebSocket 代理 Agent 或 undefined
   * 
   * @example
   * const ws = new WebSocket(url, {
   *   agent: NetworkAdapter.getWebSocketAgent(url)
   * });
   */
  getWebSocketAgent(url: string): HttpAgent | HttpsAgent | HttpsProxyAgent<string> | SocksProxyAgent | undefined {
    if (this.shouldBypassProxy(url) || !this.config.wsProxy) {
      return undefined;
    }

    try {
      return this.createProxyAgent(this.config.wsProxy, {
        keepAlive: true,
        keepAliveMsecs: 500,
      });
    } catch (error) {
      console.error('❌ [NetworkAdapter] 创建 WebSocket 代理 Agent 失败', error);
      return undefined;
    }
  }

  /**
   * 获取 HTTP Agent（用于 Worker 线程等场景）
   */
  getHttpAgent(): HttpAgent | HttpsProxyAgent<string> | SocksProxyAgent | undefined {
    return this.httpAgent;
  }

  /**
   * 获取 HTTPS Agent（用于 Worker 线程等场景）
   */
  getHttpsAgent(): HttpsAgent | HttpsProxyAgent<string> | SocksProxyAgent | undefined {
    return this.httpsAgent;
  }

  /**
   * 是否启用了代理
   */
  isProxyEnabled(): boolean {
    return !!(this.config.httpProxy || this.config.httpsProxy);
  }

  /**
   * 获取当前配置（只读）
   */
  getConfig(): Readonly<NetworkAdapterConfig> {
    return { ...this.config };
  }

  /**
   * 获取代理 URL（用于日志等）
   */
  getProxyUrl(): string | null {
    return this.config.httpsProxy || this.config.httpProxy || null;
  }

  /**
   * 获取适配器配置（用于 Worker 线程初始化）
   * 
   * 返回可序列化的配置对象，适合通过 workerData 传递
   */
  getSerializableConfig() {
    return {
      proxyUrl: this.getProxyUrl(),
      timeout: this.config.defaultTimeout,
      enablePooling: this.config.enablePooling,
      noProxy: this.config.noProxy,
    };
  }

  /**
   * 为 Worker 线程创建 axios 配置
   * 
   * Worker 线程需要重新创建 Agent，不能直接使用主线程的
   */
  static createWorkerAxiosConfig(workerConfig: {
    proxyUrl: string | null;
    timeout?: number;
    enablePooling?: boolean;
  }): AxiosRequestConfig {
    const { proxyUrl, timeout = 10000, enablePooling = true } = workerConfig;

    if (!proxyUrl) {
      return { timeout };
    }

    const poolOptions = enablePooling
      ? {
          keepAlive: true,
          keepAliveMsecs: 50, // Worker 使用更激进的心跳
          maxSockets: 20,
          maxFreeSockets: 20,
          scheduling: 'lifo' as const,
          rejectUnauthorized: false,
        }
      : { rejectUnauthorized: false };

    const agent = proxyUrl.startsWith('socks')
      ? new SocksProxyAgent(proxyUrl, { ...poolOptions, timeout })
      : new HttpsProxyAgent(proxyUrl, { ...poolOptions, timeout });

    return {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout,
    };
  }
}

// ============================================
// 全局单例导出
// ============================================

/**
 * 全局网络适配器实例
 * 
 * 这是整个系统唯一的网络配置入口
 */
export const NetworkAdapter = UnifiedNetworkAdapter.getInstance();

// ============================================
// 便捷函数导出
// ============================================

/**
 * 获取全局 axios 实例
 * 
 * @deprecated 推荐直接使用 NetworkAdapter.axios
 */
export const getAxios = () => NetworkAdapter.axios;

/**
 * 创建 Solana Connection
 * 
 * @deprecated 推荐直接使用 NetworkAdapter.createConnection()
 */
export const createConnection = (
  endpoint: string,
  commitmentOrConfig?: ConnectionConfig | 'processed' | 'confirmed' | 'finalized'
) => NetworkAdapter.createConnection(endpoint, commitmentOrConfig);

/**
 * 导出配置接口（用于类型检查）
 */
export type { NetworkAdapterConfig };

/**
 * 导出类（用于高级场景）
 */
export { UnifiedNetworkAdapter };



