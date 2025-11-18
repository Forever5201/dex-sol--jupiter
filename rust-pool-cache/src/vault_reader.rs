/*!
 * Vault Reader Module
 * 
 * 为需要从外部 vault 账户读取储备量的 DEX 池子提供支持
 * 
 * 支持的 DEX:
 * - SolFi V2 (37% 机会)
 * - GoonFi (6% 机会)
 * 
 * 总共增加 43% 的套利机会覆盖率
 */

use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::str::FromStr;
use tracing::debug;
use spl_token::state::Account as SplTokenAccount;
use solana_program::program_pack::Pack;

/// Vault 信息
#[derive(Debug, Clone)]
pub struct VaultInfo {
    /// Vault 地址
    #[allow(dead_code)]
    pub address: Pubkey,
    /// Vault 余额（token 数量）
    pub amount: u64,
    /// 最后更新时间戳
    pub last_updated: u64,
}

/// VaultReader - 管理所有 vault 账户的余额
pub struct VaultReader {
    /// 存储所有 vault 的余额
    /// Key: vault 地址字符串
    /// Value: VaultInfo
    vaults: HashMap<String, VaultInfo>,
    
    /// 池子到 vault 的映射
    /// Key: pool 地址
    /// Value: (vault_a 地址, vault_b 地址)
    pool_to_vaults: HashMap<String, (String, String)>,
}

#[allow(dead_code)]
impl VaultReader {
    /// 创建新的 VaultReader
    pub fn new() -> Self {
        Self {
            vaults: HashMap::new(),
            pool_to_vaults: HashMap::new(),
        }
    }
    
    /// 注册一个池子的 vault 地址
    /// 
    /// # Arguments
    /// * `pool_address` - 池子地址
    /// * `vault_a` - Token A 的 vault 地址
    /// * `vault_b` - Token B 的 vault 地址
    pub fn register_pool_vaults(
        &mut self,
        pool_address: &str,
        vault_a: &str,
        vault_b: &str,
    ) {
        self.pool_to_vaults.insert(
            pool_address.to_string(),
            (vault_a.to_string(), vault_b.to_string())
        );
        
        // 初始化 vault 信息
        if let Ok(pubkey) = Pubkey::from_str(vault_a) {
            self.vaults.insert(
                vault_a.to_string(),
                VaultInfo {
                    address: pubkey,
                    amount: 0,
                    last_updated: 0,
                }
            );
        }
        
        if let Ok(pubkey) = Pubkey::from_str(vault_b) {
            self.vaults.insert(
                vault_b.to_string(),
                VaultInfo {
                    address: pubkey,
                    amount: 0,
                    last_updated: 0,
                }
            );
        }
    }
    
    /// 更新 vault 余额（从 WebSocket 账户更新）
    /// 
    /// # Arguments
    /// * `vault_address` - Vault 地址
    /// * `data` - SPL Token 账户数据（165 字节）
    /// 
    /// # Returns
    /// * `Ok(amount)` - 更新成功，返回余额
    /// * `Err(error)` - 解析失败
    pub fn update_vault(&mut self, vault_address: &str, data: &[u8]) -> Result<u64, String> {
        // 🔥 修复：支持多种数据长度
        // SPL Token 账户: 165 字节
        // SPL Token-2022 with Extensions: 165+ 字节
        // 压缩/wrapped账户: 82 字节（Mint账户）
        
        // Handle different token account sizes
        if data.len() == 82 {
            // 82-byte Mint accounts should have been filtered earlier
            debug!(vault = vault_address, len = data.len(), "Received Mint account data, skipping");
            return Ok(0);
        } else if data.len() < 165 {
            return Err(format!(
                "Invalid token account size: expected >= 165 bytes, got {}",
                data.len()
            ));
        }
        
        // ✅ FIX: SPL Token accounts use Pack trait, NOT Borsh!
        // Standard SPL Token: 165 bytes
        // Token-2022 with extensions: 165-400+ bytes (extensions are appended after base 165 bytes)
        // We only need the first 165 bytes for the base Account structure
        let base_data = if data.len() > 165 {
            debug!(
                vault = vault_address, 
                total_len = data.len(), 
                extensions_len = data.len() - 165,
                "Token-2022 account with extensions detected, using base 165 bytes"
            );
            &data[0..165]
        } else {
            data
        };
        
        // ⭐ CRITICAL FIX: Use spl_token::state::Account::unpack() instead of Borsh
        // SPL Token accounts use the Pack trait for serialization, not Borsh
        let token_account = SplTokenAccount::unpack(base_data)
            .map_err(|e| format!("Failed to unpack SPL Token account: {:?}", e))?;
        
        // 更新 vault 信息
        if let Some(vault_info) = self.vaults.get_mut(vault_address) {
            vault_info.amount = token_account.amount;
            vault_info.last_updated = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            Ok(token_account.amount)
        } else {
            // Vault 未注册，但我们仍然更新它
            if let Ok(pubkey) = Pubkey::from_str(vault_address) {
                let amount = token_account.amount;
                self.vaults.insert(
                    vault_address.to_string(),
                    VaultInfo {
                        address: pubkey,
                        amount,
                        last_updated: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    }
                );
                Ok(amount)
            } else {
                Err(format!("Invalid vault address: {}", vault_address))
            }
        }
    }
    
    /// 获取池子的储备量（从 vault 读取）
    /// 
    /// # Arguments
    /// * `pool_address` - 池子地址
    /// 
    /// # Returns
    /// * `Some((reserve_a, reserve_b))` - 成功读取
    /// * `None` - 池子未注册或 vault 数据不可用
    pub fn get_pool_reserves(&self, pool_address: &str) -> Option<(u64, u64)> {
        let (vault_a, vault_b) = self.pool_to_vaults.get(pool_address)?;
        
        let amount_a = self.vaults.get(vault_a)?.amount;
        let amount_b = self.vaults.get(vault_b)?.amount;
        
        Some((amount_a, amount_b))
    }
    
    /// 获取单个 vault 的余额
    pub fn get_vault_amount(&self, vault_address: &str) -> Option<u64> {
        self.vaults.get(vault_address).map(|v| v.amount)
    }
    
    /// 检查池子是否有 vault 配置
    pub fn has_pool_vaults(&self, pool_address: &str) -> bool {
        self.pool_to_vaults.contains_key(pool_address)
    }
    
    /// 检查是否是 vault 账户
    pub fn is_vault_account(&self, address: &str) -> bool {
        self.vaults.contains_key(address)
    }
    
    /// 获取所有 vault 地址（用于订阅）
    pub fn get_all_vault_addresses(&self) -> Vec<String> {
        self.vaults.keys().cloned().collect()
    }
    
    /// 获取池子关联的 vault 地址
    pub fn get_pool_vault_addresses(&self, pool_address: &str) -> Option<(String, String)> {
        self.pool_to_vaults.get(pool_address).cloned()
    }
    
    /// 获取使用特定 vault 的所有池子地址
    /// 
    /// # Arguments
    /// * `vault_address` - Vault 地址
    /// 
    /// # Returns
    /// 使用该 vault 的所有池子地址列表
    pub fn get_pools_for_vault(&self, vault_address: &str) -> Vec<String> {
        self.pool_to_vaults
            .iter()
            .filter(|(_, (vault_a, vault_b))| {
                vault_a == vault_address || vault_b == vault_address
            })
            .map(|(pool_addr, _)| pool_addr.clone())
            .collect()
    }
    
    /// 获取统计信息
    pub fn get_stats(&self) -> VaultReaderStats {
        VaultReaderStats {
            total_pools: self.pool_to_vaults.len(),
            total_vaults: self.vaults.len(),
            vaults_with_data: self.vaults.values().filter(|v| v.amount > 0).count(),
        }
    }
}

/// VaultReader 统计信息
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VaultReaderStats {
    pub total_pools: usize,
    pub total_vaults: usize,
    pub vaults_with_data: usize,
}

impl Default for VaultReader {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_vault_reader() {
        let mut reader = VaultReader::new();
        
        // 注册池子
        reader.register_pool_vaults(
            "pool123",
            "vaultA456",
            "vaultB789"
        );
        
        assert!(reader.has_pool_vaults("pool123"));
        assert!(!reader.has_pool_vaults("pool999"));
        
        assert!(reader.is_vault_account("vaultA456"));
        assert!(reader.is_vault_account("vaultB789"));
        assert!(!reader.is_vault_account("unknown"));
    }
    
    #[test]
    fn test_get_pool_reserves() {
        let mut reader = VaultReader::new();
        
        reader.register_pool_vaults(
            "pool123",
            "vaultA456",
            "vaultB789"
        );
        
        // 模拟更新 vault（实际使用需要真实的 token account 数据）
        // 这里只测试逻辑
        
        let reserves = reader.get_pool_reserves("pool123");
        // 初始应该是 (0, 0)
        assert_eq!(reserves, Some((0, 0)));
    }
}



