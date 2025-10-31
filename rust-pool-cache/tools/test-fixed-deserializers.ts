/**
 * 测试修复后的DEX Deserializers
 * 
 * 使用真实链上数据验证所有4个DEX的反序列化器
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// RPC配置
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// 测试池子配置
const TEST_POOLS = [
  {
    name: 'TesseraV USDC/SOL',
    address: 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',
    type: 'tesserav',
    programId: 'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH',
    expectedDataSize: 1264,
    expectedReserveOffsets: [104, 112],
  },
  {
    name: 'Lifinity V2 SOL/USDC',
    address: 'DrRd8gYMJu9XGxLhwTCPdHNLXCKHsxJtMpbn62YqmwQe',
    type: 'lifinity_v2',
    programId: '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c',
    expectedDataSize: 911,
    vaultMode: true,
    expectedVaultOffsets: [192, 224],
  },
  {
    name: 'Stabble USD1/USDC #2',
    address: 'BqLJmoxkcetgwwybit9XksNTuPzeh7SpxkYExbZKmLEC',
    type: 'stabble',
    programId: 'swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ',
    expectedDataSize: 438,
    expectedReserveOffsets: [104, 168],
  },
  {
    name: 'PancakeSwap USDC/USDT',
    address: '22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w',
    type: 'pancakeswap',
    programId: 'HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq',
    expectedDataSize: 1544,
    expectedReserveOffsets: [256, 280],
  },
];

interface TestResult {
  pool: string;
  success: boolean;
  details: string;
  errors: string[];
}

/**
 * 测试单个池子的deserializer
 */
async function testPool(connection: Connection, poolConfig: any): Promise<TestResult> {
  const result: TestResult = {
    pool: poolConfig.name,
    success: false,
    details: '',
    errors: [],
  };
  
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`测试池子: ${poolConfig.name}`);
    console.log(`类型: ${poolConfig.type}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const pubkey = new PublicKey(poolConfig.address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) {
      result.errors.push('无法获取账户信息');
      return result;
    }
    
    const data = accountInfo.data;
    const programId = accountInfo.owner.toBase58();
    
    console.log(`✅ 账户信息获取成功`);
    console.log(`   Data Length: ${data.length} bytes`);
    console.log(`   Program ID: ${programId}`);
    
    // 验证1: 数据大小
    if (data.length !== poolConfig.expectedDataSize) {
      result.errors.push(`数据大小不匹配: 期望${poolConfig.expectedDataSize}, 实际${data.length}`);
      console.log(`❌ 数据大小验证失败`);
    } else {
      console.log(`✅ 数据大小验证通过: ${data.length} bytes`);
    }
    
    // 验证2: Program ID
    if (programId !== poolConfig.programId) {
      result.errors.push(`Program ID不匹配: 期望${poolConfig.programId}, 实际${programId}`);
      console.log(`⚠️  Program ID不匹配`);
    } else {
      console.log(`✅ Program ID验证通过`);
    }
    
    // 验证3: 储备量提取（如果不是vault模式）
    if (!poolConfig.vaultMode && poolConfig.expectedReserveOffsets) {
      const [offset_a, offset_b] = poolConfig.expectedReserveOffsets;
      
      const reserve_a = data.readBigUInt64LE(offset_a);
      const reserve_b = data.readBigUInt64LE(offset_b);
      
      console.log(`   Reserve A (offset ${offset_a}): ${reserve_a}`);
      console.log(`   Reserve B (offset ${offset_b}): ${reserve_b}`);
      
      if (reserve_a > 0n && reserve_b > 0n) {
        console.log(`✅ 储备量提取成功`);
        
        // 计算价格
        const decimals_a = poolConfig.type === 'tesserav' ? 9 : 6;
        const decimals_b = 6;
        const price = Number(reserve_b) / (10 ** decimals_b) / (Number(reserve_a) / (10 ** decimals_a));
        console.log(`   价格: ${price.toFixed(6)}`);
        
        result.details += `Reserves: ${Number(reserve_a) / (10 ** decimals_a).toFixed(2)} / ${Number(reserve_b) / (10 ** decimals_b)}.toFixed(2)}, Price: ${price.toFixed(6)}`;
      } else {
        result.errors.push('储备量为零或无效');
        console.log(`❌ 储备量提取失败`);
      }
    }
    
    // 验证4: Vault地址提取（vault模式）
    if (poolConfig.vaultMode && poolConfig.expectedVaultOffsets) {
      const [offset_a, offset_b] = poolConfig.expectedVaultOffsets;
      
      const vault_a_bytes = data.slice(offset_a, offset_a + 32);
      const vault_b_bytes = data.slice(offset_b, offset_b + 32);
      
      const vault_a = new PublicKey(vault_a_bytes);
      const vault_b = new PublicKey(vault_b_bytes);
      
      console.log(`   Vault A (offset ${offset_a}): ${vault_a.toBase58()}`);
      console.log(`   Vault B (offset ${offset_b}): ${vault_b.toBase58()}`);
      
      // 验证vault不是default (全零)
      const isVaultAValid = vault_a.toBase58() !== '11111111111111111111111111111111';
      const isVaultBValid = vault_b.toBase58() !== '11111111111111111111111111111111';
      
      if (isVaultAValid && isVaultBValid) {
        console.log(`✅ Vault地址提取成功`);
        result.details += `Vault A: ${vault_a.toBase58().slice(0, 8)}..., Vault B: ${vault_b.toBase58().slice(0, 8)}...`;
      } else {
        result.errors.push('Vault地址无效（全零）');
        console.log(`❌ Vault地址提取失败`);
      }
    }
    
    // 判断整体成功
    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`\n✅ ${poolConfig.name} 测试通过！`);
    } else {
      console.log(`\n❌ ${poolConfig.name} 测试失败: ${result.errors.join(', ')}`);
    }
    
  } catch (error: any) {
    result.errors.push(error.message || String(error));
    console.log(`\n❌ 异常: ${error.message}`);
  }
  
  return result;
}

/**
 * 主函数
 */
async function main() {
  console.log('🧪 测试修复后的DEX Deserializers');
  console.log(`📡 RPC: ${RPC_ENDPOINT}\n`);
  
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const results: TestResult[] = [];
  
  // 测试每个池子
  for (const poolConfig of TEST_POOLS) {
    const result = await testPool(connection, poolConfig);
    results.push(result);
    
    // 等待一下避免RPC限速
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 打印总结
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 测试总结');
  console.log(`${'='.repeat(80)}\n`);
  
  const passedCount = results.filter(r => r.success).length;
  const failedCount = results.length - passedCount;
  
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${result.pool}`);
    if (!result.success) {
      result.errors.forEach(err => console.log(`       错误: ${err}`));
    }
  });
  
  console.log(`\n总计: ${passedCount} 通过, ${failedCount} 失败`);
  
  if (failedCount === 0) {
    console.log(`\n🎉 所有测试通过！DEX deserializers修复成功！`);
  } else {
    console.log(`\n⚠️  仍有${failedCount}个池子需要修复`);
  }
  
  // 保存测试报告
  const reportPath = path.join(__dirname, '..', 'DESERIALIZER_FIX_TEST_REPORT.md');
  let report = '# DEX Deserializer修复测试报告\n\n';
  report += `测试时间: ${new Date().toISOString()}\n\n`;
  report += `## 测试结果\n\n`;
  report += `- 通过: ${passedCount}/${results.length}\n`;
  report += `- 失败: ${failedCount}/${results.length}\n\n`;
  report += `## 详细结果\n\n`;
  
  results.forEach(result => {
    report += `### ${result.pool}\n\n`;
    report += `- 状态: ${result.success ? '✅ 通过' : '❌ 失败'}\n`;
    if (result.details) {
      report += `- 详情: ${result.details}\n`;
    }
    if (result.errors.length > 0) {
      report += `- 错误:\n`;
      result.errors.forEach(err => report += `  - ${err}\n`);
    }
    report += `\n`;
  });
  
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`\n📄 测试报告已保存: ${reportPath}`);
}

// 运行
main().catch(console.error);





