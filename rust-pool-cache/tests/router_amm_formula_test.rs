/*!
 * AMM公式正确性测试
 * 
 * 验证精确AMM计算公式的正确性，确保与Uniswap V2、Raydium等DEX一致
 */

use solana_pool_cache::dex_interface::amm_calculator;

#[test]
fn test_amm_formula_small_trade() {
    // 测试小额交易：1 SOL in 1000 SOL / 185000 USDC pool
    let output = amm_calculator::calculate_amm_output_f64(
        1.0,        // 1 SOL
        1000.0,     // 1000 SOL reserve
        185000.0,   // 185000 USDC reserve
        0.0025,     // 0.25% fee
    );
    
    // 预期：~184.815 USDC (minimal slippage)
    assert!(output >= 184.8 && output <= 184.82, "Small trade output: {}", output);
    
    // 验证滑点很小
    let linear_output = 1.0 * 185.0;
    let slippage_pct = ((linear_output - output) / linear_output) * 100.0;
    assert!(slippage_pct < 0.15, "Slippage should be <0.15%, got: {:.2}%", slippage_pct);
}

#[test]
fn test_amm_formula_medium_trade() {
    // 测试中额交易：10 SOL (1% of pool)
    let output = amm_calculator::calculate_amm_output_f64(
        10.0,       // 10 SOL
        1000.0,     // 1000 SOL reserve
        185000.0,   // 185000 USDC reserve
        0.0025,
    );
    
    // 线性会给出：10 × 185 = 1850 USDC
    // AMM应该略低，约1832 USDC（~1% 滑点）
    assert!(output >= 1825.0 && output <= 1835.0, "Medium trade output: {}", output);
    
    let linear_output = 10.0 * 185.0;
    let slippage_pct = ((linear_output - output) / linear_output) * 100.0;
    assert!(slippage_pct >= 0.8 && slippage_pct <= 1.5, "Slippage: {:.2}%", slippage_pct);
}

#[test]
fn test_amm_formula_large_trade() {
    // 测试大额交易：100 SOL (10% of pool)
    let output = amm_calculator::calculate_amm_output_f64(
        100.0,      // 100 SOL
        1000.0,     // 1000 SOL reserve
        185000.0,   // 185000 USDC reserve
        0.0025,
    );
    
    // 线性会给出：100 × 185 = 18500 USDC
    // AMM应该明显更低，约16800 USDC（~9% �ippage）
    assert!(output >= 16700.0 && output <= 16900.0, "Large trade output: {}", output);
    
    let linear_output = 100.0 * 185.0;
    let slippage_pct = ((linear_output - output) / linear_output) * 100.0;
    assert!(slippage_pct >= 8.0 && slippage_pct <= 10.0, "Slippage: {:.2}%", slippage_pct);
}

#[test]
fn test_amm_formula_zero_fee() {
    // 测试零手续费（如Lifinity）
    let output = amm_calculator::calculate_amm_output_f64(
        1.0,
        1000.0,
        185000.0,
        0.0,  // 零手续费
    );
    
    // 零手续费时，输出应该略高
    assert!(output >= 184.98 && output <= 185.01, "Zero fee output: {}", output);
}

#[test]
fn test_amm_formula_high_fee() {
    // 测试高手续费（如某些DEX的0.3%）
    let output = amm_calculator::calculate_amm_output_f64(
        1.0,
        1000.0,
        185000.0,
        0.003,  // 0.3% fee
    );
    
    // 高手续费时，输出应该更低
    assert!(output >= 184.6 && output <= 184.7, "High fee output: {}", output);
}

#[test]
fn test_constant_product_invariant() {
    // 验证恒定乘积不变式：x * y = k
    let reserve_in = 1000.0;
    let reserve_out = 185000.0;
    let k_before = reserve_in * reserve_out;
    
    let amount_in = 10.0;
    let fee_rate = 0.0025;
    
    let amount_out = amm_calculator::calculate_amm_output_f64(
        amount_in,
        reserve_in,
        reserve_out,
        fee_rate,
    );
    
    // 交易后的储备量
    let amount_in_with_fee = amount_in * (1.0 - fee_rate);
    let new_reserve_in = reserve_in + amount_in_with_fee;
    let new_reserve_out = reserve_out - amount_out;
    let k_after = new_reserve_in * new_reserve_out;
    
    // k应该保持不变（考虑浮点误差）
    let k_diff_pct = ((k_after - k_before) / k_before * 100.0).abs();
    assert!(k_diff_pct < 0.01, "Constant product variance: {:.4}%", k_diff_pct);
}

#[test]
fn test_amm_vs_linear_comparison() {
    // 比较不同交易规模下AMM vs 线性的差异
    let reserve_in = 1000.0;
    let reserve_out = 185000.0;
    let price = reserve_out / reserve_in;  // 185.0
    let fee = 0.0025;
    
    let test_amounts = vec![0.1, 1.0, 10.0, 50.0, 100.0];
    
    for amount in test_amounts {
        let amm_output = amm_calculator::calculate_amm_output_f64(
            amount,
            reserve_in,
            reserve_out,
            fee,
        );
        
        let linear_output = amount * price * (1.0 - fee);
        let error_pct = ((linear_output - amm_output) / amm_output * 100.0).abs();
        
        println!(
            "Amount: {} SOL | AMM: {:.2} USDC | Linear: {:.2} USDC | Error: {:.2}%",
            amount, amm_output, linear_output, error_pct
        );
        
        // 验证：交易越大，误差越大
        if amount >= 100.0 {
            assert!(error_pct >= 5.0, "Large trade should have >5% error");
        } else if amount <= 1.0 {
            assert!(error_pct < 0.5, "Small trade should have <0.5% error");
        }
    }
}


