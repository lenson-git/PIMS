import { supabase } from './config.js'

// 获取 SKU 列表
export async function fetchSKUs(page = 1, pageSize = 20, search = '') {
  let query = supabase
    .from('skus')
    .select('*')
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  
  if (search) {
    query = query.or(`external_barcode.ilike.%${search}%,product_info.ilike.%${search}%`)
  }
  
  const { data, error } = await query
  if (error) throw error
  return data
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

// 上传图片
export async function uploadImage(file, filename) {
  const { data, error } = await supabase.storage
    .from('products')
    .upload(filename, file)
  
  if (error) throw error
  
  return supabase.storage
    .from('products')
    .getPublicUrl(filename).data.publicUrl
}

// 获取配置项
export async function fetchSettings(type) {
  const { data, error } = await supabase
    .from('settings')
    .select('code, name')
    .ilike('type', type)
    .order('name')
  
  if (error) throw error
  
  // 更新缓存
  if (!window._settingsCache[type]) {
    window._settingsCache[type] = {}
  }
  data.forEach(item => {
    window._settingsCache[type][item.code || item.name] = item.name
  })
  
  return data
}
