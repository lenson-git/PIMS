/**
 * SKU Management Module
 * SKU 管理模块
 */

import {
    fetchSKUs,
    createSKU,
    updateSKU,
    uploadImage,
    fetchSKUById,
    fetchSKUByBarcode,
    fetchStockTotalBySKU,
    fetchSales30dBySKU,
    createSignedUrlFromPublicUrl,
    createTransformedUrlFromPublicUrl
} from '../supabase-client.js';
import { showError, showSuccess, showInfo, escapeHtml, getSettingName } from '../utils.js';
import { logger } from '../logger.js';
import { checkAuth, loginWithGoogle } from '../auth.js';
import { FIELD_LABELS } from '../config.js';

// ==========================================
// 状态变量
// ==========================================

let currentImageBase64 = null;
let currentSKUId = null;
let currentImageFile = null;
let currentImageUrl = null;
let lastSearchQuery = '';

// ==========================================
// 图片处理
// ==========================================

/**
 * 处理图片选择
 */
async function handleImageSelect(e) {
    console.log('[DEBUG] handleImageSelect triggered');
    const file = e.target.files[0];
    if (!file) {
        console.log('[DEBUG] No file selected');
        return;
    }
    console.log('[DEBUG] File selected:', file.name);

    currentImageFile = file;

    // 显示加载状态
    const area = document.getElementById('sku-upload-area');
    // 保持高度防止抖动
    const height = area.offsetHeight;
    area.style.height = height + 'px';

    area.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #6b7280;">
            <div class="loading-spinner"></div>
            <div style="margin-top: 12px; font-size: 14px;">正在上传...</div>
        </div>
    `;

    try {
        // 1. 生成文件名
        const filename = `sku-${Date.now()}-${file.name}`;

        // 2. 上传图片
        const imageUrl = await uploadImage(file, filename);
        currentImageUrl = imageUrl;
        currentImageBase64 = imageUrl; // 预览直接用 URL

        // 3. 显示成功状态和图片
        area.innerHTML = `
            <div class="img-preview-wrapper" style="position: relative; width: 100%; height: 100%; opacity: 0; transition: opacity 0.3s;">
                <img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: contain;" />
                
                <!-- 成功标记 -->
                <div class="upload-success-overlay" style="position: absolute; inset: 0; background: rgba(255,255,255,0.8); display: flex; align-items: center; justify-content: center; z-index: 10;">
                    <div style="text-align: center;">
                        <div class="success-checkmark-anim" style="width: 48px; height: 48px; margin: 0 auto 8px; border-radius: 50%; background: #10b981; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.3);">
                            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                        <div style="color: #059669; font-weight: 600; font-size: 14px;">上传成功</div>
                    </div>
                </div>

                <button type="button" onclick="clearImageSelection()" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; z-index: 20;">&times;</button>
            </div>`;

        // 4. 动画展示
        requestAnimationFrame(() => {
            const wrapper = area.querySelector('.img-preview-wrapper');
            if (wrapper) wrapper.style.opacity = '1';

            // 1.5秒后淡出成功遮罩
            setTimeout(() => {
                const overlay = area.querySelector('.upload-success-overlay');
                if (overlay) {
                    overlay.style.transition = 'opacity 0.5s';
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 500);
                }
            }, 1500);
        });

    } catch (error) {
        console.error('上传失败:', error);
        showError('图片上传失败，请重试');
        clearImageSelection();
    } finally {
        area.style.height = ''; // 恢复高度自适应
    }
}

/**
 * 清除图片选择
 */
export function clearImageSelection() {
    currentImageFile = null;
    currentImageBase64 = null;
    currentImageUrl = null;
    const area = document.getElementById('sku-upload-area');
    if (area) {
        area.innerHTML = `
            <input type="file" id="sku-img-input" accept="image/*" hidden>
            <label for="sku-img-input" class="upload-label">
                <svg viewBox="0 0 24 24" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span>点击选择图片</span>
                <span class="text-sm text-secondary">选择后将自动上传并重命名</span>
            </label>`;
        const input = document.getElementById('sku-img-input');
        if (input) input.addEventListener('change', handleImageSelect);
    }
}

// ==========================================
// 表单操作
// ==========================================

/**
 * 重置表单
 */
export function resetForm() {
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
            </label>`;
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

/**
 * 处理创建 SKU
 */
export function handleCreate(barcode) {
    resetForm();
    window._inboundCreateBarcode = barcode || '';
    window.openModal('sku-modal');
    const input = document.getElementById('modal-barcode-input');
    if (input && barcode) {
        input.value = barcode;
        if (input.parentElement) input.parentElement.classList.add('active');
    }
}

/**
 * 保存 SKU
 */
export async function saveSKU() {
    const form = document.getElementById('sku-form');
    const formData = new FormData(form);

    const barcode = (formData.get('barcode') || '').trim();
    if (!barcode) {
        showError('请输入 SKU / 条码');
        const input = document.getElementById('modal-barcode-input');
        if (input && typeof window.shakeElement === 'function') {
            window.shakeElement(input.parentElement || input);
        }
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
            const input = document.getElementById('modal-barcode-input');
            if (input && typeof window.shakeElement === 'function') {
                window.shakeElement(input.parentElement || input);
            }
            return;
        }
        if (currentSKUId && existing && String(existing.id) !== String(currentSKUId)) {
            showError('该条码已被其他 SKU 使用');
            const input = document.getElementById('modal-barcode-input');
            if (input && typeof window.shakeElement === 'function') {
                window.shakeElement(input.parentElement || input);
            }
            return;
        }
        // 图片已经自动上传，直接使用 currentImageUrl
        let imageUrl = currentImageUrl;

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

        // 高亮新增/修改的行
        setTimeout(() => {
            const row = document.querySelector(`.sku-row[data-sku-id="${savedSKU.id}"]`);
            if (row && typeof window.highlightRow === 'function') {
                window.highlightRow(row);
            }
        }, 300);

        if (savedSKU && savedSKU.external_barcode) {
            window._skuCacheByBarcode[savedSKU.external_barcode] = savedSKU;
        }

        // 处理入库创建后的逻辑
        try {
            if (window._inboundCreateBarcode) {
                const code = window._inboundCreateBarcode;
                const sku = await window.getSKUByBarcodeCached(code);
                if (sku) {
                    const pending = window.getPendingInbound();
                    pending[code] = (pending[code] || 0) + 1;
                    window.setPendingInbound(pending);
                    await window.renderInboundList();
                    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                    if (row) {
                        const input = row.querySelector('input[data-role="inbound-qty"]');
                        if (input) input.value = pending[code];
                    }
                    window.flashRow(code);
                    window.playBeep();
                    window._inboundCreateBarcode = '';
                    const inboundInputEl = document.getElementById('inbound-sku-input');
                    if (inboundInputEl) {
                        inboundInputEl.value = '';
                        inboundInputEl.focus();
                    }
                }
            }
        } catch (_) { }

    } catch (error) {
        logger.error(error);
        showError('保存失败: ' + (error && error.message ? error.message : error));
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * 编辑 SKU
 */
export async function editSKU(id) {
    try {
        const sku = await fetchSKUById(id);
        if (!sku) { showError('未找到该 SKU'); return; }
        currentSKUId = id;
        currentImageBase64 = null;
        currentImageFile = null;
        currentImageUrl = sku.pic || null;

        await window.loadSelectOptions('shop_code', 'shop', sku.shop_code);
        await window.loadSelectOptions('status_code', 'status', sku.status_code);

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
                try {
                    const signed = await createSignedUrlFromPublicUrl(currentImageUrl);
                    if (signed) displayUrl = signed;
                } catch (_) { }

                area.innerHTML = `
                    <div class="img-preview-wrapper" style="position: relative; width: 100%; height: 100%;">
                        <img src="${displayUrl}" style="width: 100%; height: 100%; object-fit: contain;" />
                        <button type="button" onclick="clearImageSelection()" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">&times;</button>
                    </div>`;
            } else {
                area.innerHTML = `
                    <input type="file" id="sku-img-input" accept="image/*" hidden>
                    <label for="sku-img-input" class="upload-label">
                        <svg viewBox="0 0 24 24" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        <span>点击选择图片</span>
                        <span class="text-sm text-secondary">选择后将自动上传并重命名</span>
                    </label>`;
                document.getElementById('sku-img-input').addEventListener('change', handleImageSelect);
            }
        }

        window.openModal('sku-modal');
    } catch (err) {
        showError('加载编辑信息失败: ' + err.message);
    }
}

/**
 * 删除 SKU
 */
export async function deleteSKUConfirm(id) {
    try {
        const ok = window.confirm('确认删除该 SKU 吗？此操作不可恢复');
        if (!ok) return;

        // 找到对应的行并添加删除动画
        const row = document.querySelector(`.sku-row[data-sku-id="${id}"]`);

        const sku = await fetchSKUById(id);
        const code = sku && sku.external_barcode;
        await updateSKU(id, { status_code: 'down' });
        if (code && window._skuCacheByBarcode && window._skuCacheByBarcode[code]) {
            delete window._skuCacheByBarcode[code];
        }

        // 使用删除动画
        if (row && typeof window.removeRow === 'function') {
            window.removeRow(row, () => {
                showSuccess('删除成功');
                loadSKUs();
            });
        } else {
            showSuccess('删除成功');
            loadSKUs();
        }
    } catch (err) {
        showError('删除失败: ' + err.message);
    }
}

// ==========================================
// SKU 列表
// ==========================================

/**
 * 初始化无限滚动观察器
 */
function initSKUObserver() {
    console.log('[DEBUG] initSKUObserver called');
    if (window.skuObserver) {
        window.skuObserver.disconnect();
    }

    const options = {
        root: null,
        rootMargin: '100px',
        threshold: 0.1
    };

    window.skuObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            console.log('[DEBUG] Observer entry:', entry.isIntersecting, window.isLoadingSKUs);
            if (entry.isIntersecting && !window.isLoadingSKUs) {
                const maxPage = Math.ceil(window.totalSKUCount / 20);
                console.log('[DEBUG] Loading next page:', window.currentSKUPage + 1, 'Max:', maxPage);
                if (window.currentSKUPage < maxPage) {
                    window.loadSKUs(window.currentSKUPage + 1, document.getElementById('sku-main-input').value, false);
                }
            }
        });
    }, options);

    const sentinel = document.getElementById('sku-loading-sentinel');
    if (sentinel) {
        console.log('[DEBUG] Sentinel found, observing');
        window.skuObserver.observe(sentinel);
    } else {
        logger.error('[DEBUG] Sentinel NOT found');
    }
}

/**
 * 加载 SKU 列表
 */
export async function loadSKUs(page = 1, search = '', reset = true) {
    const tbody = document.querySelector('.sku-table-compact tbody');
    const sentinel = document.getElementById('sku-loading-sentinel');
    const loadingText = sentinel ? sentinel.querySelector('.loading-text') : null;
    const noMoreData = sentinel ? sentinel.querySelector('.no-more-data') : null;

    if (!tbody) return;
    if (window.isLoadingSKUs) return;

    window.isLoadingSKUs = true;
    if (loadingText) loadingText.style.display = 'inline-block';
    if (noMoreData) noMoreData.style.display = 'none';

    if (reset) {
        window.currentSKUPage = 1;
        tbody.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">加载中...</td></tr>';
    }

    try {
        const { data: products, count } = await fetchSKUs(page, 20, search);
        window.totalSKUCount = count || 0;
        window.currentSKUPage = page;

        if (reset) {
            tbody.innerHTML = '';
            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">暂无数据</td></tr>';
            }
        }

        const withThumbs = await Promise.all(products.map(async (p, index) => {
            const original = p.pic || null;
            let thumb = null;
            if (p.pic) {
                thumb = await createTransformedUrlFromPublicUrl(p.pic, 300, 300);
                if (!thumb) thumb = await createSignedUrlFromPublicUrl(p.pic);
            }
            const seqId = (page - 1) * 20 + index + 1;
            return { ...p, __thumb: thumb, __original: original, __seqId: seqId };
        }));

        renderSKUTable(withThumbs, !reset);

        const maxPage = Math.ceil(window.totalSKUCount / 20);
        console.log('[DEBUG] Page loaded:', page, 'Total:', window.totalSKUCount, 'MaxPage:', maxPage);

        if (page >= maxPage && window.totalSKUCount > 0) {
            if (noMoreData) noMoreData.style.display = 'block';
            if (window.skuObserver) window.skuObserver.disconnect();
        }

    } catch (error) {
        logger.error('loadSKUs error:', error);
        if (reset) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-error">加载失败: ' + error.message + '</td></tr>';
        }
    } finally {
        window.isLoadingSKUs = false;
        if (loadingText) loadingText.style.display = 'none';

        const maxPage = Math.ceil(window.totalSKUCount / 20);
        if (page < maxPage) {
            initSKUObserver();
        }
    }
}

/**
 * 渲染 SKU 表格
 */
function renderSKUTable(products, append = false) {
    const tbody = document.querySelector('.sku-table-compact tbody');
    if (!products || products.length === 0) {
        if (!append) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">暂无数据</td></tr>';
        }
        return;
    }

    const html = products.map(p => `
        <tr class="sku-row" data-sku-id="${p.id}">
            <td>${p.__seqId}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); ${p.__original ? `showLightbox('${p.__original}')` : ''}">
                    <div class="image-container" data-img-id="${p.id}">
                        ${p.__thumb ? `
                            <div class="skeleton-image"></div>
                            <img src="${p.__thumb}" alt="Product" loading="lazy" onerror="window.handleImgError && window.handleImgError(this)">
                        ` : `
                            <div class="image-placeholder">📦</div>
                        `}
                    </div>
                </div>
            </td>
            <td class="font-mono">${escapeHtml(p.external_barcode) || '-'}</td>
            <td>
                <div class="product-info-compact">
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
        </tr>
    `).join('');

    if (append) {
        tbody.insertAdjacentHTML('beforeend', html);
    } else {
        tbody.innerHTML = html;
    }

    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }
}

/**
 * 处理搜索
 */
export function handleSearch() {
    const query = document.getElementById('sku-main-input').value;
    loadSKUs(1, query);
}

// ==========================================
// 图片加载优化
// ==========================================

/**
 * 设置图片加载监听
 */
export function setupImageLoading() {
    const containers = document.querySelectorAll('.image-container');
    containers.forEach(container => {
        const img = container.querySelector('img');
        if (!img) return;

        if (img.complete) {
            handleImageLoad(container, img);
        } else {
            img.addEventListener('load', () => handleImageLoad(container, img), { once: true });
            img.addEventListener('error', () => handleImageError(container, img), { once: true });
        }
    });
}

/**
 * 处理图片加载完成
 */
function handleImageLoad(container, img) {
    img.classList.add('image-loaded');
    container.classList.add('loaded');
}

/**
 * 处理图片加载失败
 */
function handleImageError(container, img) {
    container.classList.add('loaded');
    container.innerHTML = '<div class="image-placeholder">📦</div>';
}

// ==========================================
// SKU 详情
// ==========================================

/**
 * 显示 SKU 详情
 */
export async function showSKUDetails(skuId) {
    try {
        const sku = await fetchSKUById(skuId);
        if (!sku) { showError('未找到该 SKU'); return; }
        const mapName = (t, c) => (window._settingsCache[t] && window._settingsCache[t][c]) ? window._settingsCache[t][c] : c;
        const labels = FIELD_LABELS && FIELD_LABELS.skus ? FIELD_LABELS.skus : {};
        const img = sku.pic || 'https://via.placeholder.com/300';
        const left = `<div class="sku-detail-image"><img src="${img}" alt="商品图片" onerror="window.handleImgError && window.handleImgError(this)"></div>`;
        const rows = [];

        const fmtDate = (d) => {
            try { return new Date(d).toLocaleString('zh-CN'); } catch (_) { return d || ''; }
        };

        const pushRow = (label, value) => {
            rows.push(`<div class="sku-detail-row"><div class="sku-detail-key">${label}</div><div class="sku-detail-val">${value ?? ''}</div></div>`);
        };

        if (sku.created_at) pushRow(labels.created_at || '创建时间', fmtDate(sku.created_at));
        if (sku.external_barcode) pushRow(labels.external_barcode || '产品条码', escapeHtml(sku.external_barcode));
        if (sku.product_info) pushRow(labels.product_info || '产品信息', (sku.product_info || '').split('\n').map(l => `<div>${escapeHtml(l)}</div>`).join(''));
        pushRow('产品链接', sku.url ? `<a class="icon-link" href="${sku.url}" target="_blank" rel="noopener" title="${sku.url}">
            <svg class="icon-web-animated" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 0 20"></path>
                <path d="M12 2a15.3 15.3 0 0 0 0 20"></path>
            </svg>
            <span class="link-domain">${getDomain(sku.url)}</span>
        </a>` : '');
        pushRow(labels.purchase_price_rmb || '采购价(RMB)', sku.purchase_price_rmb);
        pushRow(labels.selling_price_thb || '销售价(THB)', sku.selling_price_thb);
        if (sku.shop_code) pushRow('店铺', mapName('shop', sku.shop_code) || '');

        const stockTotal = await fetchStockTotalBySKU(sku.id);
        const sales30d = await fetchSales30dBySKU(sku.id);
        pushRow('库存数量', stockTotal === null ? '-' : stockTotal);
        pushRow('最近30天销售量', sales30d === null ? '-' : sales30d);
        const right = `<div class="sku-detail-fields">${rows.join('')}</div>`;
        const body = document.getElementById('sku-detail-body');
        if (body) body.innerHTML = `<div class="sku-detail-grid">${left}${right}</div>`;
        window.openModal('sku-detail-modal');
    } catch (err) {
        showError('加载 SKU 详情失败: ' + err.message);
    }
}

function getDomain(u) {
    try { return new URL(u).hostname; } catch (_) { return u; }
}

// ==========================================
// 全局暴露
// ==========================================

window.loadSKUs = loadSKUs;
window.saveSKU = saveSKU;
window.editSKU = editSKU;
window.deleteSKUConfirm = deleteSKUConfirm;
window.showSKUDetails = showSKUDetails;
window.handleSearch = handleSearch;
window.handleCreate = handleCreate;
window.resetForm = resetForm;
window.clearImageSelection = clearImageSelection;
window.setupImageLoading = setupImageLoading;

// 初始化全局状态变量
window.currentSKUPage = 1;
window.totalSKUCount = 0;
window.isLoadingSKUs = false;
window.skuObserver = null;

// 初始化图片加载
window.setupImageLoading();
