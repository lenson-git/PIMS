import { fetchSKUs, createSKU, uploadImage, fetchSettings } from './supabase-client.js'
import { showLoading, hideLoading, showError, showSuccess } from './utils.js'

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
window.navigate = function (viewName) {
    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        // 简单匹配：如果点击的是当前项，或者通过 onclick 触发
        // 这里我们假设 nav-item 的 onclick 已经正确设置
    });

    // 由于 onclick 是在 div 上，我们需要手动处理 active 类
    // 这里的简单实现：遍历所有 nav-item，找到 onclick 包含 viewName 的那个
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick').includes(`'${viewName}'`)) {
            item.classList.add('active');
        }
    });

    // 切换视图
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    const view = document.getElementById(viewName + '-view');
    if (view) view.classList.add('active');

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

    // Load data if needed
    if (viewName === 'sku') {
        loadSKUs();
    } else if (viewName === 'stock') {
        // loadStock(); // TODO: Implement loadStock
    }
}

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

            const newOpt = specialOptions.find(o => o.value === '__new__');
            if (newOpt) select.appendChild(newOpt);

            if (select.value) select.parentElement.classList.add('active');
        });
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// ==========================================
// SKU Logic
// ==========================================

let currentImageBase64 = null;
let currentSKUId = null;
let currentImageFile = null;

window.handleSearch = function () {
    const query = document.getElementById('sku-main-input').value;
    loadSKUs(1, query);
}

window.handleCreate = function () {
    resetForm();
    const query = document.getElementById('sku-main-input').value;
    window.openModal('sku-modal');
    if (query) {
        document.getElementById('modal-barcode-input').value = query;
        document.getElementById('modal-barcode-input').parentElement.classList.add('active');
    }
}

window.resetForm = function () {
    document.getElementById('sku-form').reset();
    currentSKUId = null;
    currentImageBase64 = null;
    currentImageFile = null;

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
            <div class="img-preview-wrapper" style="position: relative; width: 100%; height: 100%;">
                <img src="${currentImageBase64}" style="width: 100%; height: 100%; object-fit: contain;">
                <button type="button" onclick="resetForm()" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">&times;</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

window.saveSKU = async function () {
    const form = document.getElementById('sku-form');
    const formData = new FormData(form);

    const barcode = formData.get('barcode');
    if (!barcode) {
        alert('请输入 SKU / 条码');
        return;
    }

    const btn = document.querySelector('#sku-modal .btn-black');
    const originalText = btn.textContent;
    btn.textContent = '保存中...';
    btn.disabled = true;

    try {
        let imageUrl = null;
        if (currentImageFile) {
            const filename = `sku-${Date.now()}-${currentImageFile.name}`;
            imageUrl = await uploadImage(currentImageFile, filename);
        }

        const skuData = {
            external_barcode: barcode,
            name: formData.get('product_info').split('\n')[0],
            product_info: formData.get('product_info'),
            category: formData.get('shop'),
            cost_price: parseFloat(formData.get('purchase_price')) || 0,
            selling_price: parseFloat(formData.get('sales_price')) || 0,
            status: formData.get('status'),
            image_url: imageUrl
        };

        await createSKU(skuData);

        window.closeModal('sku-modal');
        loadSKUs();
        alert('保存成功');

    } catch (error) {
        console.error(error);
        alert('保存失败: ' + error.message);
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
        renderSKUTable(products);
    } catch (error) {
        console.error('loadSKUs error:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-error">加载失败: ' + error.message + '</td></tr>';
    }
}

function renderSKUTable(products) {
    const tbody = document.querySelector('.sku-table-compact tbody');
    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">暂无数据</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
        <tr class="sku-row" onclick="showSKUDetails('${p.id}')">
            <td>${p.id}</td>
            <td>
                <div class="img-thumbnail-small" onclick="event.stopPropagation(); showLightbox('${p.image_url || 'https://via.placeholder.com/300'}');">
                    <img src="${p.image_url || 'https://via.placeholder.com/300'}" alt="Product">
                </div>
            </td>
            <td class="font-mono">${p.external_barcode || '-'}</td>
            <td>
                <div class="product-info-compact">
                    <div class="info-title" style="max-width: 300px; word-wrap: break-word; white-space: normal;">${p.name || '-'}</div>
                    <div class="info-meta">${p.product_info || ''}</div>
                </div>
            </td>
            <td class="font-num">¥ ${p.cost_price || 0}</td>
            <td class="font-num">฿ ${p.selling_price || 0}</td>
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

window.showSKUDetails = function (skuId) {
    alert('显示 SKU 详情: ' + skuId);
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

window.importSKU = function () {
    alert('批量导入功能即将上线');
}

window.editSKU = function (id) {
    alert('编辑功能开发中');
}

// ==========================================
// Inbound Logic
// ==========================================

window.submitInbound = function () {
    alert('确认入库功能开发中');
}

window.triggerSheetUpload = function () {
    document.getElementById('sheet-upload-input').click();
}

// ==========================================
// Outbound Logic
// ==========================================

window.submitOutbound = function () {
    alert('确认出库功能开发中');
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
    alert(`搜索库存: ${query}, 仓库: ${warehouse}`);
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

    // Load Initial Data
    loadSKUs();
    loadSelectOptions('shop', 'shop');
    loadSelectOptions('warehouse', 'warehouse');
    loadSelectOptions('inbound_type', 'inbound_type');
    loadSelectOptions('outbound_type', 'outbound_type');

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
