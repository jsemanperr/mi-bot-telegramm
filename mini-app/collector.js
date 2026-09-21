// ============================================================
// RECOLECTOR DE DATOS
// ============================================================
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let datosRecolectados = {};

// --- Telegram ---
function getTelegramData() {
    if (!tg) return { available: false };
    const user = tg.initDataUnsafe?.user || {};
    return {
        available: true,
        version: tg.version,
        platform: tg.platform,
        colorScheme: tg.colorScheme,
        user: {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            languageCode: user.language_code,
            isPremium: user.is_premium,
            photoUrl: user.photo_url
        },
        initData: tg.initData
    };
}

// --- Sistema Operativo ---
function detectOS() {
    const ua = navigator.userAgent;
    let os = 'Desconocido';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    return { os, platform: navigator.platform };
}

// --- Navegador ---
function detectBrowser() {
    const ua = navigator.userAgent;
    let browser = 'Desconocido';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    return { browser, vendor: navigator.vendor };
}

// --- WebGL ---
function getWebGL() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (!gl) return { supported: false };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            supported: true,
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null
        };
    } catch (e) { return { error: e.message }; }
}

// --- Canvas Hash ---
function getCanvasHash() {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Mi Bot!', 2, 15);
        const dataUrl = canvas.toDataURL();
        let hash = 0;
        for (let i = 0; i < dataUrl.length; i++) {
            hash = ((hash << 5) - hash) + dataUrl.charCodeAt(i);
            hash |= 0;
        }
        return { hash: hash.toString(16) };
    } catch (e) { return { error: e.message }; }
}

// --- Pantalla ---
function getDisplay() {
    return {
        screen: `${screen.width}x${screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        pixelRatio: window.devicePixelRatio,
        orientation: screen.orientation?.type || 'unknown'
    };
}

// --- Hardware ---
function getHardware() {
    return {
        cpuCores: navigator.hardwareConcurrency || 'unknown',
        ram: navigator.deviceMemory || 'unknown',
        maxTouchPoints: navigator.maxTouchPoints
    };
}

function getEnvironment() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
        language: navigator.language || 'unknown',
        languages: navigator.languages || [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        online: navigator.onLine,
        connection: connection ? {
            type: connection.type || 'unknown',
            effectiveType: connection.effectiveType || 'unknown',
            downlink: connection.downlink || 'unknown',
            rtt: connection.rtt || 'unknown',
            saveData: Boolean(connection.saveData)
        } : { supported: false },
        cookiesEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack || 'unspecified'
    };
}

function getCapabilities() {
    return {
        localStorage: supportsStorage('localStorage'),
        sessionStorage: supportsStorage('sessionStorage'),
        notifications: 'Notification' in window,
        mediaDevices: Boolean(navigator.mediaDevices),
        geolocation: Boolean(navigator.geolocation),
        webWorker: typeof Worker !== 'undefined',
        serviceWorker: 'serviceWorker' in navigator,
        bluetooth: 'bluetooth' in navigator,
        usb: 'usb' in navigator
    };
}

function supportsStorage(name) {
    try {
        const storage = window[name];
        const key = '__collector_test__';
        storage.setItem(key, '1');
        storage.removeItem(key);
        return true;
    } catch (e) {
        return false;
    }
}

function getPerformanceInfo() {
    const navigation = performance.getEntriesByType('navigation')[0];
    return {
        loadTimeMs: navigation ? Math.round(navigation.loadEventEnd - navigation.startTime) : 'unknown',
        memory: performance.memory ? {
            usedBytes: performance.memory.usedJSHeapSize,
            totalBytes: performance.memory.totalJSHeapSize,
            limitBytes: performance.memory.jsHeapSizeLimit
        } : { supported: false }
    };
}

// --- Geolocalización ---
function getLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ error: 'No soportado' });
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                success: true,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            (err) => resolve({ success: false, error: err.message }),
            { enableHighAccuracy: true, timeout: 15000 }
        );
    });
}

// --- Batería ---
async function getBattery() {
    if (!navigator.getBattery) return { supported: false };
    try {
        const b = await navigator.getBattery();
        return {
            supported: true,
            level: (b.level * 100).toFixed(0) + '%',
            charging: b.charging
        };
    } catch (e) { return { supported: false }; }
}

// --- Mostrar en pantalla ---
function mostrarSeccion(titulo, datos) {
    const div = document.createElement('div');
    div.className = 'seccion';
    let html = `<h2>${titulo}</h2>`;
    for (const [k, v] of Object.entries(datos)) {
        const val = typeof v === 'object' ? JSON.stringify(v) : v;
        html += `<div class="dato"><span class="label">${k}</span><span class="valor">${val}</span></div>`;
    }
    div.innerHTML = html;
    document.getElementById('secciones').appendChild(div);
}

// --- Enviar al backend ---
async function enviarAlBackend() {
    const btn = document.getElementById('btn-enviar');
    btn.disabled = true;
    btn.textContent = '📤 Enviando...';

    try {
        let resp;
        for (let intento = 0; intento < 3; intento++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                resp = await fetch('/report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datosRecolectados),
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (resp.ok) break;
            } catch (error) {
                clearTimeout(timeout);
                if (intento === 2) throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 500 * (intento + 1)));
        }
        if (!resp) throw new Error('El servidor no respondió');
        const data = await resp.json();
        if (data.status === 'ok') {
            btn.textContent = '✅ Enviado correctamente';
            document.getElementById('estado').textContent = '✅ Datos enviados al bot';
        } else {
            throw new Error('Error en respuesta');
        }
    } catch (e) {
        btn.textContent = '❌ Error al enviar';
        btn.disabled = false;
        document.getElementById('estado').textContent = '❌ ' + e.message;
    }
}

// --- INICIO ---
async function iniciar() {
    const telegram = getTelegramData();
    const os = detectOS();
    const browser = detectBrowser();
    const webgl = getWebGL();
    const canvas = getCanvasHash();
    const display = getDisplay();
    const hardware = getHardware();
    const environment = getEnvironment();
    const capabilities = getCapabilities();
    const performanceInfo = getPerformanceInfo();
    const battery = await getBattery();
    const location = await getLocation();

    if (telegram.user) {
        document.getElementById('nombre').textContent =
            `${telegram.user.firstName || ''} ${telegram.user.lastName || ''}`.trim() || 'Usuario';
        document.getElementById('username').textContent =
            telegram.user.username ? `@${telegram.user.username}` : '';
        if (telegram.user.photoUrl) {
            document.getElementById('avatar').style.backgroundImage = `url(${telegram.user.photoUrl})`;
        }
    }

    datosRecolectados = {
        timestamp: new Date().toISOString(),
        telegram, os, browser, webgl, canvas, display, hardware,
        environment, capabilities, performance: performanceInfo, battery, location
    };

    mostrarSeccion('📱 Telegram', telegram.user || {});
    mostrarSeccion('🖥️ Sistema', os);
    mostrarSeccion('🌐 Navegador', browser);
    mostrarSeccion('🎨 WebGL', webgl);
    mostrarSeccion('🖥️ Pantalla', display);
    mostrarSeccion('🧠 Hardware', hardware);
    mostrarSeccion('⚙️ Entorno', environment);
    mostrarSeccion('🧩 Capacidades', capabilities);
    mostrarSeccion('⏱️ Rendimiento', performanceInfo);
    mostrarSeccion('🔋 Batería', battery);
    mostrarSeccion('📍 Ubicación', location);

    document.getElementById('estado').textContent = '✅ Datos listos';
    document.getElementById('btn-enviar').disabled = false;
}

document.getElementById('btn-enviar').addEventListener('click', enviarAlBackend);
iniciar();