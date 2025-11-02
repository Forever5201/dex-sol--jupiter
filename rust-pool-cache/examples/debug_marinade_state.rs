/*!
 * Debug Marinade State Account Structure
 * 
 * 用于诊断 Marinade State 账户的实际字段布局
 */

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

const MARINADE_STATE: &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

fn main() -> anyhow::Result<()> {
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    let state_address = Pubkey::from_str(MARINADE_STATE)?;
    
    println!("🔍 Fetching Marinade State account...");
    let account_data = client.get_account_data(&state_address)?;
    
    println!("\n📊 Account Data Summary:");
    println!("   Total size: {} bytes", account_data.len());
    
    // 打印前 512 字节的十六进制和可能的字段
    println!("\n📖 Account Data (hex dump):");
    for (i, chunk) in account_data.chunks(32).enumerate().take(16) {
        print!("   {:04}: ", i * 32);
        for byte in chunk {
            print!("{:02x} ", byte);
        }
        
        // 尝试解析为 u64
        if chunk.len() >= 8 {
            let value = u64::from_le_bytes(chunk[0..8].try_into().unwrap());
            print!("  | u64: {}", value);
        }
        println!();
    }
    
    // 尝试不同的偏移量读取 mSOL supply 和 total lamports
    println!("\n🔬 Testing different offsets for mSOL supply and total lamports:");
    
    // Marinade State 实际结构（基于 Anchor）
    // discriminator: 8 bytes
    // msol_mint: 32 bytes (offset 8)
    // admin_authority: 32 bytes (offset 40)
    // ...
    
    let test_offsets = vec![
        (288, 296, "Current code"),
        (8, 16, "After discriminator"),
        (72, 80, "Offset 72"),
        (104, 112, "Offset 104"),
        (136, 144, "Offset 136"),
        (200, 208, "Offset 200"),
        (232, 240, "Offset 232"),
        (264, 272, "Offset 264"),
        (296, 304, "Offset 296"),
        (328, 336, "Offset 328"),
    ];
    
    for (supply_offset, lamports_offset, label) in test_offsets {
        if account_data.len() >= lamports_offset + 8 {
            let supply = u64::from_le_bytes(account_data[supply_offset..supply_offset+8].try_into()?);
            let lamports = u64::from_le_bytes(account_data[lamports_offset..lamports_offset+8].try_into()?);
            
            let rate = if supply > 0 {
                lamports as f64 / supply as f64
            } else {
                0.0
            };
            
            println!("   [{:20}] supply={:20} lamports={:20} rate={:.6}", 
                     label, supply, lamports, rate);
        }
    }
    
    // 搜索所有可能的有效 mSOL supply（应该是一个很大的数字）
    println!("\n🎯 Searching for likely mSOL supply values (> 1B lamports):");
    for i in (0..account_data.len()-8).step_by(8) {
        let value = u64::from_le_bytes(account_data[i..i+8].try_into()?);
        
        // mSOL supply 应该在 10^15 到 10^18 lamports 范围内
        if value > 1_000_000_000_000_000 && value < 1_000_000_000_000_000_000 {
            println!("   Offset {}: {} ({:.2} million mSOL)", i, value, value as f64 / 1e9);
        }
    }
    
    println!("\n✅ Debug complete!");
    Ok(())
}

