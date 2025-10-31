-- 检查 HumidiFi 池子的历史更新
SELECT 
    'HumidiFi Pools' as category,
    pool_address,
    COUNT(*) as total_updates,
    MAX(base_reserve) as max_base_reserve,
    MAX(quote_reserve) as max_quote_reserve,
    MAX(price) as max_price,
    MIN(timestamp) as first_update,
    MAX(timestamp) as last_update
FROM pool_updates 
WHERE pool_address IN (
    'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm',  -- JUP/USDC
    '6n9VhCwQ7EwK6NqFDjnHPzEk6wZdRBTfh43RFgHQWHuQ',  -- USDC/USDT
    '3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuekia2'   -- USD1/USDC
)
GROUP BY pool_address;

-- 检查 AlphaQ 池子的详细数据
SELECT 
    'AlphaQ Pools' as category,
    pool_address,
    base_reserve,
    quote_reserve,
    price,
    timestamp
FROM pool_updates 
WHERE pool_address IN (
    '9xPhpwq6GLUkrDBNfXCbnSP9ARAMMyUQqgkrqaDW6NLV',  -- USDC/USD1
    'Pi9nzTjPxD8DsRfRBGfKYzmefJoJM8TcXu2jyaQjSHm',  -- USDT/USDC
    '6R3LknvRLwPg7c8Cww7LKqBHRDcGioPoj29uURX9anug'   -- USDS/USDC
)
ORDER BY timestamp DESC
LIMIT 10;

-- 查看最近的 vault 更新
SELECT 
    'Vault Updates' as category,
    vault_address,
    token_amount,
    timestamp
FROM vault_updates
ORDER BY timestamp DESC
LIMIT 20;

