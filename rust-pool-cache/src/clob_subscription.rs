/// OpenBook V2 CLOB多账户订阅管理器
/// 
/// CLOB市场需要订阅多个账户才能获取完整的市场数据：
/// - Market账户: 市场元数据
/// - Bids账户: 买单订单簿
/// - Asks账户: 卖单订单簿
/// - EventHeap账户: 成交事件队列

use anyhow::{Context, Result};
use serde_json::json;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{info, warn, error};

use crate::deserializers::OpenBookMarketState;
use crate::dex_interface::DexPool;

/// CLOB账户类型
#[derive(Debug, Clone, PartialEq)]
pub enum CLOBAccountType {
    Market,
    Bids,
    Asks,
    EventHeap,
}

/// CLOB市场的所有关联账户
#[derive(Debug, Clone)]
pub struct CLOBAccounts {
    pub market: String,
    pub bids: Option<String>,
    pub asks: Option<String>,
    pub event_heap: Option<String>,
}

/// CLOB账户更新类型
#[derive(Debug)]
pub enum CLOBUpdate {
    /// 市场元数据更新（罕见）
    MarketMetadata(OpenBookMarketState),
    /// Bids订单簿更新
    BidsChanged(Vec<u8>),
    /// Asks订单簿更新
    AsksChanged(Vec<u8>),
    /// 新的成交事件
    TradeEvents(Vec<u8>),
}

/// CLOB多账户订阅管理器
pub struct CLOBSubscriptionManager {
    /// Market地址 -> 所有关联账户
    market_accounts: Arc<Mutex<HashMap<String, CLOBAccounts>>>,
    
    /// 订阅ID -> (账户地址, 账户类型, Market地址)
    subscription_map: Arc<Mutex<HashMap<u64, (String, CLOBAccountType, String)>>>,
    
    /// 下一个订阅请求ID
    next_request_id: Arc<Mutex<u64>>,
}

impl CLOBSubscriptionManager {
    pub fn new() -> Self {
        Self {
            market_accounts: Arc::new(Mutex::new(HashMap::new())),
            subscription_map: Arc::new(Mutex::new(HashMap::new())),
            next_request_id: Arc::new(Mutex::new(1000)), // 从1000开始，避免与常规池子冲突
        }
    }
    
    /// 订阅OpenBook V2市场（4个账户）
    /// 
    /// # 参数
    /// - market_address: Market账户地址
    /// - rpc_client: Solana RPC客户端（用于获取子账户地址）
    /// - ws_writer: WebSocket写入器
    /// 
    /// # 返回
    /// 成功返回订阅的所有账户地址
    pub async fn subscribe_openbook_market(
        &self,
        market_address: &str,
        rpc_client: &RpcClient,
        ws_writer: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ) -> Result<CLOBAccounts> {
        info!("🔔 开始订阅OpenBook V2市场: {}", &market_address[0..8]);
        
        // 步骤1: 获取Market账户数据
        let market_pubkey = Pubkey::from_str(market_address)
            .context("Invalid market address")?;
        
        let account = rpc_client.get_account(&market_pubkey)
            .context("Failed to get market account")?;
        
        // 步骤2: 反序列化Market账户，提取子账户地址
        let market_state = OpenBookMarketState::from_account_data(&account.data)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize market: {:?}", e))?;
        
        let bids_address = market_state.bids.to_string();
        let asks_address = market_state.asks.to_string();
        let event_heap_address = market_state.event_heap.to_string();
        
        info!("✅ Market账户解析成功:");
        info!("   Bids: {}", &bids_address[0..8]);
        info!("   Asks: {}", &asks_address[0..8]);
        info!("   EventHeap: {}", &event_heap_address[0..8]);
        
        // 步骤3: 订阅Market账户
        let market_sub_id = self.subscribe_account(
            ws_writer,
            market_address,
            CLOBAccountType::Market,
            market_address,
        ).await?;
        
        // 步骤4: 订阅Bids账户
        let bids_sub_id = self.subscribe_account(
            ws_writer,
            &bids_address,
            CLOBAccountType::Bids,
            market_address,
        ).await?;
        
        // 步骤5: 订阅Asks账户
        let asks_sub_id = self.subscribe_account(
            ws_writer,
            &asks_address,
            CLOBAccountType::Asks,
            market_address,
        ).await?;
        
        // 步骤6: 订阅EventHeap账户（可选）
        let event_heap_sub_id = self.subscribe_account(
            ws_writer,
            &event_heap_address,
            CLOBAccountType::EventHeap,
            market_address,
        ).await?;
        
        // 步骤7: 保存账户映射
        let accounts = CLOBAccounts {
            market: market_address.to_string(),
            bids: Some(bids_address.clone()),
            asks: Some(asks_address.clone()),
            event_heap: Some(event_heap_address.clone()),
        };
        
        {
            let mut map = self.market_accounts.lock().await;
            map.insert(market_address.to_string(), accounts.clone());
        }
        
        info!("✅ OpenBook V2市场订阅完成: {}", &market_address[0..8]);
        info!("   订阅了4个账户 (Market + Bids + Asks + EventHeap)");
        
        Ok(accounts)
    }
    
    /// 订阅单个账户
    async fn subscribe_account(
        &self,
        ws_writer: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        account_address: &str,
        account_type: CLOBAccountType,
        market_address: &str,
    ) -> Result<u64> {
        use futures_util::SinkExt;
        
        let request_id = {
            let mut id = self.next_request_id.lock().await;
            let current = *id;
            *id += 1;
            current
        };
        
        let subscribe_msg = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "accountSubscribe",
            "params": [
                account_address,
                {
                    "encoding": "base64",
                    "commitment": "confirmed"
                }
            ]
        });
        
        ws_writer.send(Message::Text(subscribe_msg.to_string())).await
            .context("Failed to send subscription message")?;
        
        // 记录订阅映射（等待服务器确认后会更新为subscription_id）
        {
            let mut map = self.subscription_map.lock().await;
            map.insert(
                request_id,
                (account_address.to_string(), account_type, market_address.to_string())
            );
        }
        
        Ok(request_id)
    }
    
    /// 处理订阅确认响应
    /// 
    /// 当服务器返回subscription_id时，更新映射关系
    pub async fn handle_subscription_response(
        &self,
        request_id: u64,
        subscription_id: u64,
    ) -> Result<()> {
        let mut map = self.subscription_map.lock().await;
        
        if let Some(info) = map.remove(&request_id) {
            map.insert(subscription_id, info);
            Ok(())
        } else {
            warn!("Received subscription response for unknown request_id: {}", request_id);
            Ok(())
        }
    }
    
    /// 处理账户更新
    /// 
    /// 根据subscription_id判断是哪个账户的更新，返回对应的更新类型
    pub async fn handle_account_update(
        &self,
        subscription_id: u64,
        data: &[u8],
    ) -> Result<Option<(String, CLOBUpdate)>> {
        let map = self.subscription_map.lock().await;
        
        if let Some((account_address, account_type, market_address)) = map.get(&subscription_id) {
            let update = match account_type {
                CLOBAccountType::Market => {
                    // Market账户更新（元数据变化，罕见）
                    match OpenBookMarketState::from_account_data(data) {
                        Ok(market) => CLOBUpdate::MarketMetadata(market),
                        Err(e) => {
                            error!("Failed to parse Market account: {:?}", e);
                            return Ok(None);
                        }
                    }
                }
                CLOBAccountType::Bids => {
                    // Bids账户更新（买单变化）
                    CLOBUpdate::BidsChanged(data.to_vec())
                }
                CLOBAccountType::Asks => {
                    // Asks账户更新（卖单变化）
                    CLOBUpdate::AsksChanged(data.to_vec())
                }
                CLOBAccountType::EventHeap => {
                    // EventHeap账户更新（新成交）
                    CLOBUpdate::TradeEvents(data.to_vec())
                }
            };
            
            Ok(Some((market_address.clone(), update)))
        } else {
            // 不是CLOB市场的订阅
            Ok(None)
        }
    }
    
    /// 检查一个地址是否是已订阅的CLOB账户
    pub async fn is_clob_account(&self, address: &str) -> bool {
        let map = self.subscription_map.lock().await;
        map.values().any(|(addr, _, _)| addr == address)
    }
    
    /// 获取市场的所有账户地址
    pub async fn get_market_accounts(&self, market_address: &str) -> Option<CLOBAccounts> {
        let map = self.market_accounts.lock().await;
        map.get(market_address).cloned()
    }
}

impl Default for CLOBSubscriptionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_account_type() {
        let market_type = CLOBAccountType::Market;
        let bids_type = CLOBAccountType::Bids;
        
        assert_eq!(market_type, CLOBAccountType::Market);
        assert_ne!(market_type, bids_type);
    }
}

