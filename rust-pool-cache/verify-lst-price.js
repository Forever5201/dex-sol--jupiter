const http = require('http');

async function verifyLstPrices() {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3001/prices', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const prices = JSON.parse(data);
                    
                    const raydium = prices.find(p => p.pair === 'SOL/mSOL (Raydium CLMM)');
                    const phoenix = prices.find(p => p.pair === 'mSOL/SOL (Phoenix)');
                    
                    if (!raydium || !phoenix) {
                        console.log('未找到池子数据');
                        return;
                    }
                    
                    console.log('\n🔍 实时价格验证（从链上数据）\n');
                    console.log('='.repeat(70) + '\n');
                    
                    console.log('📊 Raydium CLMM SOL/mSOL:');
                    console.log(`   原始价格: ${raydium.price.toFixed(4)} (这是mSOL/SOL方向)`);
                    const raydium_std = 1 / raydium.price;
                    console.log(`   标准化价格: ${raydium_std.toFixed(4)} SOL/mSOL`);
                    console.log(`   Base Reserve: ${(raydium.base_reserve / 1e9).toFixed(2)} SOL`);
                    console.log(`   Quote Reserve: ${(raydium.quote_reserve / 1e9).toFixed(2)} mSOL\n`);
                    
                    console.log('📊 Phoenix mSOL/SOL:');
                    console.log(`   价格: ${phoenix.price.toFixed(4)} SOL/mSOL`);
                    console.log(`   Base Reserve: ${(phoenix.base_reserve / 1e9).toFixed(2)} mSOL`);
                    console.log(`   Quote Reserve: ${(phoenix.quote_reserve / 1e9).toFixed(2)} SOL\n`);
                    
                    console.log('='.repeat(70) + '\n');
                    
                    console.log('💡 价格对比分析（标准化后都是SOL/mSOL）:\n');
                    console.log(`   Raydium标准化: ${raydium_std.toFixed(6)} SOL/mSOL`);
                    console.log(`   Phoenix价格:   ${phoenix.price.toFixed(6)} SOL/mSOL`);
                    
                    const diff = ((phoenix.price - raydium_std) / raydium_std * 100);
                    console.log(`   价格差异: ${diff.toFixed(2)}%`);
                    
                    if (diff > 0) {
                        console.log(`   → 在Raydium买mSOL更便宜`);
                    } else {
                        console.log(`   → 在Phoenix买mSOL更便宜`);
                    }
                    
                    console.log('\n' + '='.repeat(70) + '\n');
                    
                    console.log('📈 套利ROI详细计算:\n');
                    console.log(`   1. 理论价差: ${diff.toFixed(3)}%`);
                    console.log(`   2. Raydium CLMM手续费: 0.01%`);
                    console.log(`   3. Phoenix手续费: 0.05%`);
                    console.log(`   4. 总手续费: 0.06%`);
                    
                    const netRoi = diff - 0.06;
                    console.log(`   5. 净ROI: ${netRoi.toFixed(2)}%\n`);
                    
                    if (Math.abs(netRoi - 9.07) < 1) {
                        console.log('   ✅ 与系统报告的9.07%匹配！\n');
                    }
                    
                    // 考虑滑点
                    const slippage = diff * 0.3; // 假设30%的价差会被滑点消耗
                    const actualRoi = diff - 0.06 - slippage;
                    
                    console.log(`   6. 预估滑点损失: ${slippage.toFixed(2)}% (约30%的价差)`);
                    console.log(`   7. 实际可能ROI: ${actualRoi.toFixed(2)}%\n`);
                    
                    console.log('='.repeat(70) + '\n');
                    
                    console.log('🎯 最终验证结论:\n');
                    
                    if (diff <= 0) {
                        console.log('   ❌ 无套利机会（价差<=0%）');
                        console.log('   → 实际是Phoenix更便宜，方向相反');
                    } else if (diff > 0 && diff < 3) {
                        console.log('   ✅ 价差正常（<3%），可能是真实的小幅机会');
                        console.log(`   → 预期实际收益: $${(actualRoi * 10).toFixed(2)}（投资$1000）`);
                        console.log('   → 建议: 可以尝试小额测试$100-200');
                    } else if (diff >= 3 && diff < 7) {
                        console.log('   ⚠️ 价差偏高（3-7%），谨慎对待');
                        console.log(`   → 预期实际收益: $${(actualRoi * 10).toFixed(2)}（投资$1000）`);
                        console.log('   → 可能原因: 流动性差异、数据延迟');
                        console.log('   → 建议: 极小额测试$50-100，快速执行');
                    } else if (diff >= 7 && diff < 12) {
                        console.log('   ⚠️ 价差很高（7-12%），高度怀疑');
                        console.log(`   → 如果真实，预期收益: $${(actualRoi * 10).toFixed(2)}（投资$1000）`);
                        console.log('   → 但很可能是: 数据延迟、流动性极差、或计算bug');
                        console.log('   → 建议: 在Raydium和Phoenix界面人工确认后再决定');
                    } else {
                        console.log('   ❌ 价差过高（>12%），几乎肯定是错误');
                        console.log('   → 真实市场不会有这么大的持续价差');
                        console.log('   → 建议: 不执行');
                    }
                    
                    console.log('\n' + '='.repeat(70));
                    
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

verifyLstPrices().catch(console.error);







