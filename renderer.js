const logContainer = document.getElementById('log-container');

function appendLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 탭 전환 로직
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.add('active');
        appendLog(`탭 전환: ${e.target.textContent}`);
    });
});

// 모달 로직
const modal = document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', () => modal.showModal());
document.getElementById('btn-close-settings').addEventListener('click', () => modal.close());
document.getElementById('btn-clear-log').addEventListener('click', () => logContainer.innerHTML = '');

// 추출 버튼 로직
let extractedTokens = null;

document.getElementById('btn-run-extract').addEventListener('click', async () => {
    const url = document.getElementById('extract-url').value;
    if (!url) return appendLog('URL을 입력해주세요.', 'error');
    
    appendLog(`프론트엔드 추출 시작: ${url}...`);
    document.getElementById('extract-result').textContent = '추출 진행 중...';
    
    try {
        const res = await window.api.extractFrontend(url);
        appendLog(res.message, 'info');
        extractedTokens = res.data;
        document.getElementById('extract-result').textContent = JSON.stringify(res.data, null, 2);
    } catch (err) {
        appendLog(`추출 오류: ${err.message}`, 'error');
        document.getElementById('extract-result').textContent = '오류 발생';
    }
});

// 생성 버튼 로직
document.getElementById('btn-run-scaffold').addEventListener('click', async () => {
    const config = {
        mallName: document.getElementById('mall-name').value,
        adminId: document.getElementById('admin-id').value,
        outputDir: document.getElementById('output-dir').value,
        tokens: extractedTokens || {
            primaryColor: '#333333', secondaryColor: '#cccccc', backgroundColor: '#ffffff', textColor: '#000000', primaryFont: 'sans-serif'
        }
    };
    
    appendLog(`백엔드 스캐폴딩 시작: ${config.mallName}...`);
    document.getElementById('scaffold-result').textContent = '프로젝트 생성 중...';
    
    try {
        const res = await window.api.scaffoldBackend(config);
        appendLog(res.message, 'info');
        document.getElementById('scaffold-result').textContent = '생성 완료!\n경로: ' + config.outputDir;
    } catch (err) {
        appendLog(`생성 오류: ${err.message}`, 'error');
        document.getElementById('scaffold-result').textContent = '오류 발생';
    }
});

appendLog('GJC 리버싱 워크벤치 초기화 완료.');
