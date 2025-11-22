// ==========================================
// 条码扫描器功能
// ==========================================

let currentScannerTarget = null;
let isScanning = false;
let mediaStream = null; // 存储媒体流以便关闭

// 打开条码扫描器
window.openBarcodeScanner = function (inputId) {
    currentScannerTarget = inputId;
    const modal = document.getElementById('barcode-scanner-modal');
    const container = document.getElementById('scanner-container');
    const errorDiv = document.getElementById('scanner-error');

    if (!modal || !container) return;

    // 显示模态框（使用 active 类）
    modal.classList.add('active');
    container.style.display = 'block';
    errorDiv.style.display = 'none';

    // 初始化 QuaggaJS
    initQuagga();
};

// 关闭条码扫描器
window.closeBarcodeScanner = function () {
    console.log('Closing barcode scanner...');
    const modal = document.getElementById('barcode-scanner-modal');
    if (modal) modal.classList.remove('active');

    // 停止 QuaggaJS
    if (isScanning && typeof Quagga !== 'undefined') {
        Quagga.stop();
        isScanning = false;
        console.log('QuaggaJS stopped');
    }

    // 停止所有媒体轨道（关闭摄像头）
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
            console.log('Media track stopped:', track.kind);
        });
        mediaStream = null;
    }

    currentScannerTarget = null;
};

// 初始化 QuaggaJS 扫描器
function initQuagga() {
    if (typeof Quagga === 'undefined') {
        console.error('QuaggaJS not loaded');
        showScannerError();
        return;
    }

    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: document.querySelector('#scanner-viewport'),
            constraints: {
                width: 640,
                height: 480,
                facingMode: "environment" // 使用后置摄像头
            }
        },
        decoder: {
            readers: [
                "code_128_reader",
                "ean_reader",
                "ean_8_reader",
                "code_39_reader",
                "code_39_vin_reader",
                "codabar_reader",
                "upc_reader",
                "upc_e_reader"
            ]
        },
        locate: true,
        locator: {
            patchSize: "medium",
            halfSample: true
        }
    }, function (err) {
        if (err) {
            console.error('QuaggaJS init error:', err);
            showScannerError();
            return;
        }

        console.log("QuaggaJS initialized");

        // 保存媒体流引用
        const stream = Quagga.CameraAccess.getActiveStreamLabel();
        if (stream) {
            // 获取实际的媒体流对象
            const videoElement = document.querySelector('#scanner-viewport video');
            if (videoElement && videoElement.srcObject) {
                mediaStream = videoElement.srcObject;
                console.log('Media stream captured');
            }
        }

        Quagga.start();
        isScanning = true;
    });

    // 监听条码检测事件
    Quagga.onDetected(onBarcodeDetected);
}

// 处理条码检测结果
function onBarcodeDetected(result) {
    if (!result || !result.codeResult) return;

    const code = result.codeResult.code;
    console.log('Barcode detected:', code);

    // 填充到目标输入框
    if (currentScannerTarget) {
        const input = document.getElementById(currentScannerTarget);
        if (input) {
            input.value = code;
            // 触发 input 事件以便其他逻辑响应
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // 不自动关闭扫描器，支持连续扫描
    // 用户需要手动点击关闭按钮、ESC键或点击外部来关闭
}

// 显示扫描器错误
function showScannerError() {
    const container = document.getElementById('scanner-container');
    const errorDiv = document.getElementById('scanner-error');

    if (container) container.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'block';
}

// 绑定所有扫描按钮
window.bindScanButtons = function () {
    const scanButtons = document.querySelectorAll('.scan-btn');
    console.log('Binding scan buttons, found:', scanButtons.length);

    scanButtons.forEach(btn => {
        // 移除旧的事件监听器（通过克隆节点）
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        // 添加新的事件监听器
        newBtn.addEventListener('click', function (e) {
            console.log('Scan button clicked!');
            e.preventDefault();
            e.stopPropagation();

            // 查找最近的输入框容器（支持多种结构）
            const inputGroup = this.closest('.input-group, .floating-label-group, .input-wrapper, .input-group-large');
            if (inputGroup) {
                const input = inputGroup.querySelector('input[type="text"]');
                if (input && input.id) {
                    console.log('Opening scanner for input:', input.id);
                    openBarcodeScanner(input.id);
                } else {
                    console.error('Input not found or has no ID');
                }
            } else {
                console.error('Input group not found');
            }
        });
    });
};

// 监听页面卸载/刷新事件，确保关闭摄像头
window.addEventListener('beforeunload', function () {
    if (isScanning) {
        closeBarcodeScanner();
    }
});

// 监听页面隐藏事件（切换标签页、最小化等）
document.addEventListener('visibilitychange', function () {
    if (document.hidden && isScanning) {
        closeBarcodeScanner();
    }
});

// 点击模态框外部关闭
document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('barcode-scanner-modal');
    if (modal) {
        modal.addEventListener('click', function (e) {
            // 如果点击的是遮罩层本身（不是模态框内容）
            if (e.target === modal) {
                closeBarcodeScanner();
            }
        });
    }
});

// 监听 ESC 键关闭
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isScanning) {
        closeBarcodeScanner();
    }
});
