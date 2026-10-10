with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

target = '            <button class="primary-btn" id="btn-run-extract">추출 시작</button>'
replacement = """            <!-- v3.3 Multi-page options -->
            <div style="margin-top: 10px; margin-bottom: 10px;">
                <label style="cursor: pointer; font-weight: bold; color: var(--accent-color);">
                    <input type="checkbox" id="chk-multipage"> 멀티페이지 전체 추출 (베타)
                </label>
            </div>
            <div id="multi-settings" style="display: none; background: #1a1a1a; padding: 15px; margin-bottom: 15px; border-radius: 5px; border: 1px solid #444;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <div class="form-group" style="flex: 1; margin: 0;">
                        <label>크롤 깊이 (maxDepth)</label>
                        <input type="number" id="inp-depth" value="2" min="0" max="5">
                    </div>
                    <div class="form-group" style="flex: 1; margin: 0;">
                        <label>최대 페이지 (maxPages)</label>
                        <input type="number" id="inp-maxpages" value="100">
                    </div>
                </div>
                <div class="form-group" style="margin-bottom: 10px;">
                    <label>제외 패턴 (포함 시 무시, 콤마 구분)</label>
                    <input type="text" id="inp-exclude" value="login, cart, order, mypay, member, write">
                </div>
                <div class="form-group" style="margin: 0;">
                    <label>URL 파라미터 무시 (정규화용, 콤마 구분)</label>
                    <input type="text" id="inp-param-ignore" value="timeKey">
                </div>
                <button id="btn-crawl" class="primary-btn" style="margin-top: 15px; background: #2196F3;">링크 수집</button>
                <div id="crawl-results" style="display: none; margin-top: 10px; padding: 10px; background: #222; border-left: 3px solid #2196F3;">
                    <p id="crawl-status" style="font-weight: bold; margin-top: 0;"></p>
                    <button id="btn-extract-multi" class="primary-btn" style="background-color: var(--secondary-color);">수집된 페이지 추출 시작</button>
                </div>
            </div>

            <button class="primary-btn" id="btn-run-extract">단일 추출 시작</button>"""

if target in content:
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(content.replace(target, replacement))
    print("index.html patched")
else:
    print("Target not found in index.html")
