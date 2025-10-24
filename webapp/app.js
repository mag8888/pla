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
            loadCartItems(); // This will call updateCartBadge()
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
        console.log('🤝 Showing partner program info:', type);
        
        // Генерируем простой реферальный код для демонстрации
        const referralCode = 'PLAZMA' + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        // Создаем реферальную ссылку
        const referralLink = `https://t.me/plazma_water_bot?start=${referralCode}`;
        
        // Текст как в боте
        let message = '';
        let shareText = '';
        
        if (type === 'DIRECT') {
            message = `💰 Прямая комиссия — 25%
Делитесь ссылкой → получаете 25% от всех покупок друзей.

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 25% начнет действовать при Вашей активности 120PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;
            
            shareText = `Дружище 🌟
Я желаю тебе энергии, здоровья и внутренней силы, поэтому делюсь с тобой этим ботом 💧
Попробуй PLAZMA Water — технология будущего, которая реально меняет состояние ⚡️
🔗 Твоя ссылка:
${referralLink}`;
        } else {
            message = `📈 Многоуровневая система — 15% + 5% + 5%
• 15% с покупок ваших друзей (1-й уровень)
• 5% с покупок их друзей (2-й уровень)
• 5% с покупок следующего уровня (3-й уровень)

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 15%+5%+5% начнет действовать при Вашей активности 120PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;
            
            shareText = `Дружище 🌟
Я желаю тебе энергии, здоровья и внутренней силы, поэтому делюсь с тобой этим ботом 💧
Попробуй PLAZMA Water — технология будущего, которая реально меняет состояние ⚡️
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
                    
                    <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                                border: 1px solid rgba(255, 255, 255, 0.1); 
                                border-radius: 12px; 
                                padding: 16px; 
                                margin: 20px 0;">
                        <h4 style="color: #ffffff; margin-bottom: 8px;">🔗 Ваша реферальная ссылка:</h4>
                        <p style="color: #cccccc; word-break: break-all; font-family: monospace;">${referralLink}</p>
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
function copyReferralLink(link) {
    try {
        navigator.clipboard.writeText(link).then(() => {
            showSuccess('Ссылка скопирована в буфер обмена!');
        }).catch(() => {
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = link;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showSuccess('Ссылка скопирована!');
        });
    } catch (error) {
        console.error('Error copying link:', error);
        showError('Не удалось скопировать ссылку');
    }
}

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
    
    showProductsSection(content);
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
                    <button class="btn-back-to-catalog" onclick="openSection('shop')">
                        ← Назад к каталогу
                    </button>
                <h3>Товары категории</h3>
        `;
        
        if (products && products.length > 0) {
            content += '<div class="products-grid">';
            products.forEach(product => {
                content += `
                    <div class="product-tile">
                        ${product.imageUrl ? `<div class="product-image" onclick="showProductDetails('${product.id}')"><img src="${product.imageUrl}" alt="${product.title}" onerror="this.style.display='none'"></div>` : '<div class="product-image-placeholder" onclick="showProductDetails(\'' + product.id + '\')">📦</div>'}
                        <h4 onclick="showProductDetails('${product.id}')">${product.title}</h4>
                        <div class="product-description" onclick="showProductDetails('${product.id}')">${product.summary || product.description || 'Описание товара'}</div>
                        <div class="product-actions">
                            <button class="btn-add-to-cart" onclick="addToCart('${product.id}')">
                                🛒 В корзину
                            </button>
                            <button class="btn-buy" onclick="buyProduct('${product.id}')">
                                🛍 Купить
                            </button>
                            ${product.instruction ? `<button class="btn-instruction" onclick="showInstruction('${product.id}', \`${product.instruction.replace(/`/g, '\\`')}\`)">📋 Инструкция</button>` : ''}
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
        showProductsSection(content);
    } catch (error) {
        console.error('Error loading category products:', error);
        showError('Ошибка загрузки товаров');
    }
}

// Add to cart function
async function addToCart(productId) {
    try {
        console.log('🛒 Adding to cart:', productId);
        
        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ productId, quantity: 1 })
        });
        
        if (response.ok) {
            showSuccess('Товар добавлен в корзину!');
            loadCartItems(); // This will call updateCartBadge()
        } else {
            const errorData = await response.json();
            console.error('Cart add failed:', errorData);
            showError(`Ошибка добавления в корзину: ${errorData.error || 'Неизвестная ошибка'}`);
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
            // После создания заказа запрашиваем телефон и адрес
            await requestContactAndAddress();
        } else {
            const errorData = await response.json();
            console.error('Order creation failed:', errorData);
            showError(`Ошибка создания заказа: ${errorData.error || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error('Error buying product:', error);
        showError('Ошибка создания заказа');
    }
}

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
        </div>
    `;
    
    showProductsSection(content);
}

async function showAddressConfirmation(address) {
    const content = `
        <div class="content-section">
            <h3>📍 Подтверждение адреса</h3>
            <p>Вам доставить на этот адрес?</p>
            
            <div style="background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%); 
                        border: 1px solid rgba(255, 255, 255, 0.1); 
                        border-radius: 12px; 
                        padding: 16px; 
                        margin: 20px 0;">
                <p style="color: #ffffff; font-weight: bold;">${address}</p>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn" onclick="confirmAddress('${address}')">
                    ✅ Да, доставить сюда
                </button>
            </div>
            
            <div style="margin: 20px 0;">
                <button class="btn btn-secondary" onclick="changeAddress()">
                    ✏️ Изменить адрес
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
            headers: {
                'Content-Type': 'application/json',
            },
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
    let promptText = '';
    switch (type) {
        case 'bali':
            promptText = 'Укажите адрес для Бали:\nНапишите район и название виллы (например: "Семиньяк, Villa Seminyak Resort")';
            break;
        case 'russia':
            promptText = 'Укажите адрес для России:\nНапишите ваш город и точный адрес (например: "Москва, ул. Тверская, д. 10, кв. 5")';
            break;
        case 'custom':
            promptText = 'Введите свой вариант адреса:\nНапишите полный адрес доставки в произвольной форме.';
            break;
    }
    
    const address = prompt(promptText);
    if (address) {
        await saveDeliveryAddress(type, address);
    }
}

async function saveDeliveryAddress(type, address) {
    try {
        const fullAddress = `${type}: ${address}`;
        const response = await fetch(`${API_BASE}/user/address`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

async function changeAddress() {
    await requestDeliveryAddress();
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
    console.log('🛒 Loading cart items...');
    const response = await fetch(`${API_BASE}/cart/items`);
    if (response.ok) {
      cartItems = await response.json();
      console.log('✅ Cart items loaded:', cartItems.length);
    } else if (response.status === 401) {
      console.log('User not authenticated - this is normal for web preview');
      cartItems = [];
    } else {
      console.error('Failed to load cart items:', response.status);
      cartItems = [];
    }
    
    // Update cart badge after loading items
    updateCartBadge();
  } catch (error) {
    console.error('Error loading cart items:', error);
    cartItems = [];
    updateCartBadge();
  }
}

// Load product count for shop badge
async function loadProductCount() {
    try {
        const response = await fetch(`${API_BASE}/products/count`);
        if (response.ok) {
            const data = await response.json();
            const shopBadge = document.getElementById('shop-badge');
            if (shopBadge) {
                shopBadge.textContent = data.totalProducts || '0';
            }
        }
    } catch (error) {
        console.error('Error loading product count:', error);
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
        // Calculate total sum of cart items
        let totalSum = 0;
        if (cartItems && cartItems.length > 0) {
            totalSum = cartItems.reduce((sum, item) => {
                return sum + (item.product.price * item.quantity);
            }, 0);
        }
        
        // Update shop badge with total sum
        const shopBadge = document.getElementById('shop-badge');
        if (shopBadge) {
            if (totalSum > 0) {
                shopBadge.textContent = `$${totalSum.toFixed(2)}`;
                shopBadge.style.background = '#4CAF50'; // Green for non-zero
            } else {
                shopBadge.textContent = '0';
                shopBadge.style.background = ''; // Default color for zero
            }
        }
        
        console.log(`💰 Cart total: $${totalSum.toFixed(2)}`);
    } catch (error) {
        console.error('Error updating cart badge:', error);
    }
}

function updateBadges() {
    // Update shop badge with cart total sum
    updateCartBadge();
    
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

// Show product details function
async function showProductDetails(productId) {
    try {
        console.log('📖 Showing product details for:', productId);
        
        const response = await fetch(`${API_BASE}/products/${productId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch product details');
        }
        
        const product = await response.json();
        
        // Create detailed product view
        let content = `
            <div class="product-details">
                <div class="product-details-header">
                    <button class="btn-back" onclick="showCategoryProducts('${product.categoryId}')">
                        ← Назад к товарам
                    </button>
                    <h2>${product.title}</h2>
                </div>
                
                <div class="product-details-content">
                    ${product.imageUrl ? `<div class="product-details-image"><img src="${product.imageUrl}" alt="${product.title}" onerror="this.style.display='none'"></div>` : ''}
                    
                    <div class="product-details-info">
                        <div class="product-price">💰 Цена: ${product.price}₽</div>
                        <div class="product-stock">📦 В наличии: ${product.stock} шт.</div>
                        
                        ${product.summary ? `<div class="product-summary"><h4>Краткое описание:</h4><p>${product.summary}</p></div>` : ''}
                        
                        ${product.description ? `<div class="product-description-full"><h4>Подробное описание:</h4><p>${product.description}</p></div>` : ''}
                        
                        ${product.instruction ? `<div class="product-instruction"><h4>📋 Инструкция по применению:</h4><p>${product.instruction}</p></div>` : ''}
                    </div>
                    
                    <div class="product-details-actions">
                        <button class="btn-add-to-cart" onclick="addToCart('${product.id}')">
                            🛒 В корзину
                        </button>
                        <button class="btn-buy" onclick="buyProduct('${product.id}')">
                            🛍 Купить
                        </button>
                        ${product.instruction ? `<button class="btn-instruction" onclick="showInstruction('${product.id}', \`${product.instruction.replace(/`/g, '\\`')}\`)">📋 Инструкция</button>` : ''}
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
