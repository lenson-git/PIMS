-- ================================================
-- 初始化价格规则数据
-- Version: 20251125-1713
-- Purpose: 为现有的出入库类型设置价格来源和币种
-- ================================================

-- 更新入库类型的价格规则
UPDATE settings 
SET 
    price_source = 'purchase_price_rmb',
    currency = 'RMB'
WHERE type = 'InboundType' 
  AND code = 'PURCHASE_IN';

UPDATE settings 
SET 
    price_source = 'selling_price_thb',
    currency = 'THB'
WHERE type = 'InboundType' 
  AND code = 'AFTERSALE_IN';

-- 更新出库类型的价格规则
UPDATE settings 
SET 
    price_source = 'selling_price_thb',
    currency = 'THB'
WHERE type = 'OutboundType' 
  AND code IN ('SALES_OUT', 'EXCHANGE_OUT');

UPDATE settings 
SET 
    price_source = 'purchase_price_rmb',
    currency = 'RMB'
WHERE type = 'OutboundType' 
  AND code = 'RETURN_SUPPLIER';

-- 验证更新结果
SELECT 
    type,
    code,
    name,
    price_source,
    currency
FROM settings
WHERE type IN ('InboundType', 'OutboundType')
  AND price_source IS NOT NULL
ORDER BY type, code;
