# Solana Pool Cache - Prototype

**Version**: 0.1.0  
**Status**: Prototype - Technical Validation Phase

## 🎯 Project Goals

This prototype validates the technical feasibility of using WebSocket subscriptions and Borsh deserialization to cache Solana DEX pool states locally. The goal is to:

1. ✅ Verify WebSocket connectivity to Solana RPC (Helius)
2. ✅ Validate Borsh deserialization of Raydium AMM V4 pool states
3. ✅ Measure end-to-end latency (WebSocket receive → parse → calculate price)
4. ✅ Demonstrate real-time price tracking
5. ✅ Lay architectural foundation for scaling to 100+ pools

## 📊 Architecture

```
┌─────────────────────────────────────────────────────┐
│  Solana RPC (Helius WebSocket)                      │
│  wss://mainnet.helius-rpc.com/                      │
└────────────────┬────────────────────────────────────┘
                 │ accountSubscribe
                 │ (base64 encoded account data)
                 ▼
┌─────────────────────────────────────────────────────┐
│  WebSocket Client (websocket.rs)                    │
│  - Subscribes to pool accounts                      │
│  - Receives real-time updates                       │
│  - Auto-reconnection on failure                     │
└────────────────┬────────────────────────────────────┘
                 │ Raw bytes
                 ▼
┌─────────────────────────────────────────────────────┐
│  Deserializer (deserializers/raydium.rs)            │
│  - Borsh decode → RaydiumAmmInfo struct             │
│  - Extract coin_vault_amount, pc_vault_amount       │
│  - Calculate price, reserves                        │
└────────────────┬────────────────────────────────────┘
                 │ Structured data
                 ▼
┌─────────────────────────────────────────────────────┐
│  Metrics Collector (metrics.rs)                     │
│  - Record latency (P50, P95, P99)                   │
│  - Track update frequency                           │
│  - Print statistics every 60 seconds                │
└─────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### **一键启动（推荐）**

```powershell
# 统一启动脚本（Windows PowerShell）
.\START.ps1

# Vault修复启动（推荐用于修复13个池子问题）
.\START.ps1 fix

# 查看所有可用模式
.\START.ps1 help
```

### **简单启动**

```bash
# Windows
.\run.bat

# Linux/WSL
./run.sh

# 或直接用cargo
cargo run --release --bin solana-pool-cache
```

📖 **详细说明**: 查看 `SIMPLE_START.md`

---

## 🚀 Quick Start (Old)

### Prerequisites

- Rust 1.70+ (install from [rustup.rs](https://rustup.rs/))
- Helius API Key (already configured in `config.toml`)

### Installation

```bash
# Navigate to the rust-pool-cache directory
cd rust-pool-cache

# Build the project
cargo build --release

# Run the prototype
cargo run --release
```

Or specify a custom config file:

```bash
cargo run --release -- /path/to/config.toml
```

### Expected Output

```
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🦀 Solana Pool Cache - Prototype Version 0.1.0          ║
║                                                           ║
║   Real-time WebSocket subscription to Raydium pools      ║
║   Measuring latency and validating Borsh deserialization ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

📋 Loading configuration from: config.toml
✅ Configuration loaded successfully
   WebSocket URL: wss://mainnet.helius-rpc.com/?api-key=***
   Pools to monitor: 3
     - SOL/USDC (58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2)
     - SOL/USDT (7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX)
     - USDC/USDT (77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS)

🔌 Connecting to WebSocket: wss://mainnet.helius-rpc.com/?api-key=***
✅ WebSocket connected successfully
📡 Subscribed to SOL/USDC (58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2)
📡 Subscribed to SOL/USDT (7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX)
📡 Subscribed to USDC/USDT (77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS)

🎯 Waiting for pool updates...

┌─────────────────────────────────────────────────────
│ [2025-10-26 09:23:45] SOL/USDC Pool Updated
│ ├─ Price:        185.2400 (quote/base)
│ ├─ Base Reserve:      100,234.50
│ ├─ Quote Reserve:  18,563,421.20
│ ├─ Latency:      1.234 ms (1234 μs)
│ └─ Slot:         123456789
└─────────────────────────────────────────────────────

┌───────────────────────────────────────────────────────┐
│  Statistics - Last 60 seconds                         │
├───────────────────────────────────────────────────────┤
│  Total Updates:           45                          │
│  Update Rate:           0.75 updates/sec              │
├───────────────────────────────────────────────────────┤
│  Latency (microseconds):                              │
│    Average:          1100.00 μs (1.10 ms)             │
│    Min:               850.00 μs (0.85 ms)             │
│    P50:              1050.00 μs (1.05 ms)             │
│    P95:              1450.00 μs (1.45 ms)             │
│    P99:              1650.00 μs (1.65 ms)             │
│    Max:              1800.00 μs (1.80 ms)             │
└───────────────────────────────────────────────────────┘
```

## ⚙️ Configuration

Edit `config.toml` to customize:

```toml
[websocket]
url = "wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY"

[[pools]]
address = "POOL_ADDRESS_HERE"
name = "TOKEN_A/TOKEN_B"
```

### Adding More Pools

Simply add more `[[pools]]` entries:

```toml
[[pools]]
address = "NEW_POOL_ADDRESS"
name = "NEW_POOL_NAME"
```

The system will automatically subscribe to all configured pools.

## 📈 Performance Testing Results

> **Note**: Fill in after running the prototype for 10+ minutes

### Test Environment
- **RPC Provider**: Helius (Free Tier)
- **Network**: Solana Mainnet
- **Test Duration**: __ minutes
- **Pools Monitored**: 3 (SOL/USDC, SOL/USDT, USDC/USDT)

### Results

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Average Latency | __ ms | < 5 ms | __ |
| P95 Latency | __ ms | < 10 ms | __ |
| P99 Latency | __ ms | < 15 ms | __ |
| Update Frequency | __ updates/sec | 0.5-2 updates/sec | __ |
| Stability | __ min uptime | > 10 min | __ |

### Observations

- [ ] WebSocket connection stable
- [ ] Borsh deserialization working correctly
- [ ] Prices match external sources (e.g., DexScreener)
- [ ] Latency within acceptable range
- [ ] No memory leaks observed

## 🔧 Technical Details

### Dependencies

```toml
tokio = { version = "1.35", features = ["full"] }  # Async runtime
tokio-tungstenite = "0.21"                          # WebSocket client
borsh = "0.10"                                      # Borsh deserialization
solana-sdk = "1.17"                                 # Solana types (Pubkey)
serde = { version = "1.0", features = ["derive"] }  # JSON parsing
base64 = "0.21"                                     # Base64 decoding
chrono = "0.4"                                      # Timestamps
anyhow = "1.0"                                      # Error handling
```

### Module Structure

- **`config.rs`**: Configuration loading from TOML
- **`websocket.rs`**: WebSocket client (connect, subscribe, reconnect)
- **`deserializers/raydium.rs`**: Raydium AMM V4 Borsh layout
- **`metrics.rs`**: Latency tracking and statistics
- **`main.rs`**: Entry point and task coordination

### Raydium AMM V4 State

The `RaydiumAmmInfo` struct mirrors the on-chain account layout:

```rust
pub struct RaydiumAmmInfo {
    // ... metadata fields ...
    pub coin_vault_amount: u64,  // Base token reserve
    pub pc_vault_amount: u64,    // Quote token reserve
    pub coin_decimals: u64,      // Base token decimals
    pub pc_decimals: u64,        // Quote token decimals
    // ... more fields ...
}
```

**Price Calculation**:
```
price = (pc_vault_amount / 10^pc_decimals) / (coin_vault_amount / 10^coin_decimals)
```

### WebSocket Subscription

The client sends a JSON-RPC message:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "accountSubscribe",
  "params": [
    "POOL_ADDRESS",
    {
      "encoding": "base64",
      "commitment": "confirmed"
    }
  ]
}
```

And receives notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "accountNotification",
  "params": {
    "result": {
      "context": { "slot": 123456789 },
      "value": {
        "data": ["BASE64_ENCODED_DATA", "base64"],
        ...
      }
    },
    "subscription": 12345
  }
}
```

## 🚧 Known Limitations

1. **Simplified Pool Detection**: Currently, all updates are labeled with the first pool name. A production system would track subscription IDs to correctly map updates to pools.

2. **Raydium V4 Only**: Only supports Raydium AMM V4 pools. Orca Whirlpool, Meteora DLMM, etc., require different deserializers.

3. **No Caching**: This prototype doesn't maintain a cache. It only logs updates. The next phase will add a `DashMap` for in-memory caching.

4. **No HTTP API**: No external API to query cached prices. This will be added in the MVP phase.

5. **Basic Reconnection**: Reconnects after 5 seconds on failure. Production would use exponential backoff.

## 🛣️ Roadmap

### Phase 1: Prototype (Current) ✅
- [x] WebSocket subscription
- [x] Borsh deserialization
- [x] Latency measurement
- [x] Basic reconnection

### Phase 2: MVP (Next)
- [ ] In-memory cache (DashMap)
- [ ] HTTP API for queries (`GET /price/:pool_address`)
- [ ] Support 100 pools
- [ ] Exponential backoff reconnection
- [ ] Prometheus metrics export

### Phase 3: Production
- [ ] Multi-DEX support (Orca, Meteora)
- [ ] Dynamic pool list updates
- [ ] Hot pool detection
- [ ] gRPC API (for lower latency)
- [ ] Docker containerization
- [ ] Grafana dashboard

## 🔍 Troubleshooting

### "Failed to connect to WebSocket"
- Check your Helius API Key in `config.toml`
- Verify internet connection
- Try a different RPC (e.g., QuickNode, Triton)

### "Failed to deserialize pool state"
- The pool might not be a Raydium AMM V4 pool
- The Raydium program may have been upgraded (rare)
- Check if the pool address is correct

### No updates received
- Some pools are inactive and rarely update
- Try subscribing to a more active pool (e.g., SOL/USDC)
- Check Solana network status

## 📚 References

- [Solana WebSocket API](https://solana.com/docs/rpc/websocket)
- [Raydium AMM GitHub](https://github.com/raydium-io/raydium-amm)
- [Borsh Specification](https://borsh.io/)
- [Tokio Documentation](https://tokio.rs/)

## 📄 License

This prototype is part of a larger arbitrage bot project. Internal use only.

---

**Created by**: Solana Arbitrage Team  
**Date**: 2025-10-26  
**Contact**: For questions or issues, please create a GitHub issue or contact the team.



