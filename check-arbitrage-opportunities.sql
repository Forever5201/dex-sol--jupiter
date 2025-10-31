-- 查询套利机会记录
-- 检查系统是否发现并记录了套利机会

-- 1. 统计最近1小时的套利机会数量
SELECT 
    COUNT(*) as total_opportunities,
    COUNT(DISTINCT arb_type) as unique_types,
    AVG(net_profit) as avg_profit,
    MAX(net_profit) as max_profit,
    MIN(detected_at) as first_detected,
    MAX(detected_at) as last_detected
FROM opportunities
WHERE detected_at > NOW() - INTERVAL '1 hour';

-- 2. 查看最新的 10 个套利机会详情
SELECT 
    id,
    arb_type,
    start_token,
    end_token,
    net_profit,
    roi_percent,
    path_description,
    detected_at
FROM opportunities
ORDER BY detected_at DESC
LIMIT 10;

-- 3. 按套利类型分组统计
SELECT 
    arb_type,
    COUNT(*) as count,
    AVG(net_profit) as avg_profit,
    AVG(roi_percent) as avg_roi
FROM opportunities
WHERE detected_at > NOW() - INTERVAL '24 hours'
GROUP BY arb_type
ORDER BY count DESC;

-- 4. 查看路由器模式使用情况
SELECT 
    router_mode,
    COUNT(*) as opportunities_found,
    AVG(net_profit) as avg_profit
FROM opportunities
WHERE detected_at > NOW() - INTERVAL '1 hour'
GROUP BY router_mode;






