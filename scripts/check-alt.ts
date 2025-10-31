/**
 * 检查交易状态并验证 ALT 是否已创建
 */
import { PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

async function checkALT() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
  
  // 之前的交易签名
  const signature = '3eNUdjwX9ogS2qpKsJesU8m8wM7fEBYyXWeCNoSLaebXdTZLTKuC8uj1pz9eyudsoS93L5xCmvNCbmpUNXCbYeqY';
  
  console.log('='.repeat(60));
  console.log('检查交易和 ALT 状态');
  console.log('='.repeat(60));
  console.log('');
  
  console.log('📋 交易签名:');
  console.log(`   ${signature}`);
  console.log(`   链接: https://solscan.io/tx/${signature}`);
  console.log('');
  
  // 1. 检查交易状态
  console.log('🔍 检查交易状态...');
  const status = await connection.getSignatureStatus(signature);
  
  if (!status || !status.value) {
    console.log('❌ 交易未找到（可能未发送或已过期）');
    console.log('');
    console.log('💡 提示：交易可能已经被网络丢弃，需要重新创建 ALT');
    return;
  }
  
  console.log(`   错误: ${status.value.err ? JSON.stringify(status.value.err) : '无 ✅'}`);
  console.log(`   确认状态: ${status.value.confirmationStatus || '未知'}`);
  console.log(`   Slot: ${status.value.slot || '未知'}`);
  console.log('');
  
  if (status.value.err) {
    console.log('❌ 交易失败');
    console.log('');
    return;
  }
  
  console.log('✅ 交易成功！');
  console.log('');
  
  // 2. 如果交易成功，计算 ALT 地址并检查
  console.log('🔍 验证 ALT 账户...');
  
  // 从交易中提取 ALT 地址（这是之前计算出的地址）
  // ALT 地址是从 authority + recentSlot 派生出来的
  const altAddress = new PublicKey('Eq5wAtcD2uwGus2Y3RdEPJDD96g8ndpM17Yd99XxmM4S');
  
  console.log(`📋 ALT 地址: ${altAddress.toBase58()}`);
  console.log(`   链接: https://solscan.io/account/${altAddress.toBase58()}`);
  console.log('');
  
  const accountInfo = await connection.getAccountInfo(altAddress);
  
  if (!accountInfo) {
    console.log('❌ ALT 账户不存在');
    console.log('');
    console.log('可能的原因：');
    console.log('   1. 交易虽然成功，但 ALT 创建需要 warmup period（1个slot）');
    console.log('   2. 需要等待一段时间后再次检查');
    console.log('');
    return;
  }
  
  const ALT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
  
  if (!accountInfo.owner.equals(ALT_PROGRAM_ID)) {
    console.log('❌ ALT 账户所有者不正确');
    console.log(`   期望: ${ALT_PROGRAM_ID.toBase58()}`);
    console.log(`   实际: ${accountInfo.owner.toBase58()}`);
    console.log('');
    return;
  }
  
  // 解析 ALT 账户
  const altAccount = new AddressLookupTableAccount({
    key: altAddress,
    state: AddressLookupTableAccount.deserialize(accountInfo.data),
  });
  
  console.log('✅ ALT 账户已创建！');
  console.log('');
  console.log('ALT 信息:');
  console.log(`   地址: ${altAddress.toBase58()}`);
  console.log(`   地址数量: ${altAccount.state.addresses.length}`);
  console.log(`   去激活 slot: ${altAccount.state.deactivationSlot.toString()}`);
  console.log('');
  
  // 3. 保存到 .env
  const fs = require('fs');
  const path = require('path');
  
  console.log('💾 保存 ALT 地址到 .env 文件...');
  const envPath = path.join(process.cwd(), '.env');
  
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }
  
  const envLines = envContent.split('\n');
  let found = false;
  const newLines = envLines.map(line => {
    if (line.startsWith('JUPITER_LEND_ALT_ADDRESS=')) {
      found = true;
      return `JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`;
    }
    return line;
  });
  
  if (!found) {
    newLines.push(`JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`);
  }
  
  fs.writeFileSync(envPath, newLines.join('\n'));
  console.log('✅ 已保存到 .env 文件');
  console.log('');
  
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ ALT 已成功创建并保存！');
  console.log('');
  console.log('现在可以启动机器人了:');
  console.log('   pnpm start:flashloan --config=configs/flashloan-serverchan.toml');
  console.log('');
}

checkALT().catch(console.error);

