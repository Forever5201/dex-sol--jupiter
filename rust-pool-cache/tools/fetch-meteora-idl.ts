/**
 * 从Meteora DLMM程序获取IDL并生成Rust结构定义
 * 
 * Program ID: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';

const METEORA_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// 🌐 使用代理配置
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const httpsAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

// Anchor IDL 标准类型
interface IdlField {
  name: string;
  type: any;
}

interface IdlAccount {
  name: string;
  type: {
    kind: string;
    fields: IdlField[];
  };
}

interface Idl {
  version: string;
  name: string;
  instructions: any[];
  accounts: IdlAccount[];
  types?: any[];
}

/**
 * 从已知源获取Meteora DLMM IDL
 */
async function fetchMeteoraIdl(): Promise<Idl | null> {
  const idlSources = [
    // 1. 官方GitHub仓库
    'https://raw.githubusercontent.com/meteoraag/dlmm-sdk/main/programs/lb_clmm/target/idl/lb_clmm.json',
    // 2. 备用源
    'https://raw.githubusercontent.com/meteoraag/dlmm-sdk/main/ts-client/src/idl.json',
  ];

  for (const url of idlSources) {
    try {
      console.log(`🔍 尝试从 ${url} 获取IDL...`);
      if (PROXY_URL) {
        console.log(`   🌐 使用代理: ${PROXY_URL}`);
      }
      
      const response = await fetch(url, {
        // @ts-ignore - Node.js fetch支持agent
        agent: httpsAgent
      });
      
      if (response.ok) {
        const idl = await response.json();
        console.log(`✅ 成功从 ${url} 获取IDL`);
        return idl;
      }
    } catch (error) {
      console.log(`❌ 失败: ${(error as Error).message}`);
    }
  }

  return null;
}

/**
 * 将IDL类型转换为Rust类型
 */
function idlTypeToRust(idlType: any): string {
  if (typeof idlType === 'string') {
    const typeMap: Record<string, string> = {
      'publicKey': 'Pubkey',
      'u8': 'u8',
      'u16': 'u16',
      'u32': 'u32',
      'u64': 'u64',
      'u128': 'u128',
      'i8': 'i8',
      'i16': 'i16',
      'i32': 'i32',
      'i64': 'i64',
      'i128': 'i128',
      'bool': 'bool',
      'string': 'String',
      'bytes': 'Vec<u8>',
    };
    return typeMap[idlType] || idlType;
  }

  if (idlType.array) {
    const innerType = idlTypeToRust(idlType.array[0]);
    const size = idlType.array[1];
    return `[${innerType}; ${size}]`;
  }

  if (idlType.option) {
    const innerType = idlTypeToRust(idlType.option);
    return `Option<${innerType}>`;
  }

  if (idlType.vec) {
    const innerType = idlTypeToRust(idlType.vec);
    return `Vec<${innerType}>`;
  }

  if (idlType.defined) {
    return idlType.defined;
  }

  return 'Unknown';
}

/**
 * 生成Rust结构体定义
 */
function generateRustStruct(account: IdlAccount): string {
  const lines: string[] = [];
  
  lines.push(`/// ${account.name} - Generated from Meteora DLMM IDL`);
  lines.push(`#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]`);
  lines.push(`pub struct ${account.name} {`);
  
  for (const field of account.type.fields) {
    const rustType = idlTypeToRust(field.type);
    lines.push(`    pub ${field.name}: ${rustType},`);
  }
  
  lines.push(`}`);
  
  return lines.join('\n');
}

/**
 * 计算结构体大小（估算）
 */
function estimateStructSize(account: IdlAccount): number {
  let size = 0;
  
  for (const field of account.type.fields) {
    const rustType = idlTypeToRust(field.type);
    
    // 估算字段大小
    if (rustType === 'Pubkey') {
      size += 32;
    } else if (rustType === 'u8' || rustType === 'i8' || rustType === 'bool') {
      size += 1;
    } else if (rustType === 'u16' || rustType === 'i16') {
      size += 2;
    } else if (rustType === 'u32' || rustType === 'i32') {
      size += 4;
    } else if (rustType === 'u64' || rustType === 'i64') {
      size += 8;
    } else if (rustType === 'u128' || rustType === 'i128') {
      size += 16;
    } else if (rustType.startsWith('[') && rustType.includes(';')) {
      // 数组类型
      const match = rustType.match(/\[(.+);\s*(\d+)\]/);
      if (match) {
        const elementType = match[1];
        const count = parseInt(match[2]);
        const elementSize = estimateFieldSize(elementType);
        size += elementSize * count;
      }
    }
  }
  
  return size;
}

function estimateFieldSize(type: string): number {
  const sizeMap: Record<string, number> = {
    'Pubkey': 32,
    'u8': 1, 'i8': 1, 'bool': 1,
    'u16': 2, 'i16': 2,
    'u32': 4, 'i32': 4,
    'u64': 8, 'i64': 8,
    'u128': 16, 'i128': 16,
  };
  return sizeMap[type] || 0;
}

/**
 * 生成完整的Rust模块文件
 */
function generateRustModule(idl: Idl): string {
  const lines: string[] = [];
  
  lines.push(`//! Meteora DLMM Account Structures`);
  lines.push(`//! Auto-generated from IDL`);
  lines.push(`//! Program ID: ${METEORA_DLMM_PROGRAM_ID}`);
  lines.push(``);
  lines.push(`use borsh::{BorshDeserialize, BorshSerialize};`);
  lines.push(`use solana_sdk::pubkey::Pubkey;`);
  lines.push(``);
  
  // 查找LbPair账户（主要的池子状态账户）
  const lbPairAccount = idl.accounts?.find(acc => 
    acc.name === 'LbPair' || 
    acc.name === 'lbPair' ||
    acc.name.toLowerCase().includes('pair')
  );
  
  if (lbPairAccount) {
    lines.push(generateRustStruct(lbPairAccount));
    lines.push(``);
    
    const estimatedSize = estimateStructSize(lbPairAccount);
    lines.push(`// 估算结构体大小: ${estimatedSize} bytes`);
    lines.push(`// 注意: 实际大小可能因对齐和额外字段而有所不同`);
  }
  
  // 生成其他类型定义
  if (idl.types) {
    for (const type of idl.types) {
      if (type.type?.kind === 'struct') {
        lines.push(``);
        lines.push(generateRustStruct(type));
      }
    }
  }
  
  return lines.join('\n');
}

/**
 * 生成测试验证代码
 */
function generateTestCode(idl: Idl): string {
  const lines: string[] = [];
  
  lines.push(`#[cfg(test)]`);
  lines.push(`mod tests {`);
  lines.push(`    use super::*;`);
  lines.push(`    use std::mem::size_of;`);
  lines.push(``);
  lines.push(`    #[test]`);
  lines.push(`    fn test_lb_pair_size() {`);
  lines.push(`        let actual_size = size_of::<LbPair>();`);
  lines.push(`        println!("LbPair actual size: {} bytes", actual_size);`);
  lines.push(``);
  lines.push(`        // 从链上数据验证: 904 bytes total (8-byte discriminator + 896 bytes data)`);
  lines.push(`        let expected_size = 896;`);
  lines.push(``);
  lines.push(`        if actual_size != expected_size {`);
  lines.push(`            panic!(`);
  lines.push(`                "Size mismatch! Expected {} bytes, got {} bytes. Diff: {} bytes",`);
  lines.push(`                expected_size, actual_size, expected_size as i32 - actual_size as i32`);
  lines.push(`            );`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`}`);
  
  return lines.join('\n');
}

async function main() {
  console.log('🚀 Meteora DLMM IDL 获取工具');
  console.log('━'.repeat(60));
  
  // 1. 获取IDL
  const idl = await fetchMeteoraIdl();
  
  if (!idl) {
    console.error('❌ 无法获取Meteora DLMM IDL');
    console.log('\n💡 手动方案:');
    console.log('1. 访问 https://github.com/meteoraag/dlmm-sdk');
    console.log('2. 找到 lb_clmm.json IDL文件');
    console.log('3. 手动下载到 ./idl/meteora-dlmm.json');
    process.exit(1);
  }
  
  console.log('\n📊 IDL信息:');
  console.log(`  版本: ${idl.version}`);
  console.log(`  名称: ${idl.name}`);
  console.log(`  账户数: ${idl.accounts?.length || 0}`);
  console.log(`  类型数: ${idl.types?.length || 0}`);
  
  // 2. 保存IDL
  const idlDir = path.join(__dirname, '../idl');
  if (!fs.existsSync(idlDir)) {
    fs.mkdirSync(idlDir, { recursive: true });
  }
  
  const idlPath = path.join(idlDir, 'meteora-dlmm.json');
  fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
  console.log(`\n✅ IDL已保存到: ${idlPath}`);
  
  // 3. 生成Rust结构
  const rustCode = generateRustModule(idl);
  const rustPath = path.join(__dirname, '../src/deserializers/meteora_dlmm_generated.rs');
  fs.writeFileSync(rustPath, rustCode);
  console.log(`✅ Rust结构已生成: ${rustPath}`);
  
  // 4. 生成测试代码
  const testCode = generateTestCode(idl);
  const testPath = path.join(__dirname, '../tests/meteora_dlmm_size_test.rs');
  fs.writeFileSync(testPath, testCode);
  console.log(`✅ 测试代码已生成: ${testPath}`);
  
  // 5. 显示LbPair结构信息
  const lbPairAccount = idl.accounts?.find(acc => 
    acc.name === 'LbPair' || acc.name.toLowerCase().includes('pair')
  );
  
  if (lbPairAccount) {
    console.log(`\n📦 LbPair 结构信息:`);
    console.log(`  字段数: ${lbPairAccount.type.fields.length}`);
    console.log(`  估算大小: ${estimateStructSize(lbPairAccount)} bytes`);
    console.log(`  期望大小: 896 bytes (904 - 8 discriminator)`);
    
    console.log(`\n📋 主要字段:`);
    for (const field of lbPairAccount.type.fields.slice(0, 10)) {
      const rustType = idlTypeToRust(field.type);
      console.log(`  - ${field.name}: ${rustType}`);
    }
    if (lbPairAccount.type.fields.length > 10) {
      console.log(`  ... 和其他 ${lbPairAccount.type.fields.length - 10} 个字段`);
    }
  }
  
  console.log('\n✨ 完成！下一步:');
  console.log('1. 检查生成的 meteora_dlmm_generated.rs');
  console.log('2. 运行 cargo test 验证结构体大小');
  console.log('3. 如果大小匹配，替换现有的 meteora_dlmm.rs');
  console.log('4. 重新编译并测试反序列化');
}

main().catch(console.error);


