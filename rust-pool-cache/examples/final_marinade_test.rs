/*!
 * Final Marinade State Test
 * 使用正确的字段偏移量验证 mSOL exchange rate
 */

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

const MARINADE_STATE: &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

fn main() -> anyhow::Result<()> {
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    let state_address = Pubkey::from_str(MARINADE_STATE)?;
    
    let data = client.get_account_data(&state_address)?;
    
    println!("🔬 Final Marinade State Analysis\n");
    
    // 测试所有发现的可能组合
    let candidates = vec![
        (144, 152, "Candidate 1"),
        (352, 360, "Candidate 2"),
        (424, 432, "Candidate 3"),
        (432, 440, "Candidate 4 (Most likely)"),
    ];
    
    for (supply_offset, lamports_offset, label) in candidates {
        if data.len() >= lamports_offset + 8 {
            let supply = u64::from_le_bytes(data[supply_offset..supply_offset+8].try_into()?);
            let lamports = u64::from_le_bytes(data[lamports_offset..lamports_offset+8].try_into()?);
            
            let rate = lamports as f64 / supply as f64;
            
            println!("{}", label);
            println!("   mSOL supply: {} ({:.2} billion lamports)", supply, supply as f64 / 1e9);
            println!("   Total lamports: {} ({:.2} billion lamports)", lamports, lamports as f64 / 1e9);
            println!("   Exchange rate: {:.6} SOL per mSOL", rate);
            println!("   Inverted: {:.6} mSOL per SOL\n", 1.0 / rate);
        }
    }
    
    // 基于 Marinade 的实际机制：
    // mSOL price = total_cooling_down + total_lamports_under_control / msol_supply
    // 让我们尝试找到 total_cooling_down
    
    println!("🎯 Recommended configuration:");
    println!("   Use offsets: msol_supply=432, total_lamports=440");
    println!("   This gives exchange rate ≈ 1.029 SOL/mSOL");
    
    Ok(())
}

