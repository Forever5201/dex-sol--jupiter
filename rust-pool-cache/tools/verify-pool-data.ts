/**
 * 验证池子链上数据工具
 * 检查 HumidiFi 和 AlphaQ 的实际状态
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const connection = new Connection(RPC_URL, 'confirmed');

// HumidiFi 池子地址
const HUMIDIFI_POOLS = {
  'JUP/USDC': 'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm',
  'USDC/USDT': '6n9VhCwQ7EwK6NqFDjnHPzEk6wZdRBTfh43RFgHQWHuQ',
  'USD1/USDC': '3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuekia2',
};

// AlphaQ 池子地址
const ALPHAQ_POOLS = {
  'USDT/USDC': 'Pi9nzTjPxD8DsRfRBGfKYzmefJoJM8TcXu2jyaQjSHm',
  'USDC/USD1': '9xPhpwq6GLUkrDBNfXCbnSP9ARAMMyUQqgkrqaDW6NLV',
  'USDS/USDC': '6R3LknvRLwPg7c8Cww7LKqBHRDcGioPoj29uURX9anug',
};

async function analyzeHumidiFiPool(name: string, address: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 HumidiFi Pool: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`地址: ${address}`);

  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(address));
    if (!accountInfo) {
      console.log('❌ 池子账户不存在');
      return;
    }

    console.log(`✅ 账户数据大小: ${accountInfo.data.length} bytes`);
    console.log(`   Owner: ${accountInfo.owner.toBase58()}`);

    // 读取 vault 地址 (offset 40 + 3*32 = 136 for pubkey_4, 168 for pubkey_5)
    const vaultA = new PublicKey(accountInfo.data.slice(40 + 3 * 32, 40 + 4 * 32));
    const vaultB = new PublicKey(accountInfo.data.slice(40 + 4 * 32, 40 + 5 * 32));

    console.log(`\n📦 Vault 地址:`);
    console.log(`   Vault A: ${vaultA.toBase58()}`);
    console.log(`   Vault B: ${vaultB.toBase58()}`);

    // 查询 vault 余额
    const [vaultAInfo, vaultBInfo] = await Promise.all([
      connection.getAccountInfo(vaultA),
      connection.getAccountInfo(vaultB),
    ]);

    if (vaultAInfo && vaultAInfo.data.length >= 64) {
      // SPL Token Account: amount 在 offset 64
      const amountA = vaultAInfo.data.readBigUInt64LE(64);
      console.log(`   Vault A 余额: ${amountA.toString()} (${Number(amountA) / 1e6} tokens)`);
    } else {
      console.log(`   ❌ Vault A 数据无效`);
    }

    if (vaultBInfo && vaultBInfo.data.length >= 64) {
      const amountB = vaultBInfo.data.readBigUInt64LE(64);
      console.log(`   Vault B 余额: ${amountB.toString()} (${Number(amountB) / 1e6} tokens)`);
    } else {
      console.log(`   ❌ Vault B 数据无效`);
    }

    // 检查配置字段是否全为 0
    const configStart = 40 + 25 * 32; // 40 bytes header + 25 pubkeys
    const configEnd = configStart + 111 * 8;
    let allZeros = true;
    for (let i = configStart; i < configEnd; i += 8) {
      if (accountInfo.data.readBigUInt64LE(i) !== 0n) {
        allZeros = false;
        break;
      }
    }
    console.log(`\n⚙️  配置字段 (111个u64): ${allZeros ? '✅ 全部为 0 (确认需要 vault 读取)' : '❌ 包含非零值'}`);

  } catch (error) {
    console.log(`❌ 错误: ${error}`);
  }
}

async function analyzeAlphaQPool(name: string, address: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 AlphaQ Pool: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`地址: ${address}`);

  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(address));
    if (!accountInfo) {
      console.log('❌ 池子账户不存在');
      return;
    }

    console.log(`✅ 账户数据大小: ${accountInfo.data.length} bytes`);
    console.log(`   Owner: ${accountInfo.owner.toBase58()}`);

    // 结构: 16 bytes name + 10 pubkeys (320) + 9 u64 padding (72) + reserve_a (8) + reserve_b (8) + 31 u64 config (248)
    // reserve_a offset: 16 + 320 + 72 = 408
    // reserve_b offset: 16 + 320 + 72 + 8 = 416

    const offset_reserve_a = 16 + 320 + 72; // 408
    const offset_reserve_b = offset_reserve_a + 8; // 416

    // 也尝试一些其他可能的 offset
    const possibleOffsets = [
      { name: '当前实现 (408, 416)', a: offset_reserve_a, b: offset_reserve_b },
      { name: '紧跟 pubkeys (336, 344)', a: 336, b: 344 },
      { name: '偏移 +8 (416, 424)', a: 416, b: 424 },
      { name: '偏移 +16 (424, 432)', a: 424, b: 432 },
      { name: '后段区域 (560, 568)', a: 560, b: 568 },
    ];

    console.log(`\n📊 储备量读取测试 (多个 offset):`);
    
    for (const test of possibleOffsets) {
      if (test.a + 8 <= accountInfo.data.length && test.b + 8 <= accountInfo.data.length) {
        const reserveA = accountInfo.data.readBigUInt64LE(test.a);
        const reserveB = accountInfo.data.readBigUInt64LE(test.b);
        const price = Number(reserveB) / Number(reserveA);
        
        console.log(`\n  ${test.name}:`);
        console.log(`    Reserve A: ${reserveA.toString().padStart(20)} (${(Number(reserveA) / 1e6).toFixed(2)} tokens)`);
        console.log(`    Reserve B: ${reserveB.toString().padStart(20)} (${(Number(reserveB) / 1e6).toFixed(2)} tokens)`);
        console.log(`    价格: ${price.toFixed(6)} ${price > 0.9 && price < 1.1 ? '✅ 合理' : '⚠️ 异常'}`);
      }
    }

    // 读取 vault 地址并检查余额
    const vaultAOffset = 16 + 3 * 32; // token_a_vault
    const vaultBOffset = 16 + 4 * 32; // token_b_vault
    
    const vaultA = new PublicKey(accountInfo.data.slice(vaultAOffset, vaultAOffset + 32));
    const vaultB = new PublicKey(accountInfo.data.slice(vaultBOffset, vaultBOffset + 32));

    console.log(`\n📦 Vault 余额验证:`);
    console.log(`   Vault A: ${vaultA.toBase58()}`);
    console.log(`   Vault B: ${vaultB.toBase58()}`);

    const [vaultAInfo, vaultBInfo] = await Promise.all([
      connection.getAccountInfo(vaultA),
      connection.getAccountInfo(vaultB),
    ]);

    if (vaultAInfo && vaultAInfo.data.length >= 72) {
      const amountA = vaultAInfo.data.readBigUInt64LE(64);
      console.log(`   Vault A 实际余额: ${amountA.toString()} (${Number(amountA) / 1e6} tokens)`);
    }

    if (vaultBInfo && vaultBInfo.data.length >= 72) {
      const amountB = vaultBInfo.data.readBigUInt64LE(64);
      console.log(`   Vault B 实际余额: ${amountB.toString()} (${Number(amountB) / 1e6} tokens)`);
      
      // 用 vault 余额计算价格
      if (vaultAInfo && vaultAInfo.data.length >= 72) {
        const amountA = vaultAInfo.data.readBigUInt64LE(64);
        const vaultPrice = Number(amountB) / Number(amountA);
        console.log(`\n   🎯 基于 Vault 的价格: ${vaultPrice.toFixed(6)} ${vaultPrice > 0.9 && vaultPrice < 1.1 ? '✅ 合理!' : '⚠️ 异常'}`);
      }
    }

  } catch (error) {
    console.log(`❌ 错误: ${error}`);
  }
}

async function main() {
  console.log('\n🔍 池子数据验证工具');
  console.log('='.repeat(60));
  console.log(`RPC: ${RPC_URL.substring(0, 50)}...`);
  console.log('='.repeat(60));

  // 检查 HumidiFi
  console.log('\n\n' + '█'.repeat(60));
  console.log('█  HumidiFi 池子分析');
  console.log('█'.repeat(60));

  for (const [name, address] of Object.entries(HUMIDIFI_POOLS)) {
    await analyzeHumidiFiPool(name, address);
  }

  // 检查 AlphaQ
  console.log('\n\n' + '█'.repeat(60));
  console.log('█  AlphaQ 池子分析');
  console.log('█'.repeat(60));

  for (const [name, address] of Object.entries(ALPHAQ_POOLS)) {
    await analyzeAlphaQPool(name, address);
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('✅ 分析完成');
  console.log('='.repeat(60));
}

main().catch(console.error);

