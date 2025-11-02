/*!
 * Analyze Marinade State Structure
 * 基于实际数据逆向分析字段布局
 */

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

const MARINADE_STATE: &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

fn main() -> anyhow::Result<()> {
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    let state_address = Pubkey::from_str(MARINADE_STATE)?;
    
    println!("🔍 Analyzing Marinade State structure...\n");
    let data = client.get_account_data(&state_address)?;
    
    // Marinade State 已知字段（基于 Anchor + 官方文档）：
    // 0-8: discriminator
    // 8-40: msol_mint (Pubkey)
    // 40-72: admin_authority (Pubkey)
    // 72-104: operational_sol_account (Pubkey)
    // 104-136: treasury_msol_account (Pubkey)
    // ...继续
    
    println!("📊 Known Pubkey fields:");
    let msol_mint = Pubkey::try_from(&data[8..40])?;
    let admin = Pubkey::try_from(&data[40..72])?;
    let operational_sol = Pubkey::try_from(&data[72..104])?;
    let treasury_msol = Pubkey::try_from(&data[104..136])?;
    
    println!("   mSOL Mint: {}", msol_mint);
    println!("   Admin: {}", admin);
    println!("   Operational SOL: {}", operational_sol);
    println!("   Treasury mSOL: {}", treasury_msol);
    
    // 验证：mSOL mint 应该是 mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So
    let expected_msol_mint = Pubkey::from_str("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So")?;
    println!("\n✅ mSOL Mint验证: {}", msol_mint == expected_msol_mint);
    
    // 搜索 mSOL price（实际上是 exchange rate）
    // mSOL price = total_lamports_under_control / msol_supply
    // 预期 mSOL price 约为 1.05-1.10
    
    println!("\n🔬 Searching for exchange rate components:");
    println!("   Looking for values where: total_lamports / msol_supply ≈ 1.05-1.10\n");
    
    for i in (136..500).step_by(8) {
        if i + 16 > data.len() { break; }
        
        let val1 = u64::from_le_bytes(data[i..i+8].try_into()?);
        let val2 = u64::from_le_bytes(data[i+8..i+16].try_into()?);
        
        // 检查两种可能的顺序
        if val1 > 0 && val2 > 0 {
            let rate1 = val2 as f64 / val1 as f64;
            let rate2 = val1 as f64 / val2 as f64;
            
            // mSOL exchange rate 应该在 1.0-1.2 之间
            if (1.0..=1.2).contains(&rate1) {
                println!("   ✅ Offset {}: {} / {} = {:.6}", 
                         i, val2, val1, rate1);
                println!("      (msol_supply at {}, total_lamports at {})", i, i+8);
            } else if (1.0..=1.2).contains(&rate2) {
                println!("   ✅ Offset {}: {} / {} = {:.6}", 
                         i, val1, val2, rate2);
                println!("      (msol_supply at {}, total_lamports at {})", i+8, i);
            }
        }
    }
    
    // 基于 Marinade 官方结构，最有可能的布局：
    println!("\n🎯 Most likely structure (based on Anchor patterns):");
    println!("   Offset 0-8: discriminator");
    println!("   Offset 8-40: msol_mint");
    println!("   Offset 40-72: admin_authority");
    println!("   Offset 72-104: operational_sol_account");
    println!("   Offset 104-136: treasury_msol_account");
    println!("   Offset 136-144: reserve_bump_seed (u8 + padding)");
    println!("   Offset 144-152: msol_mint_authority_bump_seed");
    println!("   Offset 152-160: rent_exempt_for_token_acc (u64)");
    println!("   Offset 160-168: reward_fee_bp (u32 + padding)");
    println!("   Offset 168-176: stake_system_fee");
    println!("   Offset 176-184: ⭐ msol_supply (u64) - CRITICAL");
    println!("   Offset 184-192: msol_price (u64 in basis points?)");
    
    // 验证这个假设
    if data.len() >= 192 {
        let msol_supply = u64::from_le_bytes(data[176..184].try_into()?);
        let next_val = u64::from_le_bytes(data[184..192].try_into()?);
        
        println!("\n📊 Testing hypothesis:");
        println!("   mSOL supply (offset 176): {} ({:.2} million mSOL)", 
                 msol_supply, msol_supply as f64 / 1e9);
        println!("   Next value (offset 184): {}", next_val);
        
        // 在更远的地方搜索 total_lamports_under_control
        // 通常在 stake account info 之后
        println!("\n🔍 Searching for total_lamports_under_control...");
        for i in (300..600).step_by(8) {
            if i + 8 > data.len() { break; }
            let val = u64::from_le_bytes(data[i..i+8].try_into()?);
            
            if val > 0 {
                let rate = val as f64 / msol_supply as f64;
                if (1.0..=1.2).contains(&rate) {
                    println!("   ✅ Offset {}: {} (rate = {:.6})", i, val, rate);
                }
            }
        }
    }
    
    Ok(())
}

