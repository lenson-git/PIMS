/**
 * Dashboard Module
 * 仪表盘数据计算和渲染模块
 */

import {
    fetchSettings,
    fetchAllStock,
    fetchStockMovements,
    fetchSKUs,
    fetchExpenses,
    fetchSafetyStock
} from '../supabase-client.js';
import { getSettingName, formatCurrency } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 状态管理
// ==========================================

let currentExchangeRate = 4.8; // 默认汇率 (1 CNY ≈ 4.8 THB)

// ==========================================
// 汇率获取
// ==========================================

/**
 * 获取实时汇率 (CNY → THB)
 */
export async function fetchExchangeRate() {
    try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/CNY');
        const data = await response.json();
        if (data && data.rates && data.rates.THB) {
            currentExchangeRate = data.rates.THB;
            logger.debug('汇率更新:', currentExchangeRate);
            const rateEl = document.getElementById('dashboard-rate');
            if (rateEl) rateEl.textContent = `汇率: 1 CNY ≈ ${currentExchangeRate.toFixed(2)} THB`;
        }
    } catch (error) {
        logger.error('获取汇率失败:', error);
    }
}

// ==========================================
// 数据获取
// ==========================================

/**
 * 获取仪表盘所需的所有数据
 */
async function fetchDashboardData(startDate, endDate) {
    const [shops, salesChannels, warehouses, movements, skusResult, expenses, allStock, safetyStock] = await Promise.all([
        fetchSettings('shop'),
        fetchSettings('sales_channel'),
        fetchSettings('warehouse'),
        fetchStockMovements(startDate, endDate),
        fetchSKUs(1, 10000),  // 获取所有 SKU
        fetchExpenses({ startDate, endDate }),  // 使用 filters 对象
        fetchAllStock(),
        fetchSafetyStock()
    ]);

    return {
        shops,
        salesChannels,
        warehouses,
        movements,
        allSkus: skusResult.data || [],  // 提取 data 字段
        expenses,
        allStock,
        safetyStock
    };
}

// ==========================================
// 指标计算
// ==========================================

/**
 * 初始化店铺和仓库指标
 */
function initializeMetrics(shops, salesChannels, warehouses) {
    const shopMetrics = {};
    const warehouseMetrics = {};

    // 初始化店铺指标
    if (shops.length > 0) {
        shops.forEach(shop => {
            shopMetrics[shop.code] = {
                name: shop.name,
                salesTHB: 0,
                profitTHB: 0,
                cogsRMB: 0,
                lowStockCount: 0,
                channels: {}
            };
            // 初始化所有配置的渠道为 0
            if (salesChannels.length > 0) {
                salesChannels.forEach(ch => {
                    shopMetrics[shop.code].channels[ch.name] = 0;
                });
            }
        });
    }

    // 初始化仓库指标
    if (warehouses.length > 0) {
        warehouses.forEach(wh => {
            warehouseMetrics[wh.code] = { name: wh.name, valueRMB: 0, qty: 0 };
        });
    } else {
        // 如果配置未加载，使用默认仓库
        warehouseMetrics['MAIN'] = { name: '主仓库', valueRMB: 0, qty: 0 };
        warehouseMetrics['AFTERSALES'] = { name: '售后仓库', valueRMB: 0, qty: 0 };
    }

    return { shopMetrics, warehouseMetrics };
}

/**
 * 计算销售额和成本
 */
function calculateSalesMetrics(movements, allSkus, shopMetrics) {
    let salesRevenueTHB = 0;
    let cogsRMB = 0;

    movements.forEach(m => {
        const qty = m.quantity;
        const sku = allSkus.find(s => s.id === m.sku_id);
        const costRMB = sku ? (sku.purchase_price_rmb || 0) : 0;
        const shopCode = sku ? sku.shop_code : null;

        // 销售出库
        if (m.movement_type_code === '销售出库') {
            const revenue = qty * (m.unit_price_thb || 0);
            const cogs = qty * costRMB;

            salesRevenueTHB += revenue;
            cogsRMB += cogs;

            if (shopCode && shopMetrics[shopCode]) {
                shopMetrics[shopCode].salesTHB += revenue;
                shopMetrics[shopCode].cogsRMB += cogs;

                // 渠道细分
                const channel = m.sales_channel || 'Other';
                if (shopMetrics[shopCode].channels[channel] !== undefined) {
                    shopMetrics[shopCode].channels[channel] += revenue;
                } else {
                    shopMetrics[shopCode].channels[channel] = (shopMetrics[shopCode].channels[channel] || 0) + revenue;
                }
            }
        }
        // 售后入库 (退货)
        else if (m.movement_type_code === '售后入库') {
            const revenue = qty * (m.unit_price_thb || 0);
            const cogs = qty * costRMB;

            salesRevenueTHB -= revenue;
            cogsRMB -= cogs;

            if (shopCode && shopMetrics[shopCode]) {
                shopMetrics[shopCode].salesTHB -= revenue;
                shopMetrics[shopCode].cogsRMB -= cogs;

                // 渠道细分 (扣减)
                const channel = m.sales_channel || 'Other';
                if (shopMetrics[shopCode].channels[channel] !== undefined) {
                    shopMetrics[shopCode].channels[channel] -= revenue;
                } else {
                    shopMetrics[shopCode].channels[channel] = (shopMetrics[shopCode].channels[channel] || 0) - revenue;
                }
            }
        }
        // 换货出库 (计入 COGS)
        else if (m.movement_type_code === '换货出库') {
            const cogs = qty * costRMB;
            cogsRMB += cogs;
            if (shopCode && shopMetrics[shopCode]) shopMetrics[shopCode].cogsRMB += cogs;
        }
        // 退给供应商 (扣减 COGS)
        else if (m.movement_type_code === '退给供应商') {
            const cogs = qty * costRMB;
            cogsRMB -= cogs;
            if (shopCode && shopMetrics[shopCode]) shopMetrics[shopCode].cogsRMB -= cogs;
        }
    });

    return { salesRevenueTHB, cogsRMB };
}

/**
 * 计算库存价值和数量
 */
function calculateInventoryMetrics(allStock, warehouseMetrics, rateThbToCny) {
    let inventoryValueRMB = 0;
    let totalInventoryQty = 0;

    allStock.forEach(stock => {
        let cost = stock.purchase_price_rmb || 0;
        if (!cost && stock.selling_price_thb) {
            cost = stock.selling_price_thb * rateThbToCny;
        }
        const qty = stock.quantity || 0;
        const val = cost * qty;

        inventoryValueRMB += val;
        totalInventoryQty += qty;

        // 分仓库统计
        const whCode = stock.warehouse_code;
        if (!warehouseMetrics[whCode]) {
            // 尝试从全局缓存获取名称，否则使用代码
            let whName = whCode;
            if (window._settingsCache && window._settingsCache.warehouse && window._settingsCache.warehouse[whCode]) {
                whName = window._settingsCache.warehouse[whCode];
            }

            warehouseMetrics[whCode] = { name: whName, valueRMB: 0, qty: 0 };
        }

        warehouseMetrics[whCode].valueRMB += val;
        warehouseMetrics[whCode].qty += qty;
    });

    return { inventoryValueRMB, totalInventoryQty };
}

/**
 * 计算低库存预警
 */
function calculateLowStockWarnings(allSkus, allStock, safetyStock, shopMetrics) {
    // 计算每个 SKU 的总库存数量
    const skuStockMap = {};
    allStock.forEach(stock => {
        const skuId = stock.sku_id;
        const qty = stock.quantity || 0;
        skuStockMap[skuId] = (skuStockMap[skuId] || 0) + qty;
    });

    // 创建安全库存映射表
    const safetyStockMap = {};
    safetyStock.forEach(ss => {
        safetyStockMap[ss.sku_id] = ss.suggested_safety_stock || 0;
    });

    // 检查每个 SKU
    allSkus.forEach(sku => {
        const totalQty = skuStockMap[sku.id] || 0;
        const threshold = safetyStockMap[sku.id] || 0;

        // 统计 SKU 数量
        if (sku.shop_code && shopMetrics[sku.shop_code]) {
            if (!shopMetrics[sku.shop_code].skuCount) shopMetrics[sku.shop_code].skuCount = 0;
            shopMetrics[sku.shop_code].skuCount += 1;
        }

        // 只有当库存数量低于安全库存阈值时才计入低库存
        if (threshold > 0 && totalQty < threshold) {
            if (sku.shop_code && shopMetrics[sku.shop_code]) {
                shopMetrics[sku.shop_code].lowStockCount += 1;
            }
        }
    });
}

/**
 * 计算仪表盘财务数据
 */
async function calculateDashboardMetrics() {
    // 1. 获取汇率
    await fetchExchangeRate();
    const rateCnyToThb = currentExchangeRate;
    const rateThbToCny = 1 / rateCnyToThb;

    // 2. 获取本月时间范围
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // 3. 并行获取数据
    const data = await fetchDashboardData(startOfMonth, endOfMonth);

    // 4. 初始化指标
    const { shopMetrics, warehouseMetrics } = initializeMetrics(
        data.shops,
        data.salesChannels,
        data.warehouses
    );

    // 5. 计算销售指标
    const { salesRevenueTHB, cogsRMB } = calculateSalesMetrics(
        data.movements,
        data.allSkus,
        shopMetrics
    );

    // 6. 计算费用
    let totalExpensesTHB = 0;
    data.expenses.forEach(e => {
        if (e.currency === 'THB') {
            totalExpensesTHB += e.amount;
        } else {
            totalExpensesTHB += (e.amount * rateCnyToThb);
        }
    });

    // 7. 计算纯利润 (THB)
    const cogsTHB = cogsRMB * rateCnyToThb;
    const netProfitTHB = salesRevenueTHB - cogsTHB - totalExpensesTHB;

    // 8. 计算各店铺毛利 (THB)
    Object.values(shopMetrics).forEach(m => {
        m.profitTHB = m.salesTHB - (m.cogsRMB * rateCnyToThb);
    });

    // 9. 计算库存指标
    const { inventoryValueRMB, totalInventoryQty } = calculateInventoryMetrics(
        data.allStock,
        warehouseMetrics,
        rateThbToCny
    );

    // 10. 计算低库存预警
    calculateLowStockWarnings(data.allSkus, data.allStock, data.safetyStock, shopMetrics);

    return {
        salesRevenueTHB,
        netProfitTHB,
        inventoryValueRMB,
        totalInventoryQty,
        rateCnyToThb,
        shopMetrics,
        warehouseMetrics,
        skuCount: data.allSkus ? data.allSkus.length : 0
    };
}

// ==========================================
// UI 渲染
// ==========================================

/**
 * 格式化数字
 */
function formatNumber(num) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * 更新指标文本
 */
function updateMetric(elementId, value, prefix = '', suffix = '', isInteger = false) {
    const el = document.getElementById(elementId);
    if (el) {
        const formatted = isInteger ? Math.round(value) : formatNumber(value);
        el.innerHTML = `${prefix} ${formatted} <span class="unit">${suffix}</span>`;

        // Color coding for profit/loss
        if (elementId === 'dashboard-profit') {
            el.className = value >= 0 ? 'stat-total text-success' : 'stat-total text-error';
        }
    }
}

/**
 * 渲染店铺指标
 */
function renderShopMetrics(containerId, shopMetrics, metricKey, prefix = '', suffix = '', isInteger = false, showChannels = false) {
    const body = document.getElementById(containerId);
    if (!body) return;
    body.innerHTML = '';

    const shops = Object.values(shopMetrics);
    if (shops.length > 0) {
        shops.forEach(shop => {
            // 针对 stat-body (销售额) 的特殊布局 - 只在启用渠道显示时使用
            if (showChannels) {
                const col = document.createElement('div');
                col.className = 'shop-column';

                // 构建渠道细分 HTML
                let channelsHtml = '';
                if (shop.channels && Object.keys(shop.channels).length > 0) {
                    Object.entries(shop.channels).forEach(([channel, amount]) => {
                        channelsHtml += `
    <div class="metric-row sub-row" style="font-size: 0.9em; opacity: 0.8;">
                                <span class="label">${channel === 'Other' ? '未分类' : channel}</span>
                                <span class="value">${prefix} ${formatNumber(amount)}${suffix}</span>
                            </div>
    `;
                    });
                }

                col.innerHTML = `
    <div class="shop-header"> ${shop.name}</div>
        <div class="metric-row">
            <span class="label">Total</span>
            <span class="value">${prefix} ${formatNumber(shop[metricKey] || 0)}${suffix}</span>
        </div>
                    ${channelsHtml}
`;
                body.appendChild(col);

                // Add divider if not last
                if (shop !== shops[shops.length - 1]) {
                    const div = document.createElement('div');
                    div.className = 'vertical-divider';
                    body.appendChild(div);
                }
            } else {
                // 简单行布局 (Profit, Low Stock, etc.)
                const row = document.createElement('div');
                row.className = 'metric-row';
                const val = shop[metricKey] || 0;
                const formatted = isInteger ? Math.round(val) : formatNumber(val);

                row.innerHTML = `
    <span class="label"> ${shop.name}</span>
        <span class="value">${prefix} ${formatted}${suffix}</span>
`;
                body.appendChild(row);
            }
        });
    } else {
        body.innerHTML = '<div class="text-secondary text-center">暂无店铺数据</div>';
    }
}

/**
 * 渲染仓库指标
 */
function renderWarehouseMetrics(containerId, warehouseMetrics, metricKey, prefix = '', suffix = '', isInteger = false) {
    const body = document.getElementById(containerId);
    if (!body) return;

    body.innerHTML = '';

    const group = document.createElement('div');
    group.className = 'metric-group';

    Object.values(warehouseMetrics).forEach(wh => {
        const row = document.createElement('div');
        row.className = 'metric-row highlight';
        const val = wh[metricKey] || 0;
        const formatted = isInteger ? Math.round(val) : formatNumber(val);

        row.innerHTML = `
    <span class="label"> ${wh.name}</span>
        <span class="value">${prefix} ${formatted}${suffix}</span>
`;
        group.appendChild(row);
    });

    body.appendChild(group);
}

/**
 * 加载仪表盘数据
 */
export async function loadDashboard() {
    const dashboardView = document.getElementById('dashboard-view');
    if (!dashboardView) return;

    try {
        // 显示加载状态
        document.getElementById('dashboard-revenue').textContent = 'Loading...';

        const metrics = await calculateDashboardMetrics();

        // 更新 UI
        // 1. 本月销售额 (THB) - 显示分渠道数据
        updateMetric('dashboard-revenue', metrics.salesRevenueTHB, '฿');
        renderShopMetrics('dashboard-revenue-body', metrics.shopMetrics, 'salesTHB', '฿', '', false, true);

        // 2. 本月纯利润 (THB) - 在底部添加汇率
        updateMetric('dashboard-profit', metrics.netProfitTHB, '฿');
        renderShopMetrics('dashboard-profit-body', metrics.shopMetrics, 'profitTHB', '฿');
        // 在利润卡片底部添加汇率
        const profitBody = document.getElementById('dashboard-profit-body');
        if (profitBody) {
            const div = document.createElement('div');
            div.className = 'horizontal-divider';
            profitBody.appendChild(div);
            const rateDiv = document.createElement('div');
            rateDiv.className = 'metric-group';
            rateDiv.innerHTML = '<div class="metric-row"><span class="label" style="color: #666; font-size: 0.9em;">汇率: 1 CNY ≈ ' + metrics.rateCnyToThb.toFixed(2) + ' THB</span></div>';
            profitBody.appendChild(rateDiv);
        }

        // 3. 库存总价值 (RMB) - 分仓库
        updateMetric('dashboard-inventory-value', metrics.inventoryValueRMB, '¥');
        renderWarehouseMetrics('dashboard-inventory-value-body', metrics.warehouseMetrics, 'valueRMB', '¥');

        // 4. 库存数量 - 分仓库 (整数)
        updateMetric('dashboard-inventory-qty', metrics.totalInventoryQty, '', '件', true);
        renderWarehouseMetrics('dashboard-inventory-qty-body', metrics.warehouseMetrics, 'qty', '', '件', true);

        // 5. 低库存预警 - 分店铺 (整数)
        let totalLowStock = 0;
        Object.values(metrics.shopMetrics).forEach(s => totalLowStock += s.lowStockCount);
        updateMetric('dashboard-low-stock', totalLowStock, '', '个', true);
        renderShopMetrics('dashboard-low-stock-body', metrics.shopMetrics, 'lowStockCount', '', '个', true);

        // 6. SKU 数量 (整数)
        updateMetric('dashboard-sku-count', metrics.skuCount, '', '个', true);
        renderShopMetrics('dashboard-sku-count-body', metrics.shopMetrics, 'skuCount', '', '个', true);

        // 更新汇率显示
        const rateEl = document.getElementById('dashboard-rate');
        if (rateEl) {
            rateEl.innerHTML = `
汇率: 1 CNY ≈ ${metrics.rateCnyToThb.toFixed(2)} THB
            `;
        }

    } catch (error) {
        logger.error('加载仪表盘数据失败:', error);
        const rateEl = document.getElementById('dashboard-rate');
        if (rateEl) rateEl.textContent = 'Error: ' + error.message;
    }
}

// 暴露到全局
window.loadDashboard = loadDashboard;
