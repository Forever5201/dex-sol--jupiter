/**
 * 检查交易状态
 */
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

async function checkTransaction() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
  
  // 最新的交易签名
  const signature = '3eNUdjwX9ogS2qpKsJesU8m8wM7fEBYyXWeCNoSLaebXdTZLTKuC8uj1pz9eyudsoS93L5xCmvNCbmpUNXCbYeqY';
  
  console.log(`检查交易状态: ${signature}`);
  console.log(`链接: https://solscan.io/tx/${signature}`);
  console.log('');
  
  const status = await connection.getSignatureStatus(signature);
  
  if (!status || !status.value) {
    console.log('❌ 交易未找到（可能未发送或已过期）');
  } else {
    console.log('交易状态:');
    console.log(`  错误: ${status.value.err ? JSON.stringify(status.value.err) : '无'}`);
    console.log(`  确认状态: ${status.value.confirmationStatus || '未知'}`);
    console.log(`  Slot: ${status.value.slot || '未知'}`);
    
    if (status.value.err) {
      console.log('');
      console.log('❌ 交易失败');
    } else {
      console.log('');
      console.log('✅ 交易成功！');
    }
  }
}

checkTransaction().catch(console.error);

