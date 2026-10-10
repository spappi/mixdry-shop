
            (() => {
                const colorMap = {};
                const spacingMap = {};
                const fonts = new Set();
                const sections = [];
                const components = [];
                
                document.querySelectorAll('*').forEach(el => {
                    const s = window.getComputedStyle(el);
                    
                    const bg = s.backgroundColor;
                    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorMap[bg] = (colorMap[bg] || 0) + 1;
                    
                    const c = s.color;
                    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colorMap[c] = (colorMap[c] || 0) + 1;
                    
                    if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());

                    ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom'].forEach(prop => {
                        if (s[prop] && s[prop] !== '0px') spacingMap[s[prop]] = (spacingMap[s[prop]] || 0) + 1;
                    });
                });
                
                const colors = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).map(e => e[0]);
                const spacing = Object.entries(spacingMap).sort((a, b) => b[1] - a[1]).map(e => e[0]);
                    
                document.querySelectorAll('header, nav, main, section, article, aside, footer').forEach(el => {
                    sections.push({ tag: el.tagName.toLowerCase(), className: el.className });
                });
                
                document.querySelectorAll('button, input, textarea, select, table, form').forEach(el => {
                    components.push({ type: el.tagName.toLowerCase() });
                });

                document.querySelectorAll('script, iframe, noscript').forEach(s => s.remove());
                const iter = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT, null, false);
                let node;
                const comments = [];
                while(node = iter.nextNode()) comments.push(node);
                comments.forEach(c => c.remove());

                document.querySelectorAll('*').forEach(el => {
                    if(!el.attributes) return;
                    Array.from(el.attributes).forEach(attr => {
                        if(attr.name.startsWith('on')) el.removeAttribute(attr.name);
                    });
                });

                const assetUrls = [];
                let assetId = 0;

                document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
                    if (el.href && !el.href.startsWith('data:')) {
                        const localPath = 'css/style-' + (assetId++) + '.css';
                        assetUrls.push({ url: el.href, localPath, type: 'css' });
                        el.href = localPath;
                    }
                });

                document.querySelectorAll('img, source').forEach(el => {
                    if (el.src && !el.src.startsWith('data:')) {
                        const ext = el.src.split('.').pop().split('?')[0] || 'png';
                        const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                        const localPath = 'assets/img-' + (assetId++) + '.' + safeExt;
                        assetUrls.push({ url: el.src, localPath, type: 'asset' });
                        el.src = localPath;
                    }
                    if (el.srcset) el.removeAttribute('srcset');
                });

                document.querySelectorAll('style').forEach(el => {
                    const localPath = 'css/inline-' + (assetId++) + '.css';
                    assetUrls.push({ text: el.innerHTML, localPath, type: 'inline-css' });
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = localPath;
                    el.replaceWith(link);
                });

                return {
                    html: document.documentElement.outerHTML,
                    assetUrls,
                    tokens: { colors, fonts: Array.from(fonts), spacing },
                    layout: { sections },
                    components,
                    elementCount: document.querySelectorAll('*').length
                };
            })();
        