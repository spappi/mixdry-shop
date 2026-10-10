with open('preload.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = "extractFrontend: (config) => ipcRenderer.invoke('extract-frontend', config),"
replacement = """extractFrontend: (config) => ipcRenderer.invoke('extract-frontend', config),
    crawlLinks: (config) => ipcRenderer.invoke('crawl-links', config),
    extractMulti: (config) => ipcRenderer.invoke('extract-multi', config),"""

if target in content:
    with open('preload.js', 'w', encoding='utf-8') as f:
        f.write(content.replace(target, replacement))
    print("preload.js patched")
else:
    print("Target not found in preload.js")
