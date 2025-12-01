/**
 * Stock Management Module  
 * 库存管理模块
 */

import {
    fetchSKUs,
    fetchSKUByBarcode,
    fetchStockTotalBySKUs,
    fetchStockBySKUsWarehouse,
    fetchStockBySKUWarehouse,
    fetchAllStock,
    createStockMovement,
    createTransformedUrlFromPublicUrl
} from '../supabase-client.js';
import { showError, showSuccess, showInfo, getSettingName } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 状态变量
// ==========================================

// 库存统计缓存
let stockStatsCache = null;
let stockStatsCacheTime = 0;
const STOCK_STATS_CACHE_DURATION = 30000; // 30秒缓存

// ==========================================
// 库存统计
// ==========================================

/**
 * 更新库存统计信息显示
 */
function updateStockStatistics(skuCount, totalQuantity, mainWarehouse, aftersaleWarehouse) {
    const skuCountEl = document.getElementById('stock-sku-count');
    const totalQuantityEl = document.getElementById('stock-quantity-total');
    const mainWarehouseEl = document.getElementById('stock-main-warehouse');
    const aftersaleWarehouseEl = document.getElementById('stock-aftersale-warehouse');

    if (skuCountEl) skuCountEl.textContent = skuCount;
    if (totalQuantityEl) totalQuantityEl.textContent = totalQuantity;
    if (mainWarehouseEl) mainWarehouseEl.textContent = mainWarehouse;
    if (aftersaleWarehouseEl) aftersaleWarehouseEl.textContent = aftersaleWarehouse;
}

/**
 * 计算库存统计信息 (带缓存)
 */
async function calculateStockStatistics() {
    try {
        const now = Date.now();
        if (stockStatsCache && (now - stockStatsCacheTime) < STOCK_STATS_CACHE_DURATION) {
            logger.debug('[库存统计] 使用缓存数据');
            updateStockStatistics(...stockStatsCache);
            return;
        }

        const allStock = await fetchAllStock();
        const totalQuantity = allStock.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const mainStock = allStock
            .filter(item => item.warehouse_code === 'MAIN')
            .reduce((sum, item) => sum + (item.quantity || 0), 0);
        const aftersaleStock = allStock
            .filter(item => item.warehouse_code === 'AFTERSALE')
            .reduce((sum, item) => sum + (item.quantity || 0), 0);

        stockStatsCache = [window.totalStockCount, totalQuantity, mainStock, aftersaleStock];
        stockStatsCacheTime = now;
        updateStockStatistics(...stockStatsCache);

        logger.debug('[库存统计]', {
            SKU: window.totalStockCount,
            总库存: totalQuantity,
            主仓: mainStock,
            售后仓: aftersaleStock
        });
    } catch (error) {
        logger.error('[库存统计] 计算失败:', error);
        updateStockStatistics(window.totalStockCount, 0, 0, 0);
    }
}

/**
 * 清除库存统计缓存
 */
export function clearStockStatsCache() {
    stockStatsCache = null;
    stockStatsCacheTime = 0;
    logger.debug('[库存统计] 缓存已清除');
}

// ==========================================
// 库存列表
// ==========================================

/**
 * 初始化库存无限滚动观察器
 */
function initStockObserver() {
    if (window.stockObserver) {
        window.stockObserver.disconnect();
    }

    const options = {
        root: null,
        rootMargin: '100px',
        threshold: 0.1
    };

    window.stockObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !window.isLoadingStock) {
                const maxPage = Math.ceil(window.totalStockCount / 20);
                if (window.currentStockPage < maxPage) {
                    const query = document.getElementById('stock-search-input').value;
                    const warehouse = document.getElementById('stock-warehouse').value;
                    window.loadStockList(query, warehouse, window.currentStockPage + 1, false);
                }
            }
        });
    }, options);

    const sentinel = document.getElementById('stock-loading-sentinel');
    if (sentinel) {
        window.stockObserver.observe(sentinel);
    }
}

/**
 * 加载库存列表
 */
export async function loadStockList(query = '', warehouse = '', page = 1, reset = true) {
    const tbody = document.getElementById('stock-list-body');
    const sentinel = document.getElementById('stock-loading-sentinel');
    const loadingText = sentinel ? sentinel.querySelector('.loading-text') : null;
    const noMoreData = sentinel ? sentinel.querySelector('.no-more-data') : null;

    if (!tbody) return;
    if (window.isLoadingStock) return;

    window.isLoadingStock = true;
    if (loadingText) loadingText.style.display = 'inline-block';
    if (noMoreData) noMoreData.style.display = 'none';

    if (reset) {
        window.currentStockPage = 1;
        tbody.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">加载中...</td></tr>';
    }

    try {
        const { data: products, count } = await fetchSKUs(page, 20, query);
        window.totalStockCount = count || 0;
        window.currentStockPage = page;

        const skuCountEl = document.getElementById('stock-sku-count');
        if (skuCountEl) skuCountEl.textContent = window.totalStockCount;

        if (reset) {
            tbody.innerHTML = '';
            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">暂无数据</td></tr>';
                updateStockStatistics(0, 0, 0, 0);
                return;
            }
        }

        // 批量获取库存数据
        const skuIds = products.map(p => p.id);
        let stockTotals = {};
        let warehouseStocks = {};

        try {
            const promises = [fetchStockTotalBySKUs(skuIds)];
            if (warehouse) {
                promises.push(fetchStockBySKUsWarehouse(skuIds, warehouse));
            }
            const results = await Promise.all(promises);
            stockTotals = results[0] || {};
            if (warehouse) {
                warehouseStocks = results[1] || {};
            }
        } catch (e) {
            logger.error('Bulk fetch stock error:', e);
        }

        // 并行获取所有图片URL
        const thumbPromises = products.map(p => {
            if (p.pic) {
                return createTransformedUrlFromPublicUrl(p.pic, 300, 300);
            }
            return Promise.resolve(null);
        });
        const thumbs = await Promise.all(thumbPromises);

        // 构建HTML行
        const rows = [];
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            const original = p.pic || null;
            const thumb = thumbs[i];
            let stockWarehouse = '-';
            let stockTotal = stockTotals[p.id] !== undefined ? stockTotals[p.id] : '-';

            if (warehouse) {
                stockWarehouse = warehouseStocks[p.id] !== undefined ? warehouseStocks[p.id] : 0;
            }

            // 过滤下架状态的SKU
            const statusName = getSettingName('status', p.status_code) || '';
            const statusCode = (p.status_code || '').toLowerCase();
            const statusNameLower = statusName.toLowerCase();

            if (statusNameLower.includes('下架') ||
                statusNameLower.includes('停用') ||
                statusNameLower.includes('禁用') ||
                statusCode === 'inactive' ||
                statusCode === 'down' ||
                statusCode === 'disabled') {
                continue;
            }

            const idx = (page - 1) * 20 + rows.length + 1;
            let warehouseName = '';
            if (warehouse) {
                warehouseName = getSettingName('warehouse', warehouse) || warehouse;
            } else {
                warehouseName = '全部仓库';
            }
            const stockShown = warehouse ? stockWarehouse : stockTotal;
            rows.push(`
                <tr>
                    <td>${idx}</td>
                    <td>
                        <div class="img-thumbnail-small" onclick="event.stopPropagation(); ${original ? `showLightbox('${original}')` : ''}">
                            <div class="image-container">
                                ${thumb ? `
                                    <div class="skeleton-image"></div>
                                    <img src="${thumb}" alt="Product" loading="lazy" onerror="window.handleImgError && window.handleImgError(this)">
                                ` : `
                                    <div class="image-placeholder">📦</div>
                                `}
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
                    <td class="font-num">${(p.safety_stock_30d !== null && p.safety_stock_30d !== undefined) ? p.safety_stock_30d : '-'}</td>
                    <td class="text-center">${p.url ? `<a href="${p.url}" target="_blank" title="打开链接" class="btn-url-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 0 20"></path><path d="M12 2a15.3 15.3 0 0 0 0 20"></path></svg></a>` : ''}</td>
                    <td class="text-center">
                        <div class="action-icons">
                            <button class="btn-icon-action" title="调整" onclick="openAdjustModal('${p.external_barcode || p.code || ''}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `);
        }
        const html = rows.join('');
        if (reset) {
            tbody.innerHTML = html || '<tr><td colspan="8" class="text-center">暂无数据</td></tr>';
        } else {
            tbody.insertAdjacentHTML('beforeend', html);
        }

        const maxPage = Math.ceil(window.totalStockCount / 20);
        if (page >= maxPage && window.totalStockCount > 0) {
            if (noMoreData) noMoreData.style.display = 'block';
            if (window.stockObserver) window.stockObserver.disconnect();
        }

        if (reset && page === 1) {
            calculateStockStatistics();
        }

        if (typeof window.setupImageLoading === 'function') {
            window.setupImageLoading();
        }
    } catch (error) {
        logger.error('loadStockList error:', error);
        if (reset) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-error">加载失败: ' + error.message + '</td></tr>';
        }
    } finally {
        window.isLoadingStock = false;
        if (loadingText) loadingText.style.display = 'none';

        const maxPage = Math.ceil(window.totalStockCount / 20);
        if (page < maxPage) {
            initStockObserver();
        }
    }
}

/**
 * 搜索库存
 */
export function searchStock(queryOverride) {
    try {
        const query = queryOverride !== undefined ? queryOverride : document.getElementById('stock-search-input').value;
        const warehouse = document.getElementById('stock-warehouse').value;
        loadStockList(query, warehouse, 1, true);
    } catch (error) {
        logger.error('搜索失败:', error);
        showError('搜索失败,请重试');
    }
}

// ==========================================
// 库存调整
// ==========================================

/**
 * 打开库存调整模态框
 */
export async function openAdjustModal(sku) {
    window.openModal('adjust-stock-modal');

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

                if (warehouseSelect) {
                    const updateStock = async () => {
                        const selectedWarehouse = warehouseSelect.value;
                        if (selectedWarehouse) {
                            const cur = await fetchStockBySKUWarehouse(s.id, selectedWarehouse);
                            if (currentStockEl) currentStockEl.textContent = (cur === null ? 0 : cur);
                            window._adjustSku = {
                                id: s.id,
                                barcode: s.external_barcode,
                                warehouse: selectedWarehouse,
                                current: (cur === null ? 0 : cur),
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
                    if (warehouseSelect.value) {
                        await updateStock();
                    }
                }
            } else {
                if (skuNameEl) skuNameEl.textContent = '未找到';
            }
        } catch (err) {
            logger.error('加载SKU信息失败:', err);
        }
    })();

    // 绑定确认按钮事件
    const footerBtn = document.getElementById('confirm-adjust-btn');
    if (footerBtn) {
        footerBtn.onclick = async () => {
            try {
                const info = window._adjustSku || {};
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
                    else { showInfo('库存不变'); window.closeModal('adjust-stock-modal'); return; }
                }
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
                window.closeModal('adjust-stock-modal');
                const q = document.getElementById('stock-search-input')?.value || '';
                loadStockList(q, warehouse);
            } catch (err) {
                showError('调整失败: ' + err.message);
            }
        };
    } else {
        logger.error('[ERROR] 找不到确认调整按钮!');
    }
}

// ==========================================
// 全局暴露
// ==========================================

window.loadStockList = loadStockList;
window.searchStock = searchStock;
window.openAdjustModal = openAdjustModal;
window.clearStockStatsCache = clearStockStatsCache;

// 初始化全局状态变量
window.currentStockPage = 1;
window.totalStockCount = 0;
window.isLoadingStock = false;
window.stockObserver = null;
