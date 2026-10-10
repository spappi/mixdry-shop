
            (() => {
                const p = {
                    siteType: 'server-rendered',
                    techStack: [],
                    menuTree: {},
                    urlPatterns: [],
                    pageEstimate: 0,
                    apiCount: {},
                    crawlConfig: {
                        maxDepth: 2,
                        maxPages: 500,
                        excludePatterns: ['login', 'cart', 'member', 'mymenu', 'my_group', 'mypage', 'auth', 'board_style=view', 'write'],
                        paramBlacklist: [],
                        sitemapUrls: {}
                    }
                };

                if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')) p.techStack.push('React');
                if (window.__VUE__ || document.querySelector('[data-v-app]')) p.techStack.push('Vue');
                if (window.__NUXT__) { p.techStack.push('Nuxt.js'); p.siteType = 'spa'; }
                if (window.__NEXT_DATA__) { p.techStack.push('Next.js'); p.siteType = 'spa'; }
                if (window.angular || document.querySelector('[ng-app]')) p.techStack.push('Angular');
                if (window.jQuery) p.techStack.push('jQuery');

                const navLinks = Array.from(document.querySelectorAll('nav a, header a, .menu a, .gnb a'));
                navLinks.forEach(a => {
                    if (a.href && a.innerText.trim()) {
                        const text = a.innerText.trim().replace(/\\n/g, ' ');
                        if (text.length < 20) p.menuTree[text] = a.href;
                    }
                });

                const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h && h.startsWith('http'));
                const uniqueLinks = [...new Set(allLinks)];
                p.pageEstimate = Math.max(10, uniqueLinks.length * 3);

                const trackParams = ['utm_source', 'utm_medium', 'utm_campaign', 'timeKey', 'sessionid', 'PHPSESSID', 'fbclid', 'gclid'];
                const detectedParams = new Set();
                uniqueLinks.forEach(l => {
                    try {
                        const u = new URL(l);
                        for (const key of u.searchParams.keys()) {
                            if (trackParams.includes(key) || key.startsWith('utm_')) {
                                detectedParams.add(key);
                            }
                        }
                    } catch(e){}
                });
                p.crawlConfig.paramBlacklist = Array.from(detectedParams);

                const patterns = {};
                uniqueLinks.forEach(l => {
                    try {
                        const u = new URL(l);
                        if (u.origin === window.location.origin) {
                            const pt = u.pathname.split('/').slice(0, 2).join('/');
                            patterns[pt] = (patterns[pt] || 0) + 1;
                        }
                    } catch(e){}
                });
                
                const sortedPatterns = Object.entries(patterns).sort((a,b) => b[1] - a[1]);
                p.urlPatterns = sortedPatterns.slice(0, 10).map(x => x[0]).filter(Boolean);

                if (p.urlPatterns.some(pt => pt.includes('board') || pt.includes('bbs') || pt.includes('forum'))) {
                    p.siteType = 'board-heavy';
                    p.crawlConfig.maxDepth = 2;
                } else if (p.urlPatterns.some(pt => pt.includes('product') || pt.includes('goods') || pt.includes('item'))) {
                    p.siteType = 'catalog';
                    p.crawlConfig.maxDepth = 2;
                } else if (p.urlPatterns.some(pt => pt.includes('blog') || pt.includes('post') || pt.includes('article'))) {
                    p.siteType = 'blog';
                    p.crawlConfig.maxDepth = 1;
                } else if (uniqueLinks.length < 5) {
                    p.siteType = 'single-landing';
                    p.crawlConfig.maxDepth = 0;
                }

                sortedPatterns.forEach(([pt, count]) => {
                    if (count > uniqueLinks.length * 0.3) {
                        if (pt.includes('board') || pt.includes('view') || pt.includes('article')) {
                            if (!p.crawlConfig.excludePatterns.includes(pt)) {
                                p.crawlConfig.excludePatterns.push(pt);
                            }
                        }
                    }
                });

                return p;
            })();
        