/**
 * GJC Reversing Workbench - Standard Interaction Library
 * Version: 1.0.0
 * Description: Data-attribute driven lightweight UI behaviors.
 */
window.GJC_INTERACTIONS_VERSION = '1.0.0';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Toggles (data-gjc-toggle)
    // clicking an element with data-gjc-toggle will toggle display of its target or its next sibling
    document.querySelectorAll('[data-gjc-toggle]').forEach(el => {
        if (el.dataset.gjcInit) return;
        el.dataset.gjcInit = "true";
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetSelector = el.getAttribute('data-gjc-toggle');
            let target = null;
            if (targetSelector && targetSelector !== 'true') {
                target = document.querySelector(targetSelector);
            } else {
                const getTarget = (base) => {
                    let sib = base.nextElementSibling;
                    while (sib) {
                        if (sib.matches('ul, ol, nav, .menu, .submenu, .depth2')) {
                            const nested = sib.querySelector('ul[style*="display: none"], ul[style*="display:none"], .gnb-all, .gnb-2ul, .submenu, .depth2');
                            if (nested) return nested;
                            return sib;
                        }
                        if (sib.matches('div') && window.getComputedStyle(sib).display === 'none' && !sib.matches('[data-gjc-toggle], .text, .hamburger, .icon, .label')) return sib;
                        sib = sib.nextElementSibling;
                    }
                    return null;
                };
                target = getTarget(el);
                if (!target && el.parentElement) target = getTarget(el.parentElement);
                if (!target && el.parentElement) target = el.parentElement.querySelector('ul, nav');
            }
            if (target) {
                const currentDisplay = window.getComputedStyle(target).display;
                if (currentDisplay === 'none') {
                    target.style.display = 'block';
                } else {
                    target.style.display = 'none';
                }
            }
        });
    });

    // 2. Tabs (data-gjc-tabs)
    document.querySelectorAll('[data-gjc-tabs]').forEach(container => {
        if (container.dataset.gjcInit) return;
        container.dataset.gjcInit = "true";
        const tabs = container.querySelectorAll('[data-gjc-tab]');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = tab.getAttribute('data-gjc-tab');
                if (!targetId) return;
                
                // Hide all panels
                container.querySelectorAll('.gjc-tab-panel').forEach(p => p.style.display = 'none');
                
                // Remove active class from tabs
                tabs.forEach(t => t.classList.remove('active'));
                
                // Show target panel
                const panel = document.getElementById(targetId) || container.querySelector(targetId);
                if (panel) {
                    panel.style.display = 'block';
                    if (!panel.classList.contains('gjc-tab-panel')) panel.classList.add('gjc-tab-panel');
                }
                tab.classList.add('active');
            });
        });
    });

    // 3. Modals (data-gjc-modal-open)
    document.querySelectorAll('[data-gjc-modal-open]').forEach(btn => {
        if (btn.dataset.gjcInit) return;
        btn.dataset.gjcInit = "true";
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(btn.getAttribute('data-gjc-modal-open'));
            if (target) target.style.display = 'block';
        });
    });
    
    document.querySelectorAll('[data-gjc-modal]').forEach(modal => {
        if (modal.dataset.gjcInit) return;
        modal.dataset.gjcInit = "true";
        const closeBtn = modal.querySelector('.close, .btn-close, [data-gjc-modal-close]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => modal.style.display = 'none');
        }
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });
});
