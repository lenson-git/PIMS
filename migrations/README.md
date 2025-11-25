# PIMS-Web 数据库迁移指南

## 📋 概述

本目录包含 PIMS-Web 系统的数据库迁移脚本,用于实现动态仓库约束和价格规则配置。

## 🗂️ 迁移脚本列表

### 1. `01_create_warehouse_type_constraints.sql`
**目的**: 创建仓库-出入库类型约束表

**功能**:
- 创建 `warehouse_type_constraints` 表
- 添加唯一约束和索引
- 配置 Row Level Security (RLS) 策略
- 允许认证用户进行 CRUD 操作

**执行时机**: 首次部署或升级到动态约束系统时

---

### 2. `02_seed_warehouse_constraints.sql`
**目的**: 初始化仓库约束数据

**功能**:
- 插入主仓 (MAIN) 的约束规则
  - 入库类型: PURCHASE_IN, AFTERSALE_IN
  - 出库类型: SALES_OUT, EXCHANGE_OUT
- 插入售后仓 (AFTERSALE) 的约束规则
  - 入库类型: AFTERSALE_IN
  - 出库类型: RETURN_SUPPLIER

**执行时机**: 在 `01_create_warehouse_type_constraints.sql` 之后

---

### 3. `03_alter_settings_add_price_fields.sql`
**目的**: 扩展 settings 表以支持价格规则

**功能**:
- 添加 `price_source` 字段 (价格来源字段名)
- 添加 `currency` 字段 (币种: RMB/CNY/THB)
- 创建索引以提高查询性能

**执行时机**: 在初始化仓库约束之后

---

### 4. `04_seed_price_rules.sql`
**目的**: 初始化价格规则数据

**功能**:
- 为入库类型设置价格规则
  - PURCHASE_IN: purchase_price_rmb, RMB
  - AFTERSALE_IN: selling_price_thb, THB
- 为出库类型设置价格规则
  - SALES_OUT: selling_price_thb, THB
  - EXCHANGE_OUT: selling_price_thb, THB
  - RETURN_SUPPLIER: purchase_price_rmb, RMB

**执行时机**: 在 `03_alter_settings_add_price_fields.sql` 之后

---

## 🚀 执行顺序

**重要**: 必须按照以下顺序执行脚本:

```bash
# 1. 创建仓库约束表
psql -h <host> -U <user> -d <database> -f 01_create_warehouse_type_constraints.sql

# 2. 初始化仓库约束数据
psql -h <host> -U <user> -d <database> -f 02_seed_warehouse_constraints.sql

# 3. 扩展 settings 表
psql -h <host> -U <user> -d <database> -f 03_alter_settings_add_price_fields.sql

# 4. 初始化价格规则
psql -h <host> -U <user> -d <database> -f 04_seed_price_rules.sql
```

### 使用 Supabase Dashboard

1. 登录 Supabase Dashboard
2. 进入项目的 SQL Editor
3. 按顺序复制粘贴每个脚本内容并执行
4. 验证执行结果

---

## ✅ 验证

执行完所有脚本后,运行以下查询验证:

```sql
-- 1. 检查仓库约束表
SELECT warehouse_code, direction, COUNT(*) as constraint_count
FROM warehouse_type_constraints
GROUP BY warehouse_code, direction
ORDER BY warehouse_code, direction;

-- 预期结果:
-- AFTERSALE | inbound  | 1
-- AFTERSALE | outbound | 1
-- MAIN      | inbound  | 2
-- MAIN      | outbound | 2

-- 2. 检查价格规则
SELECT type, code, name, price_source, currency
FROM settings
WHERE type IN ('InboundType', 'OutboundType')
  AND price_source IS NOT NULL
ORDER BY type, code;

-- 预期结果: 5 条记录,每条都有 price_source 和 currency
```

---

## 🔄 回滚

如需回滚迁移,按相反顺序执行:

```sql
-- 4. 清除价格规则
UPDATE settings 
SET price_source = NULL, currency = NULL
WHERE type IN ('InboundType', 'OutboundType');

-- 3. 删除 settings 表字段
ALTER TABLE settings DROP COLUMN IF EXISTS price_source;
ALTER TABLE settings DROP COLUMN IF EXISTS currency;

-- 2. 清空仓库约束数据
TRUNCATE TABLE warehouse_type_constraints;

-- 1. 删除仓库约束表
DROP TABLE IF EXISTS warehouse_type_constraints;
```

---

## 📝 注意事项

1. **备份数据**: 执行迁移前请备份数据库
2. **测试环境**: 建议先在测试环境验证
3. **权限检查**: 确保执行用户有足够权限
4. **RLS 策略**: 仓库约束表已启用 RLS,确保用户已认证
5. **前端兼容**: 前端代码已支持动态配置,会自动回退到硬编码规则

---

## 🔗 相关文件

- 前端实现: `js/app.js` (loadWarehouseConstraints, loadPriceRules)
- API 接口: `js/supabase-client.js` (fetchWarehouseConstraints, fetchPriceRules)
- 硬编码后备: `js/config.js` (WAREHOUSE_RULES, PRICE_RULES)

---

## 📞 支持

如有问题,请查看:
- [验证报告](../../../.gemini/antigravity/brain/9e5e1913-f657-4ad8-8d34-34a85514c29e/verification_report.md)
- [任务清单](../../../.gemini/antigravity/brain/9e5e1913-f657-4ad8-8d34-34a85514c29e/task.md)
