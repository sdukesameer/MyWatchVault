// js/utils.js
// Shared utilities, error handling, and UI helpers

export function escapeHTML(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

let activeToasts = 0;
export function showToast(msg, type = 'info', actionText = null, onAction = null, duration = 3200) {
    if (activeToasts >= 3) return; // Prevent spam

    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.setAttribute('aria-live', 'polite');
    
    const textSpan = document.createElement('span');
    textSpan.textContent = msg;
    t.appendChild(textSpan);

    if (actionText && onAction) {
        const actionBtn = document.createElement('button');
        actionBtn.textContent = actionText;
        actionBtn.className = 'toast-action';
        actionBtn.style.cssText = 'margin-left: 12px; background: none; border: none; color: inherit; font-weight: bold; cursor: pointer; text-decoration: underline;';
        actionBtn.onclick = () => {
            onAction();
            closeToast();
        };
        t.appendChild(actionBtn);
    }

    const container = document.getElementById('toast-container');
    if (container) container.appendChild(t);
    activeToasts++;

    setTimeout(() => t.classList.add('show'), 10);
    
    let timeoutId;
    const closeToast = () => {
        clearTimeout(timeoutId);
        t.classList.remove('show');
        setTimeout(() => {
            t.remove();
            activeToasts--;
        }, 400);
    };

    if (duration > 0) {
        timeoutId = setTimeout(closeToast, duration);
    }
}

let _loadingTimeout = null;
export function showLoading(msg, sub = '', timeoutMs = 0) {
    const loader = document.getElementById('loading-overlay');
    if (!loader) return;
    
    document.getElementById('loading-text').textContent = msg;
    document.getElementById('loading-sub').textContent = sub;
    loader.classList.remove('hidden');
    
    if (_loadingTimeout) clearTimeout(_loadingTimeout);
    
    if (timeoutMs > 0) {
        _loadingTimeout = setTimeout(() => {
            hideLoading();
            showToast('Operation timed out', 'error');
        }, timeoutMs);
    }
}

export function hideLoading() {
    if (_loadingTimeout) clearTimeout(_loadingTimeout);
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.classList.add('hidden');
}

export function handleError(error, { source = 'App', userMessage = 'An error occurred', toast = true } = {}) {
    console.error(`[${source}] Error:`, error);
    if (toast) {
        showToast(userMessage, 'error');
    }
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function setupModalAccessibility(modalId, closeBtnId, closeCallback) {
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeBtnId);
    if (!modal) return;

    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            e.stopPropagation();
            closeCallback();
        }

        if (e.key === 'Tab' && !modal.classList.contains('hidden')) {
            const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusableElements.length === 0) return;
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey) { 
                if (document.activeElement === firstElement) {
                    lastElement.focus();
                    e.preventDefault();
                }
            } else { 
                if (document.activeElement === lastElement) {
                    firstElement.focus();
                    e.preventDefault();
                }
            }
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', closeCallback);
    }
}
