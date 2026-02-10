// Telegram Web App API
const tg = window.Telegram?.WebApp;

// Initialize Telegram Web App
if (tg) {
    tg.ready();
    tg.expand();

    // Use Telegram theme colors
    // Force Monochrome Premium Theme (Ignore Telegram Dark Mode)
    tg.setHeaderColor('#ffffff');
    tg.setBackgroundColor('#ffffff');

    // Reset CSS variables to strict white theme
    document.documentElement.style.setProperty('--tg-bg-color', '#ffffff');
    document.documentElement.style.setProperty('--tg-text-color', '#000000');
    document.documentElement.style.setProperty('--tg-secondary-bg-color', '#f9f9f9');
    document.documentElement.style.setProperty('--tg-button-color', '#000000');
    document.documentElement.style.setProperty('--tg-button-text-color', '#ffffff');

    // Handle viewport changes (only expand)
    tg.onEvent('viewportChanged', () => {
        tg.expand();
    });

    // Force light theme status bar
    if (tg.setHeaderColor) {
        tg.setHeaderColor('#ffffff');
    }
}

// Global state
let currentSection = null;
let userData = null;
let cartItems = [];
let favoritesSet = new Set();
let supportChatInterval = null;

// API Base URL - adjust based on your backend
const API_BASE = '/webapp/api';

// Shop/catalog UI state (tabs)
let SHOP_ACTIVE_CATEGORY_ID = 'all'; // 'all' | categoryId
let SHOP_CATEGORIES_CACHE = null;
let SHOP_PRODUCTS_CACHE = null;

// Certificates (types)
let CERT_TYPES_CACHE = null;

// Optional client-side catalog structure (categories -> subcategories -> SKU mapping)
let CATALOG_STRUCTURE = null;

async function loadCatalogStructure() {
    if (CATALOG_STRUCTURE) return CATALOG_STRUCTURE;
    try {
        const res = await fetch(`${API_BASE}/catalog-structure`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.success && Array.isArray(data.structure)) {
            CATALOG_STRUCTURE = data.structure;
            return CATALOG_STRUCTURE;
        }
    } catch (e) {
        console.warn('Failed to load catalog structure:', e);
    }
    CATALOG_STRUCTURE = null;
    return null;
}

function normalizeSku(sku) {
    return String(sku || '').trim().toUpperCase();
}

function skuPrefix(sku) {
    const s = normalizeSku(sku);
    const m = s.match(/^([A-Z]{1,3}\\d{4})-/);
    return m ? m[1] : '';
}

function matchProductsByRelatedSkus(allProducts, relatedSkus) {
    const want = (Array.isArray(relatedSkus) ? relatedSkus : []).map(normalizeSku);
    const wantSet = new Set(want);
    const wantPrefixes = new Set(want.map(skuPrefix).filter(Boolean));

    const out = [];
    const seen = new Set();
    for (const p of (allProducts || [])) {
        const ps = normalizeSku(p.sku || '');
        if (!ps) continue;
        const okExact = wantSet.has(ps);
        const okPrefix = wantPrefixes.size ? wantPrefixes.has(skuPrefix(ps)) : false;
        if (okExact || okPrefix) {
            if (!seen.has(p.id)) {
                seen.add(p.id);
                out.push(p);
            }
        }
    }
    return out;
}

function dedupeByKey(items, getKey) {
    const out = [];
    const seen = new Set();
    for (const item of (items || [])) {
        const key = String(getKey(item) || '');
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function dedupeProductsById(products) {
    const out = [];
    const seen = new Set();
    for (const p of (products || [])) {
        const id = p && p.id;
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(p);
    }
    return out;
}

function dedupeCategoriesPreferMoreProducts(categories, productsByCategory) {
    // 1) убираем повторы по id
    const byId = new Map();
    (categories || []).forEach(cat => {
        if (cat && cat.id && !byId.has(cat.id)) byId.set(cat.id, cat);
    });
    const uniqueById = Array.from(byId.values());

    // 2) убираем повторы по name (берём категорию с большим количеством товаров)
    const byName = new Map();
    uniqueById.forEach(cat => {
        const name = String(cat?.name || '').trim();
        if (!name) return;
        const count = (productsByCategory && productsByCategory[cat.id]) ? productsByCategory[cat.id].length : 0;
        const prev = byName.get(name);
        if (!prev || count > prev.count) {
            byName.set(name, { cat, count });
        }
    });
    return Array.from(byName.values()).map(x => x.cat);
}

async function fetchAllActiveProducts() {
    const categoriesRes = await fetch(`${API_BASE}/categories`);
    if (!categoriesRes.ok) throw new Error('Failed to fetch categories');
    const categories = await categoriesRes.json();
    const all = [];
    (categories || []).forEach(cat => {
        (cat.products || []).forEach(p => all.push(p));
    });
    return all;
}

// Get Telegram user data
function getTelegramUserData() {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        return tg.initDataUnsafe.user;
    }

    // Fallback for development
    return {
        id: 123456789,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'ru'
    };
}

// Get headers with Telegram user data
function getApiHeaders() {
    const user = getTelegramUserData();
    const headers = {
        'Content-Type': 'application/json',
        'X-Telegram-User': JSON.stringify(user)
    };

    // Add init data if available (for backend verification)
    if (tg && tg.initData) {
        headers['X-Telegram-Init-Data'] = tg.initData;
    }

    return headers;
}

function pzToRub(pz) {
    return Math.round(Number(pz || 0));
}

function formatRubFromPz(pz) {
    return `${pzToRub(pz)} ₽`;
}

// Initialize app
document.addEventListener('DOMContentLoaded', function () {
    loadUserData();
    loadCartItems();
    loadFavorites();
    updateBadges();
    loadProductsOnMainPage(); // Load products immediately on main page

    // Apply Telegram theme colors on load
    // Force Telegram Theme Variables Override on Load
    if (tg) {
        document.documentElement.style.setProperty('--tg-bg-color', '#ffffff');
        document.documentElement.style.setProperty('--tg-text-color', '#000000');
        document.documentElement.style.setProperty('--tg-secondary-bg-color', '#f9f9f9');
        document.documentElement.style.setProperty('--tg-button-color', '#000000');
        document.documentElement.style.setProperty('--tg-button-text-color', '#ffffff');
        document.documentElement.style.setProperty('--accent', '#000000');
    }

    // Add haptic feedback for buttons (if available)
    function addHapticFeedback(element) {
        element.addEventListener('click', function () {
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        });
    }

    // Add haptic feedback to all buttons
    document.querySelectorAll('.btn, .control-btn, .back-btn, .content-card, .nav-item').forEach(addHapticFeedback);
});

// Ensure product cards open details on click (even if markup changes)
document.addEventListener('click', function (e) {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('button, a, input, label, .favorite-btn')) return;
    const card = target.closest('.product-card-forma, .product-card-forma-horizontal');
    if (!card) return;
    const id = card.getAttribute('data-product-id');
    if (!id) return;
    const type = card.getAttribute('data-product-type');
    if (type === 'plazma') showPlazmaProductDetails(id);
    else showProductDetails(id);
});

// Favorites (webapp)
async function loadFavorites() {
    try {
        const response = await fetch(`${API_BASE}/favorites`, { headers: getApiHeaders() });
        if (!response.ok) {
            favoritesSet = new Set();
            return;
        }
        const data = await response.json();
        const ids = Array.isArray(data?.productIds) ? data.productIds : [];
        favoritesSet = new Set(ids.map(String));
    } catch (e) {
        console.error('❌ Error loading favorites:', e);
        favoritesSet = new Set();
    }
}

function isFavorite(productId) {
    return favoritesSet && favoritesSet.has(String(productId));
}

function renderFavoriteButton(productId) {
    const active = isFavorite(productId);
    const cls = active ? 'favorite-btn active' : 'favorite-btn';
    const label = active ? 'Убрать из избранного' : 'В избранное';
    const icon = active ? '♥' : '♡';
    return `<button class="${cls}" aria-label="${label}" title="${label}" onclick="event.stopPropagation(); toggleFavorite('${productId}', this)">${icon}</button>`;
}

async function toggleFavorite(productId, btnEl) {
    if (!productId) return;
    try {
        // Optimistic update
        const currently = isFavorite(productId);
        if (currently) favoritesSet.delete(String(productId));
        else favoritesSet.add(String(productId));

        if (btnEl) {
            const nowActive = !currently;
            btnEl.classList.toggle('active', nowActive);
            btnEl.textContent = nowActive ? '♥' : '♡';
        }

        const response = await fetch(`${API_BASE}/favorites/toggle`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ productId })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData?.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const serverActive = !!data?.isFavorite;
        if (serverActive) favoritesSet.add(String(productId));
        else favoritesSet.delete(String(productId));

        if (btnEl) {
            btnEl.classList.toggle('active', serverActive);
            btnEl.textContent = serverActive ? '♥' : '♡';
        }

        // If we're currently in favorites screen, refresh it
        if (currentSection === 'favorites') {
            const body = document.getElementById('section-body');
            if (body) {
                body.innerHTML = await loadFavoritesContent();
            }
        }
    } catch (e) {
        console.error('❌ Error toggling favorite:', e);
        showError('Не удалось обновить избранное. Попробуйте позже.');
        await loadFavorites();
        if (btnEl) {
            const active = isFavorite(productId);
            btnEl.classList.toggle('active', active);
            btnEl.textContent = active ? '♥' : '♡';
        }
    }
}

// Navigation functions
function closeApp() {
    if (tg) {
        tg.close();
    } else {
        // Fallback for development
        console.log('Closing app...');
    }
}

// Menu functions
function openMenu() {
    const drawer = document.getElementById('menu-drawer');
    drawer.classList.remove('hidden');
    setTimeout(() => {
        drawer.classList.add('open');
    }, 10);
}

function closeMenu() {
    const drawer = document.getElementById('menu-drawer');
    drawer.classList.remove('open');
    setTimeout(() => {
        drawer.classList.add('hidden');
    }, 300);
}

// Search functions
function openSearch() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.classList.add('open');
        loadCategoriesForSearch();
    }, 10);
}

function closeSearch() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.remove('open');
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 300);
}

async function loadCategoriesForSearch() {
    const container = document.getElementById('search-body');
    try {
        const structure = await loadCatalogStructure();
        if (structure && structure.length > 0) {
            let html = '<div class="categories-list">';
            structure.forEach(group => {
                html += `
                    <div class="category-item" onclick="openStructuredCategory('${group.id}')">
                        <span class="category-icon">📁</span>
                        <span class="category-name">${escapeHtml(group.name)}</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
            return;
        }

        // fallback to DB categories
        const response = await fetch(`${API_BASE}/categories`);
        if (!response.ok) throw new Error('Failed to fetch categories');
        const categories = await response.json();
        if (categories && categories.length > 0) {
            let html = '<div class="categories-list">';
            categories.forEach(category => {
                html += `
                    <div class="category-item" onclick="showCategoryProducts('${category.id}')">
                        <span class="category-icon">📁</span>
                        <span class="category-name">${escapeHtml(category.name)}</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div class="empty-state"><p>Категории не найдены</p></div>';
        }
    } catch (error) {
        console.error('Error loading categories:', error);
        container.innerHTML = '<div class="error-message"><p>Ошибка загрузки категорий</p></div>';
    }
}

async function openStructuredCategory(groupId) {
    closeSearch();
    openSection('shop');
    await showStructuredCategory(groupId);
}

async function showStructuredCategory(groupId) {
    const container = document.getElementById('section-body');
    try {
        const structure = await loadCatalogStructure();
        const group = (structure || []).find(g => g.id === groupId);
        if (!group) throw new Error('Category group not found');

        let html = '<div class="content-section">';
        html += `<button class="btn-back-to-catalog" onclick="openSection('shop')" style="margin-bottom: 12px;">← Назад</button>`;
        html += `<h3>${escapeHtml(group.name)}</h3>`;
        html += '<div class="categories-list" style="margin-top:10px;">';
        (group.subcategories || []).forEach(sc => {
            html += `
                <div class="category-item" onclick="showStructuredSubcategory('${group.id}','${sc.id}')">
                    <span class="category-icon">🧴</span>
                    <span class="category-name">${escapeHtml(sc.name)}</span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
            `;
        });
        html += '</div></div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('Structured category error:', e);
        container.innerHTML = '<div class="error-message"><p>Ошибка загрузки категорий</p></div>';
    }
}

async function showStructuredSubcategory(groupId, subId) {
    const container = document.getElementById('section-body');
    try {
        const structure = await loadCatalogStructure();
        const group = (structure || []).find(g => g.id === groupId);
        const sub = group && (group.subcategories || []).find(s => s.id === subId);
        if (!group || !sub) throw new Error('Subcategory not found');

        const allProducts = await fetchAllActiveProducts();
        const products = matchProductsByRelatedSkus(allProducts, sub.related_skus);

        let html = '<div class="content-section">';
        html += `<button class="btn-back-to-catalog" onclick="showStructuredCategory('${group.id}')" style="margin-bottom: 12px;">← ${escapeHtml(group.name)}</button>`;
        html += `<h3>${escapeHtml(sub.name)}</h3>`;
        if (sub.description) html += `<p style="color:#6b7280; margin-top:6px;">${escapeHtml(sub.description)}</p>`;

        if (products && products.length > 0) {
            html += '<div class="products-grid" style="margin-top:12px;">';
            products.forEach(product => { html += renderProductCard(product); });
            html += '</div>';
        } else {
            html += '<div class="empty-state"><p>Товары не найдены</p></div>';
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('Structured subcategory error:', e);
        container.innerHTML = '<div class="error-message"><p>Ошибка загрузки товаров</p></div>';
    }
}

function showCategoryProducts(categoryId) {
    closeSearch();
    openShopCategory(categoryId);
}

async function loadProductsByCategory(categoryId) {
    const container = document.getElementById('section-body');
    try {
        // Backward compatible wrapper - now uses tabbed catalog
        await openShopCategory(categoryId);
    } catch (error) {
        console.error('Error loading products:', error);
        container.innerHTML = '<div class="error-message"><p>Ошибка загрузки товаров</p></div>';
    }
}

// Profile functions
function openProfile() {
    const overlay = document.getElementById('profile-overlay');
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.classList.add('open');
        loadProfileContent();
    }, 10);
}

function closeProfile() {
    const overlay = document.getElementById('profile-overlay');
    overlay.classList.remove('open');
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 300);
}

async function loadProfileContent() {
    const container = document.getElementById('profile-body');
    try {
        // Load user profile and partner data
        const [userResponse, partnerResponse] = await Promise.all([
            fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() }),
            fetch(`${API_BASE}/partner/dashboard`, { headers: getApiHeaders() }).catch(() => ({ ok: false }))
        ]);

        if (!userResponse.ok) throw new Error('Failed to load user profile');

        const user = await userResponse.json();
        const partnerData = partnerResponse.ok ? await partnerResponse.json() : null;

        // Handle structure { profile: ..., stats: ... }
        const partner = partnerData?.profile || null;
        const stats = partnerData?.stats || null;

        const telegramUser = getTelegramUserDataSafe(); // Use safe wrapper

        // Реферальная ссылка с юзернеймом в конце
        const botUsername = 'PLAZMA_test8_bot';
        let referralLink = `https://t.me/${botUsername}`;

        // Получаем username пользователя для реферальной ссылки
        let username = null;
        if (telegramUser?.username?.trim()) {
            username = telegramUser.username.trim();
        } else if (user?.username?.trim()) {
            username = user.username.trim();
        }

        // Формируем ссылку: ПРИОРИТЕТ 1 - referralCode партнера
        if (partner?.referralCode) {
            const prefix = partner.programType === 'MULTI_LEVEL' ? 'ref_multi' : 'ref_direct';
            referralLink = `https://t.me/${botUsername}?start=${prefix}_${partner.referralCode}`;
        }
        // ПРИОРИТЕТ 2 - username (старый формат)
        else if (username) {
            referralLink = `https://t.me/${botUsername}?start=${username}`;
        }
        // Fallback: используем ID
        else {
            const userId = telegramUser?.id || user?.telegramId;
            if (userId) {
                referralLink = `https://t.me/${botUsername}?start=${userId}`;
            }
        }

        let html = `
            <div class="profile-content-wrapper">
                <div class="profile-header-info">
                    <div class="profile-avatar">
                        <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </div>
                    <h3>${escapeHtml(user.firstName || 'Пользователь')} ${escapeHtml(user.lastName || '')}</h3>
                    ${user.username ? `<p class="profile-username">@${escapeHtml(user.username)}</p>` : ''}
                </div>
                
                <div class="profile-section">
                    <h4>Реферальная ссылка</h4>
                    <div class="referral-link-box">
                        <input type="text" id="referral-link-input" value="${escapeHtml(referralLink)}" readonly onclick="this.select();">
                        <button class="btn-copy" onclick="copyReferralLink()">📋</button>
                    </div>
                    <p class="referral-hint">Поделитесь этой ссылкой с друзьями и получайте бонусы!</p>
                </div>
        `;

        if (partner) {
            // Partner Dashboard
            const referralCode = partner.referralCode;
            const balance = partner.balance || 0;
            const bonuses = partner.bonus || 0;
            const totalPartners = stats?.partners || partner.totalPartners || 0;

            const isActive = partner.isActive;
            const expiresAt = partner.expiresAt ? new Date(partner.expiresAt) : null;
            const activatedAt = partner.activatedAt ? new Date(partner.activatedAt) : null;

            // Format dates
            const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
            const expireDateStr = expiresAt ? dateFormatter.format(expiresAt) : '-';
            const activeSinceStr = activatedAt ? dateFormatter.format(activatedAt) : '-';

            html += `
            <div class="partner-dashboard">
                <div class="partner-header">
                    <h2>Партнёрская программа</h2>
                    <div class="partner-status ${isActive ? 'badge-success' : 'badge-warning'}">
                        ${isActive ? 'Активен' : 'Не активен'}
                    </div>
                </div>
                
                ${isActive ? `
                <div class="partner-subscription-info" style="margin-bottom: 15px; padding: 12px; background: #f0f7ff; border-radius: 8px;">
                    <div style="font-size: 14px; margin-bottom: 4px;">📅 Подписка активна до: <strong>${expireDateStr}</strong></div>
                    <div style="font-size: 14px; color: #666;">Следующий платеж: ${expireDateStr}</div>
                </div>
                ` : `
                <div class="partner-subscription-info" style="margin-bottom: 15px; padding: 12px; background: #fff3f3; border-radius: 8px;">
                     <div style="font-size: 14px; color: #d63031;">Подписка не активна. Совершите покупку от 15 000 ₽ для активации.</div>
                </div>
                `}

                <div class="partner-stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${balance.toFixed(0)} ₽</div>
                        <div class="stat-label">Баланс</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${bonuses.toFixed(0)} ₽</div>
                        <div class="stat-label">Заработано</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${totalPartners}</div>
                        <div class="stat-label">Партнёров</div>
                    </div>
                </div>

                <div class="referral-section">
                    <h3>Ваша реферальная ссылка</h3>
                    <p>Станьте партнёром Vital и получайте 25% по вашей ссылке!</p>
                    
                    <div class="referral-link-box">
                        <input type="text" value="${referralLink}" readonly id="refLinkInput">
                        <button class="btn-icon" onclick="copyReferralLink()">
                            📋
                        </button>
                    </div>

                    <div style="margin-top: 12px; display: flex; gap: 10px;">
                        <button class="btn" onclick="shareReferralLink('${referralLink}')">
                            📤 Поделиться
                        </button>
                         <button class="btn btn-secondary" onclick="showQrCode('${escapeAttr(partner.referralDirectQrUrl || '')}')" style="width: auto; aspect-ratio: 1;">
                            📱 QR
                        </button>
                    </div>
                </div>

                <div class="partner-info-card">
                    <h3>Условия программы</h3>
                    <ul class="partner-benefits">
                        <li>
                            <span class="benefit-icon">💎</span>
                            <div>
                                <strong>25% с покупок</strong>
                                <p>Вы получаете 25% от суммы заказов ваших прямых рефералов.</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>`;
        } else {
            // Not a partner or not active
            html += `
            <div class="partner-promo">
                <div class="promo-icon">🤝</div>
                <h2>Станьте партнёром</h2>
                <p>Рекомендуйте Plazma и зарабатывайте 25% с покупок ваших друзей!</p>

                <div class="benefits-grid">
                    <div class="benefit-item">
                        <div class="benefit-value">25%</div>
                        <div class="benefit-desc">Комиссия с продаж</div>
                    </div>
                    <div class="benefit-item">
                        <div class="benefit-value">0 ₽</div>
                        <div class="benefit-desc">Вложений</div>
                    </div>
                </div>

                <div class="promo-actions">
                   <p style="opacity: 0.8; font-size: 14px; margin-bottom: 16px;">
                     Для активации партнерской программы необходимо совершить покупку от 15 000 ₽.
                   </p>
                   <button class="btn" onclick="openShop()">Перейти в каталог</button>
                </div>
            </div>`;
        }

        html += `
                <div class="profile-section">
                    <h4>Баланс</h4>
                    <div class="balance-display">
                        <span class="balance-value">${formatRubFromPz(user.balance || 0)}</span>
                    </div>
                    <button class="btn" onclick="openSection('balance')" style="margin-top: 12px; width: 100%;">Пополнить баланс</button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading profile:', error);
        container.innerHTML = '<div class="error-message"><p>Ошибка загрузки профиля</p></div>';
    }
}

async function copyReferralLink(link) {
    const input = document.getElementById('referral-link-input');

    let linkText = (link ?? (input?.value ?? '')).toString();

    // Clean up the link text - remove any undefined/null values
    if (linkText.includes('undefined') || linkText.includes('null')) {
        console.warn('Link contains undefined/null, cleaning up...');
        linkText = linkText.replace(/undefined/g, '').replace(/null/g, '');
    }

    linkText = linkText.trim();

    // Final validation
    if (!linkText || linkText === 'undefined' || linkText === 'null') {
        console.error('Referral link is empty or invalid:', linkText);
        showError('Ошибка: ссылка не загружена. Попробуйте обновить страницу.');
        return;
    }

    // Ensure it's a valid URL
    if (!linkText.startsWith('http')) {
        console.error('Invalid link format:', linkText);
        showError('Ошибка: неверный формат ссылки');
        return;
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(linkText);
        } else {
            // Fallback for older browsers
            if (input) {
                input.value = linkText;
                input.select();
                input.setSelectionRange(0, 99999);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = linkText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
        }

        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }

        showSuccess('✅ Реферальная ссылка скопирована!');
    } catch (error) {
        console.error('Error copying referral link:', error);
        showError('Ошибка копирования ссылки. Попробуйте выделить и скопировать вручную.');
    }
}

// Cart function
function openCart() {
    openSection('cart');
}

async function loadCartContent() {
    try {
        const response = await fetch(`${API_BASE}/cart/items`, { headers: getApiHeaders() });

        if (!response.ok) {
            if (response.status === 401) {
                console.warn('⚠️ Unauthorized - user not authenticated');
                return `
                    <div class="content-section">
                        <h3>Корзина</h3>
                        <p>Для просмотра корзины необходимо авторизоваться</p>
                        <button class="btn" onclick="closeSection(); loadProductsOnMainPage();">Перейти к каталогу</button>
                    </div>
                `;
            }

            if (response.status === 503) {
                console.error('❌ Service unavailable');
                let errorData = {};
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { error: 'Сервис временно недоступен' };
                }
                return `
                    <div class="content-section">
                        <div class="error-message">
                            <h3>Сервис временно недоступен</h3>
                            <p>${errorData.error || 'База данных временно недоступна. Попробуйте позже.'}</p>
                            <button class="btn" onclick="closeSection(); loadProductsOnMainPage();" style="margin-top: 16px;">
                                Перейти к каталогу
                            </button>
                        </div>
                    </div>
                `;
            }

            let errorData = {};
            try {
                errorData = await response.json();
            } catch (e) {
                const errorText = await response.text();
                errorData = { error: errorText || 'Неизвестная ошибка' };
            }

            console.error('❌ Cart loading error:', response.status, errorData);
            return `
                <div class="content-section">
                    <div class="error-message">
                        <h3>Ошибка загрузки корзины</h3>
                        <p>${errorData.error || 'Произошла ошибка при загрузке корзины. Попробуйте обновить страницу.'}</p>
                        <button class="btn" onclick="closeSection(); location.reload();" style="margin-top: 16px;">
                            Обновить страницу
                        </button>
                        <button class="btn btn-secondary" onclick="closeSection(); loadProductsOnMainPage();" style="margin-top: 12px;">
                            Перейти к каталогу
                        </button>
                    </div>
                </div>
            `;
        }

        const items = await response.json();

        // Загружаем данные пользователя для отображения баланса
        let userBalance = 0;
        try {
            const userResponse = await fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() });
            if (userResponse.ok) {
                const userData = await userResponse.json();
                userBalance = userData.balance || 0;
            }
        } catch (error) {
            console.warn('⚠️ Failed to load user balance:', error);
            // Продолжаем без баланса
        }

        if (!items || items.length === 0) {
            return `
                <div class="content-section">
                    <h3>Корзина пуста</h3>
                    <p>Добавьте товары в корзину, чтобы продолжить</p>
                    <button class="btn" onclick="closeSection(); loadProductsOnMainPage();">Перейти к каталогу</button>
                </div>
            `;
        }

        let total = 0;
        let html = '<div class="cart-items-grid">';

        items.forEach(item => {
            // Пропускаем товары без продукта (удаленные/деактивированные)
            if (!item.product) {
                console.warn('⚠️ Cart item without product:', item.id);
                return;
            }

            const product = item.product;
            const itemTotal = (product.price || 0) * (item.quantity || 1);
            total += itemTotal;

            html += `
                <div class="cart-item-tile">
                    <div class="cart-item-image-wrapper">
                        ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${escapeHtml(product.title || 'Товар')}" class="cart-item-image">` : '<div class="cart-item-image-placeholder">📦</div>'}
                        <button class="btn-cart-remove" onclick="removeFromCart('${item.id}')">✕</button>
                    </div>
                    <div class="cart-item-info">
                        <h4>${escapeHtml(product.title || 'Без названия')}</h4>
                        <p class="cart-item-price">${pzToRub(product.price || 0)} ₽</p>
                        <div class="cart-item-quantity-controls">
                            <button class="btn-quantity" onclick="updateCartQuantity('${item.id}', ${(item.quantity || 1) - 1})" ${(item.quantity || 1) <= 1 ? 'disabled' : ''}>−</button>
                            <span class="cart-item-quantity">${item.quantity || 1}</span>
                            <button class="btn-quantity" onclick="updateCartQuantity('${item.id}', ${(item.quantity || 1) + 1})">+</button>
                        </div>
                        <p class="cart-item-total">${pzToRub(itemTotal)} ₽</p>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        html += `
            <div class="cart-summary">
                <div class="balance-display">
                    <span class="balance-label">Ваш баланс:</span>
                    <span class="balance-value">${formatRubFromPz(userBalance)}</span>
                </div>
                <div class="cart-total">
                    <div class="cart-total-row">
                        <span>Итого:</span>
                        <strong>${pzToRub(total)} ₽</strong>
                    </div>
                </div>
                <button class="btn btn-primary checkout-btn" onclick="checkoutCart()" style="width: 100%; margin-top: 16px;">
                    Оформить заказ (${pzToRub(total)} ₽)
                </button>
            </div>
        `;

        return html;
    } catch (error) {
        console.error('❌ Error loading cart:', error);
        return `
            <div class="content-section">
                <div class="error-message">
                    <h3>Ошибка загрузки корзины</h3>
                    <p>Попробуйте обновить страницу или вернуться позже</p>
                    <button class="btn" onclick="closeSection(); loadProductsOnMainPage();" style="margin-top: 16px;">
                        Перейти к каталогу
                    </button>
                </div>
            </div>
        `;
    }
}

async function updateCartQuantity(cartItemId, newQuantity) {
    if (newQuantity < 1) {
        // Если количество 0 или меньше, удаляем товар
        await removeFromCart(cartItemId);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/cart/update/${cartItemId}`, {
            method: 'PUT',
            headers: getApiHeaders(),
            body: JSON.stringify({ quantity: newQuantity })
        });

        if (response.ok) {
            await loadCartItems();
            updateCartBadge();
            // Reload cart content
            const container = document.getElementById('section-body');
            if (container) {
                container.innerHTML = await loadCartContent();
            }
        } else {
            const errorData = await response.json().catch(() => ({}));
            showError(errorData.error || 'Ошибка обновления количества');
        }
    } catch (error) {
        console.error('Error updating cart quantity:', error);
        showError('Ошибка обновления количества');
    }
}

async function removeFromCart(cartItemId) {
    try {
        const response = await fetch(`${API_BASE}/cart/remove/${cartItemId}`, {
            method: 'DELETE',
            headers: getApiHeaders()
        });

        if (response.ok) {
            await loadCartItems();
            updateCartBadge();
            // Reload cart content
            const container = document.getElementById('section-body');
            if (container) {
                container.innerHTML = await loadCartContent();
            }
            showSuccess('Товар удален из корзины');
        } else {
            showError('Ошибка удаления товара');
        }
    } catch (error) {
        console.error('Error removing from cart:', error);
        showError('Ошибка удаления товара');
    }
}

async function checkoutCart() {
    try {
        const response = await fetch(`${API_BASE}/cart/items`, { headers: getApiHeaders() });
        if (!response.ok) throw new Error('Failed to fetch cart items');

        const items = await response.json();
        if (!items || items.length === 0) {
            showError('Корзина пуста');
            return;
        }

        // Фильтруем только валидные товары (с продуктом и ценой)
        const validItems = items.filter(item => item.product && item.product.price);

        if (validItems.length === 0) {
            showError('В корзине нет доступных товаров');
            return;
        }

        // Вычисляем общую сумму в ₽ (цена хранится в PZ; 1 PZ = 100 ₽)
        const totalRub = validItems.reduce((sum, item) => {
            return sum + (Number(item.product.price || 0) * 100) * (item.quantity || 1);
        }, 0);

        // Загружаем баланс пользователя
        const userResponse = await fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() });
        let userBalance = 0;
        if (userResponse.ok) {
            const userData = await userResponse.json();
            userBalance = userData.balance || 0;
        }

        // Показываем форму оформления (в интерфейсе суммы показываем в ₽)
        showDeliveryForm(validItems, totalRub, userBalance);

    } catch (error) {
        console.error('❌ Error checkout:', error);
        console.error('❌ Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        showError(`Ошибка оформления заказа: ${error.message || 'Неизвестная ошибка'}`);
    }
}

// Обработка заказа с оплатой с баланса
async function processOrderWithBalance(items, total, partialAmount = null, phone = null, address = null, certificateCode = null) {
    try {
        const orderItems = items.map(item => ({
            productId: item.product.id,
            title: item.product.title,
            price: item.product.price,
            quantity: item.quantity
        }));

        const amountToPay = partialAmount || total;
        const contactInfo = phone && address
            ? `Телефон: ${phone}\nАдрес: ${address}`
            : '';
        const message = (partialAmount
            ? `Заказ из корзины. Оплачено с баланса: ${pzToRub(amountToPay)} ₽ из ${pzToRub(total)} ₽`
            : `Заказ из корзины. Оплачено с баланса: ${pzToRub(total)} ₽`) + (contactInfo ? `\n\n${contactInfo}` : '');

        const orderResponse = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                items: orderItems,
                message: message,
                paidFromBalance: amountToPay,
                phone: phone,
                deliveryAddress: address,
                certificateCode: certificateCode || undefined
            })
        });

        if (orderResponse.ok) {
            const orderData = await orderResponse.json().catch(() => ({}));
            const payablePz = Number(orderData?.payablePz);
            const certAppliedPz = Number(orderData?.certificateAppliedPz || 0) || 0;
            const toDeduct = Number.isFinite(payablePz) ? payablePz : amountToPay;

            // Списываем с баланса
            if (toDeduct > 0.0001) {
                const balanceResponse = await fetch(`${API_BASE}/user/deduct-balance`, {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ amount: toDeduct })
                });
                if (balanceResponse.ok) {
                    showSuccess(`Заказ оформлен! Сертификат: −${pzToRub(certAppliedPz)} ₽. С баланса списано ${pzToRub(toDeduct)} ₽.`);
                } else {
                    showSuccess('Заказ оформлен! Ожидайте подтверждения.');
                }
            } else {
                showSuccess(`Заказ оформлен! Сертификат покрыл оплату: −${pzToRub(certAppliedPz)} ₽.`);
            }

            closeSection();
            await loadCartItems();
            updateCartBadge();
        } else {
            const errorData = await orderResponse.json();
            showError(`Ошибка оформления заказа: ${errorData.error || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error('Error processing order with balance:', error);
        showError('Ошибка оформления заказа');
    }
}

// Обычное оформление заказа
async function processOrderNormal(items, phone = null, address = null, certificateCode = null) {
    try {
        const orderItems = items.map(item => ({
            productId: item.product.id,
            title: item.product.title,
            price: item.product.price,
            quantity: item.quantity
        }));

        const contactInfo = phone && address
            ? `Телефон: ${phone}\nАдрес: ${address}`
            : '';
        const message = 'Заказ из корзины' + (contactInfo ? `\n\n${contactInfo}` : '');

        const orderResponse = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                items: orderItems,
                message: message,
                phone: phone,
                deliveryAddress: address,
                certificateCode: certificateCode || undefined
            })
        });

        if (orderResponse.ok) {
            showSuccess('Заказ оформлен! Администратор свяжется с вами.');
            closeSection();
            await loadCartItems();
            updateCartBadge();
        } else {
            const errorData = await orderResponse.json();
            showError(`Ошибка оформления заказа: ${errorData.error || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error('Error processing order:', error);
        showError('Ошибка оформления заказа');
    }
}

function showHome() {
    closeSection();
    // Update bottom nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('.nav-item').classList.add('active');
}

function showFavorites() {
    // Update bottom nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.nav-item')[3].classList.add('active');

    // Show favorites section
    openSection('favorites');
}

function openSection(sectionName) {
    // Clear any existing intervals
    if (supportChatInterval) {
        clearInterval(supportChatInterval);
        supportChatInterval = null;
    }

    currentSection = sectionName;
    const overlay = document.getElementById('section-overlay');
    const title = document.getElementById('section-title');
    const body = document.getElementById('section-body');

    // Set section title
    const titles = {
        shop: 'Каталог',
        partner: 'Партнёрка',
        audio: 'Звуковые матрицы',
        reviews: 'Отзывы',
        about: 'О нас',
        // оставляем для обратной совместимости (если где-то ещё остались ссылки на 'chats')
        chats: 'Поддержка',
        support: 'Поддержка',
        favorites: 'Избранное',
        cart: 'Корзина',
        certificates: 'Сертификаты',
        promotions: 'Акции',
        contacts: 'Контакты',
        balance: 'Баланс',
        specialists: 'Специалисты',
        'specialist-detail': 'Специалист',
        'plazma-product-detail': 'Товар'
    };

    title.textContent = titles[sectionName] || 'Раздел';

    // Главные разделы (из нижнего меню): нижнее меню всегда видно.
    // Исключение: "Партнеры" — стрелка назад нужна (как на внутренних страницах).
    try {
        const mainSections = new Set(['about', 'support', 'favorites', 'partner', 'chats']);
        const isMain = mainSections.has(String(sectionName));
        const showBackInHeader = String(sectionName) === 'partner';
        if (overlay && overlay.classList) {
            overlay.classList.toggle('no-back', isMain && !showBackInHeader);
            overlay.classList.toggle('main-section', isMain);
        }
        if (document && document.body && document.body.classList) {
            document.body.classList.toggle('main-section-open', isMain);
        }
    } catch (e) {
        console.warn('Failed to toggle no-back:', e);
    }

    // Load section content
    loadSectionContent(sectionName, body);

    // Show overlay
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);
}

function closeSection() {
    if (supportChatInterval) {
        clearInterval(supportChatInterval);
        supportChatInterval = null;
    }

    const overlay = document.getElementById('section-overlay');
    overlay.classList.remove('open');
    try {
        if (overlay && overlay.classList) {
            overlay.classList.remove('main-section');
            overlay.classList.remove('no-back');
        }
        if (document && document.body && document.body.classList) {
            document.body.classList.remove('main-section-open');
        }
    } catch (_) { }
    setTimeout(() => {
        overlay.classList.add('hidden');
        currentSection = null;
    }, 300);
}

// Load section content
async function loadSectionContent(sectionName, container) {
    container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

    try {
        let content = '';

        switch (sectionName) {
            case 'shop':
                content = await loadShopContent();
                break;
            case 'partner':
                content = await loadPartnerContent();
                break;
            case 'reviews':
                content = await loadReviewsContent();
                break;
            case 'about':
                content = await loadAboutContent();
                break;
            case 'chats':
                // Раньше был список чатов, но сейчас нужен прямой переход в чат поддержки.
                content = await loadSupportContent();
                break;
            case 'support':
                content = await loadSupportContent();
                break;
            case 'favorites':
                content = await loadFavoritesContent();
                break;
            case 'certificates':
                content = await loadCertificatesContent();
                break;
            case 'promotions':
                content = loadPromotionsContent();
                break;
            case 'contacts':
                content = loadContactsContent();
                break;
            case 'cart':
                content = await loadCartContent();
                break;
            case 'balance':
                content = await loadBalanceContent();
                break;
            case 'partners':
                await showPartners();
                return; // showPartners already sets innerHTML
            default:
                content = '<div class="error-message"><h3>Раздел не найден</h3><p>Попробуйте позже</p></div>';
        }

        container.innerHTML = content;

        // Post-render hooks
        if (sectionName === 'support' || sectionName === 'chats') {
            initSupportChat();
        }
    } catch (error) {
        console.error('Error loading section:', error);
        container.innerHTML = '<div class="error-message"><h3>Ошибка загрузки</h3><p>Попробуйте позже</p></div>';
    }
}



// Load products on main page immediately
function isSubcategoryName(name) {
    return String(name || '').includes(' > ');
}

function getTopLevelCategories(categories) {
    return (categories || []).filter(c => c && c.id && c.name && !isSubcategoryName(c.name));
}

function findCoverImageForCategory(category, products, categories) {
    const explicit = String(category?.imageUrl || '').trim();
    if (explicit) return explicit;
    const name = String(category?.name || '');
    // Special case: cosmetics includes subcategories
    if (name === 'Косметика') {
        const p = (products || []).find(x => x?.imageUrl && (x?.category?.name === 'Косметика' || String(x?.category?.name || '').startsWith('Косметика >')));
        return p?.imageUrl || '';
    }
    // Regular: first product in this category with image
    const p = (products || []).find(x => x?.imageUrl && String(x?.category?.id || '') === String(category?.id || ''));
    return p?.imageUrl || '';
}

function renderCategoryCovers(categories, products) {
    const top = getTopLevelCategories(categories);
    if (!top.length) return '';

    let html = `
    <div class="category-covers">
        <div class="category-covers-header">Категории</div>
        <div class="category-covers-scroll">
    `;
    top.forEach(cat => {
        const cover = findCoverImageForCategory(cat, products, categories);
        const bg = cover ? `style="background-image:url('${escapeAttr(cover)}')"` : '';
        html += `
          <div class="category-cover-card" ${bg} onclick="openShopCategory('${escapeAttr(cat.id)}')">
            <div class="category-cover-overlay"></div>
            <div class="category-cover-title">${escapeHtml(cat.name)}</div>
          </div>
        `;
    });
    html += `</div></div > `;
    return html;
}

function setShopActiveCategory(categoryId) {
    SHOP_ACTIVE_CATEGORY_ID = categoryId || 'all';
}

async function ensureShopDataLoaded() {
    if (SHOP_CATEGORIES_CACHE && SHOP_PRODUCTS_CACHE) return;
    try {
        const [categoriesResponse, productsResponse] = await Promise.all([
            fetch(`${API_BASE}/categories`),
            fetch(`${API_BASE}/products`)
        ]);
        if (!categoriesResponse.ok) throw new Error('Failed to fetch categories');
        if (!productsResponse.ok) throw new Error('Failed to fetch products');
        let categories = await categoriesResponse.json();
        const products = await productsResponse.json();
        SHOP_CATEGORIES_CACHE = Array.isArray(categories) ? categories : [];
        SHOP_PRODUCTS_CACHE = Array.isArray(products) ? products : [];
    } catch (e) {
        throw e;
    }
}

function getProductsForShopSelection(categoryId, categories, products) {
    const sel = String(categoryId || 'all');
    if (sel === 'all') return products || [];
    const cat = (categories || []).find(c => String(c?.id || '') === sel);
    if (!cat) return [];
    if (String(cat.name || '') === 'Косметика') {
        return (products || []).filter(p => p && (p?.category?.name === 'Косметика' || String(p?.category?.name || '').startsWith('Косметика >')));
    }
    return (products || []).filter(p => String(p?.category?.id || '') === sel);
}

function renderShopTabs(categories, activeId) {
    const top = getTopLevelCategories(categories);
    const active = String(activeId || 'all');
    let html = `<div class="category-tabs" role="tablist" aria-label="Категории">`;
    html += `<button class="category-tab ${active === 'all' ? 'active' : ''}" type="button" onclick="openShopCategory('all')">Все товары</button>`;
    top.forEach(cat => {
        html += `<button class="category-tab ${active === String(cat.id) ? 'active' : ''}" type="button" onclick="openShopCategory('${escapeAttr(cat.id)}')">${escapeHtml(cat.name)}</button>`;
    });
    html += `<button class="category-tab ${active === 'certificates' ? 'active' : ''}" type="button" onclick="openSection('certificates')">Сертификаты</button>`;
    html += `</div>`;
    return html;
}

async function openShopCategory(categoryId) {
    setShopActiveCategory(categoryId);
    if (currentSection !== 'shop') {
        openSection('shop');
        return;
    }
    // Rerender in-place
    const container = document.getElementById('section-body');
    if (container) {
        container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        container.innerHTML = await loadShopContent();
    }
}

async function ensureCertificateTypesLoaded() {
    if (CERT_TYPES_CACHE) return;
    try {
        const res = await fetch(`${API_BASE}/certificates/types`, { headers: getApiHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.success && Array.isArray(data.types)) {
            CERT_TYPES_CACHE = data.types;
            return;
        }
        throw new Error(data?.error || 'Failed to load certificates');
    } catch (e) {
        CERT_TYPES_CACHE = [];
    }
}

function renderCertificateCard(t) {
    const priceRub = Number(t?.priceRub || 0) || 0;
    const title = escapeHtml(String(t?.title || 'Сертификат'));
    const cover = String(t?.imageUrl || '').trim();
    const img = cover
        ? `<div class="product-card-image"><img src="${escapeAttr(cover)}" alt="${title}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');"></div>`
        : `<div class="product-card-image no-image"><div class="product-image-placeholder-icon">🎁</div></div>`;
    return `
      <div class="product-card-forma" onclick="showCertificateDetails('${escapeAttr(t.id)}')" style="position: relative;">
        ${img}
        <div class="product-card-content">
          <h3 class="product-card-title">${title}</h3>
          <div class="product-card-footer">
            <div class="product-card-price">
              <span class="price-value">${priceRub.toFixed(0)} ₽</span>
            </div>
            <button class="product-card-add" type="button" aria-label="Открыть сертификат" onclick="event.stopPropagation(); showCertificateDetails('${escapeAttr(t.id)}')">+</button>
          </div>
        </div>
      </div>
    `;
}

async function showCertificateDetails(typeId) {
    await ensureCertificateTypesLoaded();
    const list = Array.isArray(CERT_TYPES_CACHE) ? CERT_TYPES_CACHE : [];
    const t = list.find(x => String(x?.id || '') === String(typeId || '')) || null;
    if (!t) {
        showError('Сертификат не найден');
        return;
    }
    openSection('certificates');
    document.getElementById('section-title').textContent = 'Сертификат';

    const priceRub = Number(t.priceRub || 0) || 0;
    const valueRub = Number(t.valueRub || 0) || 0;
    const cover = String(t.imageUrl || '').trim();
    const title = escapeHtml(String(t.title || 'Подарочный сертификат'));
    const desc = t.description ? `<div class="content-section" style="margin-top:12px;"><p>${escapeHtml(String(t.description))}</p></div>` : '';

    // reuse qty control state from product detail
    resetProductDetailQty(String(t.id));

    const content = `
      <div class="content-section">
        ${cover ? `<div class="product-details-image"><img src="${escapeAttr(cover)}" alt="${title}" style="width:100%; border-radius: 14px;" onerror="this.style.display='none'"></div>` : ''}
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-top: 12px;">
          <h3 style="margin:0;">${title}</h3>
        </div>
        <div style="margin-top:10px; display:flex; justify-content:space-between; gap:12px; align-items:center;">
          <div style="font-size:16px; font-weight:800;">${priceRub.toFixed(0)} ₽</div>
          <div style="font-size:13px; color:#6b7280;">Номинал: ${valueRub.toFixed(0)} ₽</div>
        </div>

        <div style="margin-top:12px;">
          <div class="qty-control" aria-label="Количество">
            <button class="qty-btn" type="button" aria-label="Уменьшить" onclick="changeProductDetailQty(-1)">−</button>
            <div class="qty-value" id="product-detail-qty">1</div>
            <button class="qty-btn" type="button" aria-label="Увеличить" onclick="changeProductDetailQty(1)">+</button>
          </div>
        </div>

        <button class="btn" style="margin-top:12px; width:100%;" onclick="buyCertificateType('${escapeAttr(t.id)}', getProductDetailQty())">
          Купить сертификат
        </button>
        <div style="margin-top:10px; font-size:12px; color:#6b7280; line-height:1.35;">
          Покупка списывается с баланса. После покупки вы получите код сертификата и сможете применить его при оформлении заказа.
        </div>
      </div>
      ${desc}
    `;

    showProductsSection(content);
}

async function buyCertificateType(typeId, quantity) {
    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
    try {
        const res = await fetch(`${API_BASE}/certificates/buy`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ typeId, quantity: qty })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
            showError(data?.error || 'Ошибка покупки сертификата');
            return;
        }
        const codes = Array.isArray(data?.certificates) ? data.certificates.map(c => c.code).filter(Boolean) : [];
        const msg = codes.length
            ? `Сертификат куплен!\n\nКоды:\n${codes.join('\n')}\n\nСкопируй код и применяй при оформлении заказа.`
            : 'Сертификат куплен!';
        showSuccess(msg);
    } catch (e) {
        console.error('buyCertificateType error:', e);
        showError('Ошибка покупки сертификата');
    }
}

async function loadCertificatesContent() {
    await ensureShopDataLoaded().catch(() => { });
    await ensureCertificateTypesLoaded();
    const categories = Array.isArray(SHOP_CATEGORIES_CACHE) ? SHOP_CATEGORIES_CACHE : [];
    const types = Array.isArray(CERT_TYPES_CACHE) ? CERT_TYPES_CACHE : [];

    let html = `<div class="shop-catalog">`;
    html += renderShopTabs(categories, 'certificates');
    html += `<div class="products-grid" style="margin-top: 12px;">`;
    if (types.length) {
        types.sort((a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)));
        types.forEach(t => { html += renderCertificateCard(t); });
    } else {
        html += `<div class="empty-state"><p>Сертификаты скоро будут доступны</p></div>`;
    }
    html += `</div></div>`;
    return html;
}

async function loadProductsOnMainPage() {
    const container = document.getElementById('products-container');
    if (!container) return; // Container might not exist in overlay mode

    try {
        console.log('🛒 Loading products on main page...');
        const [productsRes, categoriesRes] = await Promise.all([
            fetch(`${API_BASE}/products`),
            fetch(`${API_BASE}/categories`).catch(() => ({ ok: false }))
        ]);

        if (!productsRes.ok) {
            throw new Error(`HTTP error! status: ${productsRes.status}`);
        }

        const products = await productsRes.json();
        const allCategories = (categoriesRes && categoriesRes.ok) ? await categoriesRes.json().catch(() => []) : [];
        console.log(`✅ Loaded ${products?.length || 0} products`);

        if (products && Array.isArray(products) && products.length > 0) {
            let html = '';
            // 1) Categories with covers
            if (Array.isArray(allCategories) && allCategories.length) {
                html += renderCategoryCovers(allCategories, products);
            }
            // 2) All products grid
            html += `
              <div class="products-scroll-container">
                <div class="section-header-inline">
                  <h2 class="section-title-inline">Каталог</h2>
                </div>
                <div class="products-grid">
            `;
            products.forEach(p => { html += renderProductCard(p); });
            html += `
                </div>
              </div>
            `;
            container.innerHTML = html;
        } else {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                    <p style="font-size: 18px; margin-bottom: 20px;">📦 Каталог пока пуст</p>
                </div>
            `;
        }

        // Загружаем товары из Plazma API
        await loadPlazmaProducts();

    } catch (error) {
        console.error('❌ Error loading products:', error);
        if (container) {
            container.innerHTML = `
                <div class="error-message" style="padding: 40px 20px; text-align: center;">
                    <p>Ошибка загрузки товаров</p>
                    <button class="btn" onclick="loadProductsOnMainPage()" style="margin-top: 20px;">
                        🔄 Попробовать снова
                    </button>
                </div>
            `;
        }
    }
}

// Загрузка товаров из Plazma API
async function loadPlazmaProducts() {
    const plazmaSection = document.getElementById('plazma-products-section');
    const plazmaContainer = document.getElementById('plazma-products-container');

    if (!plazmaSection || !plazmaContainer) {
        console.warn('⚠️ Plazma products section not found');
        return;
    }

    // Показываем секцию с индикатором загрузки
    plazmaSection.style.display = 'block';

    try {
        console.log('🛒 Loading products from Plazma API...');
        console.log('📍 API endpoint:', `${API_BASE}/plazma/products`);

        // Используем бэкенд endpoint для получения товаров из Plazma API
        let response;
        try {
            response = await fetch(`${API_BASE}/plazma/products`);
        } catch (netEx) {
            console.warn('⚠️ Network error loading Plazma products:', netEx);
            plazmaSection.style.display = 'none';
            return;
        }

        console.log('📡 Response status:', response.status, response.statusText);

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            console.warn('⚠️ Plazma API returned HTML instead of JSON. Likely 404 or auth error.');
            plazmaSection.style.display = 'none';
            return;
        }

        if (!response.ok) {
            let errorData = { error: 'Unknown error' };
            try {
                errorData = await response.json();
            } catch (e) { /* ignore json parse error on error response */ }

            console.warn('⚠️ Failed to load Plazma products:', {
                status: response.status,
                statusText: response.statusText,
                error: errorData.error || errorData.message
            });

            // Если это 404 или 503 (сервис недоступен), просто скрываем секцию
            if (response.status === 404 || response.status === 503) {
                console.log('ℹ️ Plazma API не настроен или недоступен, скрываем секцию');
                plazmaSection.style.display = 'none';
                return;
            }

            // Для других ошибок показываем сообщение
            const horizontalContainer = plazmaContainer.querySelector('.products-horizontal');
            if (horizontalContainer) {
                horizontalContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #999;">
                        <p>Товары временно недоступны</p>
                    </div>
                `;
            }
            return;
        }

        const result = await response.json();
        console.log('📦 Response from backend:', {
            success: result.success,
            hasProducts: !!result.products,
            productsLength: Array.isArray(result.products) ? result.products.length : 'not array',
            error: result.error
        });

        const products = result.products || result.data || [];

        console.log(`✅ Loaded ${products?.length || 0} products from Plazma API`);

        const horizontalContainer = plazmaContainer.querySelector('.products-horizontal');
        if (!horizontalContainer) {
            console.error('❌ Horizontal container not found in Plazma section');
            plazmaSection.style.display = 'none';
            return;
        }

        if (products && Array.isArray(products) && products.length > 0) {
            let html = '';
            products.forEach((product, index) => {
                console.log(`📦 Product ${index + 1}:`, {
                    id: product.id,
                    title: product.title,
                    hasImage: !!product.imageUrl,
                    price: product.price || product.priceRub
                });
                html += renderPlazmaProductCard(product);
            });
            horizontalContainer.innerHTML = html;
            plazmaSection.style.display = 'block';
            console.log('✅ Plazma products section displayed with', products.length, 'products');
        } else {
            console.warn('⚠️ No products to display, hiding Plazma section');
            plazmaSection.style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Error loading Plazma products:', error);
        console.error('❌ Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        // При ошибке сети или других ошибках скрываем секцию
        plazmaSection.style.display = 'none';
    }
}

// Render cosmetics category with mixed products from subcategories
function renderCosmeticsCategory(categoryId, allProducts, cosmeticsSubcategories) {
    try {
        // Группируем товары по подкатегориям
        const productsBySubcategory = {};
        cosmeticsSubcategories.forEach(subcat => {
            productsBySubcategory[subcat.id] = allProducts.filter(p => p.category?.id === subcat.id);
        });

        // Создаем микс: по одному товару из каждой подкатегории по очереди
        const mixedProducts = [];
        const subcategoryIds = Object.keys(productsBySubcategory).filter(id => productsBySubcategory[id].length > 0);

        if (subcategoryIds.length === 0) {
            // Если нет подкатегорий, берем первые товары из всех
            return `
                <div class="products-scroll-container">
                    <div class="section-header-inline">
                        <h2 class="section-title-inline" onclick="showCosmeticsSubcategories('${categoryId}')" style="cursor: pointer;">${escapeHtml('Косметика')} <span style="font-size: 18px; margin-left: 8px;">→</span></h2>
                    </div>
                    <div class="products-scroll-wrapper">
                        <div class="products-horizontal">
                            ${allProducts.slice(0, 10).map(p => renderProductCardHorizontal(p)).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // Берем по одному товару из каждой подкатегории по очереди, максимум 9 товаров
        let maxProducts = 0;
        subcategoryIds.forEach(subcatId => {
            if (productsBySubcategory[subcatId].length > maxProducts) {
                maxProducts = productsBySubcategory[subcatId].length;
            }
        });

        // Берем товары по кругу из каждой подкатегории, но не более 9
        for (let round = 0; round < maxProducts && mixedProducts.length < 9; round++) {
            for (const subcatId of subcategoryIds) {
                if (mixedProducts.length >= 9) break;
                const subcatProducts = productsBySubcategory[subcatId];
                if (subcatProducts && subcatProducts.length > round) {
                    mixedProducts.push(subcatProducts[round]);
                }
            }
        }

        let html = `
            <div class="products-scroll-container">
                <div class="section-header-inline">
                    <h2 class="section-title-inline" onclick="showCosmeticsSubcategories('${categoryId}')" style="cursor: pointer;">${escapeHtml('Косметика')}</h2>
                </div>
                <div class="products-scroll-wrapper">
                    <div class="products-horizontal">
        `;

        mixedProducts.forEach(product => {
            html += renderProductCardHorizontal(product);
        });

        // Кнопка "Перейти на все категории"
        html += `
                        <div class="product-card-more" onclick="showCosmeticsSubcategories('${categoryId}')">
                            <div class="more-icon">📁</div>
                            <div class="more-text">Все категории</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        return html;
    } catch (error) {
        console.error('Error rendering cosmetics category:', error);
        // Fallback: показываем все товары как обычно
        return `
            <div class="products-scroll-container">
                <div class="section-header-inline">
                    <h2 class="section-title-inline">${escapeHtml('Косметика')}</h2>
                </div>
                <div class="products-scroll-wrapper">
                    <div class="products-horizontal">
                        ${allProducts.slice(0, 9).map(p => renderProductCardHorizontal(p)).join('')}
                    </div>
                </div>
            </div>
        `;
    }
}

// Show cosmetics subcategories - отображаем товары из всех подкатегорий горизонтально
async function showCosmeticsSubcategories(parentCategoryId) {
    try {
        // Открываем секцию каталога
        openSection('shop');

        const container = document.getElementById('section-body');
        container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        // Загружаем категории и товары
        const [categoriesResponse, productsResponse] = await Promise.all([
            fetch(`${API_BASE}/categories`),
            fetch(`${API_BASE}/products`)
        ]);

        if (!categoriesResponse.ok) throw new Error('Failed to fetch categories');
        if (!productsResponse.ok) throw new Error('Failed to fetch products');

        const allCategories = await categoriesResponse.json();
        const products = await productsResponse.json();

        // Находим подкатегории "Косметика"
        let cosmeticsSubcategories = allCategories.filter(cat =>
            cat.name && cat.name.startsWith('Косметика >') && cat.name !== 'Косметика'
        );
        cosmeticsSubcategories = dedupeCategoriesPreferMoreProducts(cosmeticsSubcategories, productsByCategory);

        // Группируем товары по категориям
        const productsByCategory = {};
        products.forEach(product => {
            const categoryId = product.category?.id || 'uncategorized';
            if (!productsByCategory[categoryId]) {
                productsByCategory[categoryId] = [];
            }
            productsByCategory[categoryId].push(product);
        });

        let html = '<div class="products-main-container">';

        // Отображаем каждую подкатегорию как горизонтальную линию
        cosmeticsSubcategories.forEach(subcat => {
            const subcatProducts = productsByCategory[subcat.id] || [];
            if (subcatProducts.length === 0) return;

            html += `
                <div class="products-scroll-container">
                    <div class="section-header-inline">
                        <h2 class="section-title-inline" onclick="showCategoryProducts('${subcat.id}')" style="cursor: pointer;">${escapeHtml(subcat.name)}</h2>
                    </div>
                    <div class="products-scroll-wrapper">
                        <div class="products-horizontal">
            `;

            subcatProducts.forEach(product => {
                html += renderProductCardHorizontal(product);
            });

            html += `
                        </div>
                    </div>
                </div>
            `;
        });

        if (cosmeticsSubcategories.length === 0 || cosmeticsSubcategories.every(subcat => !productsByCategory[subcat.id] || productsByCategory[subcat.id].length === 0)) {
            html += `
                <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                <p style="font-size: 18px; margin-bottom: 20px;">📦 В подкатегориях пока нет товаров</p>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading cosmetics subcategories:', error);
        showError('Ошибка загрузки подкатегорий');
    }
}

// Helper: Clean product title
function cleanProductTitle(title) {
    if (!title) return '';
    // Take part before " - " or " | " (removed " with " to keep full names)
    // FIXED: Show full title to distinguish variants
    let clean = title; // title.split(/ - | \| /i)[0];

    // Remove trailing weight info like " 50g", " 50 G", " 50 г"
    clean = clean.replace(/\s+\d+\s*[gг]$/i, '');

    return escapeHtml(clean.trim());
}

// Helper: Extract product weight from text
function extractProductWeight(text) {
    if (!text) return { weight: null, cleanSummary: '' };

    // Look for patterns like "BEC: 50 г" or "50g" or "50 г"
    // The specific user pattern: "/ 55 BEC: 50 г /"

    // Regex to find "BEC: <value>"
    const weightMatch = text.match(/(?:BEC|ВЕС|Вес|Weight)[:\s]+(\d+\s*[гg])/i);
    let weight = weightMatch ? weightMatch[1] : null;

    // Also try to find just "50 g" if BEC line matches
    if (!weight) {
        const simpleMatch = text.match(/(\d+\s*[гg])/i);
        if (simpleMatch && (text.includes('BEC') || text.includes('ВЕС') || text.includes('Weight'))) {
            weight = simpleMatch[1];
        }
    }

    // Clean the text by removing the weight line/segment
    let cleanSummary = text;

    // 1. Remove specific "/ 55 BEC: 50 г /" pattern
    cleanSummary = cleanSummary.replace(/\/ \d+ (?:BEC|ВЕС|Вес|Weight):.*?(\/|$)/gi, '');

    // 2. Remove standalone "BEC: 50 g" or "ВЕС: 50 г"
    cleanSummary = cleanSummary.replace(/(?:BEC|ВЕС|Вес|Weight)[:\s]+\d+\s*[гg][\s\.,]*/gi, '');

    // 3. Remove "КРАТКОЕ ОПИСАНИЕ:" prefix
    cleanSummary = cleanSummary.replace(/^КРАТКОЕ ОПИСАНИЕ:\s*/i, '');

    // 5. Remove leading weight like "55 г" or "55g" at start of string
    cleanSummary = cleanSummary.replace(/^\s*\d+\s*[гg]\s+/i, '');

    // 4. Remove extra slashes or whitespace left over
    cleanSummary = cleanSummary.replace(/^\s*[\/\|]\s*/, '').trim();

    return { weight, cleanSummary };
}

// Render product card in horizontal scroll format
function renderProductCardHorizontal(product) {
    const imageHtml = product.imageUrl
        ? `<div class="product-card-image" onclick="event.stopPropagation(); showProductDetails('${product.id}')"><img src="${product.imageUrl}" alt="${escapeHtml(product.title || 'Товар')}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');"></div>`
        : `<div class="product-card-image no-image" onclick="event.stopPropagation(); showProductDetails('${product.id}')"><div class="product-image-placeholder-icon">📦</div></div>`;
    const title = cleanProductTitle(product.title || 'Без названия');
    const { weight, cleanSummary } = extractProductWeight(product.summary || product.description || '');
    const summary = escapeHtml(cleanSummary.substring(0, 80));
    const priceRub = product.price ? (product.price * 100).toFixed(0) : '0';
    return `
        <div class="product-card-forma-horizontal" data-product-id="${escapeAttr(product.id)}" data-product-type="product" onclick="showProductDetails('${product.id}')" style="position: relative;">
            ${renderFavoriteButton(product.id)}
            ${imageHtml}
            <div class="product-card-content">
                <h3 class="product-card-title">${title}</h3>
                <div class="product-card-footer">
                    <div class="product-card-price">
                        <span class="price-value">${priceRub} ₽</span>
                    </div>
                    <button class="product-card-add" type="button" aria-label="Открыть товар" onclick="event.stopPropagation(); showProductDetails('${product.id}')">
                        +
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Render product card in FORMA Store style (for grid view)
function renderProductCard(product) {
    const imageHtml = product.imageUrl
        ? `<div class="product-card-image" onclick="event.stopPropagation(); showProductDetails('${product.id}')"><img src="${product.imageUrl}" alt="${escapeHtml(product.title || 'Товар')}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');"></div>`
        : `<div class="product-card-image no-image" onclick="event.stopPropagation(); showProductDetails('${product.id}')"><div class="product-image-placeholder-icon">📦</div></div>`;
    const title = cleanProductTitle(product.title || 'Без названия');
    const { weight, cleanSummary } = extractProductWeight(product.summary || product.description || '');
    const summary = escapeHtml(cleanSummary.substring(0, 100));
    const priceRub = product.price ? (product.price * 100).toFixed(0) : '0';
    return `
        <div class="product-card-forma" data-product-id="${escapeAttr(product.id)}" data-product-type="product" onclick="showProductDetails('${product.id}')" style="position: relative;">
            ${renderFavoriteButton(product.id)}
            ${imageHtml}
            <div class="product-card-content">
                <h3 class="product-card-title">${title}</h3>
                <div class="product-card-footer">
                    <div class="product-card-price">
                        <span class="price-value">${priceRub} ₽</span>
                    </div>
                    <button class="product-card-add" type="button" aria-label="Открыть товар" onclick="event.stopPropagation(); showProductDetails('${product.id}')">
                        +
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Render Plazma API product card
function renderPlazmaProductCard(product) {
    const imageHtml = product.imageUrl
        ? `<div class="product-card-image" onclick="event.stopPropagation(); showPlazmaProductDetails('${product.id}')"><img src="${product.imageUrl}" alt="${escapeHtml(product.title || 'Товар')}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');"></div>`
        : `<div class="product-card-image no-image" onclick="event.stopPropagation(); showPlazmaProductDetails('${product.id}')"><div class="product-image-placeholder-icon">📦</div></div>`;
    const title = cleanProductTitle(product.title || 'Без названия');
    const { weight, cleanSummary } = extractProductWeight(product.summary || product.description || '');
    const summary = escapeHtml(cleanSummary.substring(0, 80));
    const priceRub = product.priceRub || (product.price ? (product.price * 100).toFixed(0) : '0');
    return `
        <div class="product-card-forma-horizontal" data-product-id="${escapeAttr(product.id)}" data-product-type="plazma" onclick="showPlazmaProductDetails('${product.id}')">
            ${imageHtml}
            <div class="product-card-content">
                <h3 class="product-card-title">${title}</h3>
                <div class="product-card-footer">
                    <div class="product-card-price">
                        <span class="price-value">${priceRub} ₽</span>
                    </div>
                    <button class="product-card-add" type="button" aria-label="Открыть товар" onclick="event.stopPropagation(); showPlazmaProductDetails('${product.id}')">
                        +
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Show Plazma product details
async function showPlazmaProductDetails(productId) {
    try {
        const response = await fetch(`${API_BASE}/plazma/products/${productId}`);
        if (!response.ok) {
            showError('Товар не найден');
            return;
        }

        const result = await response.json();
        const product = result.product || result.data;

        if (!product) {
            showError('Товар не найден');
            return;
        }

        // Открываем детали товара в отдельном окне или показываем информацию
        showPlazmaProductModal(product);
    } catch (error) {
        console.error('Error loading Plazma product:', error);
        showError('Ошибка загрузки товара');
    }
}

// Show Plazma product modal
function showPlazmaProductModal(product) {
    const title = cleanProductTitle(product.title || 'Товар');
    const { weight, cleanSummary } = extractProductWeight(product.description || product.summary || '');
    const description = escapeHtml(cleanSummary || 'Описание отсутствует');
    const priceRub = product.priceRub || (product.price ? (product.price * 100).toFixed(0) : '0');
    const imageUrl = product.imageUrl || '';

    openSection('plazma-product-detail');
    document.getElementById('section-title').textContent = title;
    document.getElementById('section-body').innerHTML = `
        <div class="content-section">
            ${imageUrl ? `<div class="product-image-full"><img src="${imageUrl}" alt="${title}" style="width: 100%; border-radius: 12px;"></div>` : ''}
            <div class="product-details-content">
                <div class="product-details-header">
                    <h2>${title}</h2>
                </div>
                <div class="product-header-row">
                    <div class="product-price">💰 ${priceRub} ₽</div>
                    ${weight ? `<div class="product-weight-badge-large">${weight}</div>` : ''}
                </div>
                <p>${description}</p>
                <button class="btn" onclick="addPlazmaProductToCart('${product.id}', '${escapeHtml(title)}', ${product.price || 0}); closeSection();" style="margin-top: 20px;">
                    🛒 Добавить в корзину
                </button>
            </div>
        </div>
    `;
}

// Add Plazma product to cart (creates a special order request)
async function addPlazmaProductToCart(productId, productTitle, price) {
    try {
        // Создаем заказ через Plazma API
        const response = await fetch(`${API_BASE}/plazma/orders`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                productId: productId,
                productTitle: productTitle,
                price: price,
                quantity: 1
            })
        });

        if (response.ok) {
            showSuccess(`Товар "${productTitle}" добавлен в заказ! Администратор свяжется с вами.`);
        } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            showError(errorData.error || 'Ошибка добавления товара');
        }
    } catch (error) {
        console.error('Error adding Plazma product:', error);
        showError('Ошибка добавления товара');
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Escape attribute values for safe interpolation into HTML attributes
function escapeAttr(text) {
    // escapeHtml covers &,<,>, but not quotes reliably for attribute context
    return escapeHtml(String(text ?? ''))
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Shop content - каталог с табами категорий + сетка товаров
async function loadShopContent() {
    try {
        console.log('🛒 Loading shop catalog...');
        await ensureShopDataLoaded();
        const categories = Array.isArray(SHOP_CATEGORIES_CACHE) ? SHOP_CATEGORIES_CACHE : [];
        const products = Array.isArray(SHOP_PRODUCTS_CACHE) ? SHOP_PRODUCTS_CACHE : [];

        const activeId = String(SHOP_ACTIVE_CATEGORY_ID || 'all');
        const filtered = getProductsForShopSelection(activeId, categories, products);

        let content = `<div class="shop-catalog">`;
        content += renderShopTabs(categories, activeId);
        content += `<div class="products-grid" style="margin-top: 12px;">`;

        if (filtered && filtered.length) {
            filtered.forEach(p => { content += renderProductCard(p); });
        } else {
            content += `<div class="empty-state"><p>Товары не найдены</p></div>`;
        }

        content += `</div></div>`;
        return content;
    } catch (error) {
        console.error('❌ Error loading shop content:', error);
        return `
            <div class="error-message">
                <h3>Ошибка загрузки каталога</h3>
                <p>${error?.message || 'Попробуйте позже'}</p>
                <button class="btn" onclick="openShopCategory('all')" style="margin-top: 20px;">
                    🔄 Попробовать снова
                </button>
            </div>
        `;
    }
}

// Import products function
async function importProducts() {
    try {
        console.log('🤖 Starting product import...');
        showSuccess('Запускаю импорт товаров...');

        const response = await fetch(`${API_BASE}/import-products`, {
            method: 'POST',
            headers: getApiHeaders()
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Импорт запущен! Обновите страницу через минуту.');
            setTimeout(() => {
                location.reload();
            }, 5000);
        } else {
            showError(result.message || 'Ошибка импорта');
        }
    } catch (error) {
        console.error('❌ Error importing products:', error);
        showError('Ошибка запуска импорта');
    }
}

// Partner content
// Partner content
async function loadPartnerContent() {
    return `
        <div class="content-section">
            <h3>Партнёрская программа</h3>
            <p>Станьте партнёром Vital и получайте бонусы 25% по вашей ссылке!</p>
            
            <div class="partner-promo-info" style="background: #f9f9f9; border-radius: 12px; padding: 16px; margin: 20px 0;">
                <p style="margin-bottom: 12px;"><strong>Как стать партнером:</strong></p>
                <ul style="padding-left: 20px; color: #333;">
                    <li>Совершите покупку на сумму от 15 000 ₽</li>
                    <li>Получите реферальную ссылку автоматически</li>
                </ul>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="openShop()">
                    🛍 Перейти в каталог
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="showPartnerDashboard()">
                    📊 Личный кабинет
                </button>
            </div>
        </div>
    `;
}

// Audio content
async function loadAudioContent() {
    return `
        <div class="content-section">
            <h3>Звуковые матрицы Гаряева</h3>
            <p>Уникальные аудиофайлы для оздоровления, записанные методом Гаряева.</p>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="playAudio('matrix1')">
                    🎵 Матрица 1 - Восстановление
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="playAudio('matrix2')">
                    🎵 Матрица 2 - Энергия
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="playAudio('matrix3')">
                    🎵 Матрица 3 - Гармония
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="playAudio('matrix4')">
                    🎵 Матрица 4 - Исцеление
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="playAudio('matrix5')">
                    🎵 Матрица 5 - Трансформация
                </button>
            </div>
        </div>
    `;
}

// Reviews content
async function loadReviewsContent() {
    try {
        const response = await fetch(`${API_BASE}/reviews`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const reviews = await response.json();

        let content = '<div class="content-section"><h3>Отзывы клиентов</h3>';

        if (reviews && reviews.length > 0) {
            reviews.forEach(review => {
                content += `
                    <div style="background: #ffffff; border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: var(--shadow-soft);">
                        <h4 style="color: #000000; margin-bottom: 8px;">⭐ ${review.name}</h4>
                        <p style="color: #333333; line-height: 1.6;">${review.content}</p>
                        ${review.link ? `<p style="margin-top: 12px;"><a href="${review.link}" style="color: #000000; text-decoration: underline;">Подробнее</a></p>` : ''}
                    </div>
                `;
            });
        } else {
            content += '<p>Отзывов пока нет</p>';
        }

        content += '</div>';
        return content;
    } catch (error) {
        return '<div class="error-message"><h3>Ошибка загрузки отзывов</h3><p>Попробуйте позже</p></div>';
    }
}

// About content
async function loadAboutContent() {
    return `
        <div class="content-section">
            <h3>О нас</h3>
            <p><strong>🌀 Добро пожаловать в эру будущего!</strong></p>
            <p>Plazma Water - это инновационная космическая эко технология, которая использует передовые наноматериалы в сфере здоровья, долголетия.</p>
            
            <p><strong>⚡️ Быстро, легко и без нагрузки на печень и почки — питание прямо в клетки.</strong></p>
            
            <p>💧 Plazma Water - это инновационный водный раствор, содержащий микроэлементы в уникальной плазменной наноструктуре. Благодаря особой технологии, частицы в составе имеют нано размер и равномерно распределены в воде, что обеспечивает их естественное взаимодействие с биологическими системами организма.</p>
            
            <p><strong>🧬 Усвоение — 99,9% (в отличие от таблеток 1–20%).</strong></p>
            
            <p>В отличие от традиционных форм добавок, где усвоение может быть ограничено, плазменная наноформа способствует более мягкому и естественному включению микроэлементов в обменные процессы. При этом не требуется участие дополнительных вспомогательных веществ, что делает продукт лёгким для восприятия и безопасным при разумном использовании.</p>

            <div style="margin-top: 18px;">
              <button class="btn btn-secondary" onclick="openSection('support')">
                  💬 Написать в поддержку
              </button>
            </div>
        </div>
    `;
}

// Support content
async function loadSupportContent() {
    return `
        <div class="content-section">
            <h3>Служба поддержки</h3>
            <p>Напишите свой вопрос прямо здесь — команда Vital ответит как можно быстрее.</p>

            <div id="support-chat" style="margin-top: 16px;">
                <div id="support-messages" style="background: #ffffff; border: 1px solid var(--border-color); border-radius: 14px; padding: 14px; height: 340px; overflow-y: auto;">
                    <div class="loading"><div class="loading-spinner"></div></div>
                </div>

                <div style="display: grid; gap: 10px; margin-top: 12px;">
                    <input id="supportMessageInput" type="text" placeholder="Напишите сообщение…" style="width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border-color);" />
                    <button class="btn" onclick="sendSupportChatMessage()" style="width: 100%;">Отправить</button>
                </div>

                <p style="margin-top: 10px; color: #9ca3af; font-size: 12px;">
                    Поддержка 24/7. Если нужен срочный контакт — напишите номер телефона, и мы перезвоним.
                </p>
            </div>
        </div>
    `;
}

// Chats list (for bottom navigation)
async function loadChatsContent() {
    return `
        <div class="content-section">
            <h3>Чаты</h3>
            <div style="margin-top: 14px; display: grid; gap: 12px;">
                <div class="content-card support-card" onclick="openSection('support')" style="cursor: pointer;">
                    <div class="card-image"></div>
                    <div class="card-content">
                        <h4>Служба поддержки</h4>
                        <p>Написать в поддержку</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Favorites content
async function loadFavoritesContent() {
    try {
        // Ensure latest favorites are loaded
        await loadFavorites();
        const response = await fetch(`${API_BASE}/favorites/products`, { headers: getApiHeaders() });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return `
                <div class="content-section">
                    <h3>Избранное</h3>
                    <div class="error-message">
                        <h3>Ошибка загрузки</h3>
                        <p>${escapeHtml(errorData?.error || 'Не удалось загрузить избранное')}</p>
                    </div>
                </div>
            `;
        }

        const products = await response.json();
        const list = Array.isArray(products) ? products : [];

        if (list.length === 0) {
            return `
                <div class="content-section">
                    <h3>Избранное</h3>
                    <p>Ваши сохранённые товары</p>
                    <div style="margin: 20px 0;">
                        <p style="color: #666666; text-align: center;">Пока ничего не добавлено в избранное</p>
                    </div>
                </div>
            `;
        }

        let html = `
            <div class="content-section">
                <h3>Избранное</h3>
                <p>Ваши сохранённые товары</p>
                <div class="products-grid favorites-products-grid" style="margin-top: 12px;">
        `;

        list.forEach((p) => {
            html += renderProductCard(p);
        });

        html += `
                </div>
            </div>
        `;

        return html;
    } catch (e) {
        console.error('❌ Error loading favorites content:', e);
        return '<div class="error-message"><h3>Ошибка загрузки избранного</h3><p>Попробуйте позже</p></div>';
    }
}

// Action functions

async function addToCart(productId, quantity = 1) {
    if (!productId) {
        console.error('❌ No productId provided');
        showError('Ошибка: не указан товар');
        return false;
    }

    try {
        console.log('🛒 Adding product to cart:', productId);

        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ productId, quantity: Number(quantity) || 1 })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Product added to cart:', result);

            // Анимация корзины
            animateCartIcon();

            // Оптимистичное обновление счетчика
            incrementCartBadge(Number(quantity) || 1);

            // Загружаем обновленную корзину (счетчик обновится с точными данными)
            await loadCartItems();

            showSuccess('Товар добавлен в корзину!');
            return true;
        } else {
            // Получаем детали ошибки
            let errorMessage = 'Ошибка добавления в корзину';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('❌ Add to cart error response:', errorData);
            } catch (e) {
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage = errorText;
                    }
                } catch (textError) {
                    console.error('❌ Failed to parse error:', textError);
                }
            }

            console.error('❌ Add to cart error:', response.status, errorMessage);

            if (response.status === 401) {
                showError('Необходимо авторизоваться для добавления в корзину');
            } else if (response.status === 400) {
                showError(errorMessage || 'Неверные данные товара');
            } else if (response.status === 404) {
                showError('Товар не найден');
            } else if (response.status === 503) {
                showError('Сервис временно недоступен. Попробуйте позже.');
            } else {
                showError(errorMessage || 'Ошибка добавления в корзину');
            }
            return false;
        }
    } catch (error) {
        console.error('❌ Error adding to cart:', error);
        showError('Ошибка добавления в корзину. Проверьте подключение к интернету.');
        return false;
    }
}

async function addToCartAndOpenCart(productId, quantity = 1) {
    const ok = await addToCart(productId, quantity);
    if (ok) {
        openCart();
    }
}

async function buyNowFromProduct(productId, quantity = 1) {
    const ok = await addToCart(productId, quantity);
    if (ok) {
        await checkoutCart();
    }
}

// Анимация иконки корзины при добавлении товара
function animateCartIcon() {
    const cartButton = document.querySelector('.control-btn[onclick="openCart()"]');
    if (cartButton) {
        cartButton.style.transform = 'scale(1.2)';
        cartButton.style.transition = 'transform 0.3s ease';

        setTimeout(() => {
            cartButton.style.transform = 'scale(1)';
        }, 300);
    }

    // Анимация бейджа
    const cartBadge = document.querySelector('.cart-badge');
    if (cartBadge) {
        cartBadge.style.transform = 'scale(1.5)';
        cartBadge.style.transition = 'transform 0.3s ease';

        setTimeout(() => {
            cartBadge.style.transform = 'scale(1)';
        }, 300);
    }
}

async function buyProduct(productId, quantity = 1) {
    try {
        const response = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                items: [{ productId, quantity: Number(quantity) || 1 }],
                message: 'Покупка через веб-приложение'
            })
        });

        if (response.ok) {
            showSuccess('Заказ создан! Ожидайте подтверждения.');
            // После создания заказа запрашиваем телефон и адрес
            await requestContactAndAddress();
        } else {
            const errorData = await response.json().catch(() => ({}));
            showError(`Ошибка создания заказа: ${errorData.error || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error('Error creating order:', error);
        showError('Ошибка создания заказа');
    }
}

async function activatePartnerProgram(type) {
    try {
        console.log('🤝 Showing partner program info:', type);

        // Генерируем простой реферальный код для демонстрации
        const referralCode = 'PLAZMA' + Math.random().toString(36).substr(2, 6).toUpperCase();

        // Создаем реферальную ссылку
        const referralLink = `https://t.me/ivitalbot?start=${referralCode}`;

        // Текст как в боте
        let message = '';
        let shareText = '';

        // Только многоуровневая программа
        if (type === 'MULTI_LEVEL') {
            message = `📈 Многоуровневая система — 15% + 5% + 5%
• 15% с покупок ваших друзей (1-й уровень)
• 5% с покупок их друзей (2-й уровень)
• 5% с покупок следующего уровня (3-й уровень)

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 15%+5%+5% начнет действовать при Вашей активности 12000 ₽ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;

            shareText = `Дружище 🌟
Я желаю тебе энергии, здоровья и внутренней силы, поэтому делюсь с тобой этим ботом 💧
Попробуй PLAZMA — структурированная вода для здоровья и энергии ⚡️
🔗 Твоя ссылка (сеть 15% + 5% + 5%):
${referralLink}`;
        }

        // Показываем информацию о программе
        showSuccess('Партнёрская программа активирована!');

        // Показываем реферальную ссылку
        setTimeout(() => {
            const content = `
                <div class="content-section">
                    <h3>🎉 Партнёрская программа активирована!</h3>
                    <p>${message}</p>
                    
                    <div style="background: #f9f9f9; border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin: 20px 0;">
                        <h4 style="color: #000000; margin-bottom: 8px;">🔗 Ваша реферальная ссылка:</h4>
                        <p style="color: #333333; word-break: break-all; font-family: monospace;">${referralLink}</p>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <button class="btn" onclick="copyReferralLink('${referralLink}')">
                            📋 Скопировать ссылку
                        </button>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <button class="btn btn-secondary" onclick="showShareText('${shareText.replace(/'/g, "\\'")}')">
                            📤 Показать текст для отправки
                        </button>
                    </div>
                </div>
            `;

            showProductsSection(content);
        }, 1000);

    } catch (error) {
        console.error('Error showing partner program:', error);
        showError('Ошибка отображения программы');
    }
}

async function showPartnerDashboard() {
    try {
        const response = await fetch(`${API_BASE}/partner/dashboard`);
        const dashboard = await response.json();

        let content = '<div class="content-section">';
        content += '<button class="btn btn-secondary" onclick="openSection(\'partner\')" style="margin-bottom: 20px;">← Назад</button>';
        content += '<h3>Личный кабинет партнёра</h3>';

        if (dashboard) {
            // Updated link generation to match bot
            const botUsername = 'PLAZMA_test8_bot';
            const referralLink = `https://t.me/${botUsername}?start=ref_direct_${dashboard.profile.referralCode}`;

            content += `
                <div style="background: #f9f9f9; 
                            border: 1px solid var(--border-color); 
                            border-radius: 12px; 
                            padding: 20px; 
                            margin-bottom: 20px;">
                    <h4 style="color: #000000; margin-bottom: 16px;">📊 Статистика</h4>
                    <p style="color: #333333; margin-bottom: 8px;">💰 Баланс: ${formatRubFromPz(dashboard.balance || 0)}</p>
                    <p style="color: #333333; margin-bottom: 8px;">👥 Партнёры: ${dashboard.partners || 0}</p>
                    <p style="color: #333333; margin-bottom: 8px;">🎁 Всего бонусов: ${formatRubFromPz(dashboard.bonus || 0)}</p>
                </div>
                
                <div class="referral-section" style="margin: 20px 0;">
                    <h3>Ваша реферальная ссылка</h3>
                    <p>Делитесь ссылкой и получайте 25% с покупок приглашенных!</p>
                    
                    <div class="referral-link-box" style="display: flex; gap: 8px; margin-bottom: 12px;">
                        <input type="text" value="${referralLink}" readonly id="refLinkInput" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #ccc;">
                        <button class="btn-icon" onclick="copyReferralLink(document.getElementById('refLinkInput').value)" style="padding: 10px;">
                            📋
                        </button>
                    </div>

                    <div style="display: flex; gap: 10px;">
                        <button class="btn" onclick="shareReferralLink('${referralLink}')" style="flex: 1;">
                            📤 Поделиться
                        </button>
                        <button class="btn btn-secondary" onclick="showQrCode('${escapeAttr(dashboard.profile.referralDirectQrUrl || '')}')" style="width: auto; aspect-ratio: 1; display: flex; align-items: center; justify-content: center;">
                            📱 QR
                        </button>
                    </div>
                </div>
                
                <div style="margin: 20px 0;">
                    <button class="btn btn-secondary" onclick="showPartners()">
                        👥 Мои партнёры
                    </button>
                </div>
            `;
        } else {
            content += '<p>Сначала активируйте партнёрскую программу</p>';
        }

        content += '</div>';

        document.getElementById('section-body').innerHTML = content;
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('section-body').innerHTML = '<div class="error-message"><h3>Ошибка загрузки кабинета</h3><p>Попробуйте позже</p></div>';
    }
}

function playAudio(matrixId) {
    showSuccess(`Воспроизведение матрицы ${matrixId}...`);
    // Здесь можно добавить логику воспроизведения аудио
}

async function showVideo() {
    try {
        console.log('🎥 Getting video URL...');

        // Получаем ссылку на видео с сервера
        const response = await fetch(`${API_BASE}/video/url`);
        if (response.ok) {
            const data = await response.json();
            const videoUrl = data.videoUrl;

            console.log('✅ Video URL received:', videoUrl);

            if (tg && tg.openLink) {
                // Открываем видео в Telegram
                tg.openLink(videoUrl);
            } else if (tg && tg.openTelegramLink) {
                // Альтернативный способ открытия ссылки
                tg.openTelegramLink(videoUrl);
            } else {
                // Fallback - открываем в новом окне/вкладке
                window.open(videoUrl, '_blank');
            }
        } else {
            console.error('Failed to get video URL:', response.status);
            showError('Ошибка получения ссылки на видео');
        }
    } catch (error) {
        console.error('Error getting video URL:', error);
        showError('Ошибка открытия видео');
    }
}

function openTelegram() {
    // Ссылка на Telegram канал (замените на реальную)
    const telegramUrl = 'https://t.me/your_channel_username'; // Замените на реальную ссылку

    if (tg && tg.openLink) {
        // Открываем Telegram канал в Telegram
        tg.openLink(telegramUrl);
    } else if (tg && tg.openTelegramLink) {
        // Альтернативный способ открытия ссылки
        tg.openTelegramLink(telegramUrl);
    } else {
        // Fallback - открываем в новом окне/вкладке
        window.open(telegramUrl, '_blank');
    }
}

// Функции для партнёрской программы

function showShareText(text) {
    const content = `
        <div class="content-section">
            <h3>📤 Текст для отправки друзьям</h3>
            <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                        border: 1px solid rgba(255, 255, 255, 0.1); 
                        border-radius: 12px; 
                        padding: 16px; 
                        margin: 20px 0;">
                <p style="color: #ffffff; white-space: pre-line; line-height: 1.5;">${text}</p>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="copyShareText('${text.replace(/'/g, "\\'")}')">
                    📋 Скопировать текст
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="showPartnerProgram()">
                    ← Назад к программе
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);
}

function copyShareText(text) {
    try {
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Текст скопирован в буфер обмена!');
        }).catch(() => {
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showSuccess('Текст скопирован!');
        });
    } catch (error) {
        console.error('Error copying text:', error);
        showError('Не удалось скопировать текст');
    }
}

function showPartnerProgram() {
    const content = `
        <div class="content-section">
            <h3>Партнёрская программа</h3>
            <p>Станьте партнёром Vital и получайте бонусы 25% по вашей ссылке!</p>
            
            <div class="partner-promo-info" style="background: #f9f9f9; border-radius: 12px; padding: 16px; margin: 20px 0;">
                <p style="margin-bottom: 12px;"><strong>Как стать партнером:</strong></p>
                <ul style="padding-left: 20px; color: #333;">
                    <li>Совершите покупку на сумму от 15 000 ₽</li>
                    <li>Получите реферальную ссылку автоматически</li>
                </ul>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="openShop()">
                    🛍 Перейти в каталог
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="showPartnerDashboard()">
                    📊 Личный кабинет
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);
}

// Support chat (webapp)
let supportMessages = [];

function initSupportChat() {
    // Only run if the section is present
    const box = document.getElementById('support-messages');
    if (!box) return;

    // Enter-to-send
    const input = document.getElementById('supportMessageInput');
    if (input && !input.__supportEnterBound) {
        input.__supportEnterBound = true;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendSupportChatMessage();
            }
        });
    }

    loadSupportChatMessages();

    // Start polling
    if (supportChatInterval) clearInterval(supportChatInterval);
    supportChatInterval = setInterval(loadSupportChatMessages, 3000);
}

function renderSupportMessages() {
    const box = document.getElementById('support-messages');
    if (!box) return;

    if (!supportMessages || supportMessages.length === 0) {
        box.innerHTML = `
            <div style="text-align:center; padding: 24px 10px; color:#6b7280;">
                <p style="margin:0 0 8px 0;">Сообщений пока нет</p>
                <p style="margin:0; font-size:12px;">Напишите нам — мы ответим как можно быстрее.</p>
            </div>
        `;
        return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
    supportMessages.forEach((m) => {
        const isUser = m.direction === 'user';
        const align = isUser ? 'flex-end' : 'flex-start';
        const bg = isUser ? '#111827' : '#f3f4f6';
        const color = isUser ? '#ffffff' : '#111827';
        const time = m.createdAt ? new Date(m.createdAt).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

        html += `
            <div style="display:flex; justify-content:${align};">
                <div style="max-width: 85%; background:${bg}; color:${color}; border-radius: 14px; padding: 10px 12px; line-height:1.35;">
                    <div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(m.text || '')}</div>
                    ${time ? `<div style="margin-top:6px; font-size:11px; opacity:0.7; text-align:right;">${escapeHtml(time)}</div>` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';

    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
}

async function loadSupportChatMessages() {
    const box = document.getElementById('support-messages');

    // Stop polling if the element is no longer in the DOM
    if (!box) {
        if (supportChatInterval) {
            clearInterval(supportChatInterval);
            supportChatInterval = null;
        }
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/support/messages`, { headers: getApiHeaders() });
        if (!response.ok) {
            // Keep silent api errors during polling, unless it's the initial empty state
            if (!supportMessages || supportMessages.length === 0) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Failed to load support messages: ${response.status} ${errorText}`);
            }
            return;
        }
        const data = await response.json();
        const newMessages = Array.isArray(data) ? data : [];

        // Only render if changed (simple serialization check)
        if (JSON.stringify(newMessages) !== JSON.stringify(supportMessages)) {
            supportMessages = newMessages;
            renderSupportMessages();
        }
    } catch (error) {
        console.error('❌ Error loading support messages:', error);
        if (!supportMessages || supportMessages.length === 0) {
            box.innerHTML = `
                <div class="error-message">
                    <h3>Ошибка загрузки чата</h3>
                    <p>Попробуйте обновить страницу.</p>
                    <button class="btn" onclick="loadSupportChatMessages()" style="margin-top:12px;">Обновить</button>
                </div>
            `;
        }
    }
}

async function sendSupportChatMessage() {
    const input = document.getElementById('supportMessageInput');
    const text = (input?.value || '').trim();
    if (!text) return;

    try {
        if (input) input.value = '';
        // Optimistic UI
        supportMessages = [...(supportMessages || []), { direction: 'user', text, createdAt: new Date().toISOString() }];
        renderSupportMessages();

        const response = await fetch(`${API_BASE}/support/messages`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData?.error || `HTTP ${response.status}`);
        }

        // Refresh from server (ensures order + IDs)
        await loadSupportChatMessages();
    } catch (error) {
        console.error('❌ Error sending support message:', error);
        showError('Не удалось отправить сообщение. Попробуйте еще раз.');
        // Reload to avoid diverging optimistic state
        await loadSupportChatMessages().catch(() => { });
    }
}

function showReferralLink() {
    showSuccess('Копирование реферальной ссылки...');
    // Здесь можно добавить логику показа ссылки
}

async function showPartners() {
    try {
        const response = await fetch(`${API_BASE}/partner/referrals`, { headers: getApiHeaders() });
        if (!response.ok) {
            throw new Error('Failed to fetch referrals');
        }

        const data = await response.json();
        const directPartners = data.directPartners || [];
        const multiPartners = data.multiPartners || [];

        let html = '<div class="partners-list-container">';
        html += '<h3>👥 Мои рефералы</h3>';

        if (directPartners.length === 0 && multiPartners.length === 0) {
            html += '<p>Пока нет рефералов. Приглашайте друзей по вашей реферальной ссылке!</p>';
        } else {
            if (directPartners.length > 0) {
                html += '<h4>🎯 Прямые рефералы (1-й уровень)</h4>';
                html += '<ul class="referrals-list">';
                directPartners.forEach((partner, index) => {
                    const displayName = partner.username ? `@${partner.username}` : (partner.firstName || `ID:${partner.telegramId?.slice(-5) || ''}`);
                    const joinedDate = partner.joinedAt ? new Date(partner.joinedAt).toLocaleDateString('ru-RU') : '';
                    html += `<li>${index + 1}. ${escapeHtml(displayName)}${joinedDate ? ` (с ${joinedDate})` : ''}</li>`;
                });
                html += '</ul>';
            }

            if (multiPartners.length > 0) {
                html += '<h4>🌳 Многоуровневые рефералы</h4>';
                html += '<ul class="referrals-list">';
                multiPartners.forEach((partner, index) => {
                    const displayName = partner.username ? `@${partner.username}` : (partner.firstName || `ID:${partner.telegramId?.slice(-5) || ''}`);
                    const level = partner.level || 2;
                    const joinedDate = partner.joinedAt ? new Date(partner.joinedAt).toLocaleDateString('ru-RU') : '';
                    html += `<li>${index + 1}. ${escapeHtml(displayName)} (${level}-й уровень)${joinedDate ? ` - с ${joinedDate}` : ''}</li>`;
                });
                html += '</ul>';
            }
        }

        html += '</div>';

        const container = document.getElementById('section-body');
        if (container) {
            container.innerHTML = html;
        }
    } catch (error) {
        console.error('Error loading partners:', error);
        showError('Ошибка загрузки списка рефералов');
    }
}

// Show products section with custom content
function showProductsSection(content) {
    currentSection = 'shop';
    const overlay = document.getElementById('section-overlay');
    const title = document.getElementById('section-title');
    const body = document.getElementById('section-body');

    // Set section title
    title.textContent = 'Товары';

    // Set custom content
    body.innerHTML = content;

    // Show overlay
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);
}

// Show instruction modal
function showInstruction(productId, instructionText) {
    const modal = document.createElement('div');
    modal.className = 'instruction-modal';
    modal.innerHTML = `
        <div class="instruction-overlay" onclick="closeInstruction()">
            <div class="instruction-content" onclick="event.stopPropagation()">
                <div class="instruction-header">
                    <h3>📋 Инструкция по применению</h3>
                    <button class="btn-close" onclick="closeInstruction()">×</button>
                </div>
                <div class="instruction-body">
                    <div class="instruction-text">${instructionText.replace(/\n/g, '<br>')}</div>
                </div>
                <div class="instruction-footer">
                    <button class="btn btn-secondary" onclick="closeInstruction()">Закрыть</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add animation
    setTimeout(() => {
        modal.querySelector('.instruction-content').style.transform = 'scale(1)';
    }, 10);
}

// Close instruction modal
function closeInstruction() {
    const modal = document.querySelector('.instruction-modal');
    if (modal) {
        modal.querySelector('.instruction-content').style.transform = 'scale(0.8)';
        setTimeout(() => {
            modal.remove();
        }, 200);
    }
}

// NOTE: showCategoryProducts is defined earlier in this file.
// This legacy duplicate implementation was removed to avoid "Identifier ... has already been declared"
// and potential runtime issues in strict environments.

// NOTE: do not add duplicate addToCart/buyProduct implementations below.

// Contact and address collection functions
async function requestContactAndAddress() {
    // Сначала проверяем, есть ли у пользователя уже сохраненные данные
    const user = await loadUserData();

    if (user && user.phone && user.deliveryAddress) {
        // У пользователя есть и телефон и адрес - показываем подтверждение
        await showAddressConfirmation(user.deliveryAddress);
    } else if (user && user.phone) {
        // Есть только телефон - запрашиваем адрес
        await requestDeliveryAddress();
    } else {
        // Нет ни телефона, ни адреса - запрашиваем телефон
        await requestPhoneNumber();
    }
}

async function requestPhoneNumber() {
    const content = `
        <div class="content-section">
            <h3>📞 Номер телефона</h3>
            <p>Для быстрой связи поделитесь своим номером телефона:</p>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="shareContact()">
                    📞 Поделиться контактом
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="enterPhoneManually()">
                    ✏️ Ввести номер вручную
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="skipPhone()">
                    ⏭️ Пропустить
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);
}

async function requestDeliveryAddress() {
    const content = `
        <div class="content-section">
            <h3>📍 Адрес доставки</h3>
            <p>Укажите адрес для доставки заказа:</p>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="selectAddressType('bali')">
                    🇮🇩 Бали - район и вилла
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="selectAddressType('russia')">
                    🇷🇺 РФ - город и адрес
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="selectAddressType('custom')">
                    ✏️ Ввести свой вариант
                </button>
            </div>
            
            <div style="margin: 30px 0; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                <button class="btn btn-outline" onclick="skipAddress()" style="margin-right: 10px;">
                    ⏭️ Пропустить
                </button>
                <button class="btn btn-outline" onclick="closeSection()">
                    ❌ Отмена
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);
}

async function showAddressConfirmation(address) {
    const content = `
        <div class="content-section">
            <h3>📍 Подтверждение адреса</h3>
            <p>Вам доставить на этот адрес?</p>
            
            <div style="background: #f9f9f9; 
                        border: 1px solid var(--border-color); 
                        border-radius: 12px; 
                        padding: 16px; 
                        margin: 20px 0;">
                <p style="color: #000000; font-weight: bold;">${address}</p>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="confirmAddress('${address}')">
                    💾 Сохранить и продолжить
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="changeAddress()">
                    ✏️ Изменить адрес
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-outline" onclick="skipAddress()">
                    ⏭️ Пропустить адрес
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);
}

// Contact sharing functions
async function shareContact() {
    if (tg && tg.requestContact) {
        try {
            const contact = await tg.requestContact();
            if (contact && contact.phone_number) {
                await savePhoneNumber(contact.phone_number);
                await requestDeliveryAddress();
            }
        } catch (error) {
            console.error('Error requesting contact:', error);
            showError('Ошибка получения контакта');
        }
    } else {
        // Fallback to manual input if Telegram API is not available
        await enterPhoneManually();
    }
}

async function enterPhoneManually() {
    const phone = prompt('Введите номер телефона:');
    if (phone) {
        await savePhoneNumber(phone);
        await requestDeliveryAddress();
    }
}

async function skipPhone() {
    await requestDeliveryAddress();
}

async function savePhoneNumber(phone) {
    try {
        const response = await fetch(`${API_BASE}/user/phone`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ phone })
        });

        if (response.ok) {
            showSuccess('Номер телефона сохранен!');
        } else {
            showError('Ошибка сохранения номера');
        }
    } catch (error) {
        console.error('Error saving phone:', error);
        showError('Ошибка сохранения номера');
    }
}

// Address functions
async function selectAddressType(type) {
    let title = '';
    let placeholder = '';
    let example = '';

    switch (type) {
        case 'bali':
            title = '🇮🇩 Адрес для Бали';
            placeholder = 'Например: Семиньяк, Villa Seminyak Resort';
            example = 'Укажите район и название виллы';
            break;
        case 'russia':
            title = '🇷🇺 Адрес для России';
            placeholder = 'Например: Москва, ул. Тверская, д. 10, кв. 5';
            example = 'Укажите город и точный адрес';
            break;
        case 'custom':
            title = '✏️ Ваш адрес';
            placeholder = 'Введите полный адрес доставки';
            example = 'Укажите адрес в произвольной форме';
            break;
    }

    const content = `
        <div class="content-section">
            <h3>${title}</h3>
            <p>${example}:</p>
            
            <div style="margin: 20px 0;">
                <input type="text" id="addressInput" placeholder="${placeholder}" 
                       style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2); 
                              background: rgba(255, 255, 255, 0.1); color: white; font-size: 16px;">
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="saveAddressFromInput('${type}')">
                    💾 Сохранить адрес
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-outline" onclick="requestDeliveryAddress()">
                    ← Назад к выбору
                </button>
            </div>
        </div>
    `;

    showProductsSection(content);

    // Focus on input
    setTimeout(() => {
        const input = document.getElementById('addressInput');
        if (input) {
            input.focus();
        }
    }, 100);
}

async function saveAddressFromInput(type) {
    const input = document.getElementById('addressInput');
    const address = input ? input.value.trim() : '';

    if (!address) {
        showError('Пожалуйста, введите адрес');
        return;
    }

    await saveDeliveryAddress(type, address);
}

async function skipAddress() {
    showSuccess('Адрес пропущен. Заказ будет обработан без указания адреса.');
    closeSection();
}

async function changeAddress() {
    await requestDeliveryAddress();
}

async function saveDeliveryAddress(type, address) {
    try {
        const fullAddress = `${type}: ${address}`;
        const response = await fetch(`${API_BASE}/user/address`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ address: fullAddress })
        });

        if (response.ok) {
            showSuccess('Адрес сохранен!');
            closeSection();
        } else {
            showError('Ошибка сохранения адреса');
        }
    } catch (error) {
        console.error('Error saving address:', error);
        showError('Ошибка сохранения адреса');
    }
}

async function confirmAddress(address) {
    showSuccess('Адрес подтвержден! Заказ будет доставлен по указанному адресу.');
    closeSection();
}
// NOTE: changeAddress is defined above; duplicate removed.

// New section content loaders
function _deprecated_loadCertificatesContent() {
    return '';
}

function loadPromotionsContent() {
    return `
        <div class="content-section">
            <h3>🎉 Акции и скидки</h3>
            <p>Следите за нашими акциями и специальными предложениями!</p>
        </div>
    `;
}

function loadContactsContent() {
    return `
        <div class="content-section">
            <h3>📞 Контакты</h3>
            <div class="contacts-list">
                <div class="contact-item">
                    <strong>Телефон:</strong>
                    <a href="tel:+79999999999">+7 (999) 999-99-99</a>
                </div>
                <div class="contact-item">
                    <strong>Email:</strong>
                    <a href="mailto:info@plazma.ru">info@plazma.ru</a>
                </div>
                <div class="contact-item">
                    <strong>Telegram:</strong>
                    <a href="https://t.me/plazma_bot" target="_blank">@plazma_bot</a>
                </div>
                <div class="contact-item">
                    <strong>ВКонтакте:</strong>
                    <a href="https://vk.com/plazma" target="_blank">vk.com/plazma</a>
                </div>
                <div class="contact-item">
                    <strong>Instagram:</strong>
                    <a href="https://www.instagram.com/plazma.water/" target="_blank">@plazma.water</a>
                </div>
            </div>
        </div>
    `;
}

async function loadBalanceContent() {
    try {
        const [profileResp, topupResp] = await Promise.all([
            fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() }),
            fetch(`${API_BASE}/balance/topup-info`, { headers: getApiHeaders() })
        ]);
        const profile = await profileResp.json().catch(() => ({}));
        const topup = await topupResp.json().catch(() => ({}));
        const balance = Number(profile?.balance || 0) || 0;
        const text = String(topup?.text || '').trim();
        const safeText = text ? escapeHtml(text).replace(/\n/g, '<br>') : 'Реквизиты пополнения появятся позже.';

        return `
            <div class="content-section">
                <h3>💰 Баланс</h3>
                <div class="balance-display" style="margin-bottom: 16px;">
                    <span class="balance-label">Ваш баланс:</span>
                    <span class="balance-value">${formatRubFromPz(balance)}</span>
                </div>
                <div style="margin-bottom: 16px; padding: 14px; border: 1px solid var(--border-color); border-radius: 12px; background: #ffffff;">
                    <div style="font-weight: 800; margin-bottom: 8px;">Реквизиты пополнения</div>
                    <div style="color: #4b5563; font-size: 14px; line-height: 1.5;">${safeText}</div>
                </div>
                <div style="padding: 14px; border: 1px solid var(--border-color); border-radius: 12px; background: #ffffff;">
                    <div style="font-weight: 800; margin-bottom: 10px;">Загрузите чек</div>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="balance-topup-amount">Сумма пополнения (₽)</label>
                        <input id="balance-topup-amount" type="number" min="10" step="1" class="delivery-input" placeholder="Например: 1000">
                    </div>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <input id="balance-topup-receipt" type="file" accept="image/*" class="delivery-input">
                    </div>
                    <button class="btn" onclick="submitBalanceTopupReceipt()" style="width: 100%;">Отправить</button>
                    <div id="balance-topup-status" style="margin-top: 10px; font-size: 12px; color: var(--text-secondary);"></div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading balance content:', error);
        return '<div class="error-message"><h3>Ошибка</h3><p>Не удалось загрузить баланс</p></div>';
    }
}

async function submitBalanceTopupReceipt() {
    try {
        const amountEl = document.getElementById('balance-topup-amount');
        const fileEl = document.getElementById('balance-topup-receipt');
        const statusEl = document.getElementById('balance-topup-status');
        const amount = Math.round(Number(amountEl?.value || 0));
        if (!Number.isFinite(amount) || amount <= 0) {
            showError('Введите сумму пополнения');
            return;
        }
        if (!fileEl || !fileEl.files || !fileEl.files[0]) {
            showError('Загрузите чек');
            return;
        }

        if (statusEl) statusEl.textContent = 'Отправляем чек...';
        const form = new FormData();
        form.append('amountRub', String(amount));
        form.append('receipt', fileEl.files[0]);

        const resp = await fetch(`${API_BASE}/balance/topup-receipt`, {
            method: 'POST',
            headers: { 'X-Telegram-User': JSON.stringify(getTelegramUserData()) },
            body: form
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data?.success) {
            throw new Error(data?.error || 'Ошибка отправки чека');
        }
        if (statusEl) statusEl.textContent = 'Чек отправлен. Мы проверим оплату и пополним баланс.';
        showSuccess('Чек отправлен');
        if (fileEl) fileEl.value = '';
    } catch (e) {
        console.error('Receipt submit error:', e);
        showError('Не удалось отправить чек');
    }
}

// Balance top-up dialog
function showBalanceTopUpDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'balance-topup-modal';
    dialog.innerHTML = `
        <div class="balance-topup-overlay" onclick="closeBalanceTopUpDialog()"></div>
        <div class="balance-topup-content">
            <div class="balance-topup-header">
                <h3>💰 Пополнить баланс</h3>
                <button class="balance-topup-close" onclick="closeBalanceTopUpDialog()">×</button>
            </div>
            <div class="balance-topup-body">
                <p style="margin-bottom: 12px; color: var(--text-secondary);">Введите сумму пополнения (₽):</p>
                <input type="number" id="topup-amount" class="delivery-input" min="10" step="10" placeholder="Например: 1000" style="margin-bottom: 12px;">
                <button class="btn" onclick="startBalanceTopUpFromWebapp()" style="width: 100%; margin-bottom: 12px;">
                    💳 Оплатить картой
                </button>
                <div id="topup-hint" style="font-size: 12px; color: var(--text-secondary); line-height: 1.35; margin-bottom: 10px;">
                  После оплаты баланс обновится автоматически.
                </div>
                <button class="btn btn-secondary" onclick="closeBalanceTopUpDialog()" style="width: 100%;">
                    Отмена
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
    setTimeout(() => dialog.classList.add('open'), 10);
}

function closeBalanceTopUpDialog() {
    const dialog = document.querySelector('.balance-topup-modal');
    if (dialog) {
        dialog.classList.remove('open');
        setTimeout(() => dialog.remove(), 300);
    }
}

function openBotForBalance() {
    // Открываем бота с командой пополнения баланса
    const botUsername = 'Vital_shop_bot';
    const botUrl = `https://t.me/${botUsername}?start=add_balance`;

    // Пытаемся открыть через Telegram WebApp
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.openTelegramLink(botUrl);
    } else {
        // Fallback: открываем в новом окне
        window.open(botUrl, '_blank');
    }

    closeBalanceTopUpDialog();
}

async function startBalanceTopUpFromWebapp() {
    try {
        const amountEl = document.getElementById('topup-amount');
        const raw = amountEl ? amountEl.value : '';
        const amount = Math.round(Number(raw || 0));
        if (!Number.isFinite(amount) || amount <= 0) {
            showError('Введите сумму пополнения');
            return;
        }
        if (amount < 10) {
            showError('Минимум 10 ₽');
            return;
        }

        const resp = await fetch(`${API_BASE}/balance/topup`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amountRub: amount })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data?.success || !data?.paymentUrl) {
            throw new Error(data?.error || 'Не удалось создать ссылку на оплату');
        }

        const url = String(data.paymentUrl);
        if (window.Telegram?.WebApp?.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(url);
        } else {
            window.open(url, '_blank');
        }
        closeBalanceTopUpDialog();
    } catch (e) {
        console.error('Topup error:', e);
        showError('Не удалось начать пополнение. Попробуйте позже.');
    }
}

// ===== Delivery cities autocomplete (RU) =====
// Lightweight list for typeahead. Can be replaced later with DB-backed city directory.
const RU_CITIES = [
    'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону',
    'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград', 'Краснодар', 'Саратов', 'Тюмень', 'Тольятти', 'Ижевск',
    'Барнаул', 'Ульяновск', 'Иркутск', 'Хабаровск', 'Ярославль', 'Владивосток', 'Махачкала', 'Томск', 'Оренбург', 'Кемерово',
    'Новокузнецк', 'Рязань', 'Астрахань', 'Набережные Челны', 'Пенза', 'Киров', 'Липецк', 'Чебоксары', 'Тула', 'Калининград',
    'Курск', 'Ставрополь', 'Севастополь', 'Сочи', 'Белгород', 'Улан-Удэ', 'Тверь', 'Магнитогорск', 'Иваново', 'Брянск',
    'Сургут', 'Владимир', 'Нижний Тагил', 'Архангельск', 'Чита', 'Калуга', 'Смоленск', 'Волжский', 'Череповец', 'Орёл',
    'Вологда', 'Саранск', 'Мурманск', 'Якутск', 'Тамбов', 'Стерлитамак', 'Грозный', 'Кострома', 'Новороссийск', 'Петрозаводск',
    'Таганрог', 'Нальчик', 'Бийск', 'Комсомольск-на-Амуре', 'Нижневартовск', 'Сыктывкар', 'Шахты', 'Дзержинск', 'Орск', 'Ангарск'
];

function normalizeCityQuery(q) {
    return String(q || '').trim().toLowerCase();
}

function pickCitySuggestions(q, limit = 8) {
    const query = normalizeCityQuery(q);
    if (!query) return [];
    const starts = [];
    const contains = [];
    for (const c of RU_CITIES) {
        const lc = c.toLowerCase();
        if (lc.startsWith(query)) starts.push(c);
        else if (lc.includes(query)) contains.push(c);
        if (starts.length >= limit) break;
    }
    const out = starts.concat(contains).slice(0, limit);
    return out;
}

function renderCitySuggestions(inputEl) {
    const wrap = document.getElementById('delivery-city-suggest');
    if (!wrap || !inputEl) return;
    const q = inputEl.value || '';
    const items = pickCitySuggestions(q, 8);
    if (!items.length) {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
        return;
    }
    wrap.innerHTML = items.map(c => `<button type="button" class="city-suggest-item" data-city="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join('');
    wrap.style.display = 'block';
    wrap.querySelectorAll('button.city-suggest-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const city = btn.getAttribute('data-city') || '';
            inputEl.value = city;
            wrap.style.display = 'none';
            wrap.innerHTML = '';
        });
    });
}

function hideCitySuggestions() {
    const wrap = document.getElementById('delivery-city-suggest');
    if (!wrap) return;
    wrap.style.display = 'none';
    wrap.innerHTML = '';
}

function updateBalanceAffordability() {
    const root = document.getElementById('delivery-form-root');
    const cb = document.getElementById('pay-from-balance');
    const note = document.getElementById('balance-topup-note');
    const topupBtn = document.getElementById('topup-btn');
    if (!root || !cb || !note) return;

    const balanceRub = Number(root.getAttribute('data-balance-rub') || '0');
    const grandText = document.getElementById('checkout-grand-total')?.textContent || '0';
    const grandRub = Number(String(grandText).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;

    const shortfall = grandRub - balanceRub;
    if (shortfall > 0.5) {
        cb.checked = false;
        cb.disabled = true;
        note.style.display = 'block';
        note.innerHTML = `
          <div style="margin-top:6px; font-size: 13px; color: var(--text-secondary);">
            Недостаточно средств: не хватает <strong>${Math.ceil(shortfall)} ₽</strong>. Нужно пополнить счёт.
          </div>
        `;
        if (topupBtn) topupBtn.style.display = 'block';
    } else {
        cb.disabled = false;
        note.style.display = 'none';
        note.innerHTML = '';
        if (topupBtn) topupBtn.style.display = 'none';
    }
}

// Показать форму доставки
function showDeliveryForm(items, totalRub, userBalance) {
    // Загружаем данные пользователя для предзаполнения
    fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() })
        .then(response => response.ok ? response.json() : {})
        .then(userData => {
            const userBalanceRub = Number(userBalance || 0) * 100;
            const dialog = document.createElement('div');
            dialog.className = 'delivery-form-modal';
            dialog.innerHTML = `
                <div class="delivery-form-overlay" onclick="closeDeliveryForm()"></div>
                <div class="delivery-form-content" id="delivery-form-root" data-balance-rub="${userBalanceRub}" data-items-rub="${Number(totalRub || 0)}">
                    <div class="delivery-form-header">
                        <h3>📦 Оформление заказа</h3>
                        <button class="delivery-form-close" onclick="closeDeliveryForm()">×</button>
                    </div>
                    <div class="delivery-form-body">
                        <div style="margin-bottom: 20px; padding: 16px; background: var(--bg-secondary); border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <span>💰 Ваш баланс:</span>
                                <strong>${userBalanceRub.toFixed(0)} ₽</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>📦 Сумма заказа:</span>
                                <strong id="checkout-items-total">${Number(totalRub || 0).toFixed(0)} ₽</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-top: 6px;">
                                <span>Итого:</span>
                                <strong id="checkout-grand-total">${Number(totalRub || 0).toFixed(0)} ₽</strong>
                            </div>
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">Город *</label>
                            <div style="position: relative;">
                              <input type="text" id="delivery-city" class="delivery-input" placeholder="Например: Санкт-Петербург" value="" autocomplete="off" required>
                              <div id="delivery-city-suggest" class="city-suggest" style="display:none;"></div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">Телефон *</label>
                            <input type="tel" id="delivery-phone" class="delivery-input" placeholder="+7 (999) 123-45-67" value="${userData.phone || ''}" required>
                        </div>
                        
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">Адрес доставки *</label>
                            <textarea id="delivery-address" class="delivery-textarea" placeholder="Город, улица, дом, квартира" rows="3" required>${userData.deliveryAddress || ''}</textarea>
                        </div>

                        <div style="margin-bottom: 16px;">
                          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                              <input type="checkbox" id="pay-from-balance">
                              <span>Оплатить с баланса</span>
                          </label>
                          <div id="balance-topup-note" style="display:none;"></div>
                          <button type="button" class="btn btn-outline" id="topup-btn" onclick="openBalanceFromCheckout()" style="display:none; width:100%; margin-top: 10px;">
                            Пополнить счёт
                          </button>
                        </div>

                        <div style="margin-bottom: 16px;">
                          <label style="display:block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">Сертификат (код)</label>
                          <input type="text" id="certificate-code" class="delivery-input" placeholder="Например: VTL-ABCD-1234" value="" autocomplete="off">
                          <div style="margin-top:6px; font-size:12px; color: var(--text-secondary); line-height:1.35;">
                            Если у вас есть подарочный сертификат — введите код, он уменьшит сумму к оплате.
                          </div>
                        </div>
                        
                        <button class="btn" onclick="submitDeliveryForm(${JSON.stringify(items).replace(/"/g, '&quot;')}, ${Number(totalRub || 0)}, ${Number(userBalance || 0)})" style="width: 100%;">
                            Оформить заказ
                        </button>
                        <button class="btn btn-secondary" onclick="closeDeliveryForm()" style="width: 100%; margin-top: 12px;">
                            Отмена
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
            setTimeout(() => dialog.classList.add('open'), 10);

            // Город: подсказки по вводу
            const cityInput = document.getElementById('delivery-city');
            if (cityInput) {
                cityInput.addEventListener('input', () => renderCitySuggestions(cityInput));
                cityInput.addEventListener('blur', () => setTimeout(hideCitySuggestions, 150));
                cityInput.addEventListener('focus', () => renderCitySuggestions(cityInput));
            }
            // Инициализируем доступность оплаты с баланса
            updateBalanceAffordability();
        })
        .catch(error => {
            console.error('Error loading user data:', error);
            showError('Ошибка загрузки данных пользователя');
        });
}

function debounce(fn, wait) {
    let t = null;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

// delivery totals removed (checkout is "fill address and order"; delivery method selection is not used in client)

function closeDeliveryForm() {
    const dialog = document.querySelector('.delivery-form-modal');
    if (dialog) {
        dialog.classList.remove('open');
        setTimeout(() => dialog.remove(), 300);
    }
}

function openBalanceFromCheckout() {
    closeDeliveryForm();
    setTimeout(() => openSection('balance'), 220);
}

async function submitDeliveryForm(items, totalRub, userBalance) {
    const phone = document.getElementById('delivery-phone')?.value?.trim();
    const city = document.getElementById('delivery-city')?.value?.trim();
    const address = document.getElementById('delivery-address')?.value?.trim();
    const payFromBalance = document.getElementById('pay-from-balance')?.checked || false;
    const certificateCode = document.getElementById('certificate-code')?.value?.trim();

    if (!phone) {
        showError('Укажите номер телефона');
        return;
    }

    if (!city) {
        showError('Укажите город');
        return;
    }

    if (!address) {
        showError('Укажите адрес доставки');
        return;
    }

    // Сохраняем телефон и адрес
    try {
        await fetch(`${API_BASE}/user/profile`, {
            method: 'PUT',
            headers: getApiHeaders(),
            body: JSON.stringify({ phone, deliveryAddress: address })
        });
    } catch (error) {
        console.error('Error saving user data:', error);
    }

    const grandTotalRub = Number(totalRub || 0);
    const userBalanceRub = Number(userBalance || 0) * 100;

    // Оплата с баланса (если выбрана)
    if (payFromBalance) {
        if (userBalanceRub < grandTotalRub) {
            showError('Недостаточно средств на балансе');
            return;
        }
        const totalPz = grandTotalRub / 100; // ₽→PZ
        const deliveryLine = `Город: ${city}\nАдрес: ${address}`;
        await processOrderWithBalance(items, totalPz, null, phone, deliveryLine, certificateCode);
        closeDeliveryForm();
        return;
    }

    // Без онлайн-оплаты: просто создаем заказ администратору
    const deliveryLine = `Город: ${city}\nАдрес: ${address}`;
    await processOrderNormal(items, phone, deliveryLine, certificateCode);

    closeDeliveryForm();
}

// Utility functions
async function loadUserData() {
    try {
        const response = await fetch(`${API_BASE}/user/profile`, { headers: getApiHeaders() });
        if (response.ok) {
            userData = await response.json();
        } else if (response.status === 401) {
            console.log('User not authenticated - this is normal for web preview');
            userData = null;
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        userData = null;
    }
}

async function loadCartItems() {
    try {
        console.log('🛒 Loading cart items...');
        const response = await fetch(`${API_BASE}/cart/items`, { headers: getApiHeaders() });
        if (response.ok) {
            cartItems = await response.json();
            console.log('✅ Cart items loaded:', cartItems.length);

            // Фильтруем валидные товары
            cartItems = cartItems.filter(item => item.product && item.product.isActive);
        } else if (response.status === 401) {
            console.log('User not authenticated - this is normal for web preview');
            cartItems = [];
        } else {
            console.error('Failed to load cart items:', response.status);
            cartItems = [];
        }

        // Обновляем счетчик корзины после загрузки
        updateCartBadge();
        console.log(`🛒 Cart items: ${cartItems.length} items`);
    } catch (error) {
        console.error('Error loading cart items:', error);
        cartItems = [];
        updateCartBadge();
        console.log('🛒 Cart items: 0 items (error)');
    }
}

// Load product count for shop badge
async function loadProductCount() {
    try {
        console.log('📦 Loading product count...');
        const response = await fetch(`${API_BASE}/products/count`);
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Product count data:', data);
            const shopBadge = document.getElementById('shop-badge');
            if (shopBadge) {
                shopBadge.textContent = data.totalProducts || '0';
                console.log(`📦 Shop badge updated: ${data.totalProducts || '0'} products`);
            } else {
                console.log('❌ Shop badge element not found');
            }
        } else {
            console.error('❌ Failed to load product count:', response.status);
        }
    } catch (error) {
        console.error('❌ Error loading product count:', error);
    }
}

// Load reviews count for reviews badge
async function loadReviewsCount() {
    try {
        const response = await fetch(`${API_BASE}/reviews/count`);
        if (response.ok) {
            const data = await response.json();
            const reviewsBadge = document.getElementById('reviews-badge');
            if (reviewsBadge) {
                reviewsBadge.textContent = data.totalReviews || '0';
            }
        }
    } catch (error) {
        console.error('Error loading reviews count:', error);
    }
}

function updateCartBadge() {
    try {
        // Calculate total quantity of items in cart
        let totalQuantity = 0;
        if (cartItems && Array.isArray(cartItems) && cartItems.length > 0) {
            totalQuantity = cartItems.reduce((sum, item) => {
                // Пропускаем товары без продукта
                if (!item.product || !item.product.isActive) {
                    return sum;
                }
                return sum + (item.quantity || 1);
            }, 0);
        }

        // Update cart badge with item count
        const cartBadge = document.querySelector('.cart-badge');
        if (cartBadge) {
            if (totalQuantity > 0) {
                cartBadge.textContent = totalQuantity.toString();
                cartBadge.style.display = 'grid';
                cartBadge.classList.add('animate');
                setTimeout(() => cartBadge.classList.remove('animate'), 300);
            } else {
                cartBadge.textContent = '0';
                cartBadge.style.display = 'none';
            }
        } else {
            console.warn('⚠️ Cart badge element not found');
        }

        console.log(`🛒 Cart badge updated: ${totalQuantity} items`);
    } catch (error) {
        console.error('Error updating cart badge:', error);
    }
}

// Принудительное обновление счетчика корзины
async function refreshCartBadge() {
    try {
        await loadCartItems();
        updateCartBadge();
    } catch (error) {
        console.error('Error refreshing cart badge:', error);
    }
}

// Оптимистичное увеличение счетчика корзины (до загрузки данных)
function incrementCartBadge(delta = 1) {
    try {
        const cartBadge = document.querySelector('.cart-badge');
        if (cartBadge) {
            const currentCount = parseInt(cartBadge.textContent) || 0;
            const newCount = currentCount + (Number(delta) || 1);
            cartBadge.textContent = newCount.toString();
            cartBadge.style.display = 'grid';
            cartBadge.classList.add('animate');
            setTimeout(() => cartBadge.classList.remove('animate'), 300);
            console.log(`🛒 Cart badge incremented: ${newCount}`);
        }
    } catch (error) {
        console.error('Error incrementing cart badge:', error);
    }
}

function updateBadges() {
    // Update shop badge with total products count (not cart sum)
    loadProductCount();

    // Update reviews badge with total reviews count
    loadReviewsCount();

    // Update other badges based on data
    // This would be populated from actual data
}

function showSuccess(message) {
    // Show success message (could be a toast notification)
    console.log('Success:', message);
    if (tg) {
        tg.showAlert(message);
    } else {
        alert(message);
    }
}

function showError(message) {
    // Show error message (could be a toast notification)
    console.log('Error:', message);
    if (tg) {
        tg.showAlert(message);
    } else {
        alert(message);
    }

    // Close any open sections on error
    if (currentSection) {
        closeSection();
    }
}

// Search functionality
const searchInput = document.querySelector('.search-input');
if (searchInput) {
    searchInput.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase();
        if (query.length > 2) {
            // Implement search logic here
            console.log('Searching for:', query);
        }
    });
}

// Keyboard navigation
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && currentSection) {
        closeSection();
    }
});

// Handle back button
window.addEventListener('popstate', function (e) {
    if (currentSection) {
        closeSection();
    }
});

// Show product details function
let _productDetailQty = 1;
let _productDetailId = null;

function getProductDetailQty() {
    return Number(_productDetailQty) || 1;
}

function setProductDetailQty(nextQty) {
    const q = Math.max(1, Math.min(99, Number(nextQty) || 1));
    _productDetailQty = q;
    const el = document.getElementById('product-detail-qty');
    if (el) el.textContent = String(q);
}

function changeProductDetailQty(delta) {
    setProductDetailQty(getProductDetailQty() + (Number(delta) || 0));
}

function resetProductDetailQty(productId) {
    _productDetailId = productId;
    setProductDetailQty(1);
}

async function showProductDetails(productId) {
    try {
        console.log('📖 Showing product details for:', productId);

        let product = null;

        // 1. Try to find in local cache first (instant load)
        if (typeof SHOP_PRODUCTS_CACHE !== 'undefined' && Array.isArray(SHOP_PRODUCTS_CACHE)) {
            product = SHOP_PRODUCTS_CACHE.find(p => String(p.id) === String(productId));
            if (product) {
                console.log('✅ Found product in cache:', productId);
            }
        }

        // 2. If not in cache, fetch from API
        if (!product) {
            const response = await fetch(`${API_BASE}/products/${productId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch product details');
            }
            product = await response.json();
        }

        if (!product) {
            throw new Error('Product not found');
        }
        resetProductDetailQty(product.id);

        // Create detailed product view
        let content = `
            <div class="product-details">
                <div class="product-details-header">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                        <h2 style="margin:0;">${cleanProductTitle(product.title)}</h2>
                        ${renderFavoriteButton(product.id)}
                    </div>
                </div>
                
                <div class="product-details-content">
                    ${product.imageUrl ? `<div class="product-details-image"><img src="${product.imageUrl}" alt="${product.title}" onerror="this.style.display='none'"></div>` : ''}
                    
                    <div class="product-details-info">
                        <div class="product-header-row">
                            <div class="product-price">💰 Цена: ${pzToRub(product.price)} ₽</div>
                            ${extractProductWeight(product.summary).weight ? `<div class="product-weight-badge-large">${extractProductWeight(product.summary).weight}</div>` : ''}
                        </div>
                        
                        ${product.summary ? `<div class="product-summary"><h4>Краткое описание:</h4><p>${product.summary}</p></div>` : ''}
                        
                        ${product.description ? `<div class="product-description-full"><h4>Подробное описание:</h4><p>${product.description}</p></div>` : ''}
                        
                        ${product.instruction ? `<div class="product-instruction"><h4>📋 Инструкция по применению:</h4><p>${product.instruction}</p></div>` : ''}
                    </div>
                    
                    <div class="product-details-actions">
                        <div class="qty-control" aria-label="Количество">
                            <button class="qty-btn" type="button" aria-label="Уменьшить" onclick="changeProductDetailQty(-1)">−</button>
                            <div class="qty-value" id="product-detail-qty">1</div>
                            <button class="qty-btn" type="button" aria-label="Увеличить" onclick="changeProductDetailQty(1)">+</button>
                        </div>
                        <button class="btn-buy" onclick="addToCartAndOpenCart('${product.id}', getProductDetailQty())">
                            🛍 Купить
                        </button>
                        ${product.instruction ? `<button class="btn-instruction" onclick="showInstruction('${product.id}', \`${product.instruction.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">📋 Инструкция</button>` : ''}
                    </div>
                </div>
            </div>
        `;

        // Show the product details section
        showProductsSection(content);

    } catch (error) {
        console.error('Error loading product details:', error);
        showError('Ошибка загрузки подробной информации о товаре');
    }
}



function showQrCode(url) {
    if (!url || url === 'undefined' || url === 'null') {
        showError('QR-код еще не сгенерирован. Пожалуйста, запросите ссылку в боте (/partner).');
        return;
    }

    // Create modal to show QR
    const modal = document.createElement('div');
    modal.className = 'instruction-modal';
    modal.innerHTML = `
        <div class="instruction-overlay" onclick="this.parentElement.remove()">
            <div class="instruction-content" onclick="event.stopPropagation()" style="text-align: center;">
                <div class="instruction-header">
                    <h3>📱 Ваш QR-код</h3>
                    <button class="btn-close" onclick="this.closest('.instruction-modal').remove()">×</button>
                </div>
                <div class="instruction-body">
                    <img src="${escapeAttr(url)}" alt="QR Code" style="max-width: 100%; border-radius: 12px; margin-bottom: 12px;">
                    <p style="color: var(--text-secondary);">Покажите этот код для сканирования</p>
                </div>
                <div class="instruction-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.instruction-modal').remove()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Animation
    setTimeout(() => {
        const content = modal.querySelector('.instruction-content');
        if (content) content.style.transform = 'scale(1)';
    }, 10);
}

// Safe wrapper for getting telegram user data
function getTelegramUserDataSafe() {
    try {
        if (typeof getTelegramUserData === 'function') {
            return getTelegramUserData();
        }
        return null;
    } catch (e) {
        console.warn('Failed to get telegram user data:', e);
        return null;
    }
}
