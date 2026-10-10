
                    (() => {
                        try {
                            return { ok: true, data: (() => {
                                const urlMap = {};
                        const paramBlacklist = {};
                        const currentLocalPath = "dummy";
                        const prefix = currentLocalPath === 'index.html' ? './' : '../';
                        
                        function normalize(href) {
                            try {
                                const u = new URL(href, window.location.href);
                                u.hash = '';
                                paramBlacklist.forEach(p => u.searchParams.delete(p.trim()));
                                let s = u.toString();
                                if (s.endsWith('/') && s.length > u.origin.length + 1) s = s.slice(0, -1);
                                return s;
                            } catch(e) { return href; }
                        }

                        document.querySelectorAll('a').forEach(a => {
                            if (!a.href || a.href.startsWith('javascript:')) return;
                            const norm = normalize(a.href);
                            if (urlMap[norm]) {
                                const to = urlMap[norm];
                                if (currentLocalPath === 'index.html') a.href = './' + to;
                                else if (to === 'index.html') a.href = '../index.html';
                                else a.href = './' + to.replace('pages/', '');
                            } else {
                                a.target = "_blank";
                            }
                        });

                        const globalCssMap = {};
                        const globalImgMap = {};
                        let nextCssId = {};
                        let nextImgId = {};
                        let nextInlineId = {};

                        const newAssets = [];
                        
                        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
                            if (el.href && !el.href.startsWith('data:')) {
                                let lp = globalCssMap[el.href];
                                if (!lp) {
                                    lp = 'css/style-' + (nextCssId++) + '.css';
                                    newAssets.push({ url: el.href, localPath: lp, type: 'css' });
                                }
                                el.href = prefix + lp;
                            }
                        });

                        document.querySelectorAll('img, source').forEach(el => {
                            const rawSrc = el.getAttribute('src');
                            if (!rawSrc || rawSrc.trim() === '') return;
                            if (el.src && !el.src.startsWith('data:')) {
                                let lp = globalImgMap[el.src];
                                if (!lp) {
                                    const ext = el.src.split('.').pop().split('?')[0] || 'png';
                                    const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                                    lp = 'assets/img-' + (nextImgId++) + '.' + safeExt;
                                    newAssets.push({ url: el.src, localPath: lp, type: 'asset' });
                                }
                                el.src = prefix + lp;
                            }
                            if (el.srcset) el.removeAttribute('srcset');
                        });

                        const parseCssUrls = (text, isInline) => {
                            const matches = text.match(/url\(['"]?(.*?)['"]?\)/g);
                            if (!matches) return text;
                            let newText = text;
                            matches.forEach(m => {
                                const inner = m.replace(/url\(['"]?/, '').replace(/['"]?\)/, '').trim();
                                if (!inner || inner.startsWith('data:')) return;
                                try {
                                    const u = new URL(inner, window.location.href).toString();
                                    let lp = globalImgMap[u];
                                    if (!lp) {
                                        const ext = u.split('.').pop().split('?')[0] || 'png';
                                        const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                                        lp = 'assets/img-' + (nextImgId++) + '.' + safeExt;
                                        newAssets.push({ url: u, localPath: lp, type: 'asset' });
                                    }
                                    const newUrl = prefix + lp;
                                    newText = newText.replace(m, 'url("' + newUrl + '")');
                                } catch(e){}
                            });
                            return newText;
                        };

                        document.querySelectorAll('*[style]').forEach(el => {
                            const newStyle = parseCssUrls(el.getAttribute('style'), true);
                            if (newStyle !== el.getAttribute('style')) el.setAttribute('style', newStyle);
                        });

                        document.querySelectorAll('style').forEach(el => {
                            const parsedCss = parseCssUrls(el.innerHTML, false);
                            const lp = 'css/inline-' + (nextInlineId++) + '.css';
                            newAssets.push({ text: parsedCss, localPath: lp, type: 'inline-css' });
                            const link = document.createElement('link');
                            link.rel = 'stylesheet';
                            link.href = prefix + lp;
                            el.replaceWith(link);
                        });

                        document.querySelectorAll('script, iframe, noscript').forEach(s => s.remove());
                        const iter = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT, null, false);
                        let node;
                        const comments = [];
                        while(node = iter.nextNode()) comments.push(node);
                        comments.forEach(c => c.remove());

                        let tokens = null, layout = null, components = null;
                        if (currentLocalPath === 'index.html') {
                            const colorMap = {};
                            const fonts = new Set();
                            document.querySelectorAll('*').forEach(el => {
                                const s = window.getComputedStyle(el);
                                const bg = s.backgroundColor;
                                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorMap[bg] = (colorMap[bg] || 0) + 1;
                                const c = s.color;
                                if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colorMap[c] = (colorMap[c] || 0) + 1;
                                if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
                            });
                            tokens = {
                                colors: Object.entries(colorMap).sort((a,b)=>b[1]-a[1]).map(e=>e[0]).slice(0,10),
                                fonts: Array.from(fonts)
                            };
                            layout = { sections: [] };
                            components = [];
                        }

                        return {
                            html: document.documentElement.outerHTML,
                            textContent: document.body ? document.body.innerText.replace(/\s+/g, ' ').toLowerCase() : '',
                            newAssets, tokens, layout, components,
                            nextCssId, nextImgId, nextInlineId
                        };
                            })() };
                        } catch (err) {
                            return { ok: false, error: err.message, stack: err.stack };
                        }
                    })();
                