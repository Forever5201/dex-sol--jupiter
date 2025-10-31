/**
 * 链上池子数据分析工具
 * 
 * 用于获取和分析Solana链上池子账户的完整数据，帮助逆向工程数据结构
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// RPC配置
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// 要分析的池子配置
const POOLS_TO_ANALYZE = [
  {
    name: 'TesseraV USDC/SOL',
    address: 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',
    type: 'tesserav',
    expectedSize: 1160,
    actualSize: 1264,
  },
  {
    name: 'Lifinity V2 SOL/USDC',
    address: 'DrRd8gYMJu9XGxLhwTCPdHNLXCKHsxJtMpbn62YqmwQe',
    type: 'lifinity_v2',
    programId: '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c',
  },
  {
    name: 'Stabble USD1/USDC #2',
    address: 'BqLJmoxkcetgwwybit9XksNTuPzeh7SpxkYExbZKmLEC',
    type: 'stabble',
    expectedSize: 664,
    actualSize: 438,
  },
  {
    name: 'PancakeSwap USDC/USDT',
    address: '22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w',
    type: 'pancakeswap',
    expectedSize: 849,
    actualSize: 1544,
  },
];

interface PoolAnalysis {
  name: string;
  address: string;
  type: string;
  programId: string;
  dataLength: number;
  hexDump: string;
  discriminator: string;
  pubkeys: Array<{ offset: number; pubkey: string }>;
  u64Values: Array<{ offset: number; value: string; valueDec: string }>;
  rawData: Buffer;
}

/**
 * 从Buffer中提取所有可能的Pubkey
 */
function extractPubkeys(data: Buffer): Array<{ offset: number; pubkey: string }> {
  const pubkeys: Array<{ offset: number; pubkey: string }> = [];
  
  // Pubkey是32字节，遍历所有可能的位置
  for (let i = 0; i <= data.length - 32; i++) {
    const pubkeyBytes = data.slice(i, i + 32);
    const pubkey = new PublicKey(pubkeyBytes).toBase58();
    
    // 过滤掉全零或无效的pubkey
    const isAllZero = pubkeyBytes.every(b => b === 0);
    if (!isAllZero) {
      pubkeys.push({ offset: i, pubkey });
    }
  }
  
  return pubkeys;
}

/**
 * 从Buffer中提取所有可能的u64值
 */
function extractU64Values(data: Buffer): Array<{ offset: number; value: string; valueDec: string }> {
  const values: Array<{ offset: number; value: string; valueDec: string }> = [];
  
  // u64是8字节，遍历所有可能的位置
  for (let i = 0; i <= data.length - 8; i += 8) {
    const value = data.readBigUInt64LE(i);
    
    // 只记录有意义的值（非零，且在合理范围内）
    if (value > 0n && value < 1000000000000000n) { // < 1e15
      values.push({
        offset: i,
        value: '0x' + value.toString(16),
        valueDec: value.toString(),
      });
    }
  }
  
  return values;
}

/**
 * 生成hex dump（类似hexdump -C）
 */
function generateHexDump(data: Buffer, maxBytes: number = 512): string {
  let output = '';
  const bytesToShow = Math.min(data.length, maxBytes);
  
  for (let i = 0; i < bytesToShow; i += 16) {
    // 地址
    output += `${i.toString(16).padStart(8, '0')}  `;
    
    // Hex bytes
    for (let j = 0; j < 16; j++) {
      if (i + j < bytesToShow) {
        output += data[i + j].toString(16).padStart(2, '0') + ' ';
      } else {
        output += '   ';
      }
      if (j === 7) output += ' ';
    }
    
    // ASCII
    output += ' |';
    for (let j = 0; j < 16 && i + j < bytesToShow; j++) {
      const byte = data[i + j];
      output += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
    }
    output += '|\n';
  }
  
  if (data.length > maxBytes) {
    output += `\n... (showing first ${maxBytes} of ${data.length} bytes)\n`;
  }
  
  return output;
}

/**
 * 分析单个池子账户
 */
async function analyzePool(connection: Connection, poolConfig: any): Promise<PoolAnalysis> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`分析池子: ${poolConfig.name}`);
  console.log(`地址: ${poolConfig.address}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const pubkey = new PublicKey(poolConfig.address);
  const accountInfo = await connection.getAccountInfo(pubkey);
  
  if (!accountInfo) {
    throw new Error(`无法获取账户信息: ${poolConfig.address}`);
  }
  
  const data = accountInfo.data;
  const programId = accountInfo.owner.toBase58();
  
  console.log(`✅ 账户信息获取成功`);
  console.log(`   Program ID: ${programId}`);
  console.log(`   Data Length: ${data.length} bytes`);
  
  if (poolConfig.expectedSize) {
    const diff = data.length - poolConfig.expectedSize;
    console.log(`   Expected: ${poolConfig.expectedSize} bytes`);
    console.log(`   Difference: ${diff > 0 ? '+' : ''}${diff} bytes`);
  }
  
  // 提取discriminator（前8字节）
  const discriminator = data.slice(0, 8).toString('hex');
  console.log(`   Discriminator: 0x${discriminator}`);
  
  // 提取Pubkeys
  console.log(`\n📍 扫描Pubkey字段...`);
  const pubkeys = extractPubkeys(data);
  console.log(`   找到 ${pubkeys.length} 个潜在Pubkey`);
  
  // 显示前20个有意义的pubkey
  const meaningfulPubkeys = pubkeys.filter(p => {
    const pk = p.pubkey;
    // 过滤掉System Program和一些常见地址
    return pk !== '11111111111111111111111111111111' &&
           pk !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  }).slice(0, 20);
  
  meaningfulPubkeys.forEach(({ offset, pubkey }, idx) => {
    console.log(`   [${idx}] Offset ${offset}: ${pubkey}`);
  });
  
  // 提取u64值
  console.log(`\n💰 扫描u64数值字段...`);
  const u64Values = extractU64Values(data);
  console.log(`   找到 ${u64Values.length} 个潜在数值`);
  
  // 显示前15个数值
  u64Values.slice(0, 15).forEach(({ offset, value, valueDec }, idx) => {
    const valueNum = BigInt(valueDec);
    let annotation = '';
    
    // 尝试识别数值类型
    if (valueNum > 100_000_000n && valueNum < 100_000_000_000_000n) {
      // 可能是reserve amount
      if (valueNum < 10_000_000_000n) {
        annotation = ` (可能是SOL储备: ${Number(valueNum) / 1e9} SOL)`;
      } else {
        annotation = ` (可能是USDC储备: ${Number(valueNum) / 1e6} USDC)`;
      }
    }
    
    console.log(`   [${idx}] Offset ${offset}: ${valueDec}${annotation}`);
  });
  
  // 生成hex dump
  console.log(`\n📄 Hex Dump (前512字节):`);
  const hexDump = generateHexDump(data, 512);
  console.log(hexDump);
  
  return {
    name: poolConfig.name,
    address: poolConfig.address,
    type: poolConfig.type,
    programId,
    dataLength: data.length,
    discriminator,
    hexDump,
    pubkeys: meaningfulPubkeys,
    u64Values: u64Values.slice(0, 20),
    rawData: data,
  };
}

/**
 * 保存分析结果
 */
function saveAnalysisResults(analyses: PoolAnalysis[]) {
  const outputDir = path.join(__dirname, '..', 'analysis-results');
  
  // 创建输出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // 保存每个池子的完整报告
  analyses.forEach(analysis => {
    const fileName = `${analysis.type}_${analysis.address}.txt`;
    const filePath = path.join(outputDir, fileName);
    
    let report = '';
    report += `${'='.repeat(80)}\n`;
    report += `池子分析报告: ${analysis.name}\n`;
    report += `${'='.repeat(80)}\n\n`;
    report += `地址: ${analysis.address}\n`;
    report += `Program ID: ${analysis.programId}\n`;
    report += `数据长度: ${analysis.dataLength} bytes\n`;
    report += `Discriminator: 0x${analysis.discriminator}\n\n`;
    
    report += `${'='.repeat(80)}\n`;
    report += `Pubkey字段 (前20个)\n`;
    report += `${'='.repeat(80)}\n`;
    analysis.pubkeys.forEach(({ offset, pubkey }, idx) => {
      report += `[${idx}] Offset ${offset}: ${pubkey}\n`;
    });
    
    report += `\n${'='.repeat(80)}\n`;
    report += `u64数值字段 (前20个)\n`;
    report += `${'='.repeat(80)}\n`;
    analysis.u64Values.forEach(({ offset, value, valueDec }, idx) => {
      report += `[${idx}] Offset ${offset}: ${valueDec} (${value})\n`;
    });
    
    report += `\n${'='.repeat(80)}\n`;
    report += `Hex Dump (前512字节)\n`;
    report += `${'='.repeat(80)}\n`;
    report += analysis.hexDump;
    
    fs.writeFileSync(filePath, report, 'utf-8');
    console.log(`✅ 报告已保存: ${filePath}`);
    
    // 同时保存原始二进制数据
    const rawFileName = `${analysis.type}_${analysis.address}.bin`;
    const rawFilePath = path.join(outputDir, rawFileName);
    fs.writeFileSync(rawFilePath, analysis.rawData);
    console.log(`✅ 原始数据已保存: ${rawFilePath}`);
  });
  
  // 保存汇总JSON
  const summaryPath = path.join(outputDir, 'analysis-summary.json');
  const summary = analyses.map(a => ({
    name: a.name,
    address: a.address,
    type: a.type,
    programId: a.programId,
    dataLength: a.dataLength,
    discriminator: a.discriminator,
    pubkeysCount: a.pubkeys.length,
    u64ValuesCount: a.u64Values.length,
  }));
  
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`✅ 汇总已保存: ${summaryPath}`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 链上池子数据分析工具');
  console.log(`📡 连接RPC: ${RPC_ENDPOINT}\n`);
  
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const analyses: PoolAnalysis[] = [];
  
  // 分析每个池子
  for (const poolConfig of POOLS_TO_ANALYZE) {
    try {
      const analysis = await analyzePool(connection, poolConfig);
      analyses.push(analysis);
      
      // 等待一下避免RPC限速
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`❌ 分析失败: ${poolConfig.name}`);
      console.error(error);
    }
  }
  
  // 保存所有结果
  console.log(`\n${'='.repeat(80)}`);
  console.log('💾 保存分析结果...');
  console.log(`${'='.repeat(80)}\n`);
  
  saveAnalysisResults(analyses);
  
  console.log(`\n✅ 分析完成！共分析 ${analyses.length} 个池子`);
  console.log(`📁 结果保存在: rust-pool-cache/analysis-results/`);
}

// 运行
main().catch(console.error);





