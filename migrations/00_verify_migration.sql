-- ================================================
-- 数据库迁移验证脚本
-- Version: 20251125-1718
-- Purpose: 验证所有迁移脚本执行后的数据完整性
-- ================================================

-- ========================================
-- 1. 检查 warehouse_type_constraints 表是否存在
-- ========================================
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'warehouse_type_constraints'
        ) 
        THEN '✓ warehouse_type_constraints 表已创建'
        ELSE '✗ warehouse_type_constraints 表不存在'
    END as check_result;

-- ========================================
-- 2. 检查仓库约束数据
-- ========================================
SELECT 
    '仓库约束统计' as check_type,
    warehouse_code,
    direction,
    COUNT(*) as constraint_count
FROM warehouse_type_constraints
GROUP BY warehouse_code, direction
ORDER BY warehouse_code, direction;

-- 预期结果:
-- AFTERSALE | inbound  | 1
-- AFTERSALE | outbound | 1
-- MAIN      | inbound  | 2
-- MAIN      | outbound | 2

-- ========================================
-- 3. 检查 settings 表字段是否存在
-- ========================================
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'settings' 
            AND column_name = 'price_source'
        ) 
        THEN '✓ price_source 字段已添加'
        ELSE '✗ price_source 字段不存在'
    END as check_result
UNION ALL
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'settings' 
            AND column_name = 'currency'
        ) 
        THEN '✓ currency 字段已添加'
        ELSE '✗ currency 字段不存在'
    END;

-- ========================================
-- 4. 检查价格规则数据
-- ========================================
SELECT 
    '价格规则检查' as check_type,
    type,
    code,
    name,
    price_source,
    currency,
    CASE 
        WHEN price_source IS NULL OR currency IS NULL 
        THEN '✗ 缺少价格规则'
        ELSE '✓ 已配置'
    END as status
FROM settings
WHERE type IN ('InboundType', 'OutboundType')
ORDER BY type, code;

-- 预期结果: 至少 5 条记录都应该有 price_source 和 currency

-- ========================================
-- 5. 检查索引是否创建
-- ========================================
SELECT 
    '索引检查' as check_type,
    indexname,
    tablename
FROM pg_indexes
WHERE tablename IN ('warehouse_type_constraints', 'settings')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ========================================
-- 6. 检查 RLS 策略
-- ========================================
SELECT 
    'RLS 策略检查' as check_type,
    schemaname,
    tablename,
    policyname,
    cmd as operation
FROM pg_policies
WHERE tablename = 'warehouse_type_constraints'
ORDER BY cmd;

-- 预期结果: 4 条策略 (SELECT, INSERT, UPDATE, DELETE)

-- ========================================
-- 7. 完整性检查 - 验证约束与设置的一致性
-- ========================================
-- 检查仓库代码是否在 settings 中存在
SELECT 
    '仓库代码一致性检查' as check_type,
    wc.warehouse_code,
    CASE 
        WHEN s.code IS NOT NULL THEN '✓ 存在于 settings'
        ELSE '✗ 不存在于 settings'
    END as status
FROM (
    SELECT DISTINCT warehouse_code 
    FROM warehouse_type_constraints
) wc
LEFT JOIN settings s ON s.code = wc.warehouse_code AND s.type = 'Warehouse';

-- 检查出入库类型代码是否在 settings 中存在
SELECT 
    '出入库类型一致性检查' as check_type,
    wc.movement_type_code,
    wc.direction,
    CASE 
        WHEN s.code IS NOT NULL THEN '✓ 存在于 settings'
        ELSE '✗ 不存在于 settings'
    END as status
FROM (
    SELECT DISTINCT movement_type_code, direction 
    FROM warehouse_type_constraints
) wc
LEFT JOIN settings s ON s.code = wc.movement_type_code 
    AND s.type = CASE 
        WHEN wc.direction = 'inbound' THEN 'InboundType'
        WHEN wc.direction = 'outbound' THEN 'OutboundType'
    END;

-- ========================================
-- 8. 数据完整性汇总
-- ========================================
SELECT 
    '=== 数据完整性汇总 ===' as summary,
    (SELECT COUNT(*) FROM warehouse_type_constraints) as total_constraints,
    (SELECT COUNT(*) FROM settings WHERE type IN ('InboundType', 'OutboundType') AND price_source IS NOT NULL) as configured_price_rules,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'warehouse_type_constraints') as rls_policies;
