-- ================================================
-- 初始化仓库约束数据
-- Version: 20251125-1713
-- Purpose: 插入默认的仓库-出入库类型约束关系
-- ================================================

-- 清空现有数据 (可选,仅在重新初始化时使用)
-- TRUNCATE TABLE warehouse_type_constraints;

-- 主仓 (MAIN) 的约束
INSERT INTO warehouse_type_constraints (warehouse_code, direction, movement_type_code)
VALUES
    -- 主仓入库类型
    ('MAIN', 'inbound', 'PURCHASE_IN'),      -- 采购入库
    ('MAIN', 'inbound', 'AFTERSALE_IN'),     -- 售后入库
    
    -- 主仓出库类型
    ('MAIN', 'outbound', 'SALES_OUT'),       -- 销售出库
    ('MAIN', 'outbound', 'EXCHANGE_OUT')     -- 换货出库
ON CONFLICT (warehouse_code, direction, movement_type_code) DO NOTHING;

-- 售后仓 (AFTERSALE) 的约束
INSERT INTO warehouse_type_constraints (warehouse_code, direction, movement_type_code)
VALUES
    -- 售后仓入库类型
    ('AFTERSALE', 'inbound', 'AFTERSALE_IN'),     -- 售后入库
    
    -- 售后仓出库类型
    ('AFTERSALE', 'outbound', 'RETURN_SUPPLIER')  -- 退给供应商
ON CONFLICT (warehouse_code, direction, movement_type_code) DO NOTHING;

-- 验证插入结果
SELECT 
    warehouse_code,
    direction,
    COUNT(*) as constraint_count
FROM warehouse_type_constraints
GROUP BY warehouse_code, direction
ORDER BY warehouse_code, direction;
