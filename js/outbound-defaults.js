/**
 * 出库默认值设置模块
 * Version: 20251125-1734
 * Purpose: 为出库页面设置默认仓库和出库类型
 */

/**
 * 设置出库页面的默认值
 * 在 preloadOutbound() 完成后调用
 */
window.setOutboundDefaults = function () {
    const warehouseSelect = document.getElementById('outbound-warehouse');
    const typeSelect = document.getElementById('outbound-type');

    // 设置默认仓库为"主仓"
    if (warehouseSelect && warehouseSelect.options.length > 1) {
        const options = Array.from(warehouseSelect.options);
        // 查找包含"主"字的仓库,或者 value/text 包含 "main"(不区分大小写)
        const mainWarehouse = options.find(opt => {
            const text = (opt.text || '').toLowerCase();
            const value = (opt.value || '').toLowerCase();
            return text.includes('主') ||
                value.includes('主') ||
                text.includes('main') ||
                value.includes('main');
        });

        if (mainWarehouse) {
            warehouseSelect.value = mainWarehouse.value;
            // 触发 change 事件以更新 UI (浮动标签) 和过滤出库类型
            warehouseSelect.dispatchEvent(new Event('change'));
            console.log('[出库默认值] 默认仓库已设置:', mainWarehouse.text);
        } else {
            console.warn('[出库默认值] 未找到"主仓"');
        }
    }

    // 设置默认出库类型为"销售出库"
    // 注意: 需要在仓库选择后再设置,因为出库类型会根据仓库过滤
    setTimeout(() => {
        if (typeSelect && typeSelect.options.length > 1) {
            const options = Array.from(typeSelect.options);
            // 查找包含"销售"字的类型,或者 value/text 包含 "sales"(不区分大小写)
            const salesType = options.find(opt => {
                const text = (opt.text || '').toLowerCase();
                const value = (opt.value || '').toLowerCase();
                return text.includes('销售') ||
                    value.includes('销售') ||
                    text.includes('sales') ||
                    value.includes('sales');
            });

            if (salesType) {
                typeSelect.value = salesType.value;
                typeSelect.dispatchEvent(new Event('change'));
                console.log('[出库默认值] 默认出库类型已设置:', salesType.text);
            } else {
                console.warn('[出库默认值] 未找到"销售出库"类型');
            }
        }
    }, 100); // 延迟 100ms 确保仓库过滤完成
};
