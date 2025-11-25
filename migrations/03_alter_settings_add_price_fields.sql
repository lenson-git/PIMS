-- ================================================
-- 扩展 settings 表以支持价格规则
-- Version: 20251125-1713
-- Purpose: 为出入库类型添加价格来源和币种字段
-- ================================================

-- 添加价格来源字段 (purchase_price_rmb 或 selling_price_thb)
ALTER TABLE settings 
ADD COLUMN IF NOT EXISTS price_source TEXT;

-- 添加币种字段 (RMB 或 THB)
ALTER TABLE settings 
ADD COLUMN IF NOT EXISTS currency TEXT CHECK (currency IN ('RMB', 'THB', 'CNY'));

-- 添加字段注释
COMMENT ON COLUMN settings.price_source IS '价格来源字段名 (仅用于 inbound_type 和 outbound_type)';
COMMENT ON COLUMN settings.currency IS '币种 (RMB/CNY/THB, 仅用于 inbound_type 和 outbound_type)';

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_settings_type_code 
    ON settings(type, code) 
    WHERE price_source IS NOT NULL;
