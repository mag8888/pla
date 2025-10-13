// Telegram Web App API
const tg = window.Telegram?.WebApp;

// Initialize Telegram Web App
if (tg) {
    tg.ready();
    tg.expand();
    
    // Set theme
    tg.setHeaderColor('#1a1a1a');
    tg.setBackgroundColor('#1a1a1a');
}

// Global state
let currentSection = null;
let userData = null;
let cartItems = [];

// API Base URL - adjust based on your backend
const API_BASE = '/webapp/api';

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    loadUserData();
    loadCartItems();
    updateBadges();
    
    // Add click animations to cards
    document.querySelectorAll('.content-card').forEach(card => {
        card.addEventListener('click', function(e) {
            // Add click animation
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
        });
    });
});

// Navigation functions
function closeApp() {
    if (tg) {
        tg.close();
    } else {
        // Fallback for development
        console.log('Closing app...');
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
    currentSection = sectionName;
    const overlay = document.getElementById('section-overlay');
    const title = document.getElementById('section-title');
    const body = document.getElementById('section-body');
    
    // Set section title
    const titles = {
        shop: 'Магазин',
        partner: 'Партнёрка',
        audio: 'Звуковые матрицы',
        reviews: 'Отзывы',
        about: 'О PLASMA',
        support: 'Поддержка',
        favorites: 'Избранное'
    };
    
    title.textContent = titles[sectionName] || 'Раздел';
    
    // Load section content
    loadSectionContent(sectionName, body);
    
    // Show overlay
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);
}

function closeSection() {
    const overlay = document.getElementById('section-overlay');
    overlay.classList.remove('open');
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
            case 'audio':
                content = await loadAudioContent();
                break;
            case 'reviews':
                content = await loadReviewsContent();
                break;
            case 'about':
                content = await loadAboutContent();
                break;
            case 'support':
                content = await loadSupportContent();
                break;
            case 'favorites':
                content = await loadFavoritesContent();
                break;
            default:
                content = '<div class="error-message"><h3>Раздел не найден</h3><p>Попробуйте позже</p></div>';
        }
        
        container.innerHTML = content;
    } catch (error) {
        console.error('Error loading section:', error);
        container.innerHTML = '<div class="error-message"><h3>Ошибка загрузки</h3><p>Попробуйте позже</p></div>';
    }
}

// Shop content
async function loadShopContent() {
    try {
        const response = await fetch(`${API_BASE}/categories`);
        const categories = await response.json();
        
        let content = '<div class="content-section"><h3>Каталог товаров</h3>';
        
        if (categories && categories.length > 0) {
            content += '<div class="shop-categories">';
            categories.forEach(category => {
                content += `
                    <div class="shop-category" onclick="showCategoryProducts('${category.id}')">
                        <h4>${category.name}</h4>
                        <p>${category.description || 'Товары категории'}</p>
                        <button onclick="event.stopPropagation(); showCategoryProducts('${category.id}')">Открыть</button>
                    </div>
                `;
            });
            content += '</div>';
        } else {
            content += '<p>Каталог пока пуст</p>';
        }
        
        content += '</div>';
        return content;
    } catch (error) {
        return '<div class="error-message"><h3>Ошибка загрузки каталога</h3><p>Попробуйте позже</p></div>';
    }
}

// Partner content
async function loadPartnerContent() {
    return `
        <div class="content-section">
            <h3>Партнёрская программа</h3>
            <p>Станьте партнёром Plazma Water и получайте до 25% от каждой покупки по вашей ссылке!</p>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="activatePartnerProgram('DIRECT')">
                    💰 Прямая комиссия 25%
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="activatePartnerProgram('MULTI_LEVEL')">
                    📈 Многоуровневая 15% + 5% + 5%
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
                    <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                                border: 1px solid rgba(255, 255, 255, 0.1); 
                                border-radius: 12px; 
                                padding: 16px; 
                                margin-bottom: 16px;">
                        <h4 style="color: #ffffff; margin-bottom: 8px;">⭐ ${review.name}</h4>
                        <p style="color: #cccccc; line-height: 1.6;">${review.content}</p>
                        ${review.link ? `<p style="margin-top: 12px;"><a href="${review.link}" style="color: #0066ff;">Подробнее</a></p>` : ''}
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
            <h3>О PLASMA Water</h3>
            <p>Plazma Water — жидкие витамины и минералы в наноформе.</p>
            <p>💧 Усвоение — до 99,9% (в отличие от таблеток 1–10%).</p>
            <p>⚡ Быстро, легко и без нагрузки на печень и почки — питание прямо в клетки.</p>
            
            <div style="margin: 20px 0;">
                <h4>Преимущества:</h4>
                <ul style="color: #cccccc; margin: 12px 0; padding-left: 20px;">
                    <li>Без лишних добавок и побочных эффектов</li>
                    <li>Усвоение почти 100%</li>
                    <li>Поддержка иммунитета и восстановление клеток</li>
                    <li>Подходит даже для людей на реабилитации</li>
                </ul>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="showVideo()">
                    🎥 Смотреть видео
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <h4>Социальные сети:</h4>
                <button class="btn btn-secondary" onclick="openTelegram()">
                    📱 Telegram
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
            <p>Напишите свой вопрос прямо в этот чат — команда Plazma Water ответит как можно быстрее.</p>
            <p>Если нужен срочный контакт, оставьте номер телефона, и мы перезвоним.</p>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="sendMessage()">
                    💬 Написать сообщение
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="callSupport()">
                    📞 Позвонить в поддержку
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <h4>Часы работы:</h4>
                <p style="color: #cccccc;">24/7 - всегда на связи</p>
            </div>
        </div>
    `;
}

// Favorites content
async function loadFavoritesContent() {
    return `
        <div class="content-section">
            <h3>Избранное</h3>
            <p>Ваши сохранённые товары и материалы</p>
            
            <div style="margin: 20px 0;">
                <p style="color: #666666; text-align: center;">Пока ничего не добавлено в избранное</p>
            </div>
        </div>
    `;
}

// Action functions
async function showCategoryProducts(categoryId) {
    try {
        const response = await fetch(`${API_BASE}/categories/${categoryId}/products`);
        const products = await response.json();
        
        let content = '<div class="content-section">';
        content += '<button class="btn btn-secondary" onclick="openSection(\'shop\')" style="margin-bottom: 20px;">← Назад к каталогу</button>';
        content += '<h3>Товары категории</h3>';
        
        if (products && products.length > 0) {
            products.forEach(product => {
                content += `
                    <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                                border: 1px solid rgba(255, 255, 255, 0.1); 
                                border-radius: 12px; 
                                padding: 16px; 
                                margin-bottom: 16px;">
                        <h4 style="color: #ffffff; margin-bottom: 8px;">${product.title}</h4>
                        <p style="color: #cccccc; margin-bottom: 12px;">${product.summary}</p>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn" onclick="addToCart('${product.id}')" style="flex: 1;">
                                🛒 В корзину
                            </button>
                            <button class="btn btn-secondary" onclick="buyProduct('${product.id}')" style="flex: 1;">
                                💳 Купить
                            </button>
                        </div>
                    </div>
                `;
            });
        } else {
            content += '<p>В этой категории пока нет товаров</p>';
        }
        
        content += '</div>';
        
        document.getElementById('section-body').innerHTML = content;
    } catch (error) {
        console.error('Error loading products:', error);
        document.getElementById('section-body').innerHTML = '<div class="error-message"><h3>Ошибка загрузки товаров</h3><p>Попробуйте позже</p></div>';
    }
}

async function addToCart(productId) {
    try {
        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ productId })
        });
        
        if (response.ok) {
            showSuccess('Товар добавлен в корзину!');
            loadCartItems();
            updateBadges();
        } else {
            showError('Ошибка добавления в корзину');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        showError('Ошибка добавления в корзину');
    }
}

async function buyProduct(productId) {
    try {
        const response = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ productId })
        });
        
        if (response.ok) {
            showSuccess('Заявка отправлена администратору!');
        } else {
            showError('Ошибка создания заказа');
        }
    } catch (error) {
        console.error('Error creating order:', error);
        showError('Ошибка создания заказа');
    }
}

async function activatePartnerProgram(type) {
    try {
        const response = await fetch(`${API_BASE}/partner/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type })
        });
        
        if (response.ok) {
            showSuccess('Партнёрская программа активирована!');
        } else {
            showError('Ошибка активации программы');
        }
    } catch (error) {
        console.error('Error activating partner program:', error);
        showError('Ошибка активации программы');
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
            content += `
                <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                            border: 1px solid rgba(255, 255, 255, 0.1); 
                            border-radius: 12px; 
                            padding: 20px; 
                            margin-bottom: 20px;">
                    <h4 style="color: #ffffff; margin-bottom: 16px;">📊 Статистика</h4>
                    <p style="color: #cccccc; margin-bottom: 8px;">💰 Баланс: ${dashboard.balance || 0} PZ</p>
                    <p style="color: #cccccc; margin-bottom: 8px;">👥 Партнёры: ${dashboard.partners || 0}</p>
                    <p style="color: #cccccc; margin-bottom: 8px;">🎁 Всего бонусов: ${dashboard.bonus || 0} PZ</p>
                </div>
                
                <div style="margin: 20px 0;">
                    <button class="btn" onclick="showReferralLink()">
                        🔗 Моя реферальная ссылка
                    </button>
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

function showVideo() {
    showSuccess('Открытие видео...');
    // Здесь можно добавить логику показа видео
}

function openTelegram() {
    showSuccess('Открытие Telegram...');
    // Здесь можно добавить ссылку на Telegram канал
}

function sendMessage() {
    showSuccess('Отправка сообщения...');
    // Здесь можно добавить логику отправки сообщения
}

function callSupport() {
    showSuccess('Перезвон в поддержку...');
    // Здесь можно добавить логику звонка
}

function showReferralLink() {
    showSuccess('Копирование реферальной ссылки...');
    // Здесь можно добавить логику показа ссылки
}

function showPartners() {
    showSuccess('Загрузка списка партнёров...');
    // Здесь можно добавить логику показа партнёров
}

// Show category products
async function showCategoryProducts(categoryId) {
    try {
        const response = await fetch(`${API_BASE}/categories/${categoryId}/products`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const products = await response.json();
        
        let content = `
            <div class="content-section">
                <button class="btn-back-to-catalog" onclick="showShop()">
                    ← Назад к каталогу
                </button>
                <h3>Товары категории</h3>
        `;
        
        if (products && products.length > 0) {
            content += '<div class="products-grid">';
            products.forEach(product => {
                content += `
                    <div class="product-tile">
                        <h4>${product.title}</h4>
                        <div class="product-description">${product.summary || product.description || 'Описание товара'}</div>
                        <div class="product-actions">
                            <button class="btn-add-to-cart" onclick="addToCart('${product.id}')">
                                🛒 В корзину
                            </button>
                            <button class="btn-buy" onclick="buyProduct('${product.id}')">
                                🛍 Купить
                            </button>
                        </div>
                    </div>
                `;
            });
            content += '</div>';
        } else {
            content += '<p>В этой категории пока нет товаров</p>';
        }
        
        content += '</div>';
        
        // Show the products section
        showSection('shop', 'Товары', content);
    } catch (error) {
        console.error('Error loading category products:', error);
        showError('Ошибка загрузки товаров');
    }
}

// Add to cart function
async function addToCart(productId) {
    try {
        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ productId, quantity: 1 })
        });
        
        if (response.ok) {
            showSuccess('Товар добавлен в корзину!');
            loadCartItems(); // Refresh cart
        } else {
            showError('Ошибка добавления в корзину');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        showError('Ошибка добавления в корзину');
    }
}

// Buy product function
async function buyProduct(productId) {
    try {
        const response = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                items: [{ productId, quantity: 1 }],
                message: 'Покупка через веб-приложение'
            })
        });
        
        if (response.ok) {
            showSuccess('Заказ создан! Ожидайте подтверждения.');
        } else {
            showError('Ошибка создания заказа');
        }
    } catch (error) {
        console.error('Error buying product:', error);
        showError('Ошибка создания заказа');
    }
}

// Utility functions
async function loadUserData() {
  try {
    const response = await fetch(`${API_BASE}/user/profile`);
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
    const response = await fetch(`${API_BASE}/cart/items`);
    if (response.ok) {
      cartItems = await response.json();
    } else if (response.status === 401) {
      console.log('User not authenticated - this is normal for web preview');
      cartItems = [];
    }
  } catch (error) {
    console.error('Error loading cart items:', error);
    cartItems = [];
  }
}

function updateBadges() {
    // Update shop badge with cart items count
    const cartCount = cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    document.getElementById('shop-badge').textContent = cartCount > 0 ? cartCount : '0';
    
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
}

// Search functionality
document.querySelector('.search-input').addEventListener('input', function(e) {
    const query = e.target.value.toLowerCase();
    if (query.length > 2) {
        // Implement search logic here
        console.log('Searching for:', query);
    }
});

// Keyboard navigation
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && currentSection) {
        closeSection();
    }
});

// Handle back button
window.addEventListener('popstate', function(e) {
    if (currentSection) {
        closeSection();
    }
});
