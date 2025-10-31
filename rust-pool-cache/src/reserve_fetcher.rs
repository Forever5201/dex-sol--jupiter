///! 储备金获取模块
///! 
///! 为Meteora DLMM等需要从外部vault账户读取储备金的DEX提供支持

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::DexError;
use crate::deserializers::spl_token::TokenAccount;

/// 储备金信息
#[derive(Debug, Clone)]
pub struct ReserveInfo {
    /// Token X 储备金
    pub reserve_x: u64,
    
    /// Token Y 储备金
    pub reserve_y: u64,
    
    /// Token X Decimals
    pub decimals_x: u8,
    
    /// Token Y Decimals
    pub decimals_y: u8,
}

impl ReserveInfo {
    /// 创建空的储备金信息（用于降级）
    pub fn empty() -> Self {
        Self {
            reserve_x: 0,
            reserve_y: 0,
            decimals_x: 0,
            decimals_y: 0,
        }
    }
    
    /// 计算格式化后的储备金（考虑decimals）
    pub fn get_formatted_reserves(&self) -> (f64, f64) {
        let reserve_x_f64 = self.reserve_x as f64 / 10f64.powi(self.decimals_x as i32);
        let reserve_y_f64 = self.reserve_y as f64 / 10f64.powi(self.decimals_y as i32);
        (reserve_x_f64, reserve_y_f64)
    }
}

/// 储备金获取器
/// 
/// 支持批量获取多个vault账户的储备金信息
pub struct ReserveFetcher {
    rpc_client: RpcClient,
}

impl ReserveFetcher {
    /// 创建储备金获取器
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_client: RpcClient::new(rpc_url.to_string()),
        }
    }
    
    /// 获取单个vault的储备金
    /// 
    /// # Arguments
    /// * `vault_pubkey` - Vault账户地址
    /// 
    /// # Returns
    /// * `Ok(u64)` - 储备金数量
    /// * `Err(DexError)` - 获取失败
    pub fn fetch_vault_balance(&self, vault_pubkey: &Pubkey) -> Result<u64, DexError> {
        // 获取账户数据
        let account_data = self.rpc_client
            .get_account_data(vault_pubkey)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Failed to fetch vault account {}: {}",
                vault_pubkey,
                e
            )))?;
        
        // 解析为TokenAccount
        let token_account = TokenAccount::from_account_data(&account_data)?;
        
        Ok(token_account.amount)
    }
    
    /// 批量获取两个vault的储备金
    /// 
    /// # Arguments
    /// * `vault_x` - Token X的vault地址
    /// * `vault_y` - Token Y的vault地址
    /// 
    /// # Returns
    /// 储备金对 (reserve_x, reserve_y)
    pub fn fetch_reserves(
        &self,
        vault_x: &Pubkey,
        vault_y: &Pubkey,
    ) -> Result<(u64, u64), DexError> {
        let reserve_x = self.fetch_vault_balance(vault_x)?;
        let reserve_y = self.fetch_vault_balance(vault_y)?;
        
        Ok((reserve_x, reserve_y))
    }
    
    /// 获取完整的储备金信息（包括decimals）
    /// 
    /// # Arguments
    /// * `vault_x` - Token X的vault地址
    /// * `vault_y` - Token Y的vault地址
    /// * `mint_x` - Token X的mint地址
    /// * `mint_y` - Token Y的mint地址
    /// 
    /// # Returns
    /// 完整的储备金信息
    pub fn fetch_reserve_info(
        &self,
        vault_x: &Pubkey,
        vault_y: &Pubkey,
        mint_x: &Pubkey,
        mint_y: &Pubkey,
    ) -> Result<ReserveInfo, DexError> {
        // 获取储备金
        let (reserve_x, reserve_y) = self.fetch_reserves(vault_x, vault_y)?;
        
        // 获取mint信息来读取decimals
        let decimals_x = self.fetch_mint_decimals(mint_x)?;
        let decimals_y = self.fetch_mint_decimals(mint_y)?;
        
        Ok(ReserveInfo {
            reserve_x,
            reserve_y,
            decimals_x,
            decimals_y,
        })
    }
    
    /// 从mint账户获取decimals
    pub fn fetch_mint_decimals(&self, mint_pubkey: &Pubkey) -> Result<u8, DexError> {
        let account_data = self.rpc_client
            .get_account_data(mint_pubkey)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Failed to fetch mint account {}: {}",
                mint_pubkey,
                e
            )))?;
        
        // SPL Token Mint layout:
        // - 0-36: mint authority (optional)
        // - 36-44: supply (u64)
        // - 44: decimals (u8)
        
        if account_data.len() < 45 {
            return Err(DexError::DeserializationFailed(
                "Mint account data too short".to_string()
            ));
        }
        
        Ok(account_data[44])
    }
}

/// 批量储备金获取器（性能优化版）
/// 
/// 使用get_multiple_accounts一次性获取多个账户
pub struct BatchReserveFetcher {
    rpc_client: RpcClient,
}

impl BatchReserveFetcher {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_client: RpcClient::new(rpc_url.to_string()),
        }
    }
    
    /// 批量获取多个池子的储备金
    /// 
    /// # Arguments
    /// * `vault_pairs` - Vault对的列表 [(vault_x, vault_y), ...]
    /// 
    /// # Returns
    /// 储备金对的列表 [(reserve_x, reserve_y), ...]
    pub fn fetch_batch_reserves(
        &self,
        vault_pairs: &[(Pubkey, Pubkey)],
    ) -> Result<Vec<(u64, u64)>, DexError> {
        if vault_pairs.is_empty() {
            return Ok(Vec::new());
        }
        
        // 扁平化所有pubkey
        let all_vaults: Vec<Pubkey> = vault_pairs
            .iter()
            .flat_map(|(x, y)| vec![*x, *y])
            .collect();
        
        // 批量获取账户
        let accounts = self.rpc_client
            .get_multiple_accounts(&all_vaults)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Failed to fetch batch accounts: {}",
                e
            )))?;
        
        // 解析结果
        let mut results = Vec::new();
        for i in 0..vault_pairs.len() {
            let idx_x = i * 2;
            let idx_y = i * 2 + 1;
            
            let account_x = accounts.get(idx_x)
                .and_then(|opt| opt.as_ref())
                .ok_or_else(|| DexError::DeserializationFailed(
                    format!("Vault X account not found at index {}", idx_x)
                ))?;
            
            let account_y = accounts.get(idx_y)
                .and_then(|opt| opt.as_ref())
                .ok_or_else(|| DexError::DeserializationFailed(
                    format!("Vault Y account not found at index {}", idx_y)
                ))?;
            
            let token_x = TokenAccount::from_account_data(&account_x.data)?;
            let token_y = TokenAccount::from_account_data(&account_y.data)?;
            
            results.push((token_x.amount, token_y.amount));
        }
        
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_reserve_info_empty() {
        let info = ReserveInfo::empty();
        assert_eq!(info.reserve_x, 0);
        assert_eq!(info.reserve_y, 0);
        assert_eq!(info.decimals_x, 0);
        assert_eq!(info.decimals_y, 0);
    }
    
    #[test]
    fn test_reserve_info_formatting() {
        let info = ReserveInfo {
            reserve_x: 1_000_000_000, // 1B
            reserve_y: 2_000_000,     // 2M
            decimals_x: 9,            // SOL
            decimals_y: 6,            // USDC
        };
        
        let (x, y) = info.get_formatted_reserves();
        assert!((x - 1.0).abs() < 0.0001);      // 1 SOL
        assert!((y - 2.0).abs() < 0.0001);      // 2 USDC
    }
}

