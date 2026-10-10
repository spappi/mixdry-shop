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

const loadSettings = async () => {
    const s = JSON.parse(localStorage.getItem('gjc-wb-settings') || '{}');
    const zoom = s.zoom || 70;
    document.getElementById('ui-zoom').value = zoom;
    document.getElementById('zoom-label').textContent = zoom;
    window.api.setZoom(zoom / 100);

    if(s.outputDir) document.getElementById('output-dir').value = s.outputDir;
    if(s.patternDbPath) document.getElementById('pattern-db-path').value = s.patternDbPath;
    
    const mallName = s.defMallName || "Gajae Shop";
    const adminId = s.defAdminId || "admin";
    document.getElementById('def-mall-name').value = mallName;
    document.getElementById('def-admin-id').value = adminId;
    document.getElementById('mall-name').value = mallName;
    document.getElementById('admin-id').value = adminId;

    // Init DB
    try {
        const dbRes = await window.api.initDb(s.patternDbPath || null);
        appendLog(dbRes.message);
    } catch(e) {
        appendLog('DB 초기화 실패: ' + e.message, 'error');
    }
};

const saveSettings = async () => {
    const s = {
        zoom: document.getElementById('ui-zoom').value,
        outputDir: document.getElementById('output-dir').value,
        patternDbPath: document.getElementById('pattern-db-path').value,
        defMallName: document.getElementById('def-mall-name').value,
        defAdminId: document.getElementById('def-admin-id').value
    };
    localStorage.setItem('gjc-wb-settings', JSON.stringify(s));
    window.api.setZoom(s.zoom / 100);
    try {
        const dbRes = await window.api.initDb(s.patternDbPath || null);
        appendLog('설정 저장 및 ' + dbRes.message);
    } catch(e) {
        appendLog('설정 저장 중 DB 연결 실패: ' + e.message, 'error');
    }
};

document.getElementById('ui-zoom').addEventListener('input', (e) => {
    document.getElementById('zoom-label').textContent = e.target.value;
    window.api.setZoom(e.target.value / 100);
    saveSettings(); 
});

// 탭 전환 로직
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.add('active');
        
        if (e.target.dataset.target === 'tab-library') {
            loadPatterns();
        }
    });
});

const modal = document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', () => modal.showModal());
document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings();
    modal.close();
});
document.getElementById('btn-clear-log').addEventListener('click', () => logContainer.innerHTML = '');

let extractedTokens = null;
let lastExtractPath = null;
let lastTargetUrl = null;
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

const chkMulti = document.getElementById('chk-multipage');
const multiSettings = document.getElementById('multi-settings');
const btnExtractSingle = document.getElementById('btn-run-extract');
const btnCrawl = document.getElementById('btn-crawl');
const btnExtractMulti = document.getElementById('btn-extract-multi');
const crawlResults = document.getElementById('crawl-results');
const crawlStatus = document.getElementById('crawl-status');

let collectedUrls = [];

if (chkMulti) {
    chkMulti.addEventListener('change', (e) => {
        if (e.target.checked) {
            multiSettings.style.display = 'block';
            btnExtractSingle.style.display = 'none';
        } else {
            multiSettings.style.display = 'none';
            btnExtractSingle.style.display = 'inline-block';
        }
    });

    btnCrawl.addEventListener('click', async () => {
        const url = document.getElementById('extract-url').value;
        if (!url) return appendLog('URL을 입력해주세요.', 'error');
        
        btnCrawl.disabled = true;
        btnCrawl.textContent = '수집 중...';
        appendLog(`멀티페이지 링크 수집 시작: ${url}...`);
        
        const config = {
            url,
            maxDepth: parseInt(document.getElementById('inp-depth').value) || 2,
            maxPages: parseInt(document.getElementById('inp-maxpages').value) || 100,
            excludePatterns: document.getElementById('inp-exclude').value.split(',').map(s=>s.trim()).filter(Boolean),
            paramBlacklist: document.getElementById('inp-param-ignore').value.split(',').map(s=>s.trim()).filter(Boolean)
        };

        try {
            const res = await window.api.crawlLinks(config);
            if (res.success) {
                collectedUrls = res.data;
                crawlResults.style.display = 'block';
                crawlStatus.textContent = `총 ${collectedUrls.length}개의 페이지가 수집되었습니다.`;
                appendLog(`링크 수집 완료: ${collectedUrls.length}개 발견`);
            } else {
                appendLog(`링크 수집 실패: ${res.message}`, 'error');
            }
        } catch (e) {
            appendLog(`IPC 에러: ${e.message}`, 'error');
        } finally {
            btnCrawl.disabled = false;
            btnCrawl.textContent = '링크 수집';
        }
    });

    btnExtractMulti.addEventListener('click', async () => {
        if (!collectedUrls.length) return;
        btnExtractMulti.disabled = true;
        btnExtractMulti.textContent = '추출 중...';
        
        const config = {
            urls: collectedUrls,
            outDirBase: document.getElementById('output-dir').value,
            paramBlacklist: document.getElementById('inp-param-ignore').value.split(',').map(s=>s.trim()).filter(Boolean)
        };

        appendLog(`멀티페이지 순차 추출 시작 (${collectedUrls.length}개 페이지)...`);
        document.getElementById('extract-result').textContent = '다중 페이지 추출 진행 중...';
        lastTargetUrl = collectedUrls[0].url;

        try {
            const res = await window.api.extractMulti(config);
            if (res.success) {
                appendLog(res.message, 'info');
                
                if (res.data) {
                    extractedTokens = res.data;
                    lastExtractPath = res.data.clonePath;
                    
                    document.getElementById('extract-result').innerHTML = `
                        <div style="margin-bottom: 10px;">
                            <strong>[멀티페이지 추출 요약]</strong><br>
                            - 추출 완료된 클론 경로: <span style="color:var(--accent-color)">${res.data.clonePath}</span><br>
                            - 수집된 공용 에셋 수: ${(res.data.assets || []).length} 개<br>
                        </div>
                    `;

                    document.getElementById('btn-open-clone-folder').style.display = 'inline-block';
                    document.getElementById('btn-open-clone-folder').onclick = () => window.api.openFolder(lastExtractPath);
                    document.getElementById('btn-run-clone').style.display = 'inline-block';
                    document.getElementById('btn-run-clone').onclick = () => window.api.openClone(lastExtractPath);
                }
            } else {
                appendLog(`멀티페이지 추출 에러: ${res.message}`, 'error');
            }
        } catch (e) {
            appendLog(`IPC 에러: ${e.message}`, 'error');
        } finally {
            btnExtractMulti.disabled = false;
            btnExtractMulti.textContent = '수집된 페이지 추출 시작';
        }
    });
}

document.getElementById('btn-run-extract').addEventListener('click', async () => {
    const url = document.getElementById('extract-url').value;
    if (!url) return appendLog('URL을 입력해주세요.', 'error');
    
    document.getElementById('btn-open-clone-folder').style.display = 'none';
    document.getElementById('btn-run-clone').style.display = 'none';
    document.getElementById('btn-open-pattern-modal').style.display = 'none';
    appendLog(`프론트엔드 추출(Deep Clone) 시작: ${url}...`);
    document.getElementById('extract-result').textContent = '추출 진행 중...';
    lastTargetUrl = url;
    
    try {
        const outDirBase = document.getElementById('output-dir').value;
        const res = await window.api.extractFrontend({ url, outDirBase });
        appendLog(res.message, 'info');
        extractedTokens = res.data;
        lastExtractPath = res.data.clonePath;
        renderExtractResult(res.data);
        
        document.getElementById('btn-open-clone-folder').style.display = 'inline-block';
        document.getElementById('btn-open-clone-folder').onclick = () => window.api.openFolder(lastExtractPath);
        
        document.getElementById('btn-run-clone').style.display = 'inline-block';
        document.getElementById('btn-run-clone').onclick = () => window.api.openClone(lastExtractPath);
        
        document.getElementById('btn-open-pattern-modal').style.display = 'inline-block';
    } catch (err) {
        appendLog(`추출 오류: ${err.message}`, 'error');
        document.getElementById('extract-result').textContent = '오류 발생';
    }
});

// v3: 패턴 등록 모달 처리
const patternModal = document.getElementById('pattern-register-modal');
document.getElementById('btn-open-pattern-modal').addEventListener('click', () => {
    if(!extractedTokens) return;
    
    const container = document.getElementById('pattern-entries-container');
    container.innerHTML = `
        <div class="pattern-entry-form">
            <strong>색상/폰트 토큰 (color)</strong>
            <input type="text" id="pat-1-summary" value="주요 색상 및 폰트 토큰" style="width:100%; margin:5px 0;">
            <input type="text" id="pat-1-tags" value="디자인,색상,폰트,토큰" style="width:100%;">
        </div>
        <div class="pattern-entry-form">
            <strong>레이아웃 구조 (layout)</strong>
            <input type="text" id="pat-2-summary" value="시맨틱 구조 및 섹션" style="width:100%; margin:5px 0;">
            <input type="text" id="pat-2-tags" value="레이아웃,구조,시맨틱" style="width:100%;">
        </div>
        <div class="pattern-entry-form">
            <strong>컴포넌트 인벤토리 (component)</strong>
            <input type="text" id="pat-3-summary" value="사용된 UI 컴포넌트 목록" style="width:100%; margin:5px 0;">
            <input type="text" id="pat-3-tags" value="컴포넌트,UI,인벤토리" style="width:100%;">
        </div>
    `;
    patternModal.showModal();
});

document.getElementById('btn-close-pattern-modal').addEventListener('click', () => patternModal.close());
document.getElementById('btn-submit-pattern').addEventListener('click', async () => {
    try {
        const payload = {
            url: lastTargetUrl,
            domain: new URL(lastTargetUrl).hostname,
            cloneDir: lastExtractPath,
            patterns: [
                {
                    category: 'color', name: 'Color Palette',
                    summary: document.getElementById('pat-1-summary').value,
                    tags: document.getElementById('pat-1-tags').value,
                    content_json: JSON.stringify(extractedTokens.tokens)
                },
                {
                    category: 'layout', name: 'Page Layout',
                    summary: document.getElementById('pat-2-summary').value,
                    tags: document.getElementById('pat-2-tags').value,
                    content_json: JSON.stringify(extractedTokens.layout)
                },
                {
                    category: 'component', name: 'Component Inventory',
                    summary: document.getElementById('pat-3-summary').value,
                    tags: document.getElementById('pat-3-tags').value,
                    content_json: JSON.stringify(extractedTokens.components)
                }
            ]
        };
        const res = await window.api.savePattern(payload);
        if(res.success) {
            appendLog(`패턴 저장 완료! (Site ID: ${res.siteId})`, 'info');
            patternModal.close();
            document.getElementById('btn-open-pattern-modal').style.display = 'none'; // hide to prevent double save
        } else {
            appendLog('패턴 저장 실패: ' + res.message, 'error');
        }
    } catch(e) {
        appendLog('패턴 저장 오류: ' + e.message, 'error');
    }
});

// v3: 패턴 라이브러리 조회
async function loadPatterns() {
    const keyword = document.getElementById('filter-keyword').value;
    const container = document.getElementById('pattern-list-container');
    container.innerHTML = '로딩 중...';
    try {
        const res = await window.api.getPatterns(keyword);
        if(!res.success) throw new Error(res.message);
        
        container.innerHTML = '';
        if(res.data.length === 0) {
            container.innerHTML = '<div style="color:#888;">저장된 패턴이 없습니다.</div>';
            return;
        }
        res.data.forEach(p => {
            const tags = p.tags ? p.tags.split(',').map(t => `<span class="tag-pill">${t.trim()}</span>`).join('') : '';
            const card = document.createElement('div');
            card.className = 'pattern-card';
            card.innerHTML = `
                <h4>[${p.category}] ${p.name}</h4>
                <div style="font-size:12px; color:#aaa; margin-bottom:10px;">${p.domain}</div>
                <div style="font-size:13px; margin-bottom:10px;">${p.summary}</div>
                <div>${tags}</div>
                <div class="pattern-actions">
                    <button class="icon-btn btn-del" data-id="${p.id}">삭제</button>
                </div>
            `;
            container.appendChild(card);
        });
        
        document.querySelectorAll('.btn-del').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(confirm('이 패턴을 삭제하시겠습니까?')) {
                    await window.api.deletePattern(e.target.dataset.id);
                    loadPatterns();
                }
            });
        });
    } catch(e) {
        container.innerHTML = '불러오기 오류: ' + e.message;
    }
}
document.getElementById('btn-refresh-patterns').addEventListener('click', loadPatterns);
document.getElementById('filter-keyword').addEventListener('keyup', (e) => {
    if(e.key === 'Enter') loadPatterns();
});

// v3: 프롬프트 패키저
let currentPackageText = '';
document.getElementById('btn-generate-package').addEventListener('click', async () => {
    const prompt = document.getElementById('prompt-input').value;
    if(!prompt) return appendLog('프롬프트를 입력하세요.', 'error');
    
    document.getElementById('prompt-output-container').textContent = '검색 및 조립 중...';
    try {
        const res = await window.api.searchPatterns(prompt);
        if(!res.success) throw new Error(res.message);
        
        if(res.data.length === 0) {
            document.getElementById('prompt-output-container').textContent = '관련 패턴을 찾을 수 없습니다. 패턴을 먼저 쌓아주세요.';
            currentPackageText = '';
            return;
        }
        
        let packageText = `[사용자 요청]\n${prompt}\n\n`;
        res.data.forEach((p, idx) => {
            packageText += `[참조 패턴 ${idx+1}] ${p.domain} — ${p.name} (${p.category})\n`;
            packageText += `요약: ${p.summary}\n`;
            packageText += `데이터: ${p.content_json}\n\n`;
        });
        
        currentPackageText = packageText;
        document.getElementById('prompt-output-container').textContent = packageText;
        appendLog(`${res.data.length}개의 관련 패턴이 병합되었습니다.`, 'info');
    } catch(e) {
        document.getElementById('prompt-output-container').textContent = '오류 발생: ' + e.message;
        appendLog('패키지 생성 오류: ' + e.message, 'error');
    }
});

document.getElementById('btn-copy-package').addEventListener('click', () => {
    if(!currentPackageText) return appendLog('복사할 패키지가 없습니다.', 'error');
    window.api.copyToClipboard(currentPackageText);
    appendLog('프롬프트 패키지가 클립보드에 복사되었습니다!', 'info');
});

// Init
loadSettings();


// v2 복원: 백엔드 생성 버튼 로직 (v3 업데이트 중 유실된 부분)
document.getElementById('btn-run-scaffold').addEventListener('click', async () => {
    const config = {
        mallName: document.getElementById('mall-name').value,
        adminId: document.getElementById('admin-id').value,
        adminPw: document.getElementById('admin-pw').value,
        outputDir: document.getElementById('output-dir').value,
        tokens: extractedTokens && extractedTokens.tokens ? {
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
        document.getElementById('scaffold-result').textContent = '생성 완료!\\n경로: ' + config.outputDir;
        
        lastScaffoldPath = config.outputDir;
        const openBtn = document.getElementById('btn-open-scaffold-folder');
        openBtn.style.display = 'inline-block';
        openBtn.onclick = () => window.api.openFolder(lastScaffoldPath);
    } catch (err) {
        appendLog(`생성 오류: ${err.message}`, 'error');
        document.getElementById('scaffold-result').textContent = '오류 발생';
    }
});
