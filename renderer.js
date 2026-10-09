const logContainer = document.getElementById('log-container');

function appendLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

window.api.onLog((msg, type) => appendLog(msg, type));

const loadSettings = () => {
    const s = JSON.parse(localStorage.getItem('gjc-wb-settings') || '{}');
    const zoom = s.zoom || 70;
    document.getElementById('ui-zoom').value = zoom;
    document.getElementById('zoom-label').textContent = zoom;
    window.api.setZoom(zoom / 100);

    if(s.outputDir) document.getElementById('output-dir').value = s.outputDir;
    
    const mallName = s.defMallName || "Gajae Shop";
    const adminId = s.defAdminId || "admin";
    document.getElementById('def-mall-name').value = mallName;
    document.getElementById('def-admin-id').value = adminId;
    
    document.getElementById('mall-name').value = mallName;
    document.getElementById('admin-id').value = adminId;
};

const saveSettings = () => {
    const s = {
        zoom: document.getElementById('ui-zoom').value,
        outputDir: document.getElementById('output-dir').value,
        defMallName: document.getElementById('def-mall-name').value,
        defAdminId: document.getElementById('def-admin-id').value
    };
    localStorage.setItem('gjc-wb-settings', JSON.stringify(s));
    window.api.setZoom(s.zoom / 100);
};

document.getElementById('ui-zoom').addEventListener('input', (e) => {
    document.getElementById('zoom-label').textContent = e.target.value;
    window.api.setZoom(e.target.value / 100);
    // v2: 줌 슬라이더 변경 시 즉시 localStorage에 저장
    saveSettings(); 
});

loadSettings();

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.add('active');
    });
});

const modal = document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', () => modal.showModal());
document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings();
    appendLog('설정이 저장되었습니다.');
    modal.close();
});
document.getElementById('btn-clear-log').addEventListener('click', () => logContainer.innerHTML = '');

let extractedTokens = null;
let lastExtractPath = null;
let lastScaffoldPath = null;

function renderExtractResult(data) {
    const container = document.getElementById('extract-result');
    const colors = (data.tokens.colors || []).slice(0, 3).join(', ');
    const spacing = (data.tokens.spacing || []).slice(0, 3).join(', ');
    
    container.innerHTML = `
        <div style="margin-bottom: 10px;">
            <strong>[추출 요약]</strong><br>
            - 주요 색상 (빈도순): <span style="color:var(--accent-color)">${colors}</span><br>
            - 주요 여백 (빈도순): ${spacing}<br>
            - 수집된 에셋 수: ${(data.assets || []).length} 개<br>
            - 다운로드 실패 에셋: ${(data.failedAssets || []).length} 개<br>
        </div>
        <details class="details-panel">
            <summary>자세한 JSON 구조 펼치기</summary>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        </details>
    `;
}

document.getElementById('btn-run-extract').addEventListener('click', async () => {
    const url = document.getElementById('extract-url').value;
    if (!url) return appendLog('URL을 입력해주세요.', 'error');
    
    document.getElementById('btn-open-clone-folder').style.display = 'none';
    appendLog(`프론트엔드 추출(Deep Clone) 시작: ${url}...`);
    document.getElementById('extract-result').textContent = '추출 진행 중...';
    
    try {
        const outDirBase = document.getElementById('output-dir').value;
        const res = await window.api.extractFrontend({ url, outDirBase });
        appendLog(res.message, 'info');
        extractedTokens = res.data;
        lastExtractPath = res.data.clonePath;
        renderExtractResult(res.data);
        
        const openBtn = document.getElementById('btn-open-clone-folder');
        openBtn.style.display = 'inline-block';
        openBtn.onclick = () => window.api.openFolder(lastExtractPath);
    } catch (err) {
        appendLog(`추출 오류: ${err.message}`, 'error');
        document.getElementById('extract-result').textContent = '오류 발생';
    }
});

document.getElementById('btn-run-scaffold').addEventListener('click', async () => {
    const config = {
        mallName: document.getElementById('mall-name').value,
        adminId: document.getElementById('admin-id').value,
        adminPw: document.getElementById('admin-pw').value,
        outputDir: document.getElementById('output-dir').value,
        tokens: extractedTokens ? {
            primaryColor: extractedTokens.tokens.colors[0] || '#333333', 
            secondaryColor: extractedTokens.tokens.colors[1] || '#cccccc', 
            backgroundColor: extractedTokens.tokens.colors.find(c => c === '#ffffff' || c === '#000000' || c === 'rgb(255, 255, 255)' || c === 'rgb(0, 0, 0)') || '#ffffff', 
            textColor: '#000000', 
            primaryFont: (extractedTokens.tokens.fonts && extractedTokens.tokens.fonts[0]) || 'sans-serif'
        } : {
            primaryColor: '#333333', secondaryColor: '#cccccc', backgroundColor: '#ffffff', textColor: '#000000', primaryFont: 'sans-serif'
        }
    };
    
    document.getElementById('btn-open-scaffold-folder').style.display = 'none';
    appendLog(`백엔드 스캐폴딩 시작: ${config.mallName}...`);
    document.getElementById('scaffold-result').textContent = '프로젝트 생성 중...';
    
    try {
        const res = await window.api.scaffoldBackend(config);
        appendLog(res.message, 'info');
        document.getElementById('scaffold-result').textContent = '생성 완료!\n경로: ' + config.outputDir;
        
        lastScaffoldPath = config.outputDir;
        const openBtn = document.getElementById('btn-open-scaffold-folder');
        openBtn.style.display = 'inline-block';
        openBtn.onclick = () => window.api.openFolder(lastScaffoldPath);
    } catch (err) {
        appendLog(`생성 오류: ${err.message}`, 'error');
        document.getElementById('scaffold-result').textContent = '오류 발생';
    }
});

appendLog('GJC 리버싱 워크벤치 v2.0 초기화 완료.');