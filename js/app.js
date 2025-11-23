import {
    fetchSKUs, createSKU, uploadImage, fetchSettings, createSignedUrlFromPublicUrl, fetchSKUByBarcode, createStockMovement, fetchStockMovements, fetchSKUById, fetchStockTotalBySKU, fetchSales30dBySKU, updateSKU, createTransformedUrlFromPublicUrl, deleteSKU, fetchWarehouseStockMap, fetchStockBySKUWarehouse, createSetting, fetchAllStock, fetchSafetyStock,
    fetchExpenses, createExpense, updateExpense, deleteExpense, supabase
} from './supabase-client.js';
import { WAREHOUSE_RULES, PRICE_RULES, FIELD_LABELS } from './config.js'
import { checkAuth, loginWithGoogle, initAuth, logout, enforceAuth } from './auth.js'
import { getSettingName, showError, showInfo, showSuccess, formatCurrency, formatDate, escapeHtml } from './utils.js'

// ==========================================
// Core Logic
// ==========================================

// 全局配置映射缓存
window._settingsCache = {
    shop: {},
    warehouse: {},
    inbound_type: {},
    outbound_type: {}
};

// ==========================================
// Dashboard Logic
// ==========================================

let currentExchangeRate = 4.8; // 默认汇率 (THB -> CNY: 1/4.8 approx, actually this is usually CNY->THB rate. Let's clarify: 1 CNY = ~4.8 THB)
// User wants Base on RMB. Revenue is THB. So we need THB -> RMB.
// If rate is 4.8 (1 CNY = 4.8 THB), then 1 THB = 1/4.8 CNY.

// 获取实时汇率 (CNY -> THB)
async function fetchExchangeRate() {
    try {
        // 使用 open.er-api.com，无需 key，更新频率不错
        const response = await fetch('https://open.er-api.com/v6/latest/CNY');
        const data = await response.json();
        if (data && data.rates && data.rates.THB) {
            currentExchangeRate = data.rates.THB;

            // 更新 UI 显示
            const rateEl = document.getElementById('dashboard-rate');
            if (rateEl) rateEl.textContent = `汇率: 1 CNY ≈ ${currentExchangeRate.toFixed(2)} THB`;
        }
    } catch (error) {
        console.error('获取汇率失败:', error);
        // 保持默认值或上次的值
    }
}

// ==========================================
// 仪表盘辅助函数
// ==========================================

// 获取仪表盘所需的所有数据
async function fetchDashboardData(startDate, endDate) {
    const [movements, expenses, allSkus, shops, allStock, salesChannels, warehouses, safetyStock] =
        await Promise.all([
            fetchStockMovements({ startDate, endDate }),
            fetchExpenses({ startDate, endDate }),
            fetchSKUs(1, 10000),
            fetchSettings('shop'),
            fetchAllStock(),
            fetchSettings('sales_channel').catch(() => []),
            fetchSettings('warehouse').catch(() => []),
            fetchSafetyStock().catch(() => [])
        ]);

    return {
        movements: movements || [],
        expenses: expenses || [],
        allSkus: allSkus || [],
        shops: shops || [],
        allStock: allStock || [],
        salesChannels: salesChannels || [],
        warehouses: warehouses || [],
        safetyStock: safetyStock || []
    };
}

// 初始化店铺和仓库指标
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
            let whName = wh.name;
            if (wh.code === 'MAIN' || wh.code === 'Main') whName = '主仓库';
            else if (wh.code === 'AFTERSALES' || wh.code === 'AfterSales') whName = '售后仓库';

            warehouseMetrics[wh.code] = { name: whName, valueRMB: 0, qty: 0 };
        });
    } else {
        // 如果配置未加载，使用默认仓库
        warehouseMetrics['MAIN'] = { name: '主仓库', valueRMB: 0, qty: 0 };
        warehouseMetrics['AFTERSALES'] = { name: '售后仓库', valueRMB: 0, qty: 0 };
    }

    return { shopMetrics, warehouseMetrics };
}

// 计算销售额和成本
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

// 计算库存价值和数量
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
            let whName = whCode;
            if (whCode === 'MAIN' || whCode === 'Main') whName = '主仓库';
            else if (whCode === 'AFTERSALES' || whCode === 'AfterSales') whName = '售后仓库';

            warehouseMetrics[whCode] = { name: whName, valueRMB: 0, qty: 0 };
        }

        warehouseMetrics[whCode].valueRMB += val;
        warehouseMetrics[whCode].qty += qty;
    });

    return { inventoryValueRMB, totalInventoryQty };
}

// 计算低库存预警
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

// 计算仪表盘财务数据
// 计算仪表盘财务数据
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
    // Re-calculate expenses in THB
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

// 加载仪表盘数据
async function loadDashboard() {
    const dashboardView = document.getElementById('dashboard-view');
    if (!dashboardView) return;

    try {
        // 显示加载状态
        document.getElementById('dashboard-revenue').textContent = 'Loading...';

        const metrics = await calculateDashboardMetrics();

        // 更新 UI
        // 1. 本月销售额 (THB) - 显示分渠道数据
        updateMetric('dashboard-revenue', metrics.salesRevenueTHB, '฿');
        renderShopMetrics('dashboard-revenue-body', metrics.shopMetrics, 'salesTHB', '฿', '', false, true); // 最后一个参数启用渠道显示

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
        console.error('加载仪表盘数据失败:', error);
        const rateEl = document.getElementById('dashboard-rate');
        if (rateEl) rateEl.textContent = 'Error: ' + error.message;
    }
}

// Helper: Update Metric Text
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

// Helper: Render Shop Metrics
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
                    <div class="shop-header">${shop.name}</div>
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
                    <span class="label">${shop.name}</span>
                    <span class="value">${prefix} ${formatted}${suffix}</span>
                `;
                body.appendChild(row);
            }
        });
    } else {
        body.innerHTML = '<div class="text-secondary text-center">暂无店铺数据</div>';
    }
}

// Helper: Render Warehouse Metrics
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
            <span class="label">${wh.name}</span>
            <span class="value">${prefix} ${formatted}${suffix}</span>
        `;
        group.appendChild(row);
    });

    body.appendChild(group);
}



function formatNumber(num) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 页面导航控制
function navigate(viewName) {

    // 关闭可能打开的扫描器（防止摄像头一直开着）
    if (typeof window.closeBarcodeScanner === 'function') {
        window.closeBarcodeScanner();
    }

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // 由于 onclick 是在 div 上，我们需要手动处理 active 类
    document.querySelectorAll('.nav-item').forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick && onclick.includes("'" + viewName + "'")) {
            item.classList.add('active');
        }
    });

    // 切换视图
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    const view = document.getElementById(viewName + '-view');
    if (view) {
        view.classList.add('active');
    } else {
        console.error('View not found:', viewName + '-view');
    }

    // 更新标题
    const titles = {
        'dashboard': '仪表盘',
        'sku': 'SKU管理',
        'inbound': '入库',
        'outbound': '出库',
        'stock': '库存管理',
        'settings': '系统设置',
        'expenses': '费用管理'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'PIMS';

    if (viewName === 'sku') {
        loadSKUs();
        setTimeout(() => document.getElementById('sku-main-input')?.focus(), 100);
    } else if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'inbound') {
        preloadInbound();
        setTimeout(() => document.getElementById('inbound-sku-input')?.focus(), 100);
    } else if (viewName === 'outbound') {
        renderOutboundList();
        setTimeout(() => document.getElementById('outbound-sku-input')?.focus(), 100);
    } else if (viewName === 'settings') {
        loadSystemSettings();
    } else if (viewName === 'stock') {
        // 立即聚焦输入框，不等待数据加载
        setTimeout(() => document.getElementById('stock-search-input')?.focus(), 100);
        // 异步加载数据
        loadStockList();
    } else if (viewName === 'expenses') {
        // 设置默认日期为今天
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('new-expense-date');
        const dateToInput = document.getElementById('date-to');

        if (dateInput && !dateInput.value) dateInput.value = today;
        if (dateToInput && !dateToInput.value) dateToInput.value = today;

        loadExpenses();
    }

    // 重新绑定扫描按钮（因为视图已更新）
    if (typeof window.bindScanButtons === 'function') {
        setTimeout(() => window.bindScanButtons(), 100);
    }
}



// 明确暴露到全局
window.navigate = navigate;

// 暴露给全局以便 HTML onclick 调用
window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        try {
            setTimeout(initFloatingLabels, 50);
        } catch (e) {
            console.error('Error initializing floating labels:', e);
        }
    } else {
        console.error('Modal not found:', modalId);
    }
}

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// 初始化浮动标签
function initFloatingLabels() {
    document.querySelectorAll('.floating-label-group select').forEach(select => {
        if (select.dataset.floatingInit) return;
        select.dataset.floatingInit = 'true';

        function updateLabel() {
            if (select.value && select.value !== '') {
                select.parentElement.classList.add('active');
            } else {
                select.parentElement.classList.remove('active');
            }
        }

        updateLabel();
        select.addEventListener('change', updateLabel);
        select.addEventListener('focus', () => {
            select.parentElement.classList.add('active');
        });
    });
}

// 加载下拉选项
async function loadSelectOptions(selectName, type, selectedValue) {
    try {
        const data = await fetchSettings(type);

        // Update Cache
        if (!window._settingsCache[type]) window._settingsCache[type] = {};
        data.forEach(item => {
            window._settingsCache[type][item.code || item.name] = item.name;
        });

        const selects = document.querySelectorAll('select[name="' + selectName + '"]');
        selects.forEach(select => {
            let specialOptions = [];
            Array.from(select.options).forEach(opt => {
                if (opt.value === '' || opt.value === '__new__') {
                    specialOptions.push(opt);
                }
            });

            select.innerHTML = '';

            const emptyOpt = specialOptions.find(o => o.value === '');
            if (emptyOpt) select.appendChild(emptyOpt);

            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.code || item.name;
                option.textContent = item.name;
                if (selectedValue && option.value === selectedValue) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            let newOpt = specialOptions.find(o => o.value === '__new__');
            if (!newOpt) {
                newOpt = document.createElement('option');
                newOpt.value = '__new__';
                newOpt.textContent = '+ 新建...';
            }
            select.appendChild(newOpt);

            if (select.value) select.parentElement.classList.add('active');

            // 监听选择变化
            select.addEventListener('change', function () {
                if (this.value === '__new__') {
                    // 存储当前选中的值以便取消时恢复(如果需要)
                    // 但这里我们只是重置为空或者默认值
                    // 更好的做法是: 如果用户取消, 恢复到之前的值. 但这里简单处理: 重置为空

                    const previousValue = this.getAttribute('data-prev-value') || '';

                    openAddSettingModal(type, this.getAttribute('id') || this.getAttribute('name'));

                    // 立即重置为之前的值,防止界面显示 __new__
                    // 如果用户保存成功, saveNewSetting 会再次更新这个值
                    this.value = previousValue;
                } else {
                    // 记录当前有效值
                    this.setAttribute('data-prev-value', this.value);
                }
            });

            // 初始化 data-prev-value
            if (select.value && select.value !== '__new__') {
                select.setAttribute('data-prev-value', select.value);
            }

        });
    } catch (err) {
        console.error('加载下拉选项失败:', selectName, err);
    }
}

// 打开新增配置模态框
window.openAddSettingModal = function (type, targetSelectId) {
    document.getElementById('new-setting-type').value = type;
    document.getElementById('new-setting-target-select').value = targetSelectId;
    document.getElementById('new-setting-name').value = '';
    document.getElementById('new-setting-code').value = '';

    // 更新模态框标题
    const typeNameMap = {
        shop: '店铺',
        warehouse: '仓库',
        inbound_type: '入库类型',
        outbound_type: '出库类型',
        expense_type: '费用类型',
        status: '状态',
        sales_channel: '销售渠道'
    };
    const typeName = typeNameMap[type] || '配置';
    document.querySelector('#add-setting-modal h3').textContent = '新建' + typeName;

    window.openModal('add-setting-modal');
    setTimeout(() => document.getElementById('new-setting-name').focus(), 100);
}

// 监听名称输入,自动填充代码(如果代码框为空)
document.getElementById('new-setting-name').addEventListener('input', function (e) {
    const codeInput = document.getElementById('new-setting-code');
    if (!codeInput.value) {
        // 简单的自动生成预览: 转大写, 空格变下划线
        // 这里只做简单的预览, 实际保存时会有更严格的处理
        const val = e.target.value.trim();
        if (val) {
            // 尝试转为拼音或英文? 目前只能做简单的 ASCII 处理
            // 如果是中文, 暂时不填充, 让用户自己填
            if (/^[\w\s]+$/.test(val)) {
                codeInput.placeholder = val.toUpperCase().replace(/\s+/g, '_');
            }
        }
    }
});

// 保存新配置
window.saveNewSetting = async function () {
    const type = document.getElementById('new-setting-type').value;
    const targetSelectId = document.getElementById('new-setting-target-select').value;
    const name = document.getElementById('new-setting-name').value.trim();
    let code = document.getElementById('new-setting-code').value.trim();

    if (!name) {
        showError('请输入名称');
        return;
    }

    if (!code) {
        showError('请输入代码');
        return;
    }

    // 强制转大写
    code = code.toUpperCase();

    // 1. 格式验证: 必须是大写字母、数字、下划线
    if (!/^[A-Z0-9_]+$/.test(code)) {
        showError('代码格式错误: 只能包含大写字母、数字和下划线');
        return;
    }

    // 2. 唯一性验证
    const existingCodes = window._settingsCache[type] ? Object.keys(window._settingsCache[type]) : [];
    if (existingCodes.includes(code)) {
        showError('代码 ' + code + ' 已存在, 请使用其他代码');
        return;
    }

    try {
        // 使用辅助函数获取正确的数据库类型 (PascalCase)
        const dbType = getDBSettingType(type);

        const payload = {
            type: dbType,
            code: code,
            name: name,
            status: 'Active'
        };

        await createSetting(code, name, dbType);

        showSuccess('创建成功');
        closeModal('add-setting-modal');

        // 刷新缓存
        window._settingsCache[type] = null;

        // 如果有 targetSelectId，说明是下拉框触发的，刷新对应下拉框
        if (targetSelectId) {
            console.log('Refreshing select options for:', targetSelectId);
            // 查找所有使用该类型的下拉框并重新加载
            const selectMap = {
                'shop': 'shop_code',
                'warehouse': 'warehouse_code',
                'inbound_type': 'inbound_type_code',
                'outbound_type': 'outbound_type_code',
                'expense_type': 'expense_type',
                'status': 'status_code',
                'sales_channel': 'sales_channel_code'
            };

            const selectName = selectMap[type];
            if (selectName) {
                await loadSelectOptions(selectName, type, code);
            } else {
                // 尝试刷新触发的特定下拉框
                const targetSelect = document.getElementById(targetSelectId);
                if (targetSelect) {
                    const nameAttr = targetSelect.getAttribute('name');
                    if (nameAttr) {
                        await loadSelectOptions(nameAttr, type, code);
                    }
                }
            }

            // 特殊处理库存调整模态框中的仓库选择器
            if (targetSelectId === 'adjust-warehouse' && type === 'warehouse') {
                // ... (原有逻辑保持不变，如果需要可以简化，这里暂时保留以防万一)
                // 其实 loadSelectOptions 应该能处理大部分情况，这里简化处理：
                // 重新获取数据并手动更新 adjust-warehouse
                const data = await fetchSettings('warehouse');
                if (!window._settingsCache['warehouse']) window._settingsCache['warehouse'] = {};
                data.forEach(item => {
                    window._settingsCache['warehouse'][item.code || item.name] = item.name;
                });
                const warehouseSelect = document.getElementById('adjust-warehouse');
                if (warehouseSelect) {
                    warehouseSelect.innerHTML = '<option value="">请选择仓库</option>';
                    data.forEach(item => {
                        const option = document.createElement('option');
                        option.value = item.code || item.name;
                        option.textContent = item.name;
                        warehouseSelect.appendChild(option);
                    });
                    // 添加新建选项
                    const newOpt = document.createElement('option');
                    newOpt.value = '__new__';
                    newOpt.textContent = '+ 新建...';
                    warehouseSelect.appendChild(newOpt);
                    warehouseSelect.value = code;
                    warehouseSelect.dispatchEvent(new Event('change'));
                }
            }
        } else {
            console.log('Refreshing full system settings list...');
            // 如果没有 targetSelectId，说明是在系统设置页面，刷新整个列表
            await loadSystemSettings();
            console.log('System settings list refreshed.');
            // 同时更新全局缓存以便其他地方使用
            loadSettings();
        }

    } catch (err) {
        showError('创建失败: ' + err.message);
    }
}

// 移除 addSetting 函数，因为它已被模态框取代
// window.addSetting = ... (deleted)

// 根据选中的仓库过滤入/出库类型选项，仅显示允许的集合（选项值为代码）
/**
 * 根据仓库类型过滤移库类型
 * @param {string} warehouseCode - 仓库代码 (CN/TH)
 * @param {HTMLSelectElement} selectEl - 移库类型选择框的DOM元素
 * @param {string} direction - 方向 (inbound/outbound)
 */
function filterTypes(warehouseCode, selectEl, direction) {
    const warehouseName = window._settingsCache.warehouse[warehouseCode] || warehouseCode;
    const rules = WAREHOUSE_RULES[warehouseName] || WAREHOUSE_RULES[warehouseCode];
    if (!rules) return;
    const allow = direction === 'inbound' ? rules.inbound : rules.outbound;
    const typeMap = window._settingsCache[direction === 'inbound' ? 'inbound_type' : 'outbound_type'] || {};
    const preserved = [];
    Array.from(selectEl.options).forEach(opt => {
        if (opt.value === '' || opt.value === '__new__') preserved.push(opt);
    });
    const current = selectEl.value;
    selectEl.innerHTML = '';
    preserved.forEach(o => selectEl.appendChild(o));
    const allowedOptions = [];
    Object.entries(typeMap).forEach(([code, name]) => {
        if (Array.isArray(allow) && allow.includes(name)) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            selectEl.appendChild(opt);
            allowedOptions.push({ code, name });
        }
    });
    const currentName = typeMap[current] || current;
    if (Array.isArray(allow) && allow.includes(currentName)) {
        selectEl.value = current;
    } else {
        selectEl.value = '';
    }
    if (allowedOptions.length === 1) {
        selectEl.value = allowedOptions[0].code;
        if (selectEl.parentElement) selectEl.parentElement.classList.add('active');
    }
}

// 校验仓库与出/入库类型的合法性（传入代码，规则以名称比对）
/**
 * 验证库存移动数据的完整性
 * @param {string} warehouseCode - 仓库代码
 * @param {string} typeCode - 移库类型代码
 * @param {string} direction - 移动方向 ('inbound' 或 'outbound')
 * @returns {boolean} 验证是否通过
 */
function validateMovement(warehouseCode, typeCode, direction) {
    const warehouseName = window._settingsCache.warehouse[warehouseCode] || warehouseCode;
    const rules = WAREHOUSE_RULES[warehouseName];
    if (!rules) return false;
    const allow = direction === 'inbound' ? rules.inbound : rules.outbound;
    const typeMap = window._settingsCache[direction === 'inbound' ? 'inbound_type' : 'outbound_type'] || {};
    const typeName = typeMap[typeCode] || typeCode;
    return Array.isArray(allow) && allow.includes(typeName);
}

// 按类型返回对应币种的单价（不做汇率换算）
function getUnitPriceForMovement(sku, movementType) {
    const rule = PRICE_RULES[movementType];
    if (!rule) return { unit_price_rmb: null, unit_price_thb: null };
    const value = Number(sku[rule.source]) || 0;
    if (rule.currency === 'RMB') return { unit_price_rmb: value, unit_price_thb: null };
    return { unit_price_rmb: null, unit_price_thb: value };
}

// ==========================================
// SKU Logic
// ==========================================

let currentImageBase64 = null;
let currentSKUId = null;
let currentImageFile = null;
let currentImageUrl = null;
let lastSearchQuery = '';
let pendingInbound = {};
let pendingOutbound = {};
window._viewReady = { inbound: false, outbound: false, sku: false, stock: false, expenses: false };
let inboundPurchaseQty = {};
window._skuCacheByBarcode = {};
let inboundLastCode = null;
let inboundScanLock = false;
let outboundLastCode = null;
let outboundScanLock = false;

window.handleSearch = function () {
    const query = document.getElementById('sku-main-input').value;
    loadSKUs(1, query);
}

window.handleCreate = function (barcode) {
    resetForm();
    // 记住从入库触发的新建条码，用于保存后直接加入清单
    window._inboundCreateBarcode = barcode || '';
    window.openModal('sku-modal');
    const input = document.getElementById('modal-barcode-input');
    if (input && barcode) {
        input.value = barcode;
        if (input.parentElement) input.parentElement.classList.add('active');
    }
}

window.resetForm = function () {
    document.getElementById('sku-form').reset();
    currentSKUId = null;
    currentImageBase64 = null;
    currentImageFile = null;
    currentImageUrl = null;

    const uploadArea = document.getElementById('sku-upload-area');
    if (uploadArea) {
        uploadArea.innerHTML = `
            <input type="file" id="sku-img-input" accept="image/*" hidden>
            <label for="sku-img-input" class="upload-label">
                <svg viewBox="0 0 24 24" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span>点击选择图片</span>
                <span class="text-sm text-secondary">选择后将自动上传并重命名</span>
            </label>
        `;
        const input = document.getElementById('sku-img-input');
        if (input) input.addEventListener('change', handleImageSelect);
    }

    document.querySelectorAll('.floating-label-group').forEach(group => group.classList.remove('active'));

    const statusSelect = document.querySelector('select[name="status_code"]');
    if (statusSelect) {
        const cache = (window._settingsCache && window._settingsCache.status) ? window._settingsCache.status : {};
        let defaultCode = 'active';
        for (const code in cache) {
            const name = cache[code] || '';
            if (name.includes('上架')) { defaultCode = code; break; }
        }
        statusSelect.value = defaultCode;
        if (statusSelect.parentElement) statusSelect.parentElement.classList.add('active');
    }
}

function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    currentImageFile = file;

    const reader = new FileReader();
    reader.onload = function (e) {
        currentImageBase64 = e.target.result;
        const area = document.getElementById('sku-upload-area');
        area.innerHTML = `
    <div class="img-preview-wrapper" style="position: relative; width: 100%; height: 100%;" >
                <img src="${currentImageBase64}" style="width: 100%; height: 100%; object-fit: contain;" />
                <button type="button" onclick="clearImageSelection()" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">&times;</button>
            </div > `;
    };
    reader.readAsDataURL(file);
}

window.clearImageSelection = function () {
    currentImageFile = null;
    currentImageBase64 = null;
    currentImageUrl = null;
    const area = document.getElementById('sku-upload-area');
    if (area) {
        area.innerHTML = ``;
        const input = document.getElementById('sku-img-input');
        if (input) input.addEventListener('change', handleImageSelect);
    }
}

window.saveSKU = async function () {
    const form = document.getElementById('sku-form');
    const formData = new FormData(form);

    const barcode = (formData.get('barcode') || '').trim();
    if (!barcode) {
        showError('请输入 SKU / 条码');
        return;
    }

    const btn = document.querySelector('#sku-modal .btn-black');
    const originalText = btn.textContent;
    btn.textContent = '保存中...';
    btn.disabled = true;

    try {
        const user = await checkAuth();
        if (!user) {
            showInfo('请先登录后再保存 SKU');
            await loginWithGoogle();
            return;
        }
        const existing = await fetchSKUByBarcode(barcode);
        if (!currentSKUId && existing) {
            showError('外部条码已存在，不能重复创建');
            return;
        }
        if (currentSKUId && existing && String(existing.id) !== String(currentSKUId)) {
            showError('该条码已被其他 SKU 使用');
            return;
        }
        let imageUrl = null;
        if (currentImageFile) {
            const filename = `sku-${Date.now()}-${currentImageFile.name} `;
            imageUrl = await uploadImage(currentImageFile, filename);
        } else if (currentSKUId) {
            imageUrl = currentImageUrl;
        }

        const urlVal = (formData.get('url') || '').trim();
        const skuData = {
            external_barcode: barcode,
            product_info: formData.get('product_info'),
            shop_code: formData.get('shop_code'),
            purchase_price_rmb: parseFloat(formData.get('purchase_price')) || 0,
            selling_price_thb: parseFloat(formData.get('sales_price')) || 0,
            status_code: formData.get('status_code'),
            pic: imageUrl,
            url: urlVal || null
        };

        let savedSKU = null;
        if (currentSKUId) {
            await updateSKU(currentSKUId, skuData);
            savedSKU = { id: currentSKUId, ...skuData };
        } else {
            savedSKU = await createSKU(skuData);
        }

        window.closeModal('sku-modal');
        loadSKUs();
        showSuccess('保存成功');
        if (savedSKU && savedSKU.external_barcode) {
            window._skuCacheByBarcode[savedSKU.external_barcode] = savedSKU;
        }
        try {
            if (window._inboundCreateBarcode) {
                const code = window._inboundCreateBarcode;
                pendingInbound[code] = (pendingInbound[code] || 0) + 1;
                await appendInboundRowIfNeeded(code);
                const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                if (row) {
                    const input = row.querySelector('input[data-role="inbound-qty"]');
                    if (input) input.value = pendingInbound[code];
                }
                flashRow(code);
                playBeep();
                window._inboundCreateBarcode = '';
                const inboundInputEl = document.getElementById('inbound-sku-input');
                if (inboundInputEl) {
                    inboundInputEl.value = '';
                    inboundInputEl.focus();
                }
            }
        } catch (_) { }

    } catch (error) {
        console.error(error);
        showError('保存失败: ' + (error && error.message ? error.message : error));
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

window.loadSKUs = async function (page = 1, search = '') {
    const tbody = document.querySelector('.sku-table-compact tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">加载中...</td></tr>';

    try {
        const products = await fetchSKUs(page, 20, search);
        const withThumbs = await Promise.all(products.map(async (p, index) => {
            const original = p.pic || 'https://via.placeholder.com/300';
            let thumb = null;
            if (p.pic) {
                thumb = await createTransformedUrlFromPublicUrl(p.pic, 300, 300);
                if (!thumb) thumb = await createSignedUrlFromPublicUrl(p.pic);
            }
            // 计算序号: (当前页 - 1) * 每页数量 + 当前索引 + 1
            const seqId = (page - 1) * 20 + index + 1;
            return { ...p, __thumb: thumb || 'https://via.placeholder.com/100', __original: original, __seqId: seqId };
        }));
        renderSKUTable(withThumbs);
    } catch (error) {
        console.error('loadSKUs error:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-error">加载失败: ' + error.message + '</td></tr>';
    }
}

function renderSKUTable(products) {
    const tbody = document.querySelector('.sku-table-compact tbody');
    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">暂无数据</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
    <tr class="sku-row" >
            <td>${p.__seqId}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${p.__original}')">
                    <div class="image-container" data-img-id="${p.id}">
                        <div class="skeleton-image"></div>
                        <img src="${p.__thumb}" alt="Product" loading="lazy" onerror="window.handleImgError && window.handleImgError(this)">
                    </div>
                </div>
            </td>
            <td class="font-mono">${escapeHtml(p.external_barcode) || '-'}</td>
            <td>
                <div class="product-info-compact clickable" onclick="event.stopPropagation(); showSKUDetails('${p.id}')">
                    ${((p.product_info || '')).split('\n').filter(Boolean).map(l => `<div class="info-line">${escapeHtml(l)}</div>`).join('')}
                </div>
            </td>
            <td class="font-num">¥ ${p.purchase_price_rmb || 0}</td>
            <td class="font-num">฿ ${p.selling_price_thb || 0}</td>
            <td class="text-center">
                ${p.url ? `<a class="icon-link" href="${p.url}" target="_blank" rel="noopener" title="打开链接">
                    <svg class="icon-web-animated" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 0 20"></path>
                        <path d="M12 2a15.3 15.3 0 0 0 0 20"></path>
                    </svg>
                </a>` : ''}
            </td>
            <td class="text-center">
                ${(() => {
            const name = getSettingName('status', p.status_code) || '';
            let cls = 'status-inactive';
            const n = name || '';
            if (n.includes('上架') || p.status_code === 'active') cls = 'status-active';
            else if (n.includes('下架') || p.status_code === 'inactive' || p.status_code === 'down') cls = 'status-down';
            return `<span class="status-dot ${cls}" title="${name}"></span>`;
        })()}
            </td>
            <td class="text-center">
                <div class="action-icons">
                    <button class="btn-icon-action" title="修改" onclick="event.stopPropagation(); editSKU('${p.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                </div>
            </td>
        </tr >
    `).join('');

    // 为所有图片添加加载事件监听
    setupImageLoading();
}

// 设置图片加载监听
function setupImageLoading() {
    const containers = document.querySelectorAll('.image-container');
    containers.forEach(container => {
        const img = container.querySelector('img');
        if (!img) return;

        // 如果图片已经加载完成（来自缓存）
        if (img.complete) {
            handleImageLoad(container, img);
        } else {
            // 监听加载完成
            img.addEventListener('load', () => handleImageLoad(container, img), { once: true });
            // 监听加载失败
            img.addEventListener('error', () => handleImageError(container, img), { once: true });
        }
    });
}

// 处理图片加载完成
function handleImageLoad(container, img) {
    img.classList.add('image-loaded');
    container.classList.add('loaded');
}

// 处理图片加载失败
function handleImageError(container, img) {
    container.classList.add('loaded');
    container.innerHTML = '<div class="image-placeholder">📦</div>';
}


window.showSKUDetails = async function (skuId) {
    try {
        const sku = await fetchSKUById(skuId);
        if (!sku) { showError('未找到该 SKU'); return; }
        const mapName = (t, c) => (window._settingsCache[t] && window._settingsCache[t][c]) ? window._settingsCache[t][c] : c;
        const labels = FIELD_LABELS && FIELD_LABELS.skus ? FIELD_LABELS.skus : {};
        const img = sku.pic || 'https://via.placeholder.com/300';
        const left = `<div class="sku-detail-image"> <img src="${img}" alt="商品图片" onerror="window.handleImgError && window.handleImgError(this)"></div>`;
        const rows = [];

        const fmtDate = (d) => {
            try { return new Date(d).toLocaleString('zh-CN'); } catch (_) { return d || ''; }
        };

        const pushRow = (label, value) => {
            rows.push(`<div class="sku-detail-row"><div class="sku-detail-key">${label}</div><div class="sku-detail-val">${value ?? ''}</div></div > `);
        };

        // 展示字段（按顺序），隐藏 id、name、原始 code 字段
        if (sku.created_at) pushRow(labels.created_at || '创建时间', fmtDate(sku.created_at));
        if (sku.external_barcode) pushRow(labels.external_barcode || '产品条码', escapeHtml(sku.external_barcode));
        if (sku.product_info) pushRow(labels.product_info || '产品信息', (sku.product_info || '').split('\n').map(l => `<div> ${escapeHtml(l)}</div > `).join(''));
        pushRow('产品链接', sku.url ? `<a class="icon-link" href="${sku.url}" target="_blank" rel="noopener" title="${sku.url}" >
            <svg class="icon-web-animated" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 0 20"></path>
                <path d="M12 2a15.3 15.3 0 0 0 0 20"></path>
            </svg>
            <span class="link-domain">${getDomain(sku.url)}</span>
        </a > ` : '');
        pushRow(labels.purchase_price_rmb || '采购价(RMB)', sku.purchase_price_rmb);
        pushRow(labels.selling_price_thb || '销售价(THB)', sku.selling_price_thb);
        if (sku.shop_code) pushRow('店铺', mapName('shop', sku.shop_code) || '');

        // 追加统计信息
        const stockTotal = await fetchStockTotalBySKU(sku.id);
        const sales30d = await fetchSales30dBySKU(sku.id);
        pushRow('库存数量', stockTotal == null ? '-' : stockTotal);
        pushRow('最近30天销售量', sales30d == null ? '-' : sales30d);
        const right = `<div class="sku-detail-fields"> ${rows.join('')}</div > `;
        const body = document.getElementById('sku-detail-body');
        if (body) body.innerHTML = `<div class="sku-detail-grid"> ${left}${right}</div > `;
        window.openModal('sku-detail-modal');
    } catch (err) {
        showError('加载 SKU 详情失败: ' + err.message);
    }
}

//

window.showLightbox = function (src) {
    const lightbox = document.getElementById('global-lightbox');
    if (lightbox) {
        const img = lightbox.querySelector('img');
        img.src = src;
        lightbox.classList.add('active');
    }
}

window.closeLightbox = function () {
    const lightbox = document.getElementById('global-lightbox');
    if (lightbox) lightbox.classList.remove('active');
}

function getDomain(u) {
    try { return new URL(u).hostname; } catch (_) { return u; }
}

window.deleteSKUConfirm = async function (id) {
    try {
        const ok = window.confirm('确认删除该 SKU 吗？此操作不可恢复');
        if (!ok) return;
        const sku = await fetchSKUById(id);
        const code = sku && sku.external_barcode;
        await updateSKU(id, { status_code: 'down' });
        if (code && window._skuCacheByBarcode && window._skuCacheByBarcode[code]) {
            delete window._skuCacheByBarcode[code];
        }
        showSuccess('删除成功');
        loadSKUs();
    } catch (err) {
        showError('删除失败: ' + err.message);
    }
}

window.importSKU = function () {
    showInfo('批量导入功能即将上线');
}

window.editSKU = async function (id) {
    try {
        const sku = await fetchSKUById(id);
        if (!sku) { showError('未找到该 SKU'); return; }
        currentSKUId = id;
        currentImageBase64 = null;
        currentImageFile = null;
        currentImageUrl = sku.pic || null;

        await loadSelectOptions('shop_code', 'shop', sku.shop_code);
        await loadSelectOptions('status_code', 'status', sku.status_code);

        const barcodeInput = document.getElementById('modal-barcode-input');
        const infoInput = document.querySelector('textarea[name="product_info"]');
        const urlInput = document.querySelector('input[name="url"]');
        const purchaseInput = document.querySelector('input[name="purchase_price"]');
        const salesInput = document.querySelector('input[name="sales_price"]');
        const shopSelect = document.querySelector('select[name="shop_code"]');
        const statusSelect = document.querySelector('select[name="status_code"]');

        if (barcodeInput) { barcodeInput.value = sku.external_barcode || ''; barcodeInput.parentElement.classList.add('active'); }
        if (infoInput) { infoInput.value = sku.product_info || ''; infoInput.parentElement.classList.add('active'); }
        if (urlInput) { urlInput.value = sku.url || ''; if (sku.url) urlInput.parentElement.classList.add('active'); }
        if (purchaseInput) { purchaseInput.value = sku.purchase_price_rmb ?? ''; purchaseInput.parentElement.classList.add('active'); }
        if (salesInput) { salesInput.value = sku.selling_price_thb ?? ''; salesInput.parentElement.classList.add('active'); }
        if (shopSelect) { shopSelect.value = sku.shop_code || ''; shopSelect.parentElement.classList.add('active'); }
        if (statusSelect) { statusSelect.value = sku.status_code || ''; statusSelect.parentElement.classList.add('active'); }

        const area = document.getElementById('sku-upload-area');
        if (area) {
            if (currentImageUrl) {
                let displayUrl = currentImageUrl;
                // 尝试获取签名 URL 以防私有桶无法访问
                try {
                    const signed = await createSignedUrlFromPublicUrl(currentImageUrl);
                    if (signed) displayUrl = signed;
                } catch (_) { }

                area.innerHTML = `
    <div class="img-preview-wrapper" style="position: relative; width: 100%; height: 100%;" >
                <img src="${displayUrl}" style="width: 100%; height: 100%; object-fit: contain;" />
                <button type="button" onclick="clearImageSelection()" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">&times;</button>
            </div > `;
            } else {
                area.innerHTML = `
    <input type="file" id="sku-img-input" accept="image/*" hidden >
        <label for="sku-img-input" class="upload-label">
            <svg viewBox="0 0 24 24" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span>点击选择图片</span>
            <span class="text-sm text-secondary">选择后将自动上传并重命名</span>
        </label>
`;
                document.getElementById('sku-img-input').addEventListener('change', handleImageSelect);
            }
        }

        window.openModal('sku-modal');
    } catch (err) {
        showError('加载编辑信息失败: ' + err.message);
    }
}

// ==========================================
// Inbound Logic
// ==========================================

async function renderInboundList() {
    const tbody = document.getElementById('inbound-list-body');
    const empty = document.getElementById('inbound-empty-state');
    if (!tbody) return;

    const codes = Object.keys(pendingInbound);
    if (codes.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }

    const rows = await Promise.all(codes.map(async (code, idx) => {
        const sku = await getSKUByBarcodeCached(code);
        const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
        let thumb = null;
        if (sku && sku.pic) {
            thumb = await createTransformedUrlFromPublicUrl(sku.pic, 300, 300);
            if (!thumb) thumb = await createSignedUrlFromPublicUrl(sku.pic);
        }
        const qty = pendingInbound[code] || 0;
        const purchaseQty = inboundPurchaseQty[code] || 0;
        return `
    <tr data-code="${code}">
                <td>${idx + 1}</td>
                <td>
                    <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                        <div class="image-container">
                            <div class="skeleton-image"></div>
                            <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                        </div>
                    </div>
                </td>
                <td>
                    <div class="sku-code">${escapeHtml((sku && sku.external_barcode) || code)}</div>
                    <div class="sku-name">${escapeHtml((sku && (sku.product_info || '').split('\n')[0]) || '')}</div>
                    <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
                </td>
                <td><div class="form-control-plaintext" data-role="purchase-qty">${purchaseQty}</div></td>
                <td>
                    <div class="qty-input-group">
                        <button class="btn-qty-minus" onclick="window.decreaseInboundQty('${code}')">-</button>
                        <input class="form-control-plaintext" data-role="inbound-qty" type="number" min="1" step="1" value="${qty}">
                        <button class="btn-qty-plus" onclick="window.increaseInboundQty('${code}')">+</button>
                    </div>
                </td>
                <td class="text-center">
                    <button class="btn-icon-action text-error" title="移除" onclick="window.removeInboundItem('${code}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr >
    `;
    }));

    tbody.innerHTML = rows.join('');
    if (empty) empty.style.display = 'none';
    setupImageLoading(); // 激活骨架屏加载
}

// 通用数量调整函数 - 用于入库和出库
function updateQuantity(type, code, delta) {
    const config = {
        inbound: {
            data: pendingInbound,
            listBody: 'inbound-list-body',
            inputRole: 'inbound-qty'
        },
        outbound: {
            data: pendingOutbound,
            listBody: 'outbound-list-body',
            inputRole: 'outbound-qty',
            checkStock: true
        }
    };

    const cfg = config[type];
    if (!cfg) return;

    // 初始化数量
    if (!cfg.data[code]) cfg.data[code] = 0;

    let next = cfg.data[code] + delta;

    // 出库需要检查库存上限
    if (cfg.checkStock && delta > 0) {
        const row = document.querySelector(`#${cfg.listBody} tr[data-code="${code}"]`);
        if (row) {
            const cell = row.querySelector('[data-role="current-stock"]');
            const max = cell ? parseInt(cell.textContent, 10) : NaN;
            if (!Number.isNaN(max) && next > max) {
                next = max;
                showError('超过当前库存，已回退到最大可用值');
            }
        }
    }

    // 数量不能小于 1
    next = Math.max(1, next);
    cfg.data[code] = next;

    // 更新 UI
    const row = document.querySelector(`#${cfg.listBody} tr[data-code="${code}"]`);
    if (row) {
        const input = row.querySelector(`input[data-role="${cfg.inputRole}"]`);
        if (input) input.value = next;
    }
}

// 入库数量调整（使用通用函数）
window.increaseInboundQty = (code) => updateQuantity('inbound', code, 1);
window.decreaseInboundQty = (code) => updateQuantity('inbound', code, -1);


window.removeInboundItem = function (code) {
    if (pendingInbound[code] != null) delete pendingInbound[code];
    if (inboundPurchaseQty[code] != null) delete inboundPurchaseQty[code];
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (row) row.remove();
    const empty = document.getElementById('inbound-empty-state');
    if (empty && Object.keys(pendingInbound).length === 0) empty.style.display = '';
}

let quickCreateHandler = null;
function openQuickCreateForBarcode(code) {
    const unknown = document.getElementById('unknown-barcode');
    if (unknown) unknown.textContent = code;
    const quickBarcode = document.getElementById('quick-barcode');
    if (quickBarcode) {
        quickBarcode.value = code;
        if (quickBarcode.parentElement) quickBarcode.parentElement.classList.add('active');
    }
    window.openModal('quick-create-modal');
    const createBtn = document.querySelector('#quick-create-modal .modal-footer .btn.btn-black');
    if (createBtn) {
        if (quickCreateHandler) createBtn.removeEventListener('click', quickCreateHandler);
        quickCreateHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nameInput = document.querySelector('#quick-create-form input[placeholder=" "]');
            const productName = (nameInput && nameInput.value && nameInput.value.trim()) || '';
            try {
                const sku = await createSKU({ external_barcode: code, product_info: productName });
                pendingInbound[code] = (pendingInbound[code] || 0) + 1;
                await appendInboundRowIfNeeded(code);
                const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                if (row) {
                    const input = row.querySelector('input[data-role="inbound-qty"]');
                    if (input) input.value = pendingInbound[code];
                }
                flashRow(code);
                playBeep();
                window.closeModal('quick-create-modal');
                showSuccess('已创建 SKU 并加入待入库清单');
            } catch (err) {
                showError('创建失败: ' + err.message);
            }
        };
        createBtn.addEventListener('click', quickCreateHandler);
    }
}

async function appendInboundRowIfNeeded(code) {
    const tbody = document.getElementById('inbound-list-body');
    const empty = document.getElementById('inbound-empty-state');
    if (!tbody) return;
    if (document.querySelector(`#inbound-list-body tr[data-code="${code}"]`)) return;
    const sku = await getSKUByBarcodeCached(code);
    const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
    let thumb = null;
    if (sku && sku.pic) {
        thumb = await createTransformedUrlFromPublicUrl(sku.pic, 300, 300);
        if (!thumb) thumb = await createSignedUrlFromPublicUrl(sku.pic);
        if (!thumb) thumb = original; // 变换失败时直接使用原图
    }
    const idx = tbody.querySelectorAll('tr').length + 1;
    const qty = pendingInbound[code] || 0;
    const purchaseQty = inboundPurchaseQty[code] || 0;
    const rowHtml = `
    <tr data-code="${code}">
            <td>${idx}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                    <div class="image-container">
                        <div class="skeleton-image"></div>
                        <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                    </div>
                </div>
            </td>
            <td>
                <div class="sku-code">${escapeHtml((sku && sku.external_barcode) || code)}</div>
                <div class="sku-name">${escapeHtml((sku && (sku.product_info || '').split('\n')[0]) || '')}</div>
                <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
            </td>
            <td><div class="form-control-plaintext" data-role="purchase-qty">${purchaseQty}</div></td>
            <td>
                <div class="qty-input-group">
                    <button class="btn-qty-minus" onclick="window.decreaseInboundQty('${code}')">-</button>
                    <input class="form-control-plaintext" data-role="inbound-qty" type="number" min="1" step="1" value="${qty}">
                    <button class="btn-qty-plus" onclick="window.increaseInboundQty('${code}')">+</button>
                </div>
            </td>
            <td class="text-center">
                <button class="btn-icon-action text-error" title="移除" onclick="window.removeInboundItem('${code}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        </tr >
    `;
    const temp = document.createElement('tbody');
    temp.innerHTML = rowHtml.trim();
    const tr = temp.firstElementChild;
    tbody.appendChild(tr);
    if (empty) empty.style.display = 'none';

    // 重要：为新添加的图片设置加载监听
    setupImageLoading();
}
window.submitInbound = async function () {
    const barcode = document.getElementById('inbound-sku-input')?.value?.trim();
    const warehouse = document.getElementById('inbound-warehouse')?.value;
    const type = document.getElementById('inbound-type')?.value;
    if ((!barcode && Object.keys(pendingInbound).length === 0) || !warehouse || !type) {
        showError('请填写必填项：SKU、入库仓库、入库类型');
        return;
    }

    if (!validateMovement(warehouse, type, 'inbound')) {
        showError('该仓库不允许此入库类型');
        return;
    }

    try {
        let count = 0;
        if (Object.keys(pendingInbound).length > 0) {
            const ok = await confirmAction(`确认入库：共 ${Object.values(pendingInbound).reduce((a, b) => a + b, 0)} 件`)
            if (!ok) { showInfo('已取消'); return; }
            for (const code of Object.keys(pendingInbound)) {
                const qty = pendingInbound[code];
                const sku = await getSKUByBarcodeCached(code);
                if (!sku) { showError(`未找到条码 ${code} 的 SKU`); continue; }
                const price = getUnitPriceForMovement(sku, type);
                const payload = {
                    sku_id: sku.id,
                    warehouse_code: warehouse,
                    movement_type_code: type,
                    quantity: qty,
                    unit_price_rmb: price.unit_price_rmb,
                    unit_price_thb: price.unit_price_thb
                };
                await createStockMovement(payload);
                count += qty;
            }
            pendingInbound = {};
        } else {
            const sku = await getSKUByBarcodeCached(barcode);
            if (!sku) { showError('未找到该条码的 SKU'); return; }
            const price = getUnitPriceForMovement(sku, type);
            const payload = {
                sku_id: sku.id,
                warehouse_code: warehouse,
                movement_type_code: type,
                quantity: 1,
                unit_price_rmb: price.unit_price_rmb,
                unit_price_thb: price.unit_price_thb
            };
            const ok = await confirmAction(`确认入库：SKU ${sku.external_barcode}，仓库 ${getSettingName('warehouse', warehouse)}，类型 ${getSettingName('inbound_type', type)}，数量 1`)
            if (!ok) { showInfo('已取消'); return; }
            await createStockMovement(payload);
            count = 1;
        }
        showSuccess('入库成功');
        resetInboundView();
    } catch (error) {
        console.error(error);
        showError('入库失败: ' + error.message);
    }
}

window.triggerSheetUpload = function () {
    document.getElementById('sheet-upload-input').click();
}

function resetInboundView() {
    pendingInbound = {};
    inboundPurchaseQty = {};
    const inboundInput = document.getElementById('inbound-sku-input');
    if (inboundInput) inboundInput.value = '';
    const inboundWarehouse = document.getElementById('inbound-warehouse');
    if (inboundWarehouse) {
        inboundWarehouse.value = '';
        if (inboundWarehouse.parentElement) inboundWarehouse.parentElement.classList.remove('active');
    }
    const inboundType = document.getElementById('inbound-type');
    if (inboundType) {
        inboundType.value = '';
        if (inboundType.parentElement) inboundType.parentElement.classList.remove('active');
    }
    const tbody = document.getElementById('inbound-list-body');
    if (tbody) tbody.innerHTML = '';
    const empty = document.getElementById('inbound-empty-state');
    if (empty) empty.style.display = '';
}

function setInboundDisabled(disabled) {
    const inboundInput = document.getElementById('inbound-sku-input');
    const inboundWarehouse = document.getElementById('inbound-warehouse');
    const inboundType = document.getElementById('inbound-type');
    const btn = document.querySelector('#inbound-view .panel-header .btn');
    if (inboundInput) inboundInput.disabled = disabled;
    if (inboundWarehouse) inboundWarehouse.disabled = disabled;
    if (inboundType) inboundType.disabled = disabled;
    if (btn) btn.disabled = disabled;
}

async function preloadInbound() {
    window._viewReady.inbound = false;
    setInboundDisabled(true);
    await loadSelectOptions('warehouse_code', 'warehouse');
    await loadSelectOptions('inbound_type_code', 'inbound_type');
    const inboundWarehouse = document.getElementById('inbound-warehouse');
    const inboundType = document.getElementById('inbound-type');
    if (inboundWarehouse && inboundType) {
        filterTypes(inboundWarehouse.value, inboundType, 'inbound');
    }
    window._viewReady.inbound = true;
    setInboundDisabled(false);
    const inboundInputEl = document.getElementById('inbound-sku-input');
    if (inboundInputEl) inboundInputEl.focus();
}

function flashRow(code) {
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (!row) return;
    row.classList.remove('row-flash');
    void row.offsetWidth;
    row.classList.add('row-flash');
}

function playBeep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        setTimeout(() => { try { ctx.close(); } catch (_) { } }, 200);
    } catch (_) { }
}

// ==========================================
// Outbound Logic
// ==========================================

async function renderOutboundList() {
    const tbody = document.getElementById('outbound-list-body');
    const empty = document.getElementById('outbound-empty-state');
    if (!tbody) return;
    const codes = Object.keys(pendingOutbound);
    if (codes.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    const rows = await Promise.all(codes.map(async (code, idx) => {
        const sku = await getSKUByBarcodeCached(code);
        const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
        let thumb = null;
        if (sku && sku.pic) {
            thumb = await createTransformedUrlFromPublicUrl(sku.pic, 300, 300);
            if (!thumb) thumb = await createSignedUrlFromPublicUrl(sku.pic);
            if (!thumb) thumb = original;
        }
        const qty = pendingOutbound[code] || 0;
        const stockCell = '<td class="font-num" data-role="current-stock">-</td>';
        return `
    <tr data-code="${code}" data-sku-id="${(sku && sku.id) || ''}" >
                <td>${idx + 1}</td>
                <td>
                    <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                        <div class="image-container">
                            <div class="skeleton-image"></div>
                            <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                        </div>
                    </div>
                </td>
                <td>
                    <div class="sku-code">${escapeHtml((sku && sku.external_barcode) || code)}</div>
                    <div class="sku-name">${escapeHtml((sku && (sku.product_info || '').split('\n')[0]) || '')}</div>
                    <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
                </td>
                ${stockCell}
                <td>
                    <div class="qty-input-group">
                        <button class="btn-qty-minus" onclick="window.decreaseOutboundQty('${code}')">-</button>
                        <input class="form-control-plaintext" data-role="outbound-qty" type="number" min="1" step="1" value="${qty}">
                        <button class="btn-qty-plus" onclick="window.increaseOutboundQty('${code}')">+</button>
                    </div>
                </td>
                <td class="text-center">
                    <button class="btn-icon-action text-error" title="移除" onclick="window.removeOutboundItem('${code}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr >
    `;
    }));
    tbody.innerHTML = rows.join('');
    if (empty) empty.style.display = 'none';
    setupImageLoading(); // 激活骨架屏加载

    // 异步更新每行的当前库存
    codes.forEach(async (code) => {
        const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
        const skuId = row && row.getAttribute('data-sku-id');
        if (!row || !skuId) return;
        try {
            const total = await fetchStockTotalBySKU(skuId);
            const cell = row.querySelector('[data-role="current-stock"]');
            if (cell) cell.textContent = (total == null ? '-' : total);
            if (typeof total === 'number') {
                if (pendingOutbound[code] > total) {
                    pendingOutbound[code] = total;
                    const input = row.querySelector('input[data-role="outbound-qty"]');
                    if (input) input.value = total;
                    showError('超过当前库存，已回退到最大可用值');
                }
            }
        } catch (_) { }
    });
}

function resetOutboundView() {
    pendingOutbound = {};
    const outboundInput = document.getElementById('outbound-sku-input');
    if (outboundInput) outboundInput.value = '';
    const outboundWarehouse = document.getElementById('outbound-warehouse');
    if (outboundWarehouse) {
        outboundWarehouse.value = '';
        if (outboundWarehouse.parentElement) outboundWarehouse.parentElement.classList.remove('active');
    }
    const outboundType = document.getElementById('outbound-type');
    if (outboundType) {
        outboundType.value = '';
        if (outboundType.parentElement) outboundType.parentElement.classList.remove('active');
    }
    const tbody = document.getElementById('outbound-list-body');
    if (tbody) tbody.innerHTML = '';
    const empty = document.getElementById('outbound-empty-state');
    if (empty) empty.style.display = '';
}
async function appendOutboundRowIfNeeded(code) {
    const tbody = document.getElementById('outbound-list-body');
    const empty = document.getElementById('outbound-empty-state');
    if (!tbody) return;
    if (document.querySelector(`#outbound-list-body tr[data-code="${code}"]`)) return;
    const sku = await getSKUByBarcodeCached(code);
    const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
    let thumb = null;
    if (sku && sku.pic) {
        thumb = await createTransformedUrlFromPublicUrl(sku.pic, 300, 300);
        if (!thumb) thumb = await createSignedUrlFromPublicUrl(sku.pic);
        if (!thumb) thumb = original;
    }
    const idx = tbody.querySelectorAll('tr').length + 1;
    const qty = pendingOutbound[code] || 0;
    const rowHtml = `
    <tr data-code="${code}" data-sku-id="${(sku && sku.id) || ''}" >
            <td>${idx}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                    <div class="image-container">
                        <div class="skeleton-image"></div>
                        <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                    </div>
                </div>
            </td>
            <td>
                <div class="sku-code">${escapeHtml((sku && sku.external_barcode) || code)}</div>
                <div class="sku-name">${escapeHtml((sku && (sku.product_info || '').split('\n')[0]) || '')}</div>
                <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
            </td>
            <td class="font-num" data-role="current-stock">-</td>
            <td>
                <div class="qty-input-group">
                    <button class="btn-qty-minus" onclick="window.decreaseOutboundQty('${code}')">-</button>
                    <input class="form-control-plaintext" data-role="outbound-qty" type="number" min="1" step="1" value="${qty}">
                    <button class="btn-qty-plus" onclick="window.increaseOutboundQty('${code}')">+</button>
                </div>
            </td>
            <td class="text-center">
                <button class="btn-icon-action text-error" title="移除" onclick="window.removeOutboundItem('${code}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        </tr >
    `;
    const temp = document.createElement('tbody');
    temp.innerHTML = rowHtml.trim();
    const tr = temp.firstElementChild;
    tbody.appendChild(tr);
    if (empty) empty.style.display = 'none';

    // 重要：为新添加的图片设置加载监听
    setupImageLoading();

    // 异步填充当前库存
    if (sku && sku.id) {
        try {
            const total = await fetchStockTotalBySKU(sku.id);
            const cell = tr.querySelector('[data-role="current-stock"]');
            if (cell) cell.textContent = (total == null ? '-' : total);
            if (typeof total === 'number') {
                const input = tr.querySelector('input[data-role="outbound-qty"]');
                if (pendingOutbound[code] > total) {
                    pendingOutbound[code] = total;
                    if (input) input.value = total;
                    showError('超过当前库存，已回退到最大可用值');
                }
            }
        } catch (_) { }
    }
}

function flashOutboundRow(code) {
    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
    if (!row) return;
    row.classList.remove('row-flash');
    void row.offsetWidth;
    row.classList.add('row-flash');
}

// 出库数量调整（使用通用函数）
window.increaseOutboundQty = (code) => updateQuantity('outbound', code, 1);
window.decreaseOutboundQty = (code) => updateQuantity('outbound', code, -1);

window.removeOutboundItem = function (code) {
    if (pendingOutbound[code] != null) delete pendingOutbound[code];
    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
    if (row) row.remove();
    const empty = document.getElementById('outbound-empty-state');
    if (empty && Object.keys(pendingOutbound).length === 0) empty.style.display = '';
};

window.submitOutbound = async function () {
    const barcode = document.getElementById('outbound-sku-input')?.value?.trim();
    const warehouse = document.getElementById('outbound-warehouse')?.value;
    const type = document.getElementById('outbound-type')?.value;
    if ((!barcode && Object.keys(pendingOutbound).length === 0) || !warehouse || !type) {
        showError('请填写必填项：SKU、出库仓库、出库类型');
        return;
    }

    if (!validateMovement(warehouse, type, 'outbound')) {
        showError('该仓库不允许此出库类型');
        return;
    }

    try {
        let count = 0;
        if (Object.keys(pendingOutbound).length > 0) {
            const ok = await confirmAction(`确认出库：共 ${Object.values(pendingOutbound).reduce((a, b) => a + b, 0)} 件`)
            if (!ok) { showInfo('已取消'); return; }
            for (const code of Object.keys(pendingOutbound)) {
                const qty = pendingOutbound[code];
                const sku = await getSKUByBarcodeCached(code);
                if (!sku) { showError(`未找到条码 ${code} 的 SKU`); continue; }
                const price = getUnitPriceForMovement(sku, type);
                const payload = {
                    sku_id: sku.id,
                    warehouse_code: warehouse,
                    movement_type_code: type,
                    quantity: qty,
                    unit_price_rmb: price.unit_price_rmb,
                    unit_price_thb: price.unit_price_thb,
                    sales_channel: document.getElementById('outbound-channel')?.value
                };
                await createStockMovement(payload);
                count += qty;
            }
            pendingOutbound = {};
        } else {
            const sku = await getSKUByBarcodeCached(barcode);
            if (!sku) { showError('未找到该条码的 SKU'); return; }
            const price = getUnitPriceForMovement(sku, type);
            const payload = {
                sku_id: sku.id,
                warehouse_code: warehouse,
                movement_type_code: type,
                quantity: 1,
                unit_price_rmb: price.unit_price_rmb,
                unit_price_thb: price.unit_price_thb,
                sales_channel: document.getElementById('outbound-channel')?.value
            };
            const ok = await confirmAction(`确认出库：SKU ${sku.external_barcode}，仓库 ${getSettingName('warehouse', warehouse)}，类型 ${getSettingName('outbound_type', type)}，数量 1`)
            if (!ok) { showInfo('已取消'); return; }
            await createStockMovement(payload);
            count = 1;
        }
        showSuccess('出库成功');
        resetOutboundView();
    } catch (error) {
        console.error(error);
        showError('出库失败: ' + error.message);
    }
}

window.triggerOrderUpload = function () {
    document.getElementById('order-upload-input').click();
}

function setOutboundDisabled(disabled) {
    const outboundInput = document.getElementById('outbound-sku-input');
    const outboundWarehouse = document.getElementById('outbound-warehouse');
    const outboundType = document.getElementById('outbound-type');
    const btn = document.querySelector('#outbound-view .panel-header .btn');
    if (outboundInput) outboundInput.disabled = disabled;
    if (outboundWarehouse) outboundWarehouse.disabled = disabled;
    if (outboundType) outboundType.disabled = disabled;
    if (btn) btn.disabled = disabled;
}

async function preloadOutbound() {
    window._viewReady.outbound = false;
    setOutboundDisabled(true);
    await loadSelectOptions('warehouse_code', 'warehouse');
    await loadSelectOptions('outbound_type_code', 'outbound_type');
    const outboundWarehouse = document.getElementById('outbound-warehouse');
    const outboundType = document.getElementById('outbound-type');
    if (outboundWarehouse && outboundType) {
        filterTypes(outboundWarehouse.value, outboundType, 'outbound');
    }
    window._viewReady.outbound = true;
    setOutboundDisabled(false);
    const outboundInputEl = document.getElementById('outbound-sku-input');
    if (outboundInputEl) outboundInputEl.focus();
    renderOutboundList(); // Ensure list is rendered after preload
}

// ==========================================
// Stock Logic
// ==========================================

window.loadStockList = async function (query = '', warehouse = '') {
    const tbody = document.getElementById('stock-list-body');
    const totalEl = document.getElementById('stock-total-count');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">加载中...</td></tr>';
    try {
        const products = await fetchSKUs(1, 50, query);
        const rows = [];
        let warehouseStockMap = null;
        if (warehouse) {
            try { warehouseStockMap = await fetchWarehouseStockMap(warehouse); } catch (_) { warehouseStockMap = null; }
        }
        for (const p of products) {
            const original = p.pic || 'https://via.placeholder.com/300';
            let thumb = null;
            if (p.pic) {
                thumb = await createTransformedUrlFromPublicUrl(p.pic, 300, 300);
            }
            let stockWarehouse = '-';
            let stockTotal = '-';
            try {
                const total = await fetchStockTotalBySKU(p.id);
                stockTotal = total == null ? '-' : total;
            } catch (_) { }
            if (warehouse) {
                if (warehouseStockMap && Object.prototype.hasOwnProperty.call(warehouseStockMap, p.id)) {
                    stockWarehouse = warehouseStockMap[p.id];
                } else {
                    try {
                        const sw = await fetchStockBySKUWarehouse(p.id, warehouse);
                        stockWarehouse = (sw == null ? 0 : sw);
                    } catch (e) {
                        stockWarehouse = 0;
                    }
                }
            }
            // 过滤下架状态的SKU - 不在库存管理中显示
            const statusName = getSettingName('status', p.status_code) || '';
            const statusCode = (p.status_code || '').toLowerCase();
            const statusNameLower = statusName.toLowerCase();

            // 跳过所有下架/停用/禁用状态的SKU
            if (statusNameLower.includes('下架') ||
                statusNameLower.includes('停用') ||
                statusNameLower.includes('禁用') ||
                statusCode === 'inactive' ||
                statusCode === 'down' ||
                statusCode === 'disabled') {
                continue;
            }

            const idx = rows.length + 1;
            let warehouseName = '';
            if (warehouse) {
                // 选择了特定仓库,显示仓库名称
                warehouseName = getSettingName('warehouse', warehouse) || warehouse;
            } else {
                // 未选择仓库,显示"全部仓库"
                warehouseName = '全部仓库';
            }
            const stockShown = warehouse ? stockWarehouse : stockTotal;
            rows.push(`
    <tr>
                    <td>${idx}</td>
                    <td>
                        <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                            <div class="image-container">
                                <div class="skeleton-image"></div>
                                <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                            </div>
                        </div>
                    </td>
                    <td class="col-product-info">
                        <div class="sku-code">${p.external_barcode || p.code || ''}</div>
                        <div class="sku-name">${(p.product_info || '').split('\n')[0]}</div>
                        <div class="sku-meta">${getSettingName('shop', p.shop_code) || ''}</div>
                    </td>
                    <td class="no-wrap">${warehouseName}</td>
                    <td class="font-num">${stockShown}</td>
                    <td class="font-num">${p.safety_stock_30d != null ? p.safety_stock_30d : '-'}</td>
                    <td class="text-center">${p.url ? `<a href="${p.url}" target="_blank" title="打开链接" class="btn-url-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 0 20"></path><path d="M12 2a15.3 15.3 0 0 0 0 20"></path></svg></a>` : ''}</td>
                    <td class="text-center">
                        <div class="action-icons">
                            <button class="btn-icon-action" title="调整" onclick="openAdjustModal('${p.external_barcode || p.code || ''}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                        </div>
                    </td>
                </tr >
    `);
        }
        tbody.innerHTML = rows.join('') || '<tr><td colspan="8" class="text-center">暂无数据</td></tr>';
        if (totalEl) totalEl.textContent = String(rows.length || 0);
        setupImageLoading(); // 激活骨架屏加载
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-error">加载失败</td></tr>';
    }
}
/**
 * 处理库存搜索功能
 * 支持按条码、商品信息、店铺等多维度搜索
 */
window.searchStock = function (queryOverride) {
    try {
        const query = queryOverride !== undefined ? queryOverride : document.getElementById('stock-search-input').value;
        const warehouse = document.getElementById('stock-warehouse').value;
        loadStockList(query, warehouse);
    } catch (error) {
        console.error('搜索失败:', error);
        showError('搜索失败,请重试');
    }
}

window.openAdjustModal = function (sku) {
    window.openModal('adjust-stock-modal');

    // 设置SKU信息
    const skuCodeEl = document.getElementById('adjust-sku-code');
    const skuNameEl = document.getElementById('adjust-sku-name');
    const currentStockEl = document.getElementById('adjust-current-stock');
    const warehouseSelect = document.getElementById('adjust-warehouse');

    if (skuCodeEl) skuCodeEl.textContent = sku;
    if (skuNameEl) skuNameEl.textContent = '加载中...';
    if (currentStockEl) currentStockEl.textContent = '-';

    // 填充仓库下拉框
    if (warehouseSelect) {
        warehouseSelect.innerHTML = '<option value="">请选择仓库</option>';
        const warehouses = window._settingsCache['warehouse'] || {};
        Object.keys(warehouses).forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = warehouses[code];
            warehouseSelect.appendChild(option);
        });

        // 如果主页面已选择仓库,自动填充
        const mainWarehouse = document.getElementById('stock-warehouse')?.value || '';
        if (mainWarehouse) {
            warehouseSelect.value = mainWarehouse;
        }
    }

    // 加载SKU信息
    (async () => {
        try {
            const s = await fetchSKUByBarcode(sku);
            if (s) {
                if (skuNameEl) skuNameEl.textContent = (s.product_info || '').split('\n')[0] || '';

                // 监听仓库变化
                if (warehouseSelect) {
                    const updateStock = async () => {
                        const selectedWarehouse = warehouseSelect.value;
                        if (selectedWarehouse) {
                            const cur = await fetchStockBySKUWarehouse(s.id, selectedWarehouse);
                            if (currentStockEl) currentStockEl.textContent = (cur == null ? 0 : cur);
                            window._adjustSku = {
                                id: s.id,
                                barcode: s.external_barcode,
                                warehouse: selectedWarehouse,
                                current: (cur == null ? 0 : cur),
                                price_rmb: Number(s.purchase_price_rmb) || 0
                            };
                        } else {
                            if (currentStockEl) currentStockEl.textContent = '-';
                            window._adjustSku = {
                                id: s.id,
                                barcode: s.external_barcode,
                                warehouse: '',
                                current: 0,
                                price_rmb: Number(s.purchase_price_rmb) || 0
                            };
                        }
                    };

                    warehouseSelect.onchange = updateStock;

                    // 如果已选择仓库,立即更新库存
                    if (warehouseSelect.value) {
                        await updateStock();
                    }
                }
            } else {
                if (skuNameEl) skuNameEl.textContent = '未找到';
            }
        } catch (err) {
            console.error('加载SKU信息失败:', err);
        }
    })();

    // 绑定确认按钮事件
    const footerBtn = document.getElementById('confirm-adjust-btn');
    if (footerBtn) {
        footerBtn.onclick = async () => {
            try {
                const info = window._adjustSku || {};
                // 从模态框中获取仓库
                const warehouse = warehouseSelect?.value || '';
                if (!warehouse) {
                    showError('请选择仓库');
                    return;
                }
                const type = document.getElementById('adjust-type')?.value || 'add';
                let qty = parseInt(document.getElementById('adjust-qty')?.value || '0', 10);
                if (Number.isNaN(qty) || qty < 0) qty = 0;
                const note = document.getElementById('adjust-note')?.value || '';
                let movement = null;
                let amount = 0;
                if (type === 'add') { movement = 'adjust_add'; amount = qty; }
                else if (type === 'reduce') { movement = 'adjust_reduce'; amount = qty; }
                else if (type === 'set') {
                    const cur = info.current || 0;
                    const delta = qty - cur;
                    if (delta > 0) { movement = 'adjust_add'; amount = delta; }
                    else if (delta < 0) { movement = 'adjust_reduce'; amount = -delta; }
                    else { showInfo('库存不变'); closeModal('adjust-stock-modal'); return; }
                }
                // 校验 settings 是否存在相应操作类型
                // const inboundTypes = window._settingsCache['inbound_type'] || {};
                // const outboundTypes = window._settingsCache['outbound_type'] || {};
                // const hasAdd = inboundTypes['adjust_add'] != null;
                // const hasReduce = outboundTypes['adjust_reduce'] != null;
                // if ((movement === 'adjust_add' && !hasAdd) || (movement === 'adjust_reduce' && !hasReduce)) {
                //     showError('缺少操作类型:请在 settings 中添加 adjust_add / adjust_reduce');
                //     return;
                // }
                const payload = {
                    sku_id: info.id,
                    warehouse_code: warehouse,
                    movement_type_code: movement,
                    quantity: amount,
                    unit_price_rmb: info.price_rmb || 0,
                    unit_price_thb: null,
                    note: note
                };
                await createStockMovement(payload);
                showSuccess('库存已调整');
                closeModal('adjust-stock-modal');
                // 刷新当前列表行显示
                const q = document.getElementById('stock-search-input')?.value || '';
                loadStockList(q, warehouse);
            } catch (err) {
                showError('调整失败: ' + err.message);
            }
        };
    } else {
        console.error('[ERROR] 找不到确认调整按钮!');
    }
}

// ==========================================
// Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', async function () {

    // Init Floating Labels
    initFloatingLabels();

    // Init Auth
    initAuth();

    // 初始化用户状态
    await checkAuth()

    // 强制认证检查
    try {
        const isAuthenticated = await enforceAuth();

        // 只有认证通过才加载数据
        if (isAuthenticated) {
            // 默认加载仪表盘
            navigate('dashboard');

            loadSelectOptions('shop_code', 'shop');
            loadSelectOptions('warehouse_code', 'warehouse');
            loadSelectOptions('inbound_type_code', 'inbound_type');
            loadSelectOptions('outbound_type_code', 'outbound_type');
            loadSelectOptions('expense_type', 'expense_type');
            loadSelectOptions('status_code', 'status');
            loadSelectOptions('sales_channel', 'sales_channel');

            // 监听出库仓库变化，过滤出库类型
            const outboundWarehouseSelect = document.getElementById('outbound-warehouse');
            const outboundTypeSelect = document.getElementById('outbound-type');
            const channelGroup = document.getElementById('outbound-channel-group');

            if (outboundWarehouseSelect && outboundTypeSelect) {
                outboundWarehouseSelect.addEventListener('change', () => filterTypes(outboundWarehouseSelect.value, outboundTypeSelect, 'outbound'));
            }

            document.querySelectorAll('select').forEach(select => {
                if (![...select.options].some(o => o.value === '__new__')) {
                    const newOpt = document.createElement('option');
                    newOpt.value = '__new__';
                    newOpt.textContent = '+ 新建...';
                    select.appendChild(newOpt);
                }
            });
        }
    } catch (error) {
        console.error('enforceAuth failed:', error)
        // 出错时显示登录界面
        const authOverlay = document.getElementById('auth-overlay')
        if (authOverlay) authOverlay.style.display = 'flex'
    }

    const inboundWarehouse = document.getElementById('inbound-warehouse');
    const inboundType = document.getElementById('inbound-type');
    if (inboundWarehouse && inboundType) {
        inboundWarehouse.addEventListener('change', () => filterTypes(inboundWarehouse.value, inboundType, 'inbound'));
        filterTypes(inboundWarehouse.value, inboundType, 'inbound');
    }

    const outboundWarehouse = document.getElementById('outbound-warehouse');
    const outboundType = document.getElementById('outbound-type');
    if (outboundWarehouse && outboundType) {
        outboundWarehouse.addEventListener('change', () => filterTypes(outboundWarehouse.value, outboundType, 'outbound'));
        filterTypes(outboundWarehouse.value, outboundType, 'outbound');
    }

    // 移除 focus 事件监听器，避免干扰扫码
    // const barcodeInputs = ['inbound-sku-input', 'outbound-sku-input', 'stock-search-input'];
    // ...

    const inboundInput = document.getElementById('inbound-sku-input');
    if (inboundInput) {
        // 移除 focus 自动清空，避免误操作
        // inboundInput.addEventListener('focus', ...);

        inboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交行为
                const code = inboundInput.value.trim();
                // 立即清空输入框，防止重复或叠加
                inboundInput.value = '';

                if (!code) return;
                if (inboundScanLock) return;

                inboundScanLock = true;
                try {
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) {
                        showError('该产品不存在或已下架，禁止入库');
                        inboundLastCode = code;
                        return;
                    }
                    const statusName = getSettingName('status', sku.status_code) || '';
                    const isDown = sku.status_code === 'down' || sku.status_code === 'inactive' || statusName.includes('下架');
                    if (isDown) {
                        window._inboundCreateBarcode = code;
                        editSKU(sku.id);
                        return;
                    }

                    // 更新数量或新增行
                    if (!pendingInbound[code]) pendingInbound[code] = 0;
                    pendingInbound[code] += 1;

                    await appendInboundRowIfNeeded(code);

                    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                    if (row) {
                        const input = row.querySelector('input[data-role="inbound-qty"]');
                        if (input) input.value = pendingInbound[code];
                    }

                    flashRow(code);
                    playBeep();
                    inboundLastCode = code;
                } catch (err) {
                    showError('扫描入库失败: ' + err.message);
                    // 如果失败，可能需要把码放回去？通常不需要，让用户重扫即可
                } finally {
                    setTimeout(() => { inboundScanLock = false; }, 200);
                    inboundInput.focus(); // 保持聚焦
                }
            }
        });
    }

    const outboundInput = document.getElementById('outbound-sku-input');
    if (outboundInput) {
        outboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交
                const code = outboundInput.value.trim();
                // 立即清空
                outboundInput.value = '';

                if (!code) return;
                if (outboundScanLock) return;

                outboundScanLock = true;
                try {
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) {
                        showError('未找到该条码的 SKU');
                        outboundLastCode = code;
                        return;
                    }
                    const statusName = getSettingName('status', sku.status_code) || '';
                    const isDown = sku.status_code === 'down' || sku.status_code === 'inactive' || statusName.includes('下架');
                    if (isDown) {
                        showError('该产品已下架，禁止出库');
                        outboundLastCode = code;
                        return;
                    }

                    // 更新数量或新增行
                    if (!pendingOutbound[code]) pendingOutbound[code] = 0;

                    // 预先检查库存（如果是已有行）
                    // 注意：如果是新行，appendOutboundRowIfNeeded 会处理库存显示，但这里我们先增加数量
                    // 为了安全，先增加，然后检查
                    pendingOutbound[code] += 1;

                    await appendOutboundRowIfNeeded(code);

                    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
                    if (row) {
                        const cell = row.querySelector('[data-role="current-stock"]');
                        const max = cell ? parseInt(cell.textContent, 10) : NaN;

                        // 检查库存上限
                        if (!Number.isNaN(max) && pendingOutbound[code] > max) {
                            pendingOutbound[code] = max;
                            showError('超过当前库存，已回退到最大可用值');
                        }

                        const input = row.querySelector('input[data-role="outbound-qty"]');
                        if (input) input.value = pendingOutbound[code];
                    }

                    flashOutboundRow(code);
                    playBeep();
                    outboundLastCode = code;
                } catch (err) {
                    showError('扫描出库失败: ' + err.message);
                } finally {
                    setTimeout(() => { outboundScanLock = false; }, 200);
                    outboundInput.focus();
                }
            }
        });
    }

    const stockInput = document.getElementById('stock-search-input');
    if (stockInput) {
        stockInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交
                const q = stockInput.value.trim();
                // 立即清空
                stockInput.value = '';

                if (!q) return;
                // 允许重复搜索相同的码（如果用户想重新定位）
                // if (window._stockLastQuery === q) { showInfo('已搜索过该条码或关键词'); return; }
                window._stockLastQuery = q;
                try {
                    // 注意：searchStock 通常会读取 input 的值，我们需要修改它以接受参数
                    // 或者我们临时把值放回去？
                    // 更好的做法是修改 searchStock 函数接受参数，或者在这里临时设置回去
                    // 但由于我们已经清空了，searchStock 如果只读 DOM 就会失败

                    // 让我们先看看 searchStock 的实现
                    // 假设 searchStock 读取 DOM，我们需要传递参数
                    // 如果 searchStock 不支持参数，我们需要重构它

                    // 暂时方案：手动设置 input 值供 searchStock 读取，但在 UI 上看起来是清空的？
                    // 不，这很奇怪。
                    // 正确做法：searchStock 应该支持参数。

                    // 让我们先假设 searchStock 需要重构支持参数
                    // 如果不支持，我们在这里调用它之前，先不清空？
                    // 不，不清空就会有重复输入问题。

                    // 让我们先检查 searchStock 的实现
                    await searchStock(q);
                    stockInput.focus();
                } catch (err) { showError('库存搜索失败: ' + err.message); }
            }
        });
    }

    const stockWarehouse = document.getElementById('stock-warehouse');
    if (stockWarehouse) {
        stockWarehouse.addEventListener('change', () => {
            const q = document.getElementById('stock-search-input').value || '';
            const w = stockWarehouse.value || '';
            loadStockList(q, w);
        });
    }

    const inboundTbody = document.getElementById('inbound-list-body');
    if (inboundTbody) {
        inboundTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target && target.matches('input[data-role="inbound-qty"]'))) return;
            const tr = target.closest('tr');
            const code = tr && tr.getAttribute('data-code');
            if (!code) return;
            let val = parseInt(target.value, 10);
            if (Number.isNaN(val)) val = 1;
            val = Math.max(1, val);
            target.value = String(val);
            pendingInbound[code] = val;
        });
    }

    const outboundTbody = document.getElementById('outbound-list-body');
    if (outboundTbody) {
        outboundTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target && target.matches('input[data-role="outbound-qty"]'))) return;
            const tr = target.closest('tr');
            const code = tr && tr.getAttribute('data-code');
            if (!code) return;
            let val = parseInt(target.value, 10);
            if (Number.isNaN(val)) val = 1;
            val = Math.max(1, val);
            const cell = tr.querySelector('[data-role="current-stock"]');
            const max = cell ? parseInt(cell.textContent, 10) : NaN;
            if (!Number.isNaN(max) && val > max) {
                val = max;
                showError('超过当前库存，已回退到最大可用值');
            }
            target.value = String(val);
            pendingOutbound[code] = val;
        });
    }

    const searchInput = document.getElementById('sku-main-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = searchInput.value.trim();
                if (!q) return;
                if (q === lastSearchQuery) { showInfo('已搜索过该条码或关键词'); return; }
                lastSearchQuery = q;
                loadSKUs(1, q);
                searchInput.value = '';
                searchInput.focus();
            }
        });
    }

    window.handleImgError = async function (img) {
        try {
            const signed = await createSignedUrlFromPublicUrl(img.src, 3600);
            if (signed) {
                img.onerror = null;
                img.src = signed;
                return;
            }
        } catch (_) { }
        img.onerror = null;
        img.src = 'https://via.placeholder.com/300';
    }

    // Bind Global Events
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });

    // Bind Image Input
    const imgInput = document.getElementById('sku-img-input');
    if (imgInput) {
        imgInput.addEventListener('change', handleImageSelect);
    }
});

async function getSKUByBarcodeCached(code) {
    if (window._skuCacheByBarcode[code]) return window._skuCacheByBarcode[code];
    const sku = await fetchSKUByBarcode(code);
    if (sku) window._skuCacheByBarcode[code] = sku;
    return sku;
}

// Expose auth actions
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

// ==========================================
// ==========================================
// Expenses Logic
// ==========================================

// 初始化费用视图
window.initExpensesView = function () {
    // 1. 设置默认日期
    const today = new Date().toISOString().split('T')[0];

    // 快速录入: 默认为今天
    const newExpenseDate = document.getElementById('new-expense-date');
    if (newExpenseDate && !newExpenseDate.value) {
        newExpenseDate.value = today;
    }

    // 筛选: 结束日期默认为今天
    const filterDateTo = document.getElementById('date-to');
    if (filterDateTo && !filterDateTo.value) {
        filterDateTo.value = today;
    }

    // 筛选: 开始日期默认为本月第一天，结束日期默认为今天
    const filterDateFrom = document.getElementById('date-from');
    if (filterDateFrom && !filterDateFrom.value) {
        const monthStart = new Date();
        monthStart.setDate(1);
        filterDateFrom.value = monthStart.toISOString().split('T')[0];
    }

    // 2. 加载费用列表
    loadExpenses();

    // 3. 初始化浮动标签
    initFloatingLabels();
}

// 加载费用列表
// 加载费用列表
window.loadExpenses = async function () {
    const tbody = document.getElementById('expenses-list-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">加载中...</td></tr>';

    try {
        const filters = {
            startDate: document.getElementById('date-from').value,
            endDate: document.getElementById('date-to').value,
            type: document.getElementById('expense-type-filter').value
        };

        const expenses = await fetchExpenses(filters);
        renderExpenses(expenses);
    } catch (err) {
        console.error('加载费用失败:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-error">加载失败</td></tr>';
        showError('加载费用列表失败');
    }
}

// 渲染费用列表
function renderExpenses(expenses) {
    window._expensesCache = expenses;
    const tbody = document.getElementById('expenses-list-body');
    tbody.innerHTML = '';

    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">暂无数据</td></tr>';
        return;
    }

    let totalAmount = 0;

    expenses.forEach((expense, index) => {
        totalAmount += parseFloat(expense.amount || 0);

        const tr = document.createElement('tr');

        // 凭证列: 有图片显示图标, 无图片显示 -
        const receiptCell = expense.picture_id
            ? `<button class="btn-view-image" onclick="showLightbox('${expense.picture_id}')" title="查看凭证" >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
               </button > `
            : `<span class="text-secondary" > -</span > `;

        // 类型名称
        const typeName = getSettingName('expense_type', expense.expense_type_code) || expense.expense_type_code;

        tr.innerHTML = `
    <td> ${index + 1}</td >
            <td>${formatDate(expense.timestamp)}</td>
            <td><span class="expense-type-badge">${typeName}</span></td>
            <td class="text-right font-num">${formatCurrency(expense.amount, expense.currency || 'THB')}</td>
            <td class="text-secondary">${expense.description || '-'}</td>
            <td class="text-center">${receiptCell}</td>
            <td class="text-center">
                <div class="action-icons">
                    <button class="btn-icon-action" onclick="openEditExpenseModal('${expense.id}')" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-action text-error" onclick="deleteExpenseAction('${expense.id}')" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
`;
        tbody.appendChild(tr);
    });

    // 更新统计信息
    document.querySelector('.expenses-list-panel .panel-info').innerHTML =
        `共 <strong>${expenses.length}</strong> 条记录 | 总计: <strong class="text-error">${formatCurrency(totalAmount, 'THB')}</strong>`;
}

window.selectQuickDate = function (period) {
    const today = new Date();
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');

    switch (period) {
        case 'today':
            dateFrom.value = today.toISOString().split('T')[0];
            dateTo.value = today.toISOString().split('T')[0];
            break;
        case 'thisWeek':
            const weekStart = new Date(today.setDate(today.getDate() - today.getDay()));
            dateFrom.value = weekStart.toISOString().split('T')[0];
            dateTo.value = new Date().toISOString().split('T')[0];
            break;
        case 'thisMonth':
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            dateFrom.value = monthStart.toISOString().split('T')[0];
            dateTo.value = new Date().toISOString().split('T')[0];
            break;
        case 'lastMonth':
            const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            dateFrom.value = lastMonthStart.toISOString().split('T')[0];
            dateTo.value = lastMonthEnd.toISOString().split('T')[0];
            break;
    }
    // 触发浮动标签更新
    initFloatingLabels();
    loadExpenses(); // 自动刷新列表
}

window.applyFilters = function () {
    loadExpenses();
}

window.resetFilters = function () {
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = new Date().toISOString().split('T')[0]; // 重置时结束日期也默认为今天
    document.getElementById('expense-type-filter').value = '';
    initFloatingLabels();
    loadExpenses();
}

window.addExpense = async function () {
    const date = document.getElementById('new-expense-date').value;
    const type = document.getElementById('new-expense-type').value;
    const amount = document.getElementById('new-expense-amount').value;
    const currency = document.getElementById('new-expense-currency').value;
    const note = document.getElementById('new-expense-note').value;
    const imageInput = document.getElementById('expense-image-input');

    if (!date || !type || !amount) {
        showError('请填写必填项：日期、类型、金额');
        return;
    }

    try {
        let imageUrl = null;
        if (imageInput.files.length > 0) {
            imageUrl = await uploadImage(imageInput.files[0], 'expenses');
        }

        await createExpense({
            timestamp: date,
            expense_type_code: type,
            amount: parseFloat(amount),
            currency,
            description: note,
            picture_id: imageUrl
        });

        showSuccess('添加费用成功');

        // 清空表单
        document.getElementById('new-expense-amount').value = '';
        document.getElementById('new-expense-note').value = '';
        imageInput.value = '';

        // 刷新列表
        loadExpenses();
    } catch (err) {
        console.error('添加费用失败:', err);
        showError('添加费用失败: ' + err.message);
    }
}

// 打开编辑模态框
window.openEditExpenseModal = async function (id) {
    try {
        // 获取最新数据 (或者从当前列表中查找, 这里简单起见重新获取或从DOM获取? 最好是从缓存或重新获取)
        // 为了简单, 我们假设 fetchExpenses 返回了所有字段.
        // 实际项目中可能需要 fetchExpenseById, 但这里我们先遍历当前列表缓存?
        // 暂时没有全局缓存 expenses, 所以重新 fetch 或者从行数据取不太方便.
        // 让我们添加 fetchExpenseById 或者直接在 render 时把数据绑定到 button?
        // 最稳妥是 fetchExpenseById, 但 supabase-client 没加.
        // 等等, 我不能改 supabase-client 了 (tool limit).
        // 那就用 fetchExpenses 过滤 id? 不, fetchExpenses 是列表查询.
        // 既然我刚刚加了 fetchExpenses, 我可以在 render 时把数据存到 window._expensesCache.

        // 重新实现 renderExpenses 来缓存数据
        // (在 renderExpenses 中添加 window._expensesCache = expenses;)

        if (!window._expensesCache) {
            showError('数据未加载, 请刷新重试');
            return;
        }

        const expense = window._expensesCache.find(e => e.id === id);
        if (!expense) {
            showError('未找到该费用记录');
            return;
        }

        document.getElementById('edit-expense-id').value = expense.id;
        document.getElementById('edit-expense-date').value = expense.date;
        document.getElementById('edit-expense-amount').value = expense.amount;
        document.getElementById('edit-expense-note').value = expense.note || '';

        // 填充类型下拉框 (确保选项已加载)
        const typeSelect = document.getElementById('edit-expense-type');
        // 复制 new-expense-type 的选项
        typeSelect.innerHTML = document.getElementById('new-expense-type').innerHTML;
        typeSelect.value = expense.type;

        // 图片预览
        const previewArea = document.getElementById('edit-expense-image-preview');
        if (expense.image_url) {
            previewArea.innerHTML = `<img src="${expense.image_url}" style="max-height: 100px; border-radius: 4px;" > `;
        } else {
            previewArea.innerHTML = '<span class="text-secondary">无图片</span>';
        }

        window.openModal('edit-expense-modal');
        initFloatingLabels();

    } catch (err) {
        console.error(err);
        showError('打开编辑框失败');
    }
}

// 保存编辑
window.updateExpenseAction = async function () {
    const id = document.getElementById('edit-expense-id').value;
    const date = document.getElementById('edit-expense-date').value;
    const type = document.getElementById('edit-expense-type').value;
    const amount = document.getElementById('edit-expense-amount').value;
    const note = document.getElementById('edit-expense-note').value;
    const imageInput = document.getElementById('edit-expense-image-input');

    if (!date || !type || !amount) {
        showError('请填写必填项');
        return;
    }

    try {
        const updates = {
            date,
            type,
            amount: parseFloat(amount),
            note
        };

        if (imageInput.files.length > 0) {
            updates.image_url = await uploadImage(imageInput.files[0], 'expenses');
        }

        await updateExpense(id, updates);
        showSuccess('更新成功');
        closeModal('edit-expense-modal');
        loadExpenses();
    } catch (err) {
        console.error(err);
        showError('更新失败: ' + err.message);
    }
}

window.deleteExpenseAction = async function (id) {
    const ok = await confirmAction('确定要删除这条费用记录吗?');
    if (!ok) return;

    try {
        await deleteExpense(id);
        showSuccess('删除成功');
        loadExpenses();
    } catch (err) {
        showError('删除失败: ' + err.message);
    }
}

// ==========================================
// System Settings Logic
// ==========================================

// 加载全局配置缓存
window.loadSettings = async function () {
    try {
        const types = ['shop', 'warehouse', 'inbound_type', 'outbound_type', 'expense_type', 'status', 'sales_channel'];
        await Promise.all(types.map(async type => {
            const data = await fetchSettings(type);
            if (!window._settingsCache[type]) window._settingsCache[type] = {};
            // 清空旧缓存以防万一? 或者直接覆盖
            // window._settingsCache[type] = {}; 
            data.forEach(item => {
                window._settingsCache[type][item.code] = item.name;
            });
        }));
        console.log('Settings cache updated');
    } catch (err) {
        console.error('Failed to load settings cache:', err);
    }
}

window.loadSystemSettings = async function () {
    try {
        // 使用现有的 fetchSettings 获取所有配置
        // 注意：fetchSettings 返回的是 { type: { code: name } } 格式
        // 我们需要更详细的信息（如 id, status），所以最好直接查询 settings 表
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching settings:', error);
            throw error;
        }

        // 分组
        const groups = {
            shop: [],
            warehouse: [],
            inbound_type: [],
            outbound_type: [],
            expense_type: [],
            status: [],
            sales_channel: []
        };

        data.forEach(item => {
            // Normalize type: Convert 'Shop' to 'shop', 'InboundType' to 'inbound_type', etc.
            // Simple strategy: convert to snake_case or just map known types
            let typeKey = item.type.toLowerCase();

            // Handle CamelCase to snake_case if needed (e.g. InboundType -> inbound_type)
            if (item.type === 'InboundType') typeKey = 'inbound_type';
            else if (item.type === 'OutboundType') typeKey = 'outbound_type';
            else if (item.type === 'ExpenseType') typeKey = 'expense_type';
            else if (item.type === 'SalesChannel') typeKey = 'sales_channel';
            else if (item.type === 'Status') typeKey = 'status'; // SKU Status

            if (groups[typeKey]) {
                groups[typeKey].push(item);
            }
        });

        // 渲染
        Object.keys(groups).forEach(type => {
            renderSettingList(type, groups[type]);
        });

    } catch (err) {
        console.error('加载系统设置失败:', err);
        showError('加载系统设置失败');
    }
}

function renderSettingList(type, items) {
    const container = document.getElementById(`${type}-list`);
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div class="text-center text-secondary text-sm" style="padding: 20px;">暂无数据</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const isDisabled = item.status === 'disabled';
        return `
            <div class="setting-item">
                <span class="setting-name ${isDisabled ? 'disabled' : ''}">${item.name}</span>
                <div class="setting-actions">
                    <button class="btn-icon-only" title="编辑" onclick="editSetting('${item.id}', '${item.name}')">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-only" title="${isDisabled ? '启用' : '禁用'}" onclick="toggleSettingStatus('${item.id}', '${isDisabled ? 'active' : 'disabled'}')">
                        ${isDisabled
                ? '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
                : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>'}
                    </button>
                </div>
            </div>
            `;
    }).join('');
}

// 切换侧边栏 (移动端)
window.toggleSidebar = function () {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

// 初始化移动端菜单
function initMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleSidebar);
    }

    // 点击菜单项自动关闭侧边栏
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    });
}

// 初始化应用
async function initApp() {
    // This function is intended to be called on page load to initialize various components.
    // For now, it's empty, but can be expanded later.
    console.log('App initialized.');
    initMobileMenu(); // Initialize mobile menu functionality
}

// 确保在页面加载完成后调用 initApp
document.addEventListener('DOMContentLoaded', initApp);

// 辅助函数：获取数据库存储的类型名称 (PascalCase)
function getDBSettingType(type) {
    const typeMap = {
        shop: 'Shop',
        warehouse: 'Warehouse',
        inbound_type: 'InboundType',
        outbound_type: 'OutboundType',
        expense_type: 'ExpenseType',
        status: 'Status',
        sales_channel: 'SalesChannel'
    };
    return typeMap[type] || type.replace(/(^|_)(\w)/g, (_, __, ch) => ch.toUpperCase()).replace(/_/g, '');
}

// window.addSetting has been removed and replaced by openAddSettingModal

window.toggleSettingStatus = async function (id, newStatus) {
    try {
        const { error } = await supabase
            .from('settings')
            .update({ status: newStatus })
            .eq('id', id);

        if (error) throw error;

        showSuccess(newStatus === 'active' ? '已启用' : '已禁用');
        loadSystemSettings();
        loadSettings(); // 更新全局缓存

    } catch (err) {
        showError('操作失败: ' + err.message);
    }
}

let currentEditingSettingId = null;

window.editSetting = function (id, currentName) {
    currentEditingSettingId = id;
    const input = document.getElementById('edit-setting-input');
    if (input) {
        input.value = currentName;
        openModal('edit-setting-modal');
        // Focus input after a short delay to ensure modal is visible
        setTimeout(() => input.focus(), 100);
    }
}

// Bind save button event
// Note: We need to ensure this event is bound only once or handle it appropriately.
// Since this is a module, top-level code runs once.
const saveBtn = document.getElementById('save-setting-btn');
if (saveBtn) {
    saveBtn.onclick = async function () {
        if (!currentEditingSettingId) return;

        const input = document.getElementById('edit-setting-input');
        const newName = input.value.trim();

        if (!newName) {
            showError('名称不能为空');
            return;
        }

        try {
            const { error } = await supabase
                .from('settings')
                .update({ name: newName })
                .eq('id', currentEditingSettingId);

            if (error) throw error;

            showSuccess('更新成功');
            closeModal('edit-setting-modal');
            loadSystemSettings();
            loadSettings(); // Update global cache

        } catch (err) {
            console.error('Update failed:', err);
            showError('更新失败: ' + err.message);
        }
    };
}
