/**
 * 分析Meteora DLMM池子账户的实际数据结构
 * 用于验证我们的Rust结构定义是否正确
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import { NetworkAdapter } from '../../packages/core/src/network/unified-adapter';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// Meteora DLMM 池子地址 (从config.toml)
const METEORA_POOLS = [
  {
    name: 'JUP/USDC',
    address: 'BhQEFZCgCKi96rLaVMeTr5jCVWZpe72nSP6hqTXA8Cem',
  },
  // 可以添加更多池子
];

interface FieldInfo {
  offset: number;
  name: string;
  type: string;
  value: any;
  bytes: string;
}

/**
 * 分析账户数据的原始字节
 */
function analyzeAccountData(data: Buffer): {
  discriminator: string;
  totalSize: number;
  dataSize: number;
  fields: FieldInfo[];
} {
  const fields: FieldInfo[] = [];
  let offset = 0;

  // 1. Discriminator (8 bytes) - Anchor账户标识符
  const discriminator = data.slice(0, 8);
  fields.push({
    offset: 0,
    name: 'discriminator',
    type: '[u8; 8]',
    value: Array.from(discriminator),
    bytes: discriminator.toString('hex'),
  });
  offset = 8;

  // 2. 尝试识别已知字段
  
  // 假设接下来是 PoolParameters 结构 (大约30-32字节)
  const poolParamsStart = offset;
  
  // base_factor: u16
  const baseFactor = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'parameters.base_factor',
    type: 'u16',
    value: baseFactor,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // filter_period: u16
  const filterPeriod = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'parameters.filter_period',
    type: 'u16',
    value: filterPeriod,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // decay_period: u16
  const decayPeriod = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'parameters.decay_period',
    type: 'u16',
    value: decayPeriod,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // reduction_factor: u16
  const reductionFactor = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'parameters.reduction_factor',
    type: 'u16',
    value: reductionFactor,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // variable_fee_control: u32
  const variableFeeControl = data.readUInt32LE(offset);
  fields.push({
    offset,
    name: 'parameters.variable_fee_control',
    type: 'u32',
    value: variableFeeControl,
    bytes: data.slice(offset, offset + 4).toString('hex'),
  });
  offset += 4;
  
  // max_volatility_accumulator: u32
  const maxVolatilityAccumulator = data.readUInt32LE(offset);
  fields.push({
    offset,
    name: 'parameters.max_volatility_accumulator',
    type: 'u32',
    value: maxVolatilityAccumulator,
    bytes: data.slice(offset, offset + 4).toString('hex'),
  });
  offset += 4;
  
  // min_bin_id: i32
  const minBinId = data.readInt32LE(offset);
  fields.push({
    offset,
    name: 'parameters.min_bin_id',
    type: 'i32',
    value: minBinId,
    bytes: data.slice(offset, offset + 4).toString('hex'),
  });
  offset += 4;
  
  // max_bin_id: i32
  const maxBinId = data.readInt32LE(offset);
  fields.push({
    offset,
    name: 'parameters.max_bin_id',
    type: 'i32',
    value: maxBinId,
    bytes: data.slice(offset, offset + 4).toString('hex'),
  });
  offset += 4;
  
  // protocol_share: u16
  const protocolShare = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'parameters.protocol_share',
    type: 'u16',
    value: protocolShare,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // padding: [u8; 6]
  offset += 6;
  
  console.log(`PoolParameters size: ${offset - poolParamsStart} bytes`);

  // 3. Pubkey fields (32 bytes each)
  const pubkeyFields = [
    'token_x_mint',
    'token_y_mint',
    'reserve_x',
    'reserve_y',
    'oracle',
    'fee_collector_token_x',
    'fee_collector_token_y',
    'protocol_fee_owner',
    'reward_vault_0',
    'reward_vault_1',
    'reward_mint_0',
    'reward_mint_1',
    'whitelisted_wallet',
    'pre_activation_swap_address',
    'base_key',
  ];

  for (const fieldName of pubkeyFields) {
    const pubkey = new PublicKey(data.slice(offset, offset + 32));
    fields.push({
      offset,
      name: fieldName,
      type: 'Pubkey',
      value: pubkey.toBase58(),
      bytes: data.slice(offset, offset + 32).toString('hex'),
    });
    offset += 32;
  }

  // 4. 核心状态字段
  
  // active_id: i32
  const activeId = data.readInt32LE(offset);
  fields.push({
    offset,
    name: 'active_id',
    type: 'i32',
    value: activeId,
    bytes: data.slice(offset, offset + 4).toString('hex'),
  });
  offset += 4;
  
  // bin_step: u16
  const binStep = data.readUInt16LE(offset);
  fields.push({
    offset,
    name: 'bin_step',
    type: 'u16',
    value: binStep,
    bytes: data.slice(offset, offset + 2).toString('hex'),
  });
  offset += 2;
  
  // status: u8
  const status = data.readUInt8(offset);
  fields.push({
    offset,
    name: 'status',
    type: 'u8',
    value: status,
    bytes: data.slice(offset, offset + 1).toString('hex'),
  });
  offset += 1;
  
  // _padding0: u8
  offset += 1;
  
  // 剩余数据
  const remainingBytes = data.length - offset;
  console.log(`\n已解析: ${offset} bytes`);
  console.log(`剩余: ${remainingBytes} bytes`);

  return {
    discriminator: discriminator.toString('hex'),
    totalSize: data.length,
    dataSize: data.length - 8,
    fields,
  };
}

/**
 * 生成详细的字段映射表
 */
function generateFieldMap(fields: FieldInfo[]): string {
  const lines: string[] = [];
  
  lines.push('┌' + '─'.repeat(70) + '┐');
  lines.push('│' + ' Meteora DLMM 账户结构分析'.padEnd(70) + '│');
  lines.push('├' + '─'.repeat(70) + '┤');
  lines.push('│ Offset │ Field Name                      │ Type    │ Size │');
  lines.push('├' + '─'.repeat(70) + '┤');
  
  for (const field of fields) {
    const offsetStr = field.offset.toString().padStart(6);
    const nameStr = field.name.padEnd(30);
    const typeStr = field.type.padEnd(7);
    
    let size = 0;
    if (field.type === 'Pubkey') size = 32;
    else if (field.type === 'u8' || field.type === 'i8') size = 1;
    else if (field.type === 'u16' || field.type === 'i16') size = 2;
    else if (field.type === 'u32' || field.type === 'i32') size = 4;
    else if (field.type === 'u64' || field.type === 'i64') size = 8;
    else if (field.type === 'u128' || field.type === 'i128') size = 16;
    else if (field.type === '[u8; 8]') size = 8;
    
    const sizeStr = size.toString().padStart(4);
    
    lines.push(`│ ${offsetStr} │ ${nameStr} │ ${typeStr} │ ${sizeStr} │`);
    
    // 显示实际值（对于重要字段）
    if (field.name === 'active_id' || field.name === 'bin_step' || field.name === 'status') {
      lines.push(`│        │   值: ${String(field.value).padEnd(28)} │         │      │`);
    }
  }
  
  lines.push('└' + '─'.repeat(70) + '┘');
  
  return lines.join('\n');
}

async function main() {
  console.log('🔍 Meteora DLMM 账户数据分析工具\n');
  console.log('🌐 使用统一网络适配器（自动应用代理配置）\n');
  
  // 使用统一的NetworkAdapter创建Connection
  const connection = NetworkAdapter.createConnection(RPC_URL, 'confirmed');
  
  for (const pool of METEORA_POOLS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 分析池子: ${pool.name}`);
    console.log(`📍 地址: ${pool.address}`);
    console.log('='.repeat(70));
    
    try {
      // 获取账户数据
      const accountInfo = await connection.getAccountInfo(new PublicKey(pool.address));
      
      if (!accountInfo) {
        console.error('❌ 账户不存在');
        continue;
      }
      
      console.log(`\n✅ 账户信息:`);
      console.log(`  所有者: ${accountInfo.owner.toBase58()}`);
      console.log(`  数据长度: ${accountInfo.data.length} bytes`);
      console.log(`  可执行: ${accountInfo.executable}`);
      console.log(`  租金豁免: ${accountInfo.rentEpoch}`);
      
      // 分析数据结构
      console.log(`\n🔬 数据结构分析:`);
      const analysis = analyzeAccountData(accountInfo.data);
      
      console.log(`\n  Discriminator: ${analysis.discriminator}`);
      console.log(`  总大小: ${analysis.totalSize} bytes`);
      console.log(`  数据大小: ${analysis.dataSize} bytes (不含discriminator)`);
      
      // 生成字段映射表
      console.log(`\n📋 字段映射表:\n`);
      console.log(generateFieldMap(analysis.fields));
      
      // 保存原始数据
      const dataDir = './analysis-results';
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const fileName = `${pool.name.replace('/', '-')}-account-data.bin`;
      fs.writeFileSync(`${dataDir}/${fileName}`, accountInfo.data);
      console.log(`\n💾 原始数据已保存到: ${dataDir}/${fileName}`);
      
      // 保存分析结果
      const analysisFileName = `${pool.name.replace('/', '-')}-analysis.json`;
      fs.writeFileSync(
        `${dataDir}/${analysisFileName}`,
        JSON.stringify({
          pool: pool.name,
          address: pool.address,
          owner: accountInfo.owner.toBase58(),
          ...analysis,
        }, null, 2)
      );
      console.log(`📄 分析结果已保存到: ${dataDir}/${analysisFileName}`);
      
    } catch (error) {
      console.error(`❌ 错误: ${(error as Error).message}`);
    }
  }
  
  console.log(`\n✨ 分析完成！`);
  console.log(`\n💡 下一步:`);
  console.log(`1. 检查 analysis-results/ 目录中的结果`);
  console.log(`2. 对比实际字段偏移量与Rust结构定义`);
  console.log(`3. 调整Rust结构以匹配实际布局`);
  console.log(`4. 使用 std::mem::size_of 验证结构体大小`);
}

main().catch(console.error);


