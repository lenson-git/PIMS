// Supabase 配置
export const SUPABASE_URL = 'https://mgcfsinockiucyvptluv.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY2ZzaW5vY2tpdWN5dnB0bHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NDk0NDMsImV4cCI6MjA3OTAyNTQ0M30.gWn0UWWmsc2xhK2zo4tx0yK1eATbtP2-dUC8PQZ2Hm4'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export const CONFIG = {
  STORAGE_BUCKET: 'products',
  ALLOWED_EMAIL: 'lenson.sz@gmail.com'
}

// 中文标签仅用于页面显示；内部逻辑一律使用英文字段名。
export const FIELD_LABELS = {
  skus: {
    id: 'ID',
    created_at: '创建时间',
    shop: '店铺',
    product_info: '产品信息',
    pic: '图片',
    qr: '二维码',
    purchase_price_rmb: '采购价(RMB)',
    selling_price_thb: '销售价(THB)',
    external_barcode: '产品条码',
    status: '状态',
    safety_quantity: '安全库存',
    url: '链接'
  },
  expenses: {
    id: 'ID',
    timestamp: '日期',
    expense_type: '费用类型',
    amount: '金额',
    currency: '币种',
    description: '备注',
    picture_id: '图片ID'
  },
  stock_movements: {
    id: 'ID',
    timestamp: '时间',
    sku_id: 'SKU',
    warehouse_name: '仓库',
    movement_type: '类型',
    quantity: '数量',
    unit_price_rmb: '单价(RMB)',
    unit_price_thb: '单价(THB)',
    sales_channel: '渠道',
    tracking_id: '追踪号'
  },
  settings: {
    id: 'ID',
    created_at: '创建时间',
    type: '类型',
    name: '名称',
    code: '编码',
    group: '分组',
    status: '状态'
  },
  exchange_rates: {
    id: 'ID',
    from_currency: '原币种',
    to_currency: '目标币种',
    rate: '汇率',
    updated_at: '更新时间'
  },
  current_stock: {
    sku_id: 'SKU',
    warehouse_name: '仓库',
    current_quantity: '当前库存'
  },
  sales_30d: {
    sku_id: 'SKU',
    total_sales_30d: '30日销量'
  }
}

// 仓库与出入库类型约束（前端校验与选项过滤使用）
export const WAREHOUSE_RULES = {
  '主仓库': {
    inbound: ['采购入库'],
    outbound: ['销售出库', '换货出库']
  },
  '售后仓库': {
    inbound: ['售后入库'],
    outbound: ['退给供应商']
  }
}

// 出入库类型对应的价格来源与币种（不做汇率换算）
export const PRICE_RULES = {
  '采购入库': { source: 'purchase_price_rmb', currency: 'RMB' },
  '销售出库': { source: 'selling_price_thb', currency: 'THB' },
  '换货出库': { source: 'selling_price_thb', currency: 'THB' },
  '售后入库': { source: 'selling_price_thb', currency: 'THB' },
  '退给供应商': { source: 'purchase_price_rmb', currency: 'RMB' }
}
