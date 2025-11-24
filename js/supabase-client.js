import { supabase } from './config.js'
export { supabase }

// 获取 SKU 列表 (使用视图获取关联名称)
export async function fetchSKUs(page = 1, pageSize = 20, search = '') {
  let query = supabase
    .from('v_skus')  // 使用视图,包含 shop_name, status_name
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (search) {
    query = query.or(`external_barcode.ilike.%${search}%,product_info.ilike.%${search}%`)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { data, count }
}

// 创建 SKU
export async function createSKU(skuData) {
  const { data, error } = await supabase
    .from('skus')
    .insert([skuData])
    .select()

  if (error) throw error
  return data[0]
}

// 根据条码获取 SKU (使用视图)
export async function fetchSKUByBarcode(barcode) {
  const { data, error } = await supabase
    .from('v_skus')  // 使用视图,包含关联名称
    .select('id, external_barcode, purchase_price_rmb, selling_price_thb, pic, product_info, shop_code, status_code, url, shop_name, status_name')
    .eq('external_barcode', barcode)
    .limit(1)
  if (error) throw error
  return data && data[0] ? data[0] : null
}

// 根据 ID 获取 SKU (使用视图)
export async function fetchSKUById(id) {
  const { data, error } = await supabase
    .from('v_skus')  // 使用视图,包含关联名称
    .select('*')
    .eq('id', id)
    .limit(1)
  if (error) throw error
  return data && data[0] ? data[0] : null
}

export async function fetchStockTotalBySKU(id) {
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('current_quantity')
      .eq('sku_id', id)
    if (error) throw error
    const list = Array.isArray(data) ? data : []
    return list.reduce((sum, r) => sum + (r.current_quantity || 0), 0)
  } catch (_) {
    return null
  }
}

// 获取指定仓库的库存（优先从视图读取，失败时回退按流水汇总）
export async function fetchStockBySKUWarehouse(id, warehouseCode) {
  if (!id || !warehouseCode) return null
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('current_quantity')
      .eq('sku_id', id)
      .eq('warehouse_code', warehouseCode)
      .limit(1)
    if (!error && data && data[0]) {
      const q = data[0].current_quantity
      return (typeof q === 'number') ? q : (q == null ? null : Number(q))
    }
    return null
  } catch (_) {
    return null
  }
}

// 批量获取 SKU 库存总量
export async function fetchStockTotalBySKUs(ids) {
  if (!ids || ids.length === 0) return {}
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('sku_id, current_quantity')
      .in('sku_id', ids)

    if (error) throw error

    const result = {}
    // 初始化所有 ID 为 0
    ids.forEach(id => result[id] = 0)

    if (data) {
      data.forEach(row => {
        if (result[row.sku_id] !== undefined) {
          result[row.sku_id] += (row.current_quantity || 0)
        }
      })
    }
    return result
  } catch (error) {
    console.error('fetchStockTotalBySKUs error:', error)
    return {}
  }
}

// 批量获取指定仓库的 SKU 库存
export async function fetchStockBySKUsWarehouse(ids, warehouseCode) {
  if (!ids || ids.length === 0 || !warehouseCode) return {}
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('sku_id, current_quantity')
      .in('sku_id', ids)
      .eq('warehouse_code', warehouseCode)

    if (error) throw error

    const result = {}
    // 初始化所有 ID 为 0
    ids.forEach(id => result[id] = 0)

    if (data) {
      data.forEach(row => {
        result[row.sku_id] = row.current_quantity || 0
      })
    }
    return result
  } catch (error) {
    console.error('fetchStockBySKUsWarehouse error:', error)
    return {}
  }
}
const { data: inboundTypes } = await supabase
  .from('settings')
  .select('code')
  .eq('type', 'InboundType')
const { data: outboundTypes } = await supabase
  .from('settings')
  .select('code')
  .eq('type', 'OutboundType')
const inboundSet = new Set((inboundTypes || []).map(x => x.code))
const outboundSet = new Set((outboundTypes || []).map(x => x.code))

const { data, error } = await supabase
  .from('stock_movements')
  .select('quantity, movement_type_code')
  .eq('sku_id', id)
  .eq('warehouse_code', warehouseCode)
if (error) throw error
const list = Array.isArray(data) ? data : []
let total = 0
if (inboundSet.size === 0 && outboundSet.size === 0) {
  total = list.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
} else {
  for (const r of list) {
    const qty = Number(r.quantity) || 0
    if (inboundSet.has(r.movement_type_code)) total += qty
    else if (outboundSet.has(r.movement_type_code)) total -= qty
  }
}
return total
} catch (_) {
  return null
}
}

export async function fetchWarehousesForSKU(id) {
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('warehouse_code, current_quantity')
      .eq('sku_id', id)
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (_) {
    // 回退：从流水聚合出每个仓库的当前库存
    try {
      const { data: inboundTypes } = await supabase
        .from('settings')
        .select('code')
        .eq('type', 'InboundType')
      const { data: outboundTypes } = await supabase
        .from('settings')
        .select('code')
        .eq('type', 'OutboundType')
      const inboundSet = new Set((inboundTypes || []).map(x => x.code))
      const outboundSet = new Set((outboundTypes || []).map(x => x.code))

      const { data, error } = await supabase
        .from('stock_movements')
        .select('warehouse_code, quantity, movement_type_code')
        .eq('sku_id', id)
      if (error) throw error
      const list = Array.isArray(data) ? data : []
      const bucket = {}
      if (inboundSet.size === 0 && outboundSet.size === 0) {
        for (const r of list) {
          const code = r.warehouse_code || ''
          const qty = Number(r.quantity) || 0
          bucket[code] = (bucket[code] || 0) + qty
        }
      } else {
        for (const r of list) {
          const code = r.warehouse_code || ''
          const qty = Number(r.quantity) || 0
          if (inboundSet.has(r.movement_type_code)) bucket[code] = (bucket[code] || 0) + qty
          else if (outboundSet.has(r.movement_type_code)) bucket[code] = (bucket[code] || 0) - qty
        }
      }
      return Object.entries(bucket).map(([warehouse_code, current_quantity]) => ({ warehouse_code, current_quantity }))
    } catch (__) {
      return []
    }
  }
}

export async function fetchWarehouseStockMap(warehouseCode) {
  if (!warehouseCode) return {};
  try {
    const { data, error } = await supabase
      .from('v_current_stock')
      .select('sku_id, current_quantity')
      .eq('warehouse_code', warehouseCode);
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    const map = {};
    for (const r of list) {
      map[r.sku_id] = (typeof r.current_quantity === 'number') ? r.current_quantity : Number(r.current_quantity) || 0;
    }
    return map;
  } catch (_) { }

  try {
    const { data: inboundTypes } = await supabase
      .from('settings')
      .select('code')
      .eq('type', 'InboundType');
    const { data: outboundTypes } = await supabase
      .from('settings')
      .select('code')
      .eq('type', 'OutboundType');
    const inboundSet = new Set((inboundTypes || []).map(x => x.code));
    const outboundSet = new Set((outboundTypes || []).map(x => x.code));
    const { data, error } = await supabase
      .from('stock_movements')
      .select('sku_id, quantity, movement_type_code')
      .eq('warehouse_code', warehouseCode);
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    const bucket = {};
    if (inboundSet.size === 0 && outboundSet.size === 0) {
      for (const r of list) {
        const q = Number(r.quantity) || 0;
        bucket[r.sku_id] = (bucket[r.sku_id] || 0) + q;
      }
    } else {
      for (const r of list) {
        const q = Number(r.quantity) || 0;
        if (inboundSet.has(r.movement_type_code)) bucket[r.sku_id] = (bucket[r.sku_id] || 0) + q;
        else if (outboundSet.has(r.movement_type_code)) bucket[r.sku_id] = (bucket[r.sku_id] || 0) - q;
      }
    }
    return bucket;
  } catch (__) {
    return {};
  }
}

export async function fetchAllStock() {
  // Join with skus table to get price information
  const { data, error } = await supabase
    .from('v_current_stock')
    .select(`
      sku_id,
      warehouse_code,
      current_quantity,
      skus:sku_id (
        purchase_price_rmb,
        selling_price_thb
      )
    `);

  if (error) throw error;

  // Flatten the structure for easier access
  const flattenedData = (data || []).map(item => ({
    sku_id: item.sku_id,
    warehouse_code: item.warehouse_code,
    quantity: item.current_quantity,
    purchase_price_rmb: item.skus?.purchase_price_rmb || null,
    selling_price_thb: item.skus?.selling_price_thb || null
  }));

  return flattenedData;
}

export async function fetchSafetyStock() {
  const { data, error } = await supabase
    .from('safety_stock_30d')
    .select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchSales30dBySKU(id) {
  try {
    const { data, error } = await supabase
      .from('sales_30d')
      .select('total_sales_30d')
      .eq('sku_id', id)
      .limit(1)
    if (error) throw error
    return (data && data[0] && (data[0].total_sales_30d || 0)) || 0
  } catch (_) {
    return null
  }
}

// 创建库存变动记录
export async function createStockMovement(payload) {
  const { data, error } = await supabase
    .from('stock_movements')
    .insert(payload)
    .select()

  if (error) throw error
  return data[0]
}

// 获取库存变动记录 (用于财务计算)
export async function fetchStockMovements(filters = {}) {
  let query = supabase
    .from('stock_movements')
    .select(`
      *
    `)
    .order('created_at', { ascending: false })

  if (filters.startDate) {
    query = query.gte('created_at', filters.startDate)
  }
  if (filters.endDate) {
    // 包含结束日期当天
    query = query.lte('created_at', filters.endDate + 'T23:59:59')
  }
  if (filters.type) {
    query = query.eq('movement_type_code', filters.type)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateSKU(id, patch) {
  const { data, error } = await supabase
    .from('skus')
    .update(patch)
    .eq('id', id)
    .select()
  if (error) throw error
  return data && data[0] ? data[0] : null
}

export async function deleteSKU(id) {
  const { data, error } = await supabase
    .from('skus')
    .delete()
    .eq('id', id)
    .select()
  if (error) throw error
  return data
}

// 上传图片
export async function uploadImage(file, filename) {
  const processed = await compressIfNeeded(file, 500 * 1024)
  const ext = inferExt(processed) || 'jpg'
  const key = generateStorageKey(ext)
  const { data, error } = await supabase.storage
    .from('products')
    .upload(key, processed, { upsert: true })
  if (error) throw error
  return supabase.storage
    .from('products')
    .getPublicUrl(key).data.publicUrl
}

let __seq = 0
function pad(n, len = 4) { return String(n).padStart(len, '0') }
function fmtDate(dt) {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  const ss = String(dt.getSeconds()).padStart(2, '0')
  return { y, m, d, hh, mm, ss }
}

export function generateStorageKey(ext = 'jpg') {
  const now = new Date()
  const { y, m, d, hh, mm, ss } = fmtDate(now)
  __seq += 1
  return `IMG-${y}${m}${d}-${hh}${mm}${ss}-${pad(__seq)}.${ext}`
}

function inferExt(file) {
  if (!file) return null
  const t = file.type || ''
  if (t.includes('jpeg')) return 'jpg'
  if (t.includes('png')) return 'png'
  if (t.includes('webp')) return 'webp'
  const name = file.name || ''
  const m = name.match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : null
}

function toBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality))
}

export async function compressIfNeeded(file, maxBytes = 500 * 1024) {
  if (!file || file.size <= maxBytes) return file
  const url = URL.createObjectURL(file)
  const img = document.createElement('img')
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
  })
  img.src = url
  await loaded
  URL.revokeObjectURL(url)

  let w = img.naturalWidth
  let h = img.naturalHeight
  const scale = Math.min(1, Math.sqrt(maxBytes / file.size))
  w = Math.max(1, Math.floor(w * scale))
  h = Math.max(1, Math.floor(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)

  let quality = 0.9
  let blob = await toBlob(canvas, 'image/jpeg', quality)
  while (blob && blob.size > maxBytes && quality > 0.5) {
    quality -= 0.1
    blob = await toBlob(canvas, 'image/jpeg', quality)
  }
  const out = blob || await toBlob(canvas, 'image/jpeg', 0.85)
  return new File([out], 'compressed.jpg', { type: 'image/jpeg' })
}

export async function createSignedUrlFromPublicUrl(publicUrl, expires = 3600) {
  try {
    const marker = '/storage/v1/object/public/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    const path = publicUrl.substring(idx + marker.length);
    const firstSlash = path.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = path.substring(0, firstSlash);
    const objectPath = path.substring(firstSlash + 1);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, expires);
    if (error) return null;
    return data.signedUrl;
  } catch (_) {
    return null;
  }
}

export async function createTransformedUrlFromPublicUrl(publicUrl, width = 100, height = 100) {
  try {
    const marker = '/storage/v1/object/public/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    const path = publicUrl.substring(idx + marker.length);
    const firstSlash = path.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = path.substring(0, firstSlash);
    const objectPath = path.substring(firstSlash + 1);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, 3600, { transform: { width, height, resize: 'contain' } });
    if (error) return null;
    return data.signedUrl;
  } catch (_) {
    return null;
  }
}

// 获取配置项
export async function fetchSettings(type) {
  const typeMap = {
    shop: 'Shop',
    warehouse: 'Warehouse',
    inbound_type: 'InboundType',
    outbound_type: 'OutboundType',
    expense_type: 'ExpenseType',
    status: 'Status',
    sales_channel: 'SalesChannel'
  }

  const normalized = typeMap[type] || type.replace(/(^|_)(\w)/g, (_, __, ch) => ch.toUpperCase()).replace(/_/g, '')

  const { data, error } = await supabase
    .from('settings')
    .select('code, name')
    .eq('type', normalized)
    .order('name')

  if (error) throw error

  return data
}

// 创建配置项
export async function createSetting(code, name, type) {
  const { data, error } = await supabase
    .from('settings')
    .insert([{ code, name, type }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ==========================================
// Expenses API
// ==========================================

export async function fetchExpenses(filters = {}) {
  let query = supabase
    .from('expenses')
    .select('*')
    .order('timestamp', { ascending: false });

  if (filters.startDate) {
    query = query.gte('timestamp', `${filters.startDate}T00:00:00`);
  }
  if (filters.endDate) {
    query = query.lte('timestamp', `${filters.endDate}T23:59:59`);
  }
  if (filters.type) {
    query = query.eq('expense_type_code', filters.type);
  }
  if (filters.minAmount) {
    query = query.gte('amount', filters.minAmount);
  }
  if (filters.maxAmount) {
    query = query.lte('amount', filters.maxAmount);
  }
  if (filters.currency) {
    query = query.eq('currency', filters.currency);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createExpense(expenseData) {
  const { data, error } = await supabase
    .from('expenses')
    .insert([expenseData])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateExpense(id, updates) {
  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteExpense(id) {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}
