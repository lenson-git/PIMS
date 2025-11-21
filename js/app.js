import { fetchSKUs, createSKU, uploadImage, fetchSettings, createSignedUrlFromPublicUrl, fetchSKUByBarcode, createStockMovement, fetchSKUById, fetchStockTotalBySKU, fetchSales30dBySKU, updateSKU, createTransformedUrlFromPublicUrl, deleteSKU } from './supabase-client.js'
import { WAREHOUSE_RULES, PRICE_RULES, FIELD_LABELS } from './config.js'
import { checkAuth, loginWithGoogle, initAuth, logout } from './auth.js'
import { getSettingName } from './utils.js'

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

// 页面导航控制
function navigate(viewName) {
    console.log('navigate called with:', viewName);

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // 由于 onclick 是在 div 上，我们需要手动处理 active 类
    document.querySelectorAll('.nav-item').forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick && onclick.includes(`'${viewName}'`)) {
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
        console.log('Activated view:', viewName + '-view');
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
        'expenses': '费用管理'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'PIMS';

    if (viewName === 'sku') {
        loadSKUs();
    } else if (viewName === 'inbound') {
        preloadInbound();
    } else if (viewName === 'stock') {
    }
}

// 明确暴露到全局
window.navigate = navigate;
console.log('window.navigate assigned:', typeof window.navigate);

// 暴露给全局以便 HTML onclick 调用
window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        setTimeout(initFloatingLabels, 50);
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

        const selects = document.querySelectorAll(`select[name="${selectName}"]`);
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
        });
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// 根据选中的仓库过滤入/出库类型选项，仅显示允许的集合（选项值为代码）
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
        document.getElementById('sku-img-input').addEventListener('change', handleImageSelect);
    }

    document.querySelectorAll('.floating-label-group').forEach(group => group.classList.remove('active'));
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
            <div class=\"img-preview-wrapper\" style=\"position: relative; width: 100%; height: 100%;\">
                <img src=\"${currentImageBase64}\" style=\"width: 100%; height: 100%; object-fit: contain;\">
                <button type=\"button\" onclick=\"clearImageSelection()\" style=\"position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;\">&times;</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

window.clearImageSelection = function () {
    currentImageFile = null;
    currentImageBase64 = null;
    currentImageUrl = null;
    const area = document.getElementById('sku-upload-area');
    if (area) {
        area.innerHTML = `
            <input type=\"file\" id=\"sku-img-input\" accept=\"image/*\" hidden>
            <label for=\"sku-img-input\" class=\"upload-label\">
                <svg viewBox=\"0 0 24 24\" width=\"32\" height=\"32\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"></rect><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"></circle><polyline points=\"21 15 16 10 5 21\"></polyline></svg>
                <span>点击选择图片</span>
                <span class=\"text-sm text-secondary\">选择后将自动上传并重命名</span>
            </label>
        `;
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
            const filename = `sku-${Date.now()}-${currentImageFile.name}`;
            imageUrl = await uploadImage(currentImageFile, filename);
        } else if (currentSKUId) {
            imageUrl = currentImageUrl;
        }

        const skuData = {
            external_barcode: barcode,
            name: formData.get('product_info').split('\n')[0],
            product_info: formData.get('product_info'),
            shop_code: formData.get('shop_code'),
            purchase_price_rmb: parseFloat(formData.get('purchase_price')) || 0,
            selling_price_thb: parseFloat(formData.get('sales_price')) || 0,
            status_code: formData.get('status_code'),
            pic: imageUrl,
            url: (formData.get('url') || '').trim() || null
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
        } catch (_) {}

    } catch (error) {
        console.error(error);
        showError('保存失败: ' + error.message);
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
        const withThumbs = await Promise.all(products.map(async p => {
            const original = p.pic || 'https://via.placeholder.com/300';
            let thumb = null;
            if (p.pic) {
                thumb = await createTransformedUrlFromPublicUrl(p.pic, 100, 100);
            }
            return { ...p, __thumb: thumb || 'https://via.placeholder.com/100', __original: original };
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
        <tr class="sku-row" onclick="showSKUDetails('${p.id}')">
            <td>${p.id}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${p.__original}')">
                    <img src="${p.__thumb}" alt="Product" loading="lazy" onerror="window.handleImgError && window.handleImgError(this)">
                </div>
            </td>
            <td class="font-mono">${p.external_barcode || '-'}</td>
            <td>
                <div class="product-info-compact">
                    ${((p.product_info || '')).split('\n').filter(Boolean).map(l => `<div class="info-line">${l}</div>`).join('')}
                </div>
            </td>
            <td class="font-num">¥ ${p.purchase_price_rmb || 0}</td>
            <td class="font-num">฿ ${p.selling_price_thb || 0}</td>
            <td class="text-center">
                ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener" title="打开链接">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                </a>` : '-'}
            </td>
            <td>
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
}

window.showSKUDetails = async function (skuId) {
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
            rows.push(`<div class=\"sku-detail-row\"><div class=\"sku-detail-key\">${label}</div><div class=\"sku-detail-val\">${value ?? ''}</div></div>`);
        };

        // 展示字段（按顺序），隐藏 id、name、原始 code 字段
        if (sku.created_at) pushRow(labels.created_at || '创建时间', fmtDate(sku.created_at));
        if (sku.external_barcode) pushRow(labels.external_barcode || '产品条码', sku.external_barcode);
        if (sku.product_info) pushRow(labels.product_info || '产品信息', (sku.product_info || '').split('\n').map(l => `<div>${l}</div>`).join(''));
        if (sku.url) pushRow('产品链接', `<a href="${sku.url}" target="_blank" rel="noopener">${sku.url}</a>`);
        pushRow(labels.purchase_price_rmb || '采购价(RMB)', sku.purchase_price_rmb);
        pushRow(labels.selling_price_thb || '销售价(THB)', sku.selling_price_thb);
        if (sku.shop_code) pushRow('店铺', mapName('shop', sku.shop_code) || '');

        // 追加统计信息
        const stockTotal = await fetchStockTotalBySKU(sku.id);
        const sales30d = await fetchSales30dBySKU(sku.id);
        pushRow('库存数量', stockTotal == null ? '-' : stockTotal);
        pushRow('最近30天销售量', sales30d == null ? '-' : sales30d);
        const right = `<div class="sku-detail-fields">${rows.join('')}</div>`;
        const body = document.getElementById('sku-detail-body');
        if (body) body.innerHTML = `<div class="sku-detail-grid">${left}${right}</div>`;
        window.openModal('sku-detail-modal');
    } catch (err) {
        showError('加载 SKU 详情失败: ' + err.message);
    }
}

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
                area.innerHTML = `
                    <div class=\"img-preview-wrapper\" style=\"position: relative; width: 100%; height: 100%;\">
                        <img src=\"${currentImageUrl}\" style=\"width: 100%; height: 100%; object-fit: contain;\">
                        <button type=\"button\" onclick=\"clearImageSelection()\" style=\"position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;\">&times;</button>
                    </div>
                `;
            } else {
                area.innerHTML = `
                    <input type="file" id="sku-img-input" accept="image/*" hidden>
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
        const sku = await fetchSKUByBarcode(code);
        const original = (sku && sku.pic) ? sku.pic : 'https://via.placeholder.com/300';
        let thumb = null;
        if (sku && sku.pic) {
            thumb = await createTransformedUrlFromPublicUrl(sku.pic, 100, 100);
        }
        const qty = pendingInbound[code] || 0;
        const purchaseQty = inboundPurchaseQty[code] || 0;
        return `
            <tr data-code="${code}">
                <td>${idx + 1}</td>
                <td>
                    <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${original}')">
                        <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                    </div>
                </td>
                <td>
                    <div class="sku-code">${(sku && sku.external_barcode) || code}</div>
                    <div class="sku-name">${(sku && (sku.product_info || '').split('\n')[0]) || ''}</div>
                    <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
                </td>
                <td><div class="form-control-plaintext" data-role="purchase-qty">${purchaseQty}</div></td>
                <td>
                    <div class="qty-input-group">
                        <button class="btn-qty-minus" onclick="window.decreaseInboundQty('${code}')">-</button>
                        <input class="form-control-plaintext" data-role="inbound-qty" value="${qty}" readonly>
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
}

window.increaseInboundQty = function (code) {
    if (!pendingInbound[code]) pendingInbound[code] = 0;
    pendingInbound[code] += 1;
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (row) {
        const input = row.querySelector('input[data-role="inbound-qty"]');
        if (input) input.value = pendingInbound[code];
    }
}

window.decreaseInboundQty = function (code) {
    if (!pendingInbound[code]) return;
    pendingInbound[code] = Math.max(0, pendingInbound[code] - 1);
    if (pendingInbound[code] === 0) delete pendingInbound[code];
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (row) {
        if (pendingInbound[code] == null) {
            row.remove();
            const empty = document.getElementById('inbound-empty-state');
            if (empty && Object.keys(pendingInbound).length === 0) empty.style.display = '';
        } else {
            const input = row.querySelector('input[data-role="inbound-qty"]');
            if (input) input.value = pendingInbound[code];
        }
    }
}


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
        thumb = await createTransformedUrlFromPublicUrl(sku.pic, 100, 100);
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
                    <img src="${thumb || 'https://via.placeholder.com/100'}" alt="Product" loading="lazy">
                </div>
            </td>
            <td>
                <div class="sku-code">${(sku && sku.external_barcode) || code}</div>
                <div class="sku-name">${(sku && (sku.product_info || '').split('\n')[0]) || ''}</div>
                <div class="sku-meta">${(sku && getSettingName('shop', sku.shop_code)) || ''}</div>
            </td>
            <td><div class="form-control-plaintext" data-role="purchase-qty">${purchaseQty}</div></td>
            <td>
                <div class="qty-input-group">
                    <button class="btn-qty-minus" onclick="window.decreaseInboundQty('${code}')">-</button>
                    <input class="form-control-plaintext" data-role="inbound-qty" value="${qty}" readonly>
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
            const ok = await confirmAction(`确认入库：共 ${Object.values(pendingInbound).reduce((a,b)=>a+b,0)} 件`)
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
        setTimeout(() => { try { ctx.close(); } catch (_) {} }, 200);
    } catch (_) {}
}

// ==========================================
// Outbound Logic
// ==========================================

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
            const ok = await confirmAction(`确认出库：共 ${Object.values(pendingOutbound).reduce((a,b)=>a+b,0)} 件`)
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
                    unit_price_thb: price.unit_price_thb
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
                unit_price_thb: price.unit_price_thb
            };
            const ok = await confirmAction(`确认出库：SKU ${sku.external_barcode}，仓库 ${getSettingName('warehouse', warehouse)}，类型 ${getSettingName('outbound_type', type)}，数量 1`)
            if (!ok) { showInfo('已取消'); return; }
            await createStockMovement(payload);
            count = 1;
        }
        showSuccess('出库成功');
        document.getElementById('outbound-sku-input').value = '';
    } catch (error) {
        console.error(error);
        showError('出库失败: ' + error.message);
    }
}

window.triggerOrderUpload = function () {
    document.getElementById('order-upload-input').click();
}

// ==========================================
// Stock Logic
// ==========================================

window.searchStock = function () {
    const query = document.getElementById('stock-search-input').value;
    const warehouse = document.getElementById('stock-warehouse').value;
    showInfo(`搜索库存: ${query}, 仓库: ${warehouse}`);
}

window.openAdjustModal = function (sku) {
    window.openModal('adjust-stock-modal');
    document.getElementById('adjust-sku-code').textContent = sku;
    document.getElementById('adjust-sku-name').textContent = '加载中...';
    document.getElementById('adjust-current-stock').textContent = '-';
}

// ==========================================
// Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', function () {
    // Init Floating Labels
    initFloatingLabels();

    // Init Auth
    initAuth();
    checkAuth();

    // Load Initial Data
    loadSKUs();
    loadSelectOptions('shop_code', 'shop');
    loadSelectOptions('warehouse_code', 'warehouse');
    loadSelectOptions('inbound_type_code', 'inbound_type');
    loadSelectOptions('outbound_type_code', 'outbound_type');
    loadSelectOptions('expense_type', 'expense_type');
    loadSelectOptions('status_code', 'status');

    document.querySelectorAll('select').forEach(select => {
        if (![...select.options].some(o => o.value === '__new__')) {
            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = '+ 新建...';
            select.appendChild(newOpt);
        }
    });

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

    const inboundInput = document.getElementById('inbound-sku-input');
    if (inboundInput) {
        inboundInput.addEventListener('focus', () => {
            if (inboundInput.value && inboundInput.value.trim() !== '') {
                inboundInput.value = '';
            }
        });
        inboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const code = inboundInput.value.trim();
                if (!code) return;
                if (inboundScanLock) { e.preventDefault(); return; }
                inboundScanLock = true;
                try {
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) {
                        showError('该产品不存在或已下架，禁止入库');
                        inboundInput.value = '';
                        inboundInput.focus();
                        inboundLastCode = code;
                        return;
                    }
                    const statusName = getSettingName('status', sku.status_code) || '';
                    const isDown = sku.status_code === 'down' || sku.status_code === 'inactive' || statusName.includes('下架');
                    if (isDown) {
                        window._inboundCreateBarcode = code;
                        inboundInput.value = '';
                        editSKU(sku.id);
                        return;
                    }
                    if (pendingInbound[code]) {
                        pendingInbound[code] += 1;
                        await appendInboundRowIfNeeded(code);
                        const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                        if (row) {
                            const input = row.querySelector('input[data-role="inbound-qty"]');
                            if (input) input.value = pendingInbound[code];
                        }
                        flashRow(code);
                        playBeep();
                        inboundInput.value = '';
                        inboundInput.focus();
                        inboundLastCode = code;
                        return;
                    }
                    pendingInbound[code] = 1;
                    await appendInboundRowIfNeeded(code);
                    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                    if (row) {
                        const input = row.querySelector('input[data-role="inbound-qty"]');
                        if (input) input.value = pendingInbound[code];
                    }
                    flashRow(code);
                    playBeep();
                    inboundInput.value = '';
                    inboundInput.focus();
                    inboundLastCode = code;
                } catch (err) { showError('扫描入库失败: ' + err.message); }
                finally { setTimeout(() => { inboundScanLock = false; }, 200); }
            }
        });
    }

    const outboundInput = document.getElementById('outbound-sku-input');
    if (outboundInput) {
        outboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const code = outboundInput.value.trim();
                if (!code) return;
                if (outboundScanLock) { e.preventDefault(); return; }
                outboundScanLock = true;
                try {
                    if (code === outboundLastCode) { outboundInput.value = ''; return; }
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) { showError('未找到该条码的 SKU'); return; }
                    if (pendingOutbound[code]) {
                        outboundInput.value = '';
                        outboundLastCode = code;
                        return;
                    }
                    pendingOutbound[code] = 1;
                    showInfo(`出库待处理：${code} × ${pendingOutbound[code]}`);
                    outboundInput.value = '';
                    outboundInput.focus();
                    outboundLastCode = code;
                } catch (err) { showError('扫描出库失败: ' + err.message); }
                finally { setTimeout(() => { outboundScanLock = false; }, 200); }
            }
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

    window.handleImgError = async function(img) {
        try {
            const signed = await createSignedUrlFromPublicUrl(img.src, 3600);
            if (signed) {
                img.onerror = null;
                img.src = signed;
                return;
            }
        } catch (_) {}
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
// Expenses Logic
// ==========================================

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
}

window.applyFilters = function () {
    const dateFrom = document.getElementById('date-from').value;
    const dateTo = document.getElementById('date-to').value;
    const type = document.getElementById('expense-type-filter').value;
    const amountMin = document.getElementById('amount-min').value;
    const amountMax = document.getElementById('amount-max').value;

    showInfo('筛选条件:\n日期: ' + dateFrom + ' 至 ' + dateTo + '\n类型: ' + (type || '全部') + '\n金额: ' + (amountMin || '0') + ' - ' + (amountMax || '∞'));
}

window.resetFilters = function () {
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    document.getElementById('expense-type-filter').value = '';
    document.getElementById('amount-min').value = '';
    document.getElementById('amount-max').value = '';
    initFloatingLabels();
}

window.addExpense = function () {
    const date = document.getElementById('new-expense-date').value;
    const type = document.getElementById('new-expense-type').value;
    const amount = document.getElementById('new-expense-amount').value;
    const note = document.getElementById('new-expense-note').value;

    if (!date || !type || !amount) {
        showError('请填写必填项：日期、类型、金额');
        return;
    }

    showSuccess('添加费用:\n日期: ' + date + '\n类型: ' + type + '\n金额: ฿ ' + amount + '\n备注: ' + note);
}
function confirmAction(message, options = {}) {
    const overlay = document.getElementById('confirm-modal');
    const msg = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const closeBtn = document.getElementById('confirm-close');
    if (!overlay || !msg || !okBtn || !cancelBtn) return Promise.resolve(false);
    msg.textContent = message || '';
    if (options.okText) okBtn.textContent = options.okText;
    if (options.cancelText) cancelBtn.textContent = options.cancelText;
    overlay.classList.add('active');
    return new Promise(resolve => {
        const cleanup = () => {
            overlay.classList.remove('active');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
        };
        okBtn.onclick = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        cancelBtn.onclick = onCancel;
        if (closeBtn) closeBtn.onclick = onCancel;
    });
}
function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(type, message, duration = 3000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

function showError(message) { console.error(message); showToast('error', message); }
function showSuccess(message) { showToast('success', message); }
function showInfo(message) { showToast('info', message); }
