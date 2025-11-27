/**
 * Outbound Management Module
 * 出库管理模块
 */

import {
    createStockMovement,
    fetchStockTotalBySKU,
    createSignedUrlFromPublicUrl,
    createTransformedUrlFromPublicUrl
} from '../supabase-client.js';
import { showError, showSuccess, showInfo, escapeHtml, getSettingName } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 状态变量
// ==========================================

let pendingOutbound = {};

// ==========================================
// 列表渲染
// ==========================================

/**
 * 渲染出库列表
 */
export async function renderOutboundList() {
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
        const sku = await window.getSKUByBarcodeCached(code);
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
            <tr data-code="${code}" data-sku-id="${(sku && sku.id) || ''}">
                <td>${idx + 1}</td>
                <td>
                    <div class="img-thumbnail-small" onclick="event.stopPropagation(); ${original ? `showLightbox('${original}')` : ''}">
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
            </tr>
        `;
    }));
    tbody.innerHTML = rows.join('');
    if (empty) empty.style.display = 'none';
    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }

    // 异步更新每行的当前库存
    codes.forEach(async (code) => {
        const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
        const skuId = row && row.getAttribute('data-sku-id');
        if (!row || !skuId) return;
        try {
            const total = await fetchStockTotalBySKU(skuId);
            const cell = row.querySelector('[data-role="current-stock"]');
            if (cell) cell.textContent = (total === null ? '-' : total);
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

/**
 * 添加出库行（如果需要）
 */
export async function appendOutboundRowIfNeeded(code) {
    const tbody = document.getElementById('outbound-list-body');
    const empty = document.getElementById('outbound-empty-state');
    if (!tbody) return;
    if (document.querySelector(`#outbound-list-body tr[data-code="${code}"]`)) return;
    const sku = await window.getSKUByBarcodeCached(code);
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
        <tr data-code="${code}" data-sku-id="${(sku && sku.id) || ''}">
            <td>${idx}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); ${original ? `showLightbox('${original}')` : ''}">
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
        </tr>
    `;
    const temp = document.createElement('tbody');
    temp.innerHTML = rowHtml.trim();
    const tr = temp.firstElementChild;
    tbody.appendChild(tr);
    if (empty) empty.style.display = 'none';

    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }

    // 异步填充当前库存
    if (sku && sku.id) {
        try {
            const total = await fetchStockTotalBySKU(sku.id);
            const cell = tr.querySelector('[data-role="current-stock"]');
            if (cell) cell.textContent = (total === null ? '-' : total);
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

/**
 * 闪烁出库行
 */
function flashOutboundRow(code) {
    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
    if (!row) return;
    row.classList.remove('row-flash');
    void row.offsetWidth;
    row.classList.add('row-flash');
}

// ==========================================
// 数量调整
// ==========================================

/**
 * 通用数量调整函数
 */
function updateQuantity(type, code, delta) {
    const config = {
        outbound: {
            data: pendingOutbound,
            listBody: 'outbound-list-body',
            inputRole: 'outbound-qty',
            checkStock: true
        }
    };

    const cfg = config[type];
    if (!cfg) return;

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

    next = Math.max(1, next);
    cfg.data[code] = next;

    const row = document.querySelector(`#${cfg.listBody} tr[data-code="${code}"]`);
    if (row) {
        const input = row.querySelector(`input[data-role="${cfg.inputRole}"]`);
        if (input) input.value = next;
    }
}

/**
 * 增加出库数量
 */
export function increaseOutboundQty(code) {
    updateQuantity('outbound', code, 1);
}

/**
 * 减少出库数量
 */
export function decreaseOutboundQty(code) {
    updateQuantity('outbound', code, -1);
}

/**
 * 移除出库项
 */
export function removeOutboundItem(code) {
    if (pendingOutbound[code] !== null) delete pendingOutbound[code];
    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
    if (row) row.remove();
    const empty = document.getElementById('outbound-empty-state');
    if (empty && Object.keys(pendingOutbound).length === 0) empty.style.display = '';
}

// ==========================================
// 提交出库
// ==========================================

/**
 * 提交出库
 */
export async function submitOutbound() {
    const barcode = document.getElementById('outbound-sku-input')?.value?.trim();
    const warehouse = document.getElementById('outbound-warehouse')?.value;
    const type = document.getElementById('outbound-type')?.value;
    if ((!barcode && Object.keys(pendingOutbound).length === 0) || !warehouse || !type) {
        showError('请填写必填项：SKU、出库仓库、出库类型');
        return;
    }

    if (!window.validateMovement(warehouse, type, 'outbound')) {
        showError('该仓库不允许此出库类型');
        return;
    }

    try {
        let count = 0;
        if (Object.keys(pendingOutbound).length > 0) {
            const ok = await window.confirmAction(`确认出库：共 ${Object.values(pendingOutbound).reduce((a, b) => a + b, 0)} 件`)
            if (!ok) { showInfo('已取消'); return; }
            for (const code of Object.keys(pendingOutbound)) {
                const qty = pendingOutbound[code];
                const sku = await window.getSKUByBarcodeCached(code);
                if (!sku) { showError(`未找到条码 ${code} 的 SKU`); continue; }
                const price = window.getUnitPriceForMovement(sku, type);
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
            const sku = await window.getSKUByBarcodeCached(barcode);
            if (!sku) { showError('未找到该条码的 SKU'); return; }
            const price = window.getUnitPriceForMovement(sku, type);
            const payload = {
                sku_id: sku.id,
                warehouse_code: warehouse,
                movement_type_code: type,
                quantity: 1,
                unit_price_rmb: price.unit_price_rmb,
                unit_price_thb: price.unit_price_thb,
                sales_channel: document.getElementById('outbound-channel')?.value
            };
            const ok = await window.confirmAction(`确认出库：SKU ${sku.external_barcode}，仓库 ${getSettingName('warehouse', warehouse)}，类型 ${getSettingName('outbound_type', type)}，数量 1`)
            if (!ok) { showInfo('已取消'); return; }
            await createStockMovement(payload);
            count = 1;
        }
        showSuccess('出库成功');
        resetOutboundView();
    } catch (error) {
        logger.error(error);
        showError('出库失败: ' + error.message);
    }
}

/**
 * 触发订单上传
 */
export function triggerOrderUpload() {
    document.getElementById('order-upload-input').click();
}

/**
 * 重置出库视图
 */
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

/**
 * 设置出库表单禁用状态
 */
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

/**
 * 预加载出库视图
 */
export async function preloadOutbound() {
    if (!window._viewReady) window._viewReady = {};
    window._viewReady.outbound = false;
    setOutboundDisabled(true);
    await window.loadSelectOptions('warehouse_code', 'warehouse');
    await window.loadSelectOptions('outbound_type_code', 'outbound_type');
    const outboundWarehouse = document.getElementById('outbound-warehouse');
    const outboundType = document.getElementById('outbound-type');
    if (outboundWarehouse && outboundType) {
        if (typeof window.filterTypes === 'function') {
            window.filterTypes(outboundWarehouse.value, outboundType, 'outbound');
        }
    }

    window._viewReady.outbound = true;
    setOutboundDisabled(false);
    const outboundInputEl = document.getElementById('outbound-sku-input');
    if (outboundInputEl) outboundInputEl.focus();
    renderOutboundList();

    // 设置默认值
    setTimeout(() => {
        if (typeof window.setOutboundDefaults === 'function') {
            window.setOutboundDefaults();
        }
    }, 200);
}

// ==========================================
// 全局暴露
// ==========================================

window.renderOutboundList = renderOutboundList;
window.submitOutbound = submitOutbound;
window.increaseOutboundQty = increaseOutboundQty;
window.decreaseOutboundQty = decreaseOutboundQty;
window.removeOutboundItem = removeOutboundItem;
window.preloadOutbound = preloadOutbound;
window.triggerOrderUpload = triggerOrderUpload;
window.appendOutboundRowIfNeeded = appendOutboundRowIfNeeded;
window.flashOutboundRow = flashOutboundRow;

// 暴露全局状态
window.getPendingOutbound = () => pendingOutbound;
window.setPendingOutbound = (data) => { pendingOutbound = data; };
