use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use crate::dex_interface::DexError;

pub struct MintDecimalsCache {
    rpc_client: Arc<RpcClient>,
    cache: Arc<RwLock<HashMap<Pubkey, u8>>>,
}

impl MintDecimalsCache {
    pub fn new(rpc_url: &str) -> Self {
        let rpc_client = Arc::new(RpcClient::new(rpc_url.to_string()));
        Self {
            rpc_client,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn get_or_fetch_decimals(&self, mint: &Pubkey) -> Result<u8, DexError> {
        {
            let cache = self.cache.read().map_err(|e| {
                DexError::DeserializationFailed(format!("Mint decimals cache poisoned: {}", e))
            })?;
            if let Some(dec) = cache.get(mint) {
                return Ok(*dec);
            }
        }

        let account_data = self
            .rpc_client
            .get_account_data(mint)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Failed to fetch mint account {}: {}",
                mint, e
            )))?;

        if account_data.len() < 45 {
            return Err(DexError::DeserializationFailed(
                "Mint account data too short".to_string(),
            ));
        }

        let decimals = account_data[44];

        {
            if let Ok(mut cache) = self.cache.write() {
                cache.insert(*mint, decimals);
            }
        }

        Ok(decimals)
    }
}

static mut GLOBAL_MINT_CACHE: Option<Arc<MintDecimalsCache>> = None;

pub fn init_global_mint_cache(rpc_url: &str) {
    unsafe {
        if GLOBAL_MINT_CACHE.is_none() {
            GLOBAL_MINT_CACHE = Some(Arc::new(MintDecimalsCache::new(rpc_url)));
        }
    }
}

pub fn get_global_mint_cache() -> Option<Arc<MintDecimalsCache>> {
    unsafe { GLOBAL_MINT_CACHE.clone() }
}
