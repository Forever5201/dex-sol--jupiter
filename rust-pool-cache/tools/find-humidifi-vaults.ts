/**
 * HumidiFi Vault 地址定位工具
 * 检查所有25个pubkey字段，找到真正的token账户
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const connection = new Connection(RPC_URL, 'confirmed');

const HUMIDIFI_JUP_USDC = 'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm';

async function analyzeAllPubkeys() {
  console.log('\n🔍 HumidiFi Vault 地址定位器');
  console.log('='.repeat(80));
  
  const accountInfo = await connection.getAccountInfo(new PublicKey(HUMIDIFI_JUP_USDC));
  if (!accountInfo) {
    console.log('❌ 无法获取池子账户数据');
    return;
  }

  const data = accountInfo.data;
  
  // 读取所有25个pubkey
  const pubkeys: PublicKey[] = [];
  for (let i = 0; i < 25; i++) {
    const offset = 40 + i * 32; // 跳过5个u64 header
    const pubkey = new PublicKey(data.slice(offset, offset + 32));
    pubkeys.push(pubkey);
  }
  
  console.log(`\n📊 分析 25 个 Pubkey 字段...\n`);
  
  // 并发检查所有pubkey对应的账户
  const results = await Promise.all(
    pubkeys.map(async (pubkey, idx) => {
      try {
        const info = await connection.getAccountInfo(pubkey);
        return {
          idx,
          pubkey: pubkey.toBase58(),
          exists: info !== null,
          owner: info?.owner.toBase58(),
          dataLen: info?.data.length,
          info
        };
      } catch (error) {
        return {
          idx,
          pubkey: pubkey.toBase58(),
          exists: false,
          owner: undefined,
          dataLen: undefined,
          info: null
        };
      }
    })
  );
  
  console.log('Pubkey 字段分析:\n');
  
  const tokenAccounts: Array<{
    idx: number;
    pubkey: string;
    amount: string;
    mint: string;
  }> = [];
  
  for (const r of results) {
    const status = r.exists ? '✅' : '❌';
    const ownerStr = r.owner ? r.owner.substring(0, 8) : 'N/A';
    const lenStr = r.dataLen !== undefined ? `${r.dataLen}b` : 'N/A';
    
    console.log(`pubkey[${r.idx.toString().padStart(2)}] ${status} ${r.pubkey.substring(0, 8)}... Owner:${ownerStr} Len:${lenStr.padStart(5)}`);
    
    // 检查是否是SPL Token账户
    if (r.info && r.info.data.length === 165 && r.info.owner.equals(TOKEN_PROGRAM_ID)) {
      // SPL Token Account 结构:
      // 0-32: mint
      // 32-64: owner  
      // 64-72: amount (u64)
      // ...
      
      const mint = new PublicKey(r.info.data.slice(0, 32));
      const amount = r.info.data.readBigUInt64LE(64);
      
      tokenAccounts.push({
        idx: r.idx,
        pubkey: r.pubkey,
        amount: amount.toString(),
        mint: mint.toBase58()
      });
      
      console.log(`     🪙  SPL Token: ${(Number(amount) / 1e6).toFixed(2)} tokens`);
      console.log(`     📍  Mint: ${mint.toBase58().substring(0, 12)}...`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🪙 发现的 SPL Token 账户 (可能的 Vaults):');
  console.log('='.repeat(80) + '\n');
  
  if (tokenAccounts.length === 0) {
    console.log('❌ 未找到任何SPL Token账户！');
    console.log('\n这说明HumidiFi可能使用了特殊的vault结构，不是标准SPL Token账户。');
    return;
  }
  
  tokenAccounts.forEach((ta, i) => {
    console.log(`Token Account ${i + 1}:`);
    console.log(`  Pubkey 索引: config.pubkey[${ta.idx}] (pubkey_${ta.idx + 1})`);
    console.log(`  地址: ${ta.pubkey}`);
    console.log(`  余额: ${ta.amount} (${(Number(ta.amount) / 1e6).toFixed(2)})`);
    console.log(`  Mint: ${ta.mint}`);
    console.log();
  });
  
  if (tokenAccounts.length >= 2) {
    const ta0 = tokenAccounts[0];
    const ta1 = tokenAccounts[1];
    const price = Number(ta1.amount) / Number(ta0.amount);
    
    console.log('='.repeat(80));
    console.log('💡 储备量与价格计算:');
    console.log('='.repeat(80));
    console.log(`  Reserve A (pubkey_${ta0.idx + 1}): ${(Number(ta0.amount) / 1e6).toFixed(2)}`);
    console.log(`  Reserve B (pubkey_${ta1.idx + 1}): ${(Number(ta1.amount) / 1e6).toFixed(2)}`);
    console.log(`  价格 (B/A): ${price.toFixed(6)}`);
    console.log();
    
    console.log('🎯 修复代码:');
    console.log('='.repeat(80));
    console.log(`
/// Get token A vault address
pub fn token_a_vault(&self) -> &Pubkey {
    &self.pubkey_${ta0.idx + 1}
}

/// Get token B vault address  
pub fn token_b_vault(&self) -> &Pubkey {
    &self.pubkey_${ta1.idx + 1}
}
    `);
  }
}

analyzeAllPubkeys().catch(console.error);

