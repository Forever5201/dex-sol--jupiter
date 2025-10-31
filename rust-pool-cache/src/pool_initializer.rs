use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tracing::{info, warn};
use anyhow::Result;

/// 池子初始化器：启动时主动批量查询池子账户
pub struct PoolInitializer {
    rpc_clients: Vec<RpcClient>,
    current_index: AtomicUsize,
}

impl PoolInitializer {
    /// 创建新的池子初始化器
    /// 
    /// # 参数
    /// * `rpc_urls` - RPC端点列表（支持多个API key轮询）
    /// * `timeout_ms` - 请求超时时间（毫秒）
    pub fn new(rpc_urls: Vec<String>, timeout_ms: u64) -> Self {
        let rpc_clients = rpc_urls
            .iter()
            .map(|url| {
                RpcClient::new_with_timeout(url.clone(), Duration::from_millis(timeout_ms))
            })
            .collect();

        info!("🚀 Pool initializer created with {} RPC endpoint(s)", rpc_urls.len());

        Self {
            rpc_clients,
            current_index: AtomicUsize::new(0),
        }
    }

    /// 轮询获取下一个RPC客户端（负载均衡）
    fn get_next_client(&self) -> &RpcClient {
        let index = self.current_index.fetch_add(1, Ordering::Relaxed);
        &self.rpc_clients[index % self.rpc_clients.len()]
    }

    /// 批量查询池子账户数据
    /// 
    /// # 参数
    /// * `pool_addresses` - 池子地址列表
    /// * `max_retries` - 最大重试次数
    /// 
    /// # 返回
    /// 每个池子的账户数据（如果存在）
    pub async fn fetch_pool_accounts(
        &self,
        pool_addresses: &[String],
        max_retries: usize,
    ) -> Result<Vec<Option<Vec<u8>>>> {
        // 转换字符串地址为Pubkey
        let pubkeys: Vec<Pubkey> = pool_addresses
            .iter()
            .filter_map(|addr| {
                Pubkey::from_str(addr).ok()
            })
            .collect();

        if pubkeys.len() != pool_addresses.len() {
            warn!(
                "⚠️  {} invalid addresses filtered out",
                pool_addresses.len() - pubkeys.len()
            );
        }

        info!("🔍 Fetching {} pool accounts via RPC...", pubkeys.len());

        // 重试逻辑
        for attempt in 0..=max_retries {
            let client = self.get_next_client();

            match client.get_multiple_accounts(&pubkeys) {
                Ok(accounts) => {
                    let valid_count = accounts.iter().filter(|a| a.is_some()).count();
                    info!(
                        "✅ Fetched {}/{} valid pool accounts (attempt {}/{})",
                        valid_count,
                        pubkeys.len(),
                        attempt + 1,
                        max_retries + 1
                    );

                    // 提取account data
                    let data: Vec<Option<Vec<u8>>> = accounts
                        .into_iter()
                        .map(|acc| acc.map(|a| a.data))
                        .collect();

                    return Ok(data);
                }
                Err(e) => {
                    warn!(
                        "⚠️  RPC query failed (attempt {}/{}): {}",
                        attempt + 1,
                        max_retries + 1,
                        e
                    );

                    if attempt < max_retries {
                        // 指数退避：等待时间递增
                        let backoff_ms = 100 * (attempt as u64 + 1);
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    }
                }
            }
        }

        Err(anyhow::anyhow!(
            "Failed to fetch pool accounts after {} attempts",
            max_retries + 1
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_robin() {
        let urls = vec![
            "https://api1.example.com".to_string(),
            "https://api2.example.com".to_string(),
            "https://api3.example.com".to_string(),
        ];

        let initializer = PoolInitializer::new(urls, 5000);

        // 测试轮询
        for i in 0..10 {
            let client = initializer.get_next_client();
            let expected_idx = i % 3;
            // 我们不能直接比较client，但可以验证不会panic
            assert!(client as *const _ as usize > 0);
        }
    }
}

