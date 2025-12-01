/**
 * Search Module
 * 产品搜索模块
 */

import {
    fetchSKUs,
    fetchSKUById,
    fetchStockTotalBySKU,
    fetchStockBySKUWarehouse,
    fetchSales30dBySKU,
    fetchSafetyStock,
    createTransformedUrlFromPublicUrl,
    createSignedUrlFromPublicUrl
} from '../supabase-client.js';
import { showError, showSuccess, showInfo, escapeHtml, getSettingName } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 搜索功能
// ==========================================

/**
 * 执行搜索
 */
export async function performSearch() {
    const input = document.getElementById('search-input');
    const query = input?.value?.trim();

    if (!query) {
        showInfo('请输入搜索关键词');
        return;
    }

    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    // 显示加载状态
    resultsContainer.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>搜索中...</p>
        </div>
    `;

    try {
        const { data: products, count } = await fetchSKUs(1, 20, query);

        if (!products || products.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" stroke-width="1.5" fill="none">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p>未找到相关产品</p>
                    <p class="text-secondary">请尝试其他关键词</p>
                </div>
            `;
            return;
        }

        await renderSearchResults(products);

    } catch (error) {
        logger.error('搜索失败:', error);
        showError('搜索失败: ' + error.message);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" stroke-width="1.5" fill="none">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <p>搜索失败</p>
                <p class="text-secondary">${escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

/**
 * 渲染搜索结果
 */
async function renderSearchResults(products) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    // 并发获取所有产品的详细信息
    const productsWithDetails = await Promise.all(products.map(async (p) => {
        // 获取500x500缩略图
        let thumb = null;
        if (p.pic) {
            thumb = await createTransformedUrlFromPublicUrl(p.pic, 200, 200);
            if (!thumb) thumb = await createSignedUrlFromPublicUrl(p.pic);
        }

        // 并发获取详细数据
        const [stockTotal, mainStock, aftersaleStock, sales30d, safetyStockData] = await Promise.all([
            fetchStockTotalBySKU(p.id),
            fetchStockBySKUWarehouse(p.id, 'MAIN'),
            fetchStockBySKUWarehouse(p.id, 'AFTERSALE'),
            fetchSales30dBySKU(p.id),
            fetchSafetyStock()
        ]);

        // 查找安全库存
        const safetyStock = safetyStockData?.find(s => s.sku_id === p.id)?.safety_stock_30d || null;

        return {
            ...p,
            __thumb: thumb,
            __original: p.pic,
            __stockTotal: stockTotal,
            __mainStock: mainStock,
            __aftersaleStock: aftersaleStock,
            __sales30d: sales30d,
            __safetyStock: safetyStock
        };
    }));

    // 渲染产品卡片,直接显示所有信息
    const html = productsWithDetails.map(p => {
        const mapName = (t, c) => (window._settingsCache[t] && window._settingsCache[t][c]) ? window._settingsCache[t][c] : c;

        return `<div class="product-card-detailed">
            <div class="product-image-large"${p.__original ? ` onclick="showLightbox('${p.__original}')" style="cursor:zoom-in;"` : ''}>
                ${p.__thumb ? `<img src="${p.__thumb}" alt="Product" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 font-size=%2232%22%3E📦%3C/text%3E%3C/svg%3E'">` : `<div class="image-placeholder">📦</div>`}
            </div>
            <div class="product-info-detailed">
                <div class="product-header">
                    <div class="product-barcode">
                        ${escapeHtml(p.external_barcode || '-')}
                        ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener" class="barcode-url-icon" title="打开链接">🔗</a>` : ''}
                    </div>
                    <div class="product-status">${mapName('status', p.status_code) || '-'}</div>
                </div>
                <div class="product-name">${escapeHtml((p.product_info || '').split('\\n')[0] || '-')}</div>
                <div class="product-details">${(p.product_info || '').split('\\n').slice(1).filter(Boolean).map(line => `<div class="product-detail-line">${escapeHtml(line)}</div>`).join('')}</div>
                
                <div class="data-grid-compact">
                    <div class="data-item">
                        <span class="info-label">采购价</span>
                        <span class="info-value">${p.purchase_price_rmb ? `¥${p.purchase_price_rmb}` : '-'}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">销售价</span>
                        <span class="info-value">${p.selling_price_thb ? `฿${p.selling_price_thb}` : '-'}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">30天销量</span>
                        <span class="info-value highlight">${p.__sales30d === null ? '-' : p.__sales30d}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">总库存</span>
                        <span class="info-value highlight">${p.__stockTotal === null ? '-' : p.__stockTotal}</span>
                    </div>
                    
                    <div class="data-item">
                        <span class="info-label">主仓</span>
                        <span class="info-value">${p.__mainStock === null ? '-' : p.__mainStock}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">售后仓</span>
                        <span class="info-value">${p.__aftersaleStock === null ? '-' : p.__aftersaleStock}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">安全库存</span>
                        <span class="info-value">${p.__safetyStock === null ? '-' : p.__safetyStock}</span>
                    </div>
                    <div class="data-item">
                        <span class="info-label">店铺</span>
                        <span class="info-value">${mapName('shop', p.shop_code) || '-'}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    resultsContainer.innerHTML = `
        <div class="search-results-list">
            ${html}
        </div>
    `;

    // 设置图片加载监听
    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }
}

/**
 * 显示产品详情(增强版)
 */
export async function showProductDetail(skuId) {
    try {
        // 显示加载状态
        const modal = document.getElementById('sku-detail-modal');
        const body = document.getElementById('sku-detail-body');
        if (!modal || !body) return;

        body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 400px;">
                <div class="loading-spinner"></div>
            </div>
        `;
        window.openModal('sku-detail-modal');

        // 并发获取所有数据
        const [sku, stockTotal, mainStock, aftersaleStock, sales30d, safetyStockData] = await Promise.all([
            fetchSKUById(skuId),
            fetchStockTotalBySKU(skuId),
            fetchStockBySKUWarehouse(skuId, 'MAIN'),
            fetchStockBySKUWarehouse(skuId, 'AFTERSALE'),
            fetchSales30dBySKU(skuId),
            fetchSafetyStock()
        ]);

        if (!sku) {
            showError('未找到该产品');
            window.closeModal('sku-detail-modal');
            return;
        }

        // 查找安全库存
        const safetyStock = safetyStockData?.find(s => s.sku_id === skuId)?.safety_stock_30d || null;

        // 构建详情HTML
        const mapName = (t, c) => (window._settingsCache[t] && window._settingsCache[t][c]) ? window._settingsCache[t][c] : c;

        // 处理图片
        let displayImg = sku.pic || 'https://via.placeholder.com/600';
        if (sku.pic) {
            const signed = await createSignedUrlFromPublicUrl(sku.pic);
            if (signed) displayImg = signed;
        }

        const left = `
            <div class="sku-detail-image" onclick="event.stopPropagation(); ${sku.pic ? `showLightbox('${sku.pic}')` : ''}">
                <img src="${displayImg}" alt="商品图片" onerror="this.src='https://via.placeholder.com/600'">
            </div>
        `;

        const rows = [];
        const pushRow = (label, value) => {
            rows.push(`<div class="sku-detail-row"><div class="sku-detail-key">${label}</div><div class="sku-detail-val">${value ?? '-'}</div></div>`);
        };

        // 基本信息
        pushRow('产品条码', escapeHtml(sku.external_barcode || '-'));
        if (sku.product_info) {
            pushRow('产品信息', (sku.product_info || '').split('\\n').map(l => `<div>${escapeHtml(l)}</div>`).join(''));
        }

        // 产品链接
        if (sku.url) {
            const domain = sku.url.replace(/^https?:\/\/([^\/]+).*$/, '$1');
            pushRow('产品链接', `<a class="icon-link" href="${sku.url}" target="_blank" rel="noopener">
                <svg class="icon-web-animated" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 0 20"></path>
                    <path d="M12 2a15.3 15.3 0 0 0 0 20"></path>
                </svg>
                <span class="link-domain">${domain}</span>
            </a>`);
        }

        // 价格信息
        pushRow('采购价 (RMB)', sku.purchase_price_rmb ? `¥ ${sku.purchase_price_rmb}` : '-');
        pushRow('销售价 (THB)', sku.selling_price_thb ? `฿ ${sku.selling_price_thb}` : '-');

        // 库存信息
        rows.push(`<div class="sku-detail-section-title">库存信息</div>`);
        pushRow('总库存', stockTotal === null ? '-' : stockTotal);
        pushRow('主仓库存', mainStock === null ? '-' : mainStock);
        pushRow('售后仓库存', aftersaleStock === null ? '-' : aftersaleStock);
        pushRow('安全库存 (30天)', safetyStock === null ? '-' : safetyStock);

        // 销售数据
        rows.push(`<div class="sku-detail-section-title">销售数据</div>`);
        pushRow('30天销售量', sales30d === null ? '-' : sales30d);

        // 其他信息
        rows.push(`<div class="sku-detail-section-title">其他信息</div>`);
        pushRow('状态', mapName('status', sku.status_code) || '-');
        pushRow('店铺', mapName('shop', sku.shop_code) || '-');
        if (sku.created_at) {
            const fmtDate = (d) => {
                try { return new Date(d).toLocaleString('zh-CN'); } catch (_) { return d || ''; }
            };
            pushRow('创建时间', fmtDate(sku.created_at));
        }

        const right = `<div class="sku-detail-fields">${rows.join('')}</div>`;
        body.innerHTML = `<div class="sku-detail-grid">${left}${right}</div>`;

    } catch (err) {
        logger.error('加载产品详情失败:', err);
        showError('加载产品详情失败: ' + err.message);
        window.closeModal('sku-detail-modal');
    }
}

/**
 * 处理搜索框回车事件
 */
function initSearchInput() {
    const input = document.getElementById('search-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }
}

// ==========================================
// 全局暴露
// ==========================================

window.performSearch = performSearch;
window.showProductDetail = showProductDetail;

// 初始化
setTimeout(() => {
    initSearchInput();
}, 100);
