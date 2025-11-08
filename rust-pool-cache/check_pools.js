// 验证池子地址是否存在
const pools = [
  { name: "ORCA/USDC", address: "2p7nYbtPBgtmY69NsE8DAW6szpRJn7tQvDnqvoEWQvjY" },
  { name: "JUP/USDC", address: "8kJqxAbqbPXGH8yCEr4C2DqZHCRnKZX8gKGmceYXMJXv" },
  { name: "BONK/SOL", address: "Azbpsv9dxggjhfLJvPZhWpMEPb5GZcqRtPiCBKJfZrYQ" },
  { name: "mSOL/SOL", address: "ZfvDXXUhZDzDVsapffUyXHj9ByCoPjP4thL6YXcZ9ixY" }
];

async function checkPools() {
  const addresses = pools.map(p => p.address);
  
  const response = await fetch("https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [addresses, { encoding: "base64" }]
    })
  });

  const data = await response.json();
  
  console.log("\n=== Pool Verification Results ===\n");
  
  data.result.value.forEach((account, idx) => {
    const pool = pools[idx];
    if (account === null) {
      console.log(`❌ ${pool.name}: NOT FOUND (account does not exist)`);
    } else {
      const dataLength = Buffer.from(account.data[0], 'base64').length;
      console.log(`✅ ${pool.name}: EXISTS`);
      console.log(`   - Data length: ${dataLength} bytes`);
      console.log(`   - Owner: ${account.owner}`);
      console.log(`   - Executable: ${account.executable}`);
    }
    console.log();
  });
}

checkPools().catch(console.error);
























































































