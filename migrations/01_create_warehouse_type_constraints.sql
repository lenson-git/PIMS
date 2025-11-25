-- ================================================
-- 创建仓库-出入库类型约束表
-- Version: 20251125-1713
-- Purpose: 存储仓库与出入库类型的动态约束关系
-- ================================================

-- 创建表
CREATE TABLE IF NOT EXISTS warehouse_type_constraints (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    warehouse_code TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    movement_type_code TEXT NOT NULL,
    
    -- 确保同一仓库、方向、类型组合唯一
    CONSTRAINT unique_warehouse_direction_type 
        UNIQUE (warehouse_code, direction, movement_type_code)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_warehouse_constraints_warehouse 
    ON warehouse_type_constraints(warehouse_code);

CREATE INDEX IF NOT EXISTS idx_warehouse_constraints_direction 
    ON warehouse_type_constraints(direction);

-- 添加注释
COMMENT ON TABLE warehouse_type_constraints IS '仓库与出入库类型的约束关系表';
COMMENT ON COLUMN warehouse_type_constraints.warehouse_code IS '仓库代码 (对应 settings 表中 type=warehouse 的 code)';
COMMENT ON COLUMN warehouse_type_constraints.direction IS '方向: inbound(入库) 或 outbound(出库)';
COMMENT ON COLUMN warehouse_type_constraints.movement_type_code IS '出入库类型代码 (对应 settings 表中 type=inbound_type 或 outbound_type 的 code)';

-- 启用 RLS (Row Level Security)
ALTER TABLE warehouse_type_constraints ENABLE ROW LEVEL SECURITY;

-- 创建策略: 允许认证用户读取
CREATE POLICY "Allow authenticated users to read warehouse constraints"
    ON warehouse_type_constraints
    FOR SELECT
    TO authenticated
    USING (true);

-- 创建策略: 允许认证用户插入
CREATE POLICY "Allow authenticated users to insert warehouse constraints"
    ON warehouse_type_constraints
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- 创建策略: 允许认证用户更新
CREATE POLICY "Allow authenticated users to update warehouse constraints"
    ON warehouse_type_constraints
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 创建策略: 允许认证用户删除
CREATE POLICY "Allow authenticated users to delete warehouse constraints"
    ON warehouse_type_constraints
    FOR DELETE
    TO authenticated
    USING (true);
