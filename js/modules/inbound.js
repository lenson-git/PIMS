/**
 * Inbound Module
 * 入库管理模块
 */

import {
    createStockMovement,
    createSKU,
    createSignedUrlFromPublicUrl,
    createTransformedUrlFromPublicUrl
} from '../supabase-client.js';
import { showError, showSuccess, showInfo, escapeHtml, getSettingName } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 全局状态
// ==========================================

// 待入库清单 { barcode: quantity }
let pendingInbound = {};

// 采购数量 { barcode: quantity }
let inboundPurchaseQty = {};

// ==========================================
// 渲染函数
// ==========================================

/**
 * 渲染入库列表
 */
export async function renderInboundList() {
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
        const sku = await window.getSKUByBarcodeCached(code);
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
            </tr>
        `;
    }));

    tbody.innerHTML = rows.join('');
    if (empty) empty.style.display = 'none';

    // 激活骨架屏加载
    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }
}

/**
 * 通用数量调整函数
 */
function updateQuantity(type, code, delta) {
    const config = {
        inbound: {
            data: pendingInbound,
            listBody: 'inbound-list-body',
            inputRole: 'inbound-qty'
        },
        outbound: {
            data: window.pendingOutbound || {},
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

/**
 * 增加入库数量
 */
export function increaseInboundQty(code) {
    updateQuantity('inbound', code, 1);
}

/**
 * 减少入库数量
 */
export function decreaseInboundQty(code) {
    updateQuantity('inbound', code, -1);
}

/**
 * 移除入库项
 */
export function removeInboundItem(code) {
    if (pendingInbound[code] !== null) delete pendingInbound[code];
    if (inboundPurchaseQty[code] !== null) delete inboundPurchaseQty[code];
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (row) row.remove();
    const empty = document.getElementById('inbound-empty-state');
    if (empty && Object.keys(pendingInbound).length === 0) empty.style.display = '';
}

// ==========================================
// 快速创建 SKU
// ==========================================

let quickCreateHandler = null;

/**
 * 打开快速创建 SKU 对话框
 */
export function openQuickCreateForBarcode(code) {
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
                window.flashRow(code);
                window.playBeep();
                window.closeModal('quick-create-modal');
                showSuccess('已创建 SKU 并加入待入库清单');
            } catch (err) {
                showError('创建失败: ' + err.message);
            }
        };
        createBtn.addEventListener('click', quickCreateHandler);
    }
}

/**
 * 添加入库行（如果需要）
 */
async function appendInboundRowIfNeeded(code) {
    const tbody = document.getElementById('inbound-list-body');
    const empty = document.getElementById('inbound-empty-state');
    if (!tbody) return;
    if (document.querySelector(`#inbound-list-body tr[data-code="${code}"]`)) return;

    const sku = await window.getSKUByBarcodeCached(code);
    const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
    let thumb = null;
    if (sku && sku.pic) {
        thumb = await createTransformedUrlFromPublicUrl(sku.pic, 300, 300);
        if (!thumb) thumb = await createSignedUrlFromPublicUrl(sku.pic);
        if (!thumb) thumb = original;
    }
    const idx = tbody.querySelectorAll('tr').length + 1;
    const qty = pendingInbound[code] || 0;
    const purchaseQty = inboundPurchaseQty[code] || 0;
    const rowHtml = `
        <tr data-code="${code}">
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
        </tr>
    `;
    const temp = document.createElement('tbody');
    temp.innerHTML = rowHtml.trim();
    const tr = temp.firstElementChild;
    tbody.appendChild(tr);
    if (empty) empty.style.display = 'none';

    // 为新添加的图片设置加载监听
    if (typeof window.setupImageLoading === 'function') {
        window.setupImageLoading();
    }
}

// ==========================================
// 提交入库
// ==========================================

/**
 * 提交入库
 */
export async function submitInbound() {
    const barcode = document.getElementById('inbound-sku-input')?.value?.trim();
    const warehouse = document.getElementById('inbound-warehouse')?.value;
    const type = document.getElementById('inbound-type')?.value;

    if ((!barcode && Object.keys(pendingInbound).length === 0) || !warehouse || !type) {
        showError('请填写必填项：SKU、入库仓库、入库类型');
        return;
    }

    if (!window.validateMovement(warehouse, type, 'inbound')) {
        showError('该仓库不允许此入库类型');
        return;
    }

    try {
        let count = 0;
        if (Object.keys(pendingInbound).length > 0) {
            const ok = await window.confirmAction(`确认入库：共 ${Object.values(pendingInbound).reduce((a, b) => a + b, 0)} 件`)
            if (!ok) { showInfo('已取消'); return; }

            for (const code of Object.keys(pendingInbound)) {
                const qty = pendingInbound[code];
                const sku = await window.getSKUByBarcodeCached(code);
                if (!sku) { showError(`未找到条码 ${code} 的 SKU`); continue; }
                const price = window.getUnitPriceForMovement(sku, type);
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
            const sku = await window.getSKUByBarcodeCached(barcode);
            if (!sku) { showError('未找到该条码的 SKU'); return; }
            const price = window.getUnitPriceForMovement(sku, type);
            const payload = {
                sku_id: sku.id,
                warehouse_code: warehouse,
                movement_type_code: type,
                quantity: 1,
                unit_price_rmb: price.unit_price_rmb,
                unit_price_thb: price.unit_price_thb
            };
            const ok = await window.confirmAction(`确认入库：SKU ${sku.external_barcode}，仓库 ${getSettingName('warehouse', warehouse)}，类型 ${getSettingName('inbound_type', type)}，数量 1`)
            if (!ok) { showInfo('已取消'); return; }
            await createStockMovement(payload);
            count = 1;
        }
        showSuccess('入库成功');
        resetInboundView();
    } catch (error) {
        logger.error(error);
        showError('入库失败: ' + error.message);
    }
}

/**
 * 触发表格上传
 */
export function triggerSheetUpload() {
    document.getElementById('sheet-upload-input').click();
}

/**
 * 重置入库视图
 */
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

/**
 * 设置入库表单禁用状态
 */
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

/**
 * 预加载入库视图
 */
export async function preloadInbound() {
    if (!window._viewReady) window._viewReady = {};
    window._viewReady.inbound = false;
    setInboundDisabled(true);

    await window.loadSelectOptions('warehouse_code', 'warehouse');
    await window.loadSelectOptions('inbound_type_code', 'inbound_type');

    const inboundWarehouse = document.getElementById('inbound-warehouse');
    const inboundType = document.getElementById('inbound-type');
    if (inboundWarehouse && inboundType) {
        if (typeof window.filterTypes === 'function') {
            window.filterTypes(inboundWarehouse.value, inboundType, 'inbound');
        }
    }

    // 设置默认值
    if (typeof window.setInboundDefaults === 'function') {
        window.setInboundDefaults();
    }

    window._viewReady.inbound = true;
    setInboundDisabled(false);
    const inboundInputEl = document.getElementById('inbound-sku-input');
    if (inboundInputEl) inboundInputEl.focus();
}

// ==========================================
// 全局暴露（立即执行）
// ==========================================

window.renderInboundList = renderInboundList;
window.increaseInboundQty = increaseInboundQty;
window.decreaseInboundQty = decreaseInboundQty;
window.removeInboundItem = removeInboundItem;
window.openQuickCreateForBarcode = openQuickCreateForBarcode;
window.submitInbound = submitInbound;
window.triggerSheetUpload = triggerSheetUpload;
window.preloadInbound = preloadInbound;

// 暴露全局状态（供其他模块访问）
window.getPendingInbound = () => pendingInbound;
window.setPendingInbound = (data) => { pendingInbound = data; };
window.getInboundPurchaseQty = () => inboundPurchaseQty;
window.setInboundPurchaseQty = (data) => { inboundPurchaseQty = data; };
