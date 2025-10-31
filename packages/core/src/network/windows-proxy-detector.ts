/**
 * Windows 系统代理自动检测器
 * 
 * 解决问题：Node.js 不会自动读取 Windows 系统代理设置
 * 本模块从 Windows 注册表读取系统代理配置，自动转换为 Node.js 可用的格式
 */

import { execSync } from 'child_process';

export interface WindowsProxyConfig {
  enabled: boolean;
  server: string | null;
  httpProxy?: string;
  httpsProxy?: string;
}

/**
 * 从 Windows 注册表读取系统代理配置
 */
export function detectWindowsSystemProxy(): WindowsProxyConfig | null {
  // 只在 Windows 平台上运行
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    // 读取注册表中的代理配置
    // HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    
    // 读取 ProxyEnable (是否启用代理)
    const proxyEnableCmd = `reg query "${regPath}" /v ProxyEnable`;
    const proxyEnableOutput = execSync(proxyEnableCmd, { encoding: 'utf-8' });
    const proxyEnable = proxyEnableOutput.match(/ProxyEnable\s+REG_DWORD\s+0x(\d+)/)?.[1];
    
    if (!proxyEnable || proxyEnable === '0') {
      return { enabled: false, server: null };
    }
    
    // 读取 ProxyServer (代理服务器地址)
    const proxyServerCmd = `reg query "${regPath}" /v ProxyServer`;
    const proxyServerOutput = execSync(proxyServerCmd, { encoding: 'utf-8' });
    const proxyServer = proxyServerOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    
    if (!proxyServer) {
      return { enabled: true, server: null };
    }
    
    // 解析代理服务器地址
    // 可能的格式:
    // 1. "127.0.0.1:7890" (单一代理)
    // 2. "http=127.0.0.1:7890;https=127.0.0.1:7890" (分协议代理)
    
    const result: WindowsProxyConfig = {
      enabled: true,
      server: proxyServer,
    };
    
    if (proxyServer.includes('=')) {
      // 分协议代理
      const protocols = proxyServer.split(';');
      for (const proto of protocols) {
        const [protocol, address] = proto.split('=');
        if (protocol.trim().toLowerCase() === 'http') {
          result.httpProxy = formatProxyUrl(address.trim());
        } else if (protocol.trim().toLowerCase() === 'https') {
          result.httpsProxy = formatProxyUrl(address.trim());
        }
      }
    } else {
      // 单一代理，用于所有协议
      const proxyUrl = formatProxyUrl(proxyServer);
      result.httpProxy = proxyUrl;
      result.httpsProxy = proxyUrl;
    }
    
    return result;
    
  } catch (error: any) {
    // 读取失败（可能是注册表不存在或权限问题）
    console.warn(`[WindowsProxyDetector] Failed to detect system proxy: ${error.message}`);
    return null;
  }
}

/**
 * 格式化代理地址为标准 URL
 */
function formatProxyUrl(address: string): string {
  // 移除可能的协议前缀
  address = address.replace(/^(http|https):\/\//i, '');
  
  // 添加 http:// 前缀
  return `http://${address}`;
}

/**
 * 获取最终的代理配置
 * 优先级：环境变量 > Windows 系统代理 > 无代理
 */
export function getProxyConfig(): {
  httpProxy: string | null;
  httpsProxy: string | null;
  source: 'env' | 'windows' | 'none';
} {
  // 1. 优先使用环境变量
  const envHttpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const envHttpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  
  if (envHttpProxy || envHttpsProxy) {
    return {
      httpProxy: envHttpProxy || null,
      httpsProxy: envHttpsProxy || envHttpProxy || null, // HTTPS 降级到 HTTP
      source: 'env',
    };
  }
  
  // 2. 尝试读取 Windows 系统代理
  const windowsProxy = detectWindowsSystemProxy();
  
  if (windowsProxy && windowsProxy.enabled && (windowsProxy.httpProxy || windowsProxy.httpsProxy)) {
    return {
      httpProxy: windowsProxy.httpProxy || null,
      httpsProxy: windowsProxy.httpsProxy || windowsProxy.httpProxy || null,
      source: 'windows',
    };
  }
  
  // 3. 无代理
  return {
    httpProxy: null,
    httpsProxy: null,
    source: 'none',
  };
}

/**
 * 自动设置环境变量（如果需要）
 * 
 * 这样其他不使用 NetworkAdapter 的代码也能使用代理
 */
export function autoSetupProxyEnv(): void {
  const config = getProxyConfig();
  
  if (config.source === 'windows') {
    // 从 Windows 系统代理读取到了配置，但环境变量中没有
    // 自动设置环境变量，让整个进程都能使用代理
    if (config.httpProxy && !process.env.HTTP_PROXY && !process.env.http_proxy) {
      process.env.HTTP_PROXY = config.httpProxy;
      process.env.http_proxy = config.httpProxy;
    }
    
    if (config.httpsProxy && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
      process.env.HTTPS_PROXY = config.httpsProxy;
      process.env.https_proxy = config.httpsProxy;
    }
    
    console.log(`[WindowsProxyDetector] ✅ 自动检测到 Windows 系统代理: ${config.httpProxy}`);
  } else if (config.source === 'env') {
    console.log(`[WindowsProxyDetector] ✅ 使用环境变量中的代理: ${config.httpProxy}`);
  } else {
    console.log(`[WindowsProxyDetector] ℹ️  未检测到代理配置，使用直连`);
  }
}





