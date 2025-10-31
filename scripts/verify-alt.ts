/**
 * 验证 ALT 账户是否有效
 */
import { PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

async function verifyALT() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
  
  const altAddressStr = process.env.JUPITER_LEND_ALT_ADDRESS;
  
  if (!altAddressStr) {
    console.log('❌ 未找到 JUPITER_LEND_ALT_ADDRESS 环境变量');
    return;
  }
  
  console.log('='.repeat(60));
  console.log('验证 ALT 账户');
  console.log('='.repeat(60));
  console.log('');
  console.log(`ALT 地址: ${altAddressStr}`);
  console.log(`链接: https://solscan.io/account/${altAddressStr}`);
  console.log('');
  
  try {
    const altAddress = new PublicKey(altAddressStr);
    
    console.log('🔍 检查 ALT 账户...');
    const accountInfo = await connection.getAccountInfo(altAddress);
    
    if (!accountInfo) {
      console.log('❌ ALT 账户不存在');
      return;
    }
    
    const ALT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
    
    if (!accountInfo.owner.equals(ALT_PROGRAM_ID)) {
      console.log('❌ ALT 账户所有者不正确');
      console.log(`   期望: ${ALT_PROGRAM_ID.toBase58()}`);
      console.log(`   实际: ${accountInfo.owner.toBase58()}`);
      return;
    }
    
    // 解析 ALT 账户
    const altAccount = new AddressLookupTableAccount({
      key: altAddress,
      state: AddressLookupTableAccount.deserialize(accountInfo.data),
    });
    
    console.log('✅ ALT 账户有效！');
    console.log('');
    console.log('ALT 信息:');
    console.log(`   地址: ${altAddress.toBase58()}`);
    console.log(`   地址数量: ${altAccount.state.addresses.length}`);
    console.log(`   去激活 slot: ${altAccount.state.deactivationSlot.toString()}`);
    console.log('');
    
    if (altAccount.state.deactivationSlot.toString() === '18446744073709551615') {
      console.log('✅ ALT 账户处于激活状态（未去激活）');
    } else {
      console.log(`⚠️ ALT 账户将在 slot ${altAccount.state.deactivationSlot.toString()} 去激活`);
    }
    
    console.log('');
    console.log('✅ ALT 已准备就绪，可以启动机器人了！');
    console.log('');
    
  } catch (error: any) {
    console.log(`❌ 验证失败: ${error.message}`);
  }
}

verifyALT().catch(console.error);

