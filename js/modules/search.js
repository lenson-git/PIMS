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

    // 获取缩略图
    const productsWithThumbs = await Promise.all(products.map(async (p) => {
        let thumb = null;
        if (p.pic) {
            thumb = await createTransformedUrlFromPublicUrl(p.pic, 600, 600);
            if (!thumb) thumb = await createSignedUrlFromPublicUrl(p.pic);
        }
        return { ...p, __thumb: thumb, __original: p.pic };
    }));

    // 渲染产品卡片
    const html = productsWithThumbs.map(p => `
        <div class="product-card-horizontal" onclick="showProductDetail('${p.id}')">
            <div class="product-image-horizontal">
                ${p.__thumb ? `
                    <div class="image-container">
                        <div class="skeleton-image"></div>
                        <img src="${p.__thumb}" alt="Product" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\"image-placeholder\\">📦</div>'">
                    </div>
                ` : `
                    <div class="image-placeholder">📦</div>
                `}
            </div>
            <div class="product-info-horizontal">
                <div class="product-header">
                    <div class="product-barcode">${escapeHtml(p.external_barcode || '-')}</div>
                    <div class="product-status">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${getSettingName('status', p.status_code) || '-'}
                    </div>
                </div>
                <div class="product-name">${escapeHtml((p.product_info || '').split('\\n')[0] || '-')}</div>
                <div class="product-details">
                    ${(p.product_info || '').split('\\n').slice(1, 3).map(line =>
        `<div class="product-detail-line">${escapeHtml(line)}</div>`
    ).join('')}
                </div>
                <div class="product-meta-horizontal">
                    <span class="meta-item">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        库存: <strong id="stock-${p.id}">-</strong>
                    </span>
                    <span class="meta-item">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="1" x2="12" y2="5"></line>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                        </svg>
                        店铺: ${getSettingName('shop', p.shop_code) || '-'}
                    </span>
                </div>
            </div>
        </div>
    `).join('');

    resultsContainer.innerHTML = `
        <div class="search-results-list">
            ${html}
        </div>
    `;

    // 异步加载库存数据
    productsWithThumbs.forEach(async (p) => {
        try {
            const stock = await fetchStockTotalBySKU(p.id);
            const stockEl = document.getElementById(`stock-${p.id}`);
            if (stockEl) {
                stockEl.textContent = stock === null ? '-' : stock;
            }
        } catch (_) { }
    });

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
