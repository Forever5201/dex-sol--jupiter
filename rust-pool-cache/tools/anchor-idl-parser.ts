/**
 * Anchor IDL 解析器
 * 用于解析Anchor程序的IDL并生成Rust结构体定义
 */

import * as fs from 'fs';
import * as path from 'path';

interface AnchorIdlType {
  kind: string;
  fields?: AnchorIdlField[];
}

interface AnchorIdlField {
  name: string;
  type: string | object;
  docs?: string[];
}

interface AnchorIdlAccount {
  name: string;
  type: AnchorIdlType;
  discriminator?: number[];
}

interface AnchorIdl {
  version: string;
  name: string;
  instructions: any[];
  accounts?: AnchorIdlAccount[];
  types?: any[];
  metadata?: {
    address?: string;
  };
}

/**
 * Anchor IDL 解析器类
 */
export class AnchorIdlParser {
  private idl: AnchorIdl;

  constructor(idl: AnchorIdl) {
    this.idl = idl;
  }

  /**
   * 从文件加载IDL
   */
  static fromFile(filePath: string): AnchorIdlParser {
    const idlContent = fs.readFileSync(filePath, 'utf-8');
    const idl = JSON.parse(idlContent) as AnchorIdl;
    return new AnchorIdlParser(idl);
  }

  /**
   * 获取程序地址
   */
  getProgramAddress(): string | undefined {
    return this.idl.metadata?.address;
  }

  /**
   * 获取所有账户定义
   */
  getAccounts(): AnchorIdlAccount[] {
    return this.idl.accounts || [];
  }

  /**
   * 根据名称查找账户
   */
  findAccount(name: string): AnchorIdlAccount | undefined {
    return this.getAccounts().find(acc => 
      acc.name.toLowerCase() === name.toLowerCase()
    );
  }

  /**
   * 将IDL类型转换为Rust类型
   */
  private idlTypeToRust(idlType: any, depth: number = 0): string {
    // 基本类型
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

    // 数组类型
    if (idlType.array) {
      const [innerType, size] = idlType.array;
      const rustInnerType = this.idlTypeToRust(innerType, depth + 1);
      return `[${rustInnerType}; ${size}]`;
    }

    // Option类型
    if (idlType.option) {
      const innerType = this.idlTypeToRust(idlType.option, depth + 1);
      return `Option<${innerType}>`;
    }

    // Vec类型
    if (idlType.vec) {
      const innerType = this.idlTypeToRust(idlType.vec, depth + 1);
      return `Vec<${innerType}>`;
    }

    // 自定义类型
    if (idlType.defined) {
      return idlType.defined;
    }

    return 'Unknown';
  }

  /**
   * 生成Rust结构体
   */
  generateRustStruct(account: AnchorIdlAccount, includeTests: boolean = false): string {
    const lines: string[] = [];

    // 文档注释
    lines.push(`/// ${account.name}`);
    if (account.discriminator) {
      const discriminatorHex = Buffer.from(account.discriminator).toString('hex');
      lines.push(`/// Discriminator: ${discriminatorHex}`);
    }
    lines.push(`#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]`);
    lines.push(`pub struct ${account.name} {`);

    // 字段
    if (account.type.fields) {
      for (const field of account.type.fields) {
        if (field.docs && field.docs.length > 0) {
          lines.push(`    /// ${field.docs.join(' ')}`);
        }
        const rustType = this.idlTypeToRust(field.type);
        lines.push(`    pub ${field.name}: ${rustType},`);
      }
    }

    lines.push(`}`);

    // 添加测试
    if (includeTests) {
      lines.push('');
      lines.push('#[cfg(test)]');
      lines.push('mod tests {');
      lines.push('    use super::*;');
      lines.push('    use std::mem::size_of;');
      lines.push('');
      lines.push('    #[test]');
      lines.push(`    fn test_${account.name.toLowerCase()}_size() {`);
      lines.push(`        let size = size_of::<${account.name}>();`);
      lines.push(`        println!("${account.name} size: {} bytes", size);`);
      lines.push('    }');
      lines.push('}');
    }

    return lines.join('\n');
  }

  /**
   * 估算结构体大小
   */
  estimateStructSize(account: AnchorIdlAccount): number {
    let size = 0;

    if (!account.type.fields) {
      return 0;
    }

    for (const field of account.type.fields) {
      size += this.estimateFieldSize(field.type);
    }

    return size;
  }

  private estimateFieldSize(fieldType: any): number {
    if (typeof fieldType === 'string') {
      const sizeMap: Record<string, number> = {
        'publicKey': 32,
        'u8': 1, 'i8': 1, 'bool': 1,
        'u16': 2, 'i16': 2,
        'u32': 4, 'i32': 4,
        'u64': 8, 'i64': 8,
        'u128': 16, 'i128': 16,
      };
      return sizeMap[fieldType] || 0;
    }

    if (fieldType.array) {
      const [innerType, size] = fieldType.array;
      const elementSize = this.estimateFieldSize(innerType);
      return elementSize * size;
    }

    if (fieldType.option) {
      // Option adds 1 byte for the discriminator plus the inner type
      return 1 + this.estimateFieldSize(fieldType.option);
    }

    if (fieldType.vec) {
      // Vec is dynamically sized, return 24 bytes (3 * usize)
      return 24;
    }

    return 0;
  }

  /**
   * 生成完整的Rust模块
   */
  generateRustModule(accountName?: string): string {
    const lines: string[] = [];

    // 模块头部
    lines.push(`//! Auto-generated from Anchor IDL`);
    lines.push(`//! Program: ${this.idl.name}`);
    lines.push(`//! Version: ${this.idl.version}`);
    if (this.getProgramAddress()) {
      lines.push(`//! Address: ${this.getProgramAddress()}`);
    }
    lines.push('');
    lines.push('use borsh::{BorshDeserialize, BorshSerialize};');
    lines.push('use solana_sdk::pubkey::Pubkey;');
    lines.push('');

    // 生成账户结构
    const accounts = accountName 
      ? [this.findAccount(accountName)].filter(Boolean) as AnchorIdlAccount[]
      : this.getAccounts();

    for (const account of accounts) {
      lines.push(this.generateRustStruct(account, true));
      lines.push('');

      // 添加大小信息
      const estimatedSize = this.estimateStructSize(account);
      lines.push(`// Estimated size: ${estimatedSize} bytes`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成结构体布局文档
   */
  generateLayoutDoc(accountName: string): string {
    const account = this.findAccount(accountName);
    if (!account || !account.type.fields) {
      return 'Account not found';
    }

    const lines: string[] = [];
    lines.push(`# ${account.name} Layout\n`);
    lines.push('| Offset | Size | Field | Type |');
    lines.push('|--------|------|-------|------|');

    let offset = 0;
    for (const field of account.type.fields) {
      const rustType = this.idlTypeToRust(field.type);
      const size = this.estimateFieldSize(field.type);
      lines.push(`| ${offset.toString().padStart(6)} | ${size.toString().padStart(4)} | ${field.name.padEnd(30)} | ${rustType} |`);
      offset += size;
    }

    lines.push('');
    lines.push(`Total estimated size: ${offset} bytes`);

    return lines.join('\n');
  }
}

// CLI 使用
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法:');
    console.log('  tsx anchor-idl-parser.ts <idl-file> [account-name]');
    console.log('');
    console.log('示例:');
    console.log('  tsx anchor-idl-parser.ts ../idl/meteora-dlmm.json');
    console.log('  tsx anchor-idl-parser.ts ../idl/meteora-dlmm.json LbPair');
    process.exit(1);
  }

  const idlPath = args[0];
  const accountName = args[1];

  if (!fs.existsSync(idlPath)) {
    console.error(`❌ IDL文件不存在: ${idlPath}`);
    process.exit(1);
  }

  const parser = AnchorIdlParser.fromFile(idlPath);

  console.log('📊 IDL 信息:');
  console.log(`  程序: ${parser['idl'].name}`);
  console.log(`  版本: ${parser['idl'].version}`);
  if (parser.getProgramAddress()) {
    console.log(`  地址: ${parser.getProgramAddress()}`);
  }
  console.log(`  账户数: ${parser.getAccounts().length}`);
  console.log('');

  if (accountName) {
    // 生成特定账户的Rust代码
    const account = parser.findAccount(accountName);
    if (!account) {
      console.error(`❌ 未找到账户: ${accountName}`);
      process.exit(1);
    }

    console.log('✅ 生成Rust结构:\n');
    console.log(parser.generateRustStruct(account, true));
    console.log('');
    console.log(`估算大小: ${parser.estimateStructSize(account)} bytes`);
    console.log('');
    console.log('📋 布局文档:\n');
    console.log(parser.generateLayoutDoc(accountName));
  } else {
    // 生成所有账户
    console.log('✅ 生成完整模块:\n');
    console.log(parser.generateRustModule());
  }
}



























































































