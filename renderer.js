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
    if(s.crawlMaxDepth) document.getElementById('inp-depth').value = s.crawlMaxDepth;
    if(s.crawlMaxPages) document.getElementById('inp-maxpages').value = s.crawlMaxPages;
    if(s.crawlExclude) document.getElementById('inp-exclude').value = s.crawlExclude;
    if(s.crawlParamIgnore) document.getElementById('inp-param-ignore').value = s.crawlParamIgnore;
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
    const libPath = document.getElementById('inp-library-path').value;
    try {
        await window.api.setLibraryPath(libPath);
        if (typeof loadClones === 'function') loadClones();
    } catch(e) {}

    const s = {
        zoom: document.getElementById('ui-zoom').value,
        cloneLibraryPath: libPath,
        outputDir: document.getElementById('output-dir').value,
        patternDbPath: document.getElementById('pattern-db-path').value,
        defMallName: document.getElementById('def-mall-name').value,
        defAdminId: document.getElementById('def-admin-id').value,
        crawlMaxDepth: document.getElementById('inp-depth').value,
        crawlMaxPages: document.getElementById('inp-maxpages').value,
        crawlExclude: document.getElementById('inp-exclude').value,
        crawlParamIgnore: document.getElementById('inp-param-ignore').value
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
            - 식별된 백엔드 API (JS 분석): ${(data.endpoints || []).length} 개<br>
        </div>
        <div style="margin-bottom: 10px; padding: 10px; background: #222; border: 1px solid #555; border-radius: 4px;">
            <strong style="color: #4CAF50;">[JS 백엔드 스텁 관리]</strong><br>
            <div style="max-height: 150px; overflow-y: auto; margin: 10px 0; font-family: monospace; font-size: 11px;">
                ${(data.endpoints || []).map(ep => `<div style="opacity: ${ep.type === 'tracking' ? '0.6' : '1'}"><span style="color:${ep.type === 'tracking' ? '#9E9E9E' : '#2196F3'}; font-weight:bold;">[${(ep.type || 'api').toUpperCase()}]</span> <span>${ep.method}</span> ${ep.url} <span style="color:#777">(${ep.sources ? ep.sources.length : 1} sources)</span></div>`).join('')}
                ${!(data.endpoints || []).length ? '<span style="color:#777;">발견된 API 엔드포인트가 없습니다.</span>' : ''}
            </div>
            <label style="font-size: 12px; display: flex; align-items: center; gap: 5px; margin-bottom: 10px;">
                <input type="checkbox" id="chk-apply-stubs" checked> 백엔드 호출 스텁(Stub) 교체 활성화
            </label>
            <button class="primary-btn" id="btn-regen-stubs" style="background-color: #ff9800; font-size: 12px; padding: 4px 8px;" onclick="alert('스텁 재생성 기능은 현재 추출(Extract) 시 자동으로 수행됩니다. 세부 스텁 편집 기능은 추후 업데이트 예정입니다.')">스텁 설정 업데이트</button>
            <button class="icon-btn" style="font-size: 12px; padding: 4px 8px; margin-left: 5px;" onclick="window.api.openCloneFolder('${data.clonePath.replace(/\\/g, '\\\\')}')">전체 backend-raw.json 보기 (폴더 열기)</button>
        </div>
        <details class="details-panel">
            <summary>자세한 JSON 구조 펼치기</summary>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        </details>
    `;
}

const btnAnalyze = document.getElementById('btn-analyze-site');
const analyzePanel = document.getElementById('analyze-result-panel');
const analyzeSummary = document.getElementById('analyze-summary');
const btnOpenApiSpec = document.getElementById('btn-open-api-spec');
const crawlPlanPanel = document.getElementById('crawl-plan-panel');
const crawlPlanSummary = document.getElementById('crawl-plan-summary');
const chkNavOnly = document.getElementById('chk-nav-only');
const btnCrawl = document.getElementById('btn-crawl');
const btnExtractMulti = document.getElementById('btn-extract-multi');
const btnStop = document.getElementById('btn-stop-operation');
const crawlResults = document.getElementById('crawl-results');
const crawlStatus = document.getElementById('crawl-status');

let lastApiSpecPath = null;
let lastCrawlPlan = null;
let collectedUrls = [];

function getEffectiveCrawlConfig() {
    const defaultExclude = document.getElementById('inp-exclude').value.split(',').map(s=>s.trim()).filter(Boolean);
    const defaultParamIgnore = document.getElementById('inp-param-ignore').value.split(',').map(s=>s.trim()).filter(Boolean);
    const defaultDepth = parseInt(document.getElementById('inp-depth').value) || 2;
    const defaultPages = parseInt(document.getElementById('inp-maxpages').value) || 500;
    const isNavOnly = chkNavOnly && chkNavOnly.checked;

    if (lastCrawlPlan) {
        return {
            maxDepth: lastCrawlPlan.maxDepth !== undefined ? lastCrawlPlan.maxDepth : defaultDepth,
            maxPages: lastCrawlPlan.maxPages || defaultPages,
            excludePatterns: lastCrawlPlan.excludePatterns || defaultExclude,
            paramBlacklist: lastCrawlPlan.paramBlacklist || defaultParamIgnore,
            discoveryScope: isNavOnly ? 'nav' : 'all',
            sitemapUrls: lastCrawlPlan.sitemapUrls || []
        };
    }
    
    return {
        maxDepth: defaultDepth,
        maxPages: defaultPages,
        excludePatterns: defaultExclude,
        paramBlacklist: defaultParamIgnore,
        discoveryScope: isNavOnly ? 'nav' : 'all',
        sitemapUrls: []
    };
}

if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
        const url = document.getElementById('extract-url').value;
        if (!url) return appendLog('URL을 입력해주세요.', 'error');
        
        btnAnalyze.disabled = true;
        btnAnalyze.textContent = '분석 중...';
        analyzePanel.style.display = 'block';
        analyzeSummary.innerHTML = '사이트 트래픽 및 구조 분석을 진행 중입니다 (약 5~10초 소요)...';
        appendLog(`[분석] ${url} 프로파일링 및 API 트래픽 캡처 시작...`);
        
        try {
            const res = await window.api.analyzeSite({ url, outDirBase: document.getElementById('output-dir').value });
            if (res.success) {
                const p = res.profile;
                analyzeSummary.innerHTML = `
                    <strong>유형:</strong> ${p.siteType} <br>
                    <strong>예상 스택:</strong> ${p.techStack.join(', ') || '알 수 없음'} <br>
                    <strong>예상 페이지 수:</strong> 약 ${p.pageEstimate} 페이지 <br>
                    <strong>탐지된 API:</strong> ${p.apiCount} 개 엔드포인트 <br>
                    <br><em>* 크롤 설정이 자동으로 권장값으로 채워졌습니다.</em>
                `;
                lastApiSpecPath = res.apiSpecPath;
                appendLog(`[분석 완료] API 스펙 생성 완료: ${res.apiSpecPath}`, 'info');
                
                lastCrawlPlan = p.crawlConfig || null;
                if (lastCrawlPlan) {
                    if (crawlPlanPanel) crawlPlanPanel.style.display = 'block';
                    if (crawlPlanSummary) {
                        crawlPlanSummary.innerHTML = `
                            - 깊이 ${lastCrawlPlan.maxDepth} · 최대 ${lastCrawlPlan.maxPages}페이지 수집<br>
                            - 사이트맵 감지: ${lastCrawlPlan.sitemapUrls && lastCrawlPlan.sitemapUrls.length > 0 ? lastCrawlPlan.sitemapUrls.length + '개 시드 적용' : '없음'}<br>
                            - 제외 패턴: ${lastCrawlPlan.excludePatterns.join(', ')}<br>
                            - 파라미터 정규화: ${lastCrawlPlan.paramBlacklist.join(', ')}
                        `;
                    }
                }
            } else {
                analyzeSummary.innerHTML = `<span style="color:red;">분석 실패: ${res.message}</span>`;
                appendLog(`분석 에러: ${res.message}`, 'error');
            }
        } catch (e) {
            analyzeSummary.innerHTML = `<span style="color:red;">IPC 에러: ${e.message}</span>`;
            appendLog(`IPC 에러: ${e.message}`, 'error');
        } finally {
            btnAnalyze.disabled = false;
            btnAnalyze.textContent = '사이트 분석';
        }
    });
}

if (btnOpenApiSpec) {
    btnOpenApiSpec.addEventListener('click', () => {
        if (lastApiSpecPath) window.api.openFolder(lastApiSpecPath);
    });
}

    document.getElementById('extract-url').addEventListener('input', () => {
        lastCrawlPlan = null;
        if (crawlPlanPanel) crawlPlanPanel.style.display = 'none';
        if (crawlResults) crawlResults.style.display = 'none';
    });

    if (btnStop) {
        btnStop.addEventListener('click', async () => {
            await window.api.cancelOperation();
            appendLog('[중지 요청 전송]', 'warn');
            btnStop.style.display = 'none';
        });
    }

    btnCrawl.addEventListener('click', async () => {
        const url = document.getElementById('extract-url').value;
        if (!url) return appendLog('URL을 입력해주세요.', 'error');
        
        btnCrawl.disabled = true;
        if (btnStop) btnStop.style.display = 'inline-block';
        btnCrawl.textContent = '수집 중...';
        appendLog(`링크 수집 시작: ${url}...`);
        
        const config = { url, ...getEffectiveCrawlConfig() };

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
            if (btnStop) btnStop.style.display = 'none';
        }
    });

    btnExtractMulti.addEventListener('click', async () => {
        if (!collectedUrls.length) return;
        btnExtractMulti.disabled = true;
        if (btnStop) btnStop.style.display = 'inline-block';
        btnExtractMulti.textContent = '추출 중...';
        
        const config = {
            urls: collectedUrls,
            libraryPath: document.getElementById('inp-library-path').value,
            cloneName: document.getElementById('extract-clone-name').value || document.getElementById('extract-clone-name').placeholder,
            paramBlacklist: getEffectiveCrawlConfig().paramBlacklist
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
                    document.getElementById('btn-open-pattern-modal').style.display = 'inline-block';
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
            if (btnStop) btnStop.style.display = 'none';
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
// --- v4.3 Cloner Tab Logic ---
let activeClone = null;

async function loadClones() {
    const grid = document.getElementById('clones-grid');
    if (!grid) return;
    grid.innerHTML = '스캔 중...';
    try {
        const clones = await window.api.listClones();
        if (clones.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px;">아직 클론이 없습니다.<br>프론트 추출 탭에서 사이트를 추출해보세요.</div>';
            return;
        }
        grid.innerHTML = '';
        clones.forEach((c, idx) => {
            const card = document.createElement('div');
            card.style = 'background: #1a1a1a; border: 1px solid #444; border-radius: 5px; overflow: hidden; display: flex; flex-direction: column; cursor: pointer;';
            card.ondblclick = () => window.api.openClone(c.dir);
            
            const thumb = c.hasScreenshot ? `file:///${c.dir.replace(/\\/g, '/')}/screenshot.png` : '';
            const thumbHtml = thumb ? `<img src="${thumb}" style="width: 100%; height: 120px; object-fit: cover; border-bottom: 1px solid #333;">` : `<div style="width: 100%; height: 120px; background: #333; display: flex; align-items: center; justify-content: center; color: #777; border-bottom: 1px solid #222;">NO IMAGE</div>`;
            
            const isOk = c.missing === 0 && c.failed === 0;
            const badgeColor = isOk ? '#4CAF50' : '#ff9800';
            const badgeText = c.hasAssetMap ? (isOk ? '● 정상' : `● 누락 ${c.missing + c.failed}건`) : '복구 정보 없음';
            const badgeBg = c.hasAssetMap ? badgeColor : '#777';

            card.innerHTML = `
                ${thumbHtml}
                <div style="padding: 10px; flex: 1; display: flex; flex-direction: column;">
                    <div style="font-weight: bold; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${c.name}">${c.name}</div>
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 4px;">${c.domain}</div>
                    <div style="font-size: 11px; color: #888; margin-bottom: 6px;">${new Date(c.extractedAt).toLocaleString()}</div>
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 10px;">${c.pages}페이지 · ${c.assets}에셋</div>
                    <div style="font-size: 11px; color: #fff; background: transparent; border: 1px solid ${badgeBg}; color: ${badgeBg}; padding: 3px 6px; border-radius: 3px; display: inline-block; align-self: flex-start; margin-bottom: 15px;">${badgeText}</div>
                    
                    <div style="margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                        <button class="primary-btn" style="grid-column: 1 / -1; padding: 5px 0; font-size: 11px; background-color: #2196F3;" onclick="event.stopPropagation(); window.api.previewClone('${c.dir.replace(/\\/g, '\\\\')}')">미리보기 (로컬 서버)</button>
                        <button class="primary-btn" style="padding: 5px 0; font-size: 11px;" onclick="event.stopPropagation(); doLoadClone('${c.dir.replace(/\\/g, '\\\\')}')">이어하기</button>
                        <button class="primary-btn" style="padding: 5px 0; font-size: 11px; background-color: #ff9800;" onclick="event.stopPropagation(); doRepairClone('${c.dir.replace(/\\/g, '\\\\')}')">복구</button>
                        <button class="icon-btn" style="padding: 5px 0; font-size: 11px;" onclick="event.stopPropagation(); window.api.openCloneFolder('${c.dir.replace(/\\/g, '\\\\')}')">폴더 열기</button>
                        <button class="icon-btn" style="padding: 5px 0; font-size: 11px; color: #f44336; border-color: #f44336;" onclick="event.stopPropagation(); doDeleteClone('${c.dir.replace(/\\/g, '\\\\')}')">삭제</button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch(e) {
        grid.innerHTML = '에러 발생: ' + e.message;
    }
}

window.doLoadClone = async (dir) => {
    try {
        const data = await window.api.loadClone(dir);
        activeClone = { dir, manifest: data.manifest, urlmap: data.urlmap, assetMap: data.assetMap };
        const txt = document.getElementById('active-clone-text');
        const name = activeClone.manifest.name || new URL(activeClone.manifest.targetUrl).hostname;
        txt.textContent = `현재 작업 중: ${name} (${activeClone.manifest.targetUrl}, ${new Date(activeClone.manifest.extractedAt).toLocaleString()}) · ${activeClone.manifest.pages.length}페이지`;
        document.getElementById('active-clone-banner').style.display = 'block';
        
        document.getElementById('extract-url').value = activeClone.manifest.targetUrl;
        
        document.querySelector('[data-target="tab-extract"]').click();
    } catch(e) {
        alert('불러오기 실패: ' + e.message);
    }
};

window.doRepairClone = async (dir) => {
    appendLog(`[복구] ${dir} 복구 시작...`);
    try {
        const res = await window.api.repairClone(dir);
        if (!res.success) {
            appendLog(`[복구 실패] ${res.message}`, 'error');
            if (res.message.includes('부분 스캔')) alert(res.message);
        }
        loadClones();
    } catch(e) {
        appendLog(`[복구 에러] ${e.message}`, 'error');
    }
};

window.doDeleteClone = async (dir) => {
    if (confirm('이 클론 폴더를 휴지통으로 이동하시겠습니까?')) {
        try {
            await window.api.deleteClone(dir);
            loadClones();
        } catch(e) {
            alert('삭제 실패: ' + e.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const btnRelease = document.getElementById('btn-release-clone');
    if (btnRelease) {
        btnRelease.addEventListener('click', () => {
            activeClone = null;
            document.getElementById('active-clone-banner').style.display = 'none';
        });
    }

    const btnRefresh = document.getElementById('btn-clones-refresh');
    if (btnRefresh) btnRefresh.addEventListener('click', loadClones);

    const btnImport = document.getElementById('btn-clones-import');
    if (btnImport) {
        btnImport.addEventListener('click', async () => {
            try {
                await window.api.importClone();
                loadClones();
            } catch(e) {
                if(e.message !== 'cancelled') alert(e.message);
            }
        });
    }

    const btnOpen = document.getElementById('btn-clones-open');
    if (btnOpen) {
        btnOpen.addEventListener('click', async () => {
            const p = await window.api.getLibraryPath();
            window.api.openFolder(p);
        });
    }

    const urlInput = document.getElementById('extract-url');
    if (urlInput) {
        urlInput.addEventListener('input', (e) => {
            try {
                const u = new URL(e.target.value);
                document.getElementById('extract-clone-name').value = u.hostname;
            } catch(err) {}
        });
    }

    const btnBrowseLib = document.getElementById('btn-browse-library');
    if (btnBrowseLib) {
        btnBrowseLib.addEventListener('click', async () => {
            // we'll rely on the backend to open dialog and update settings if we added IPC for it,
            // but if we don't have a specific IPC, we can prompt or just tell the user to manually type it.
            // Oh, wait, we don't have a browse directory IPC specifically for settings. 
            // We can just ask them to type it for now, or add an IPC in main.js. Let's add it in main.js later.
        });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.dataset.target === 'tab-clones') {
                loadClones();
            }
        });
    });
});
