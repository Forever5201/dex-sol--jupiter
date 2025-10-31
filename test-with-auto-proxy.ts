/**
 * 使用自动代理检测的 Jupiter API 测试
 */

import { NetworkAdapter, autoSetupProxyEnv } from '@solana-arb-bot/core';

console.log('========================================');
console.log('  Jupiter API 测试（自动代理）');
console.log('========================================\n');

// 1. 自动设置代理
console.log('[1] 自动检测系统代理...');
autoSetupProxyEnv();

console.log(`   HTTP_PROXY  = ${process.env.HTTP_PROXY}`);
console.log(`   HTTPS_PROXY = ${process.env.HTTPS_PROXY}\n`);

// 2. 测试 Legacy Swap API
async function testLegacySwapAPI() {
  console.log('[2] 测试 Legacy Swap API...');
  
  try {
    const startTime = Date.now();
    
    const response = await NetworkAdapter.axios.get(
      'https://lite-api.jup.ag/swap/v1/quote',
      {
        params: {
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '100000000',
          slippageBps: '50',
        },
        timeout: 30000,
      }
    );
    
    const duration = Date.now() - startTime;
    
    if (response.status === 200 && response.data.outAmount) {
      console.log(`   ✅ 成功! 耗时: ${duration}ms`);
      console.log(`   出金: ${response.data.outAmount}`);
      console.log(`   路由: ${response.data.routePlan?.length || 0} 跳\n`);
      
      if (response.data.routePlan) {
        response.data.routePlan.forEach((hop: any, i: number) => {
          console.log(`      跳 ${i + 1}: ${hop.swapInfo?.label || 'Unknown'}`);
        });
      }
      
      return true;
    } else {
      console.log(`   ❌ 失败: HTTP ${response.status}\n`);
      return false;
    }
  } catch (error: any) {
    console.log(`   ❌ 异常: ${error.message}`);
    if (error.code) {
      console.log(`   错误代码: ${error.code}\n`);
    }
    return false;
  }
}

// 3. 测试 Ultra API
async function testUltraAPI() {
  console.log('[3] 测试 Ultra API...');
  
  try {
    const startTime = Date.now();
    
    const response = await NetworkAdapter.axios.get(
      'https://lite-api.jup.ag/ultra/v1/order',
      {
        params: {
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '100000000',
          taker: 'jdocuPgEAjMfihABsPgKEvYtsmMzjUHeq9LX4Hvs7f3',
        },
        timeout: 30000,
      }
    );
    
    const duration = Date.now() - startTime;
    
    if (response.status === 200 && response.data.outAmount) {
      console.log(`   ✅ 成功! 耗时: ${duration}ms`);
      console.log(`   出金: ${response.data.outAmount}`);
      console.log(`   路由: ${response.data.routePlan?.length || 0} 跳\n`);
      return true;
    } else {
      console.log(`   ❌ 失败: HTTP ${response.status}\n`);
      return false;
    }
  } catch (error: any) {
    console.log(`   ❌ 异常: ${error.message}`);
    if (error.code) {
      console.log(`   错误代码: ${error.code}\n`);
    }
    return false;
  }
}

// 运行测试
(async () => {
  console.log('\n开始测试...\n');
  
  const result1 = await testLegacySwapAPI();
  const result2 = await testUltraAPI();
  
  console.log('\n========================================');
  console.log('  测试结果');
  console.log('========================================');
  console.log(`Legacy Swap API: ${result1 ? '✅ 通过' : '❌ 失败'}`);
  console.log(`Ultra API:       ${result2 ? '✅ 通过' : '❌ 失败'}`);
  console.log('\n如果测试通过，您可以运行闪电贷机器人了！');
  console.log('========================================\n');
})().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});





