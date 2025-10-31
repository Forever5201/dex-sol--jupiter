import { Connection, PublicKey } from '@solana/web3.js';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

async function analyzeAccount(address: string, poolName: string, expectedType: string) {
    const connection = new Connection(RPC, 'confirmed');
    const pubkey = new PublicKey(address);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`分析池子: ${poolName} (${expectedType})`);
    console.log(`地址: ${address}`);
    console.log(`${'='.repeat(80)}`);
    
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) {
        console.log('❌ 账户不存在');
        return;
    }
    
    const data = accountInfo.data;
    console.log(`\n📊 账户信息:`);
    console.log(`  - 总大小: ${data.length} 字节`);
    console.log(`  - 所有者: ${accountInfo.owner.toBase58()}`);
    console.log(`  - Lamports: ${accountInfo.lamports}`);
    
    // 分析discriminator（前8字节）
    if (data.length >= 8) {
        const discriminator = data.slice(0, 8);
        console.log(`\n🔑 Discriminator (前8字节):`);
        console.log(`  - Hex: ${Buffer.from(discriminator).toString('hex')}`);
        console.log(`  - 字节: [${Array.from(discriminator).join(', ')}]`);
    }
    
    // 分析前128字节的结构
    console.log(`\n🔍 前128字节分析:`);
    for (let i = 0; i < Math.min(128, data.length); i += 16) {
        const chunk = data.slice(i, Math.min(i + 16, data.length));
        const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
        console.log(`  ${i.toString().padStart(4, ' ')}: ${hex.padEnd(48, ' ')} | ${ascii}`);
    }
    
    // 如果是Meteora DLMM，尝试读取一些已知字段
    if (expectedType === 'Meteora DLMM') {
        console.log(`\n🧮 尝试解析Meteora DLMM关键字段:`);
        
        // 跳过discriminator后的数据
        const offset = 8;
        
        // 尝试读取PoolParameters (32字节)
        console.log(`  - PoolParameters位置 (offset ${offset}, 32字节)`);
        
        // 然后是多个Pubkey
        let pubkeyOffset = offset + 32;
        const pubkeys = [
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
        
        pubkeys.forEach(name => {
            if (pubkeyOffset + 32 <= data.length) {
                const pubkeyBytes = data.slice(pubkeyOffset, pubkeyOffset + 32);
                const pubkey = new PublicKey(pubkeyBytes);
                console.log(`  - ${name.padEnd(25)}: ${pubkey.toBase58()} (offset ${pubkeyOffset})`);
                pubkeyOffset += 32;
            }
        });
        
        // active_id (i32)
        if (pubkeyOffset + 4 <= data.length) {
            const activeId = data.readInt32LE(pubkeyOffset);
            console.log(`  - active_id (i32)                : ${activeId} (offset ${pubkeyOffset})`);
            pubkeyOffset += 4;
        }
        
        // bin_step (u16)
        if (pubkeyOffset + 2 <= data.length) {
            const binStep = data.readUInt16LE(pubkeyOffset);
            console.log(`  - bin_step (u16)                 : ${binStep} (offset ${pubkeyOffset})`);
            pubkeyOffset += 2;
        }
        
        console.log(`\n  ✅ 读取到offset ${pubkeyOffset}，剩余 ${data.length - pubkeyOffset} 字节未解析`);
    }
    
    // 如果是Raydium CLMM
    if (expectedType === 'Raydium CLMM') {
        console.log(`\n🧮 尝试解析Raydium CLMM关键字段:`);
        
        let offset = 0;
        
        // bump ([u8; 1])
        if (offset + 1 <= data.length) {
            const bump = data.readUInt8(offset);
            console.log(`  - bump (u8)                      : ${bump} (offset ${offset})`);
            offset += 1;
        }
        
        // 然后是多个Pubkey
        const pubkeys = [
            'amm_config',
            'owner',
            'token_vault_0',
            'token_vault_1',
            'lp_mint',
            'token_mint_0',
            'token_mint_1',
            'token_program_0',
            'token_program_1',
            'observation_key'
        ];
        
        pubkeys.forEach(name => {
            if (offset + 32 <= data.length) {
                const pubkeyBytes = data.slice(offset, offset + 32);
                const pubkey = new PublicKey(pubkeyBytes);
                console.log(`  - ${name.padEnd(25)}: ${pubkey.toBase58()} (offset ${offset})`);
                offset += 32;
            }
        });
        
        console.log(`\n  ✅ 读取到offset ${offset}，剩余 ${data.length - offset} 字节未解析`);
    }
    
    // 最后128字节
    console.log(`\n📝 最后128字节:`);
    const startLast = Math.max(0, data.length - 128);
    for (let i = startLast; i < data.length; i += 16) {
        const chunk = data.slice(i, Math.min(i + 16, data.length));
        const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
        console.log(`  ${i.toString().padStart(4, ' ')}: ${hex.padEnd(48, ' ')} | ${ascii}`);
    }
}

async function main() {
    console.log('🔬 分析链上账户实际数据结构\n');
    
    // Meteora DLMM - JUP/USDC
    await analyzeAccount(
        'BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61',
        'JUP/USDC',
        'Meteora DLMM'
    );
    
    // Raydium CLMM - SOL/USDC
    await analyzeAccount(
        '61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht',
        'SOL/USDC',
        'Raydium CLMM'
    );
}

main().catch(console.error);












