import { Connection, PublicKey } from '@solana/web3.js';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

async function analyzeMeteoraDetailed(address) {
    const connection = new Connection(RPC, 'confirmed');
    const pubkey = new PublicKey(address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) return;
    
    const data = accountInfo.data;
    console.log('\n' + '='.repeat(80));
    console.log('METEORA DLMM 详细字段分析');
    console.log('='.repeat(80));
    console.log(`总大小: ${data.length} 字节\n`);
    
    let offset = 0;
    
    // Discriminator
    const discriminator = data.slice(offset, offset + 8);
    console.log(`[${offset.toString().padStart(4, ' ')}] Discriminator (8 bytes): ${Buffer.from(discriminator).toString('hex')}`);
    offset += 8;
    
    // PoolParameters结构 (应该是32字节)
    console.log(`\n[${offset.toString().padStart(4, ' ')}] PoolParameters (32 bytes):`);
    const baseFactor = data.readUInt16LE(offset); offset += 2;
    const filterPeriod = data.readUInt16LE(offset); offset += 2;
    const decayPeriod = data.readUInt16LE(offset); offset += 2;
    const reductionFactor = data.readUInt16LE(offset); offset += 2;
    const variableFeeControl = data.readUInt32LE(offset); offset += 4;
    const maxVolatilityAcc = data.readUInt32LE(offset); offset += 4;
    const minBinId = data.readInt32LE(offset); offset += 4;
    const maxBinId = data.readInt32LE(offset); offset += 4;
    const protocolShare = data.readUInt16LE(offset); offset += 2;
    const padding = data.slice(offset, offset + 6); offset += 6;
    
    console.log(`  base_factor: ${baseFactor}`);
    console.log(`  filter_period: ${filterPeriod}`);
    console.log(`  decay_period: ${decayPeriod}`);
    console.log(`  reduction_factor: ${reductionFactor}`);
    console.log(`  variable_fee_control: ${variableFeeControl}`);
    console.log(`  max_volatility_accumulator: ${maxVolatilityAcc}`);
    console.log(`  min_bin_id: ${minBinId}`);
    console.log(`  max_bin_id: ${maxBinId}`);
    console.log(`  protocol_share: ${protocolShare}`);
    
    // 12个Pubkey
    const pubkeyNames = [
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
        'reward_mint_1'
    ];
    
    console.log(`\n[${offset.toString().padStart(4, ' ')}] 12 Pubkeys (384 bytes):`);
    pubkeyNames.forEach(name => {
        const pubkeyBytes = data.slice(offset, offset + 32);
        const pubkey = new PublicKey(pubkeyBytes);
        console.log(`  ${name.padEnd(25)}: ${pubkey.toBase58()}`);
        offset += 32;
    });
    
    // Active ID
    console.log(`\n[${offset.toString().padStart(4, ' ')}] active_id (i32, 4 bytes):`);
    const activeId = data.readInt32LE(offset);
    console.log(`  active_id: ${activeId}`);
    offset += 4;
    
    // Bin Step
    console.log(`\n[${offset.toString().padStart(4, ' ')}] bin_step (u16, 2 bytes):`);
    const binStep = data.readUInt16LE(offset);
    console.log(`  bin_step: ${binStep}`);
    offset += 2;
    
    // Status
    console.log(`\n[${offset.toString().padStart(4, ' ')}] status (u8, 1 byte):`);
    const status = data.readUInt8(offset);
    console.log(`  status: ${status}`);
    offset += 1;
    
    // Padding
    console.log(`\n[${offset.toString().padStart(4, ' ')}] _padding0 (u8, 1 byte):`);
    offset += 1;
    
    // 继续读取更多字段...
    console.log(`\n[${offset.toString().padStart(4, ' ')}] protocol_fee_x (u64, 8 bytes):`);
    const protocolFeeX = data.readBigUInt64LE(offset);
    console.log(`  protocol_fee_x: ${protocolFeeX}`);
    offset += 8;
    
    console.log(`\n[${offset.toString().padStart(4, ' ')}] protocol_fee_y (u64, 8 bytes):`);
    const protocolFeeY = data.readBigUInt64LE(offset);
    console.log(`  protocol_fee_y: ${protocolFeeY}`);
    offset += 8;
    
    console.log(`\n[${offset.toString().padStart(4, ' ')}] base_fee_rate (u32, 4 bytes):`);
    const baseFeeRate = data.readUInt32LE(offset);
    console.log(`  base_fee_rate: ${baseFeeRate}`);
    offset += 4;
    
    console.log(`\n[${offset.toString().padStart(4, ' ')}] max_fee_rate (u32, 4 bytes):`);
    const maxFeeRate = data.readUInt32LE(offset);
    console.log(`  max_fee_rate: ${maxFeeRate}`);
    offset += 4;
    
    console.log(`\n当前offset: ${offset}, 剩余字节: ${data.length - offset}`);
    console.log('\n剩余数据的前64字节(hex):');
    const remaining = data.slice(offset, offset + 64);
    for (let i = 0; i < remaining.length; i += 16) {
        const chunk = remaining.slice(i, i + 16);
        const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`  ${(offset + i).toString().padStart(4, ' ')}: ${hex}`);
    }
}

async function analyzeRaydiumDetailed(address) {
    const connection = new Connection(RPC, 'confirmed');
    const pubkey = new PublicKey(address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) return;
    
    const data = accountInfo.data;
    console.log('\n' + '='.repeat(80));
    console.log('RAYDIUM CLMM 详细字段分析');
    console.log('='.repeat(80));
    console.log(`总大小: ${data.length} 字节\n`);
    
    let offset = 0;
    
    // 检查是否有discriminator
    console.log('前8字节分析:');
    const first8 = data.slice(0, 8);
    console.log(`  Hex: ${Buffer.from(first8).toString('hex')}`);
    console.log(`  可能是discriminator: ${first8[0] === 0xF7 && first8[7] === 0x46}`);
    
    // 尝试两种解析方式
    console.log('\n方案A: 假设有8字节discriminator');
    let offsetA = 8;
    console.log(`[${offsetA}] bump: ${data.readUInt8(offsetA)}`);
    
    console.log('\n方案B: 假设没有discriminator');
    let offsetB = 0;
    console.log(`[${offsetB}] bump: ${data.readUInt8(offsetB)}`);
    
    // 读取后续的Pubkey看哪个更合理
    console.log('\n方案A的第一个Pubkey (offset 9):');
    const pubkeyA = new PublicKey(data.slice(9, 9 + 32));
    console.log(`  ${pubkeyA.toBase58()}`);
    
    console.log('\n方案B的第一个Pubkey (offset 1):');
    const pubkeyB = new PublicKey(data.slice(1, 1 + 32));
    console.log(`  ${pubkeyB.toBase58()}`);
    
    // 已知的Raydium CLMM配置地址来验证
    console.log('\n已知的Raydium CLMM配置地址:');
    console.log('  H1dEYx2jYudtGACwtZ6SCjvAdHQdXM58e9CCwqUFFc4t (从前面的分析)');
    console.log(`  方案B匹配: ${pubkeyB.toBase58() === 'H1dEYx2jYudtGACwtZ6SCjvAdHQdXM58e9CCwqUFFc4t'}`);
}

async function main() {
    await analyzeMeteoraDetailed('BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61');
    await analyzeRaydiumDetailed('61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht');
}

main().catch(console.error);












