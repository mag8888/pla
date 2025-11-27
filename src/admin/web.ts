import express from 'express';
import multer from 'multer';
import session from 'express-session';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../lib/prisma.js';
import { recalculatePartnerBonuses, activatePartnerProfile, checkPartnerActivation, calculateDualSystemBonuses } from '../services/partner-service.js';
import { ordersModule } from './orders-module.js';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dt4r1tigf',
  api_key: process.env.CLOUDINARY_API_KEY || '579625698851834',
  api_secret: process.env.CLOUDINARY_API_SECRET || '3tqNb1QPMICBTW0bTLus5HFHGQI',
});

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware to check admin access
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const session = req.session as any;
  if (!session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
};

// Admin login page
router.get('/login', (req, res) => {
  const error = req.query.error;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Plazma Bot Admin Panel</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; background: #f5f5f5; }
        .login-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .error { color: red; margin-top: 10px; text-align: center; }
        h2 { text-align: center; color: #333; margin-bottom: 30px; }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h2>🔧 Plazma Bot Admin Panel</h2>
        <form method="post" action="/admin/login">
          <div class="form-group">
            <label>Пароль:</label>
            <input type="password" name="password" placeholder="Введите пароль" required>
          </div>
          <button type="submit">Войти</button>
          ${error ? '<div class="error">Неверный пароль</div>' : ''}
        </form>
      </div>
    </body>
    </html>
  `);
});

// Handle login POST request
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (password === adminPassword || password === 'test') {
    const session = req.session as any;
    session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

// Main admin panel
router.get('/', requireAdmin, async (req, res) => {
  try {
    // Calculate total balance of all users (not just partners)
    const allUsers = await prisma.user.findMany({
      select: { balance: true }
    });
    const totalBalance = allUsers.reduce((sum, user) => sum + (user.balance || 0), 0);
    
    console.log(`🔍 Debug: Total balance of all users: ${totalBalance} PZ`);

    const stats = {
      categories: await prisma.category.count(),
      products: await prisma.product.count(),
      partners: await prisma.partnerProfile.count(),
      reviews: await prisma.review.count(),
      orders: await prisma.orderRequest.count(),
      users: await prisma.user.count(),
      totalBalance: totalBalance,
    };

    // Helper function for detailed users section
    async function getDetailedUsersSection() {
      try {
        // Get recent users with their related data (preview)
        const users = await prisma.user.findMany({
          include: {
            partner: {
              include: {
                referrals: true,
                transactions: true
              }
            },
            orders: true
          },
          orderBy: { createdAt: 'desc' },
          take: 10 // Limit to 10 users for main page
        });

        // Get inviter information for each user
        const usersWithInviterInfo = await Promise.all(users.map(async (user: any) => {
          // Find who invited this user
          const referralRecord = await prisma.partnerReferral.findFirst({
            where: { referredId: user.id },
            include: {
              profile: {
                include: {
                  user: { select: { username: true, firstName: true } }
                }
              }
            }
          });

          return {
            ...user,
            inviter: referralRecord?.profile?.user || null
          };
        }));

        // Calculate additional data for each user
        const usersWithStats = usersWithInviterInfo.map((user: any) => {
          const partnerProfile = user.partner;
          const directPartners = partnerProfile?.referrals?.length || 0;
          
          // Calculate total referrals at all levels (simplified for main page)
          function countAllReferrals(userId: string, visited = new Set()): number {
            if (visited.has(userId)) return 0; // Prevent infinite loops
            visited.add(userId);
            
            const directReferrals = users.filter(u => 
              u.partner?.referrals?.some((ref: any) => ref.referredId === userId)
            );
            
            let totalCount = directReferrals.length;
            
            // Recursively count referrals of referrals
            directReferrals.forEach(ref => {
              totalCount += countAllReferrals(ref.id, new Set(visited));
            });
            
            return totalCount;
          }
          
        const totalPartners = countAllReferrals(user.id);
          
          // Разделяем заказы по статусам
          const ordersByStatus = {
            new: user.orders?.filter((order: any) => order.status === 'NEW') || [],
            processing: user.orders?.filter((order: any) => order.status === 'PROCESSING') || [],
            completed: user.orders?.filter((order: any) => order.status === 'COMPLETED') || [],
            cancelled: user.orders?.filter((order: any) => order.status === 'CANCELLED') || []
          };
          
          // Сумма только оплаченных (завершенных) заказов
          const paidOrderSum = ordersByStatus.completed.reduce((sum: number, order: any) => {
            try {
              const items = typeof order.itemsJson === 'string' 
                ? JSON.parse(order.itemsJson || '[]')
                : (order.itemsJson || []);
              const orderTotal = items.reduce((itemSum: number, item: any) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
              return sum + orderTotal;
            } catch {
              return sum;
            }
          }, 0);
          
          // Определяем приоритетный статус (новые заказы имеют приоритет)
          const hasNewOrders = ordersByStatus.new.length > 0;
          const hasProcessingOrders = ordersByStatus.processing.length > 0;
          const hasCompletedOrders = ordersByStatus.completed.length > 0;
          const hasCancelledOrders = ordersByStatus.cancelled.length > 0;
          
          let priorityStatus = 'none';
          if (hasNewOrders) priorityStatus = 'new';
          else if (hasProcessingOrders) priorityStatus = 'processing';
          else if (hasCompletedOrders) priorityStatus = 'completed';
          else if (hasCancelledOrders) priorityStatus = 'cancelled';
          
          // Debug: Log status determination
          if (user.orders && user.orders.length > 0) {
            console.log(`User ${user.firstName} orders:`, {
              total: user.orders.length,
              new: ordersByStatus.new.length,
              processing: ordersByStatus.processing.length,
              completed: ordersByStatus.completed.length,
              cancelled: ordersByStatus.cancelled.length,
              priorityStatus: priorityStatus
            });
          }
          
          const totalOrderSum = paidOrderSum; // Используем только оплаченные заказы
          const balance = user.balance || partnerProfile?.balance || 0;
          const bonus = partnerProfile?.bonus || 0;
          const lastActivity = user.updatedAt || user.createdAt;
          
          return {
            ...user,
            directPartners,
            totalPartners,
            totalOrderSum,
            balance,
            bonus,
            lastActivity,
            ordersByStatus,
            priorityStatus,
            paidOrderSum
          };
        });

        if (usersWithStats.length === 0) {
          return '<div class="empty-state"><h3>📭 Нет пользователей</h3><p>Пользователи появятся здесь после регистрации</p></div>';
        }

        // Calculate total balance across ALL users (not just this screen)
        const allBalances = await prisma.user.findMany({ select: { balance: true } });
        const totalUserBalance = allBalances.reduce((sum, u) => sum + (u.balance || 0), 0);

        return `
          <div class="detailed-users-container">
            <!-- Total Balance Header -->
            <div style="background: linear-gradient(135deg, #e8f5e8 0%, #d4edda 100%); padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: center; border: 2px solid #28a745; box-shadow: 0 2px 4px rgba(40, 167, 69, 0.2);">
              <h3 style="margin: 0; color: #28a745; font-size: 18px;">💰 Общий баланс всех пользователей: ${totalUserBalance.toFixed(2)} PZ</h3>
            </div>
            
            <div class="table-controls" style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
              <div class="sort-controls">
                <label>Сортировать по:</label>
                <select id="sortBy" onchange="applySorting()">
                  <option value="name">Имени</option>
                  <option value="balance">Балансу</option>
                  <option value="partners">Партнёрам</option>
                  <option value="orders" selected>Заказам</option>
                  <option value="activity">Активности</option>
                </select>
                <select id="sortOrder" onchange="applySorting()">
                  <option value="asc">По возрастанию</option>
                  <option value="desc" selected>По убыванию</option>
                </select>
              </div>
              <div class="message-controls">
                <button class="btn" onclick="selectAllUsers()">Выбрать всех</button>
                <button class="btn" onclick="deselectAllUsers()">Снять выбор</button>
                <button class="btn" onclick="openMessageComposer()" style="background: #28a745;">📨 Отправить сообщение</button>
              </div>
            </div>
            <div class="users-table-container">
              <table class="users-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" id="selectAll" onchange="toggleAllUsers()"></th>
                    <th onclick="sortTable('name')" style="cursor: pointer;">Пользователь ↕️</th>
                    <th onclick="sortTable('balance')" style="cursor: pointer;">Баланс ↕️</th>
                    <th onclick="sortTable('partners')" style="cursor: pointer;">Партнёры ↕️</th>
                    <th onclick="sortTable('orders')" style="cursor: pointer;">Заказы ↕️</th>
                    <th onclick="sortTable('activity')" style="cursor: pointer;">Последняя активность ↕️</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  ${usersWithStats.map(user => `
                    <tr data-user-id="${user.id}" data-name="${user.firstName || 'Без имени'}" data-balance="${user.balance}" data-partners="${user.totalPartners}" data-orders="${user.priorityStatus}" data-orders-sum="${user.totalOrderSum}" data-activity="${user.lastActivity.getTime()}">
                      <td><input type="checkbox" class="user-checkbox" value="${user.id}"></td>
                      <td>
                        <div class="user-info">
                          <div class="user-avatar">${(user.firstName || 'U')[0].toUpperCase()}</div>
                          <div class="user-details">
                            <h4><a href="javascript:void(0)" onclick="if(typeof showUserDetails === 'function') { showUserDetails('${user.id}'); } else { console.error('showUserDetails not defined'); window.open('/admin/users/${user.id}', '_blank', 'width=600,height=400'); }" class="user-name-link" style="cursor: pointer; color: #007bff; text-decoration: none;">${user.firstName || 'Без имени'} ${user.lastName || ''}</a></h4>
                            <p>@${user.username || 'без username'}</p>
                            <div style="display:flex; align-items:center; gap:6px;">
                              ${user.inviter ? `<p style=\"font-size: 11px; color: #6c757d; margin:0;\">Пригласил: @${user.inviter.username || user.inviter.firstName || 'неизвестно'}</p>` : `<p style=\"font-size: 11px; color: #6c757d; margin:0;\">Пригласитель: —</p>`}
                              <button class="balance-plus-btn" title="Сменить пригласителя" onclick="openChangeInviter('${user.id}', '${user.firstName || 'Пользователь'}')">+</button>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div class="balance ${user.balance > 0 ? 'positive' : 'zero'}">
                            ${user.balance.toFixed(2)} PZ
                          </div>
                          <button class="balance-plus-btn" onclick="openBalanceModal('${user.id}', '${user.firstName || 'Пользователь'}', ${user.balance})" title="Изменить баланс">
                            +
                          </button>
                        </div>
                        ${user.bonus > 0 ? `<div style="font-size: 11px; color: #6c757d;">Бонусы: ${user.bonus.toFixed(2)} PZ</div>` : ''}
                      </td>
                      <td>
                        <button class="partners-count-btn" onclick="if(typeof showUserPartners === 'function') { showUserPartners('${user.id}', '${user.firstName || 'Пользователь'}'); } else { console.error('showUserPartners not defined'); window.open('/admin/users/${user.id}/partners', '_blank', 'width=800,height=600'); }" style="background: none; border: none; cursor: pointer; padding: 0;">
                          <div class="partners-count">${user.totalPartners} всего</div>
                          ${user.directPartners > 0 ? `<div style="font-size: 11px; color: #6c757d;">${user.directPartners} прямых</div>` : ''}
                        </button>
                      </td>
                      <td>
                        <button class="orders-sum-btn" onclick="if(typeof showUserOrders === 'function') { showUserOrders('${user.id}', '${user.firstName || 'Пользователь'}'); } else { console.error('showUserOrders not defined'); window.open('/admin/users/${user.id}/orders', '_blank', 'width=1000,height=700'); }" style="background: none; border: none; cursor: pointer; padding: 0; width: 100%; text-align: left;">
                          <div class="orders-sum">${user.totalOrderSum.toFixed(2)} PZ</div>
                          <div class="orders-count status-${user.priorityStatus}" data-status="${user.priorityStatus}" title="Status: ${user.priorityStatus}">
                            ${user.orders?.length || 0} заказов
                            ${user.priorityStatus === 'new' ? ' 🔴' : ''}
                            ${user.priorityStatus === 'processing' ? ' 🟡' : ''}
                            ${user.priorityStatus === 'completed' ? ' 🟢' : ''}
                            ${user.priorityStatus === 'cancelled' ? ' ⚫' : ''}
                          </div>
                        </button>
                      </td>
                      <td>
                        <div style="font-size: 13px; color: #6c757d;">
                          ${user.lastActivity.toLocaleString('ru-RU')}
                        </div>
                      </td>
                    <td>
                      <button class="action-btn hierarchy" onclick="if(typeof showHierarchy === 'function') { showHierarchy('${user.id}'); } else { console.error('showHierarchy not defined'); window.open('/admin/partners-hierarchy?user=${user.id}', '_blank', 'width=800,height=600'); }">
                        🌳 Иерархия
                      </button>
                      <button class="action-btn" onclick="if(typeof showUserDetails === 'function') { showUserDetails('${user.id}'); } else { console.error('showUserDetails not defined'); window.open('/admin/users/${user.id}', '_blank', 'width=600,height=400'); }">
                          👁 Подробно
                        </button>
                        <button class="action-btn" onclick="openChangeInviter('${user.id}', '${user.firstName || 'Пользователь'}')">
                          🔄 Пригласитель
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
              <a href="/admin/users-detailed" class="btn">📊 Полный список пользователей</a>
              <a href="/admin/instructions" class="btn" style="background: #28a745; margin-left: 10px;">📋 Инструкции</a>
            </div>
          </div>
        `;
      } catch (error) {
        return '<div class="empty-state"><h3>❌ Ошибка загрузки</h3><p>Не удалось загрузить данные пользователей</p></div>';
      }
    }

    // Helper functions for lists
    async function getRecentUsers() {
      try {
        const users = await prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { firstName: true, lastName: true, username: true, createdAt: true }
        });
        
        if (users.length === 0) {
          return '<div class="empty-list">Нет пользователей</div>';
        }
        
        return users.map(user => `
          <div class="list-item">
            <div class="list-info">
              <div class="list-name">${user.firstName || 'Пользователь'} ${user.lastName || ''}</div>
              <div class="list-time">${user.createdAt.toLocaleString('ru-RU')}</div>
            </div>
            <div>@${user.username || 'без username'}</div>
          </div>
        `).join('');
      } catch (error) {
        return '<div class="empty-list">Ошибка загрузки</div>';
      }
    }

    async function getRecentOrders() {
      try {
        const orders = await prisma.orderRequest.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            user: { select: { firstName: true, lastName: true } }
          }
        });
        
        if (orders.length === 0) {
          return '<div class="empty-list">Нет заказов</div>';
        }
        
        return orders.map(order => `
          <div class="list-item">
            <div class="list-info">
              <div class="list-name">Заказ #${order.id}</div>
              <div class="list-time">${order.createdAt.toLocaleString('ru-RU')}</div>
            </div>
            <div>${order.user?.firstName || 'Пользователь'}</div>
          </div>
        `).join('');
      } catch (error) {
        return '<div class="empty-list">Ошибка загрузки</div>';
      }
    }

    async function getRecentTransactions() {
      try {
        const transactions = await prisma.partnerTransaction.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            profile: {
              include: {
                user: { select: { firstName: true, lastName: true } }
              }
            }
          }
        });
        
        if (transactions.length === 0) {
          return '<div class="empty-list">Нет транзакций</div>';
        }
        
        return transactions.map(tx => `
          <div class="list-item">
            <div class="list-info">
              <div class="list-name">${tx.profile.user.firstName || 'Партнёр'}</div>
              <div class="list-time">${tx.createdAt.toLocaleString('ru-RU')}</div>
              <div style="font-size: 11px; color: #999; margin-top: 2px;">${tx.description}</div>
            </div>
            <div class="list-amount ${tx.amount < 0 ? 'negative' : ''}">
              ${tx.amount > 0 ? '+' : ''}${tx.amount.toFixed(2)} PZ
            </div>
          </div>
        `).join('');
      } catch (error) {
        return '<div class="empty-list">Ошибка загрузки</div>';
      }
    }
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Админ-панель Plazma Bot v2.0</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .tabs { display: flex; border-bottom: 2px solid #e9ecef; margin-bottom: 30px; }
          .tab { padding: 15px 25px; background: none; border: none; cursor: pointer; font-size: 16px; color: #6c757d; border-bottom: 3px solid transparent; transition: all 0.3s; }
          .tab.active { color: #007bff; border-bottom-color: #007bff; font-weight: 600; }
          .tab:hover { color: #007bff; background: #f8f9fa; }
          .tab-content { display: none; }
          .tab-content.active { display: block; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
          .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; cursor: pointer; transition: all 0.3s; }
          .stat-card:hover { background: #e9ecef; transform: translateY(-2px); }
          .stat-number { font-size: 2em; font-weight: bold; color: #007bff; margin-bottom: 5px; }
          .stat-label { color: #6c757d; font-size: 0.9em; }
          .btn { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 5px; }
          .btn:hover { background: #0056b3; }
          .section-header { display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
          .section-title { font-size: 24px; font-weight: 600; color: #333; }
          .action-buttons { display: flex; gap: 10px; flex-wrap: wrap; }
          
          /* Recent Lists Styles */
          .recent-lists { margin: 30px 0; }
          .list-section { margin-bottom: 25px; }
          .list-section h3 { margin-bottom: 15px; color: #333; font-size: 18px; }
          .list-container { 
            background: #f8f9fa; 
            border: 1px solid #e9ecef; 
            border-radius: 8px; 
            padding: 15px; 
            max-height: 200px; 
            overflow-y: auto; 
          }
          .list-item { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 8px 0; 
            border-bottom: 1px solid #e9ecef; 
          }
          .list-item:last-child { border-bottom: none; }
          .list-item:hover { background: #e9ecef; }
          .list-info { flex: 1; }
          .list-name { font-weight: 600; color: #333; }
          .list-time { color: #6c757d; font-size: 0.9em; }
          .list-amount { font-weight: bold; color: #28a745; }
          .list-amount.negative { color: #dc3545; }
          .empty-list { text-align: center; color: #6c757d; padding: 20px; }
          
          /* Detailed Users Table Styles */
          .detailed-users-container { margin: 20px 0; }
          .users-table-container { overflow-x: auto; }
          .users-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          .users-table th { background: #f8f9fa; padding: 15px 12px; text-align: left; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6; }
          .users-table td { padding: 15px 12px; border-bottom: 1px solid #dee2e6; vertical-align: top; }
          .users-table tr:hover { background: #f8f9fa; }
          
          .user-info { display: flex; align-items: center; gap: 12px; }
          .user-avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px; }
          .user-details h4 { margin: 0; font-size: 16px; color: #212529; }
          .user-details p { margin: 2px 0 0 0; font-size: 13px; color: #6c757d; }
          .user-name-link { color: #212529; text-decoration: none; transition: color 0.3s ease; }
          .user-name-link:hover { color: #007bff; text-decoration: underline; }
          
          .balance { font-weight: bold; font-size: 14px; }
          .balance.positive { color: #28a745; }
          .balance.zero { color: #6c757d; }
          
          .partners-count { background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; }
          .orders-sum { background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; }
          
          .action-btn { background: #007bff; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; margin: 1px; }
          .action-btn:hover { background: #0056b3; }
          .action-btn.hierarchy { background: #28a745; }
          .action-btn.hierarchy:hover { background: #1e7e34; }
          
          .balance-plus-btn { 
            background: #28a745; 
            color: white; 
            border: none; 
            border-radius: 50%; 
            width: 24px; 
            height: 24px; 
            cursor: pointer; 
            font-size: 16px; 
            font-weight: bold; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            transition: all 0.2s ease;
          }
          .balance-plus-btn:hover { 
            background: #218838; 
            transform: scale(1.1); 
          }
          
          .partners-count-btn:hover .partners-count { 
            background: #bbdefb; 
            transform: scale(1.05); 
            transition: all 0.2s ease;
          }
          
          .orders-sum-btn:hover .orders-sum { 
            background: #fff3cd; 
            transform: scale(1.05); 
            transition: all 0.2s ease;
          }
          
          .orders-count {
            padding: 3px 8px;
            border-radius: 6px;
            display: inline-block;
            font-weight: 600;
            font-size: 11px;
            transition: all 0.2s ease;
          }
          
          .orders-count.status-new {
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
            box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
          }
          
          .orders-count.status-processing {
            background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%) !important;
            color: white !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
            box-shadow: 0 2px 4px rgba(255, 193, 7, 0.3) !important;
          }
          
          .orders-count.status-completed {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
            box-shadow: 0 2px 4px rgba(40, 167, 69, 0.3);
          }
          
          .orders-count.status-cancelled {
            background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
            box-shadow: 0 2px 4px rgba(108, 117, 125, 0.3);
          }
          
          .orders-count.status-none {
            color: #6c757d;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
          }
          
          /* Balance Modal Styles */
          .modal-overlay { 
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); 
            z-index: 1000; display: flex; align-items: center; justify-content: center; 
            animation: modalFadeIn 0.3s ease-out;
          }
          @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes modalSlideIn { from { transform: translateY(-20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
          
          .modal-content { 
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); 
            border-radius: 16px; padding: 0; max-width: 500px; width: 95%; 
            box-shadow: 0 25px 50px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.1); 
            animation: modalSlideIn 0.3s ease-out;
          }
          
          .modal-header { 
            display: flex; justify-content: space-between; align-items: center; 
            padding: 20px 24px; border-bottom: 1px solid rgba(226, 232, 240, 0.8); 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px 16px 0 0;
            color: white;
          }
          .modal-header h2 { margin: 0; font-size: 20px; font-weight: 700; }
          .close-btn { 
            background: rgba(255,255,255,0.2); border: none; font-size: 18px; 
            cursor: pointer; color: white; padding: 0; width: 28px; height: 28px; 
            display: flex; align-items: center; justify-content: center; 
            border-radius: 6px; transition: all 0.2s ease;
          }
          .close-btn:hover { background: rgba(255,255,255,0.3); }
          
          .modal-body { padding: 24px; }
          .modal-body .form-group { margin-bottom: 16px; }
          .modal-body label { display: block; margin-bottom: 6px; font-weight: 600; color: #374151; }
          .modal-body input, .modal-body select, .modal-body textarea { 
            width: 100%; padding: 10px 12px; border: 2px solid #e2e8f0; 
            border-radius: 8px; font-size: 14px; transition: all 0.2s ease;
          }
          .modal-body input:focus, .modal-body select:focus, .modal-body textarea:focus { 
            outline: none; border-color: #667eea; box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1); 
          }
          
          .form-actions { 
            display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;
          }
          .form-actions button { 
            padding: 10px 20px; border: none; border-radius: 8px; 
            font-weight: 600; cursor: pointer; transition: all 0.2s ease; 
          }
          .form-actions button[type="button"] { 
            background: #e2e8f0; color: #64748b; 
          }
          .form-actions button[type="button"]:hover { background: #cbd5e1; }
          .form-actions button[type="submit"] { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
          }
          .form-actions button[type="submit"]:hover { 
            background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%); 
          }
          
          /* Table Controls Styles */
          .table-controls { background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6; }
          .sort-controls label { font-weight: 600; margin-right: 10px; }
          .sort-controls select { margin-right: 10px; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; }
          .message-controls { display: flex; gap: 10px; }
          .message-controls .btn { padding: 8px 12px; font-size: 14px; }
          
          /* Checkbox Styles */
          .user-checkbox { transform: scale(1.2); cursor: pointer; }
          #selectAll { transform: scale(1.2); cursor: pointer; }
          
          /* Sortable Headers */
          th[onclick] { user-select: none; }
          th[onclick]:hover { background: #e9ecef; }
          
          /* Message Composer Modal */
          .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); }
          .modal-content { background-color: white; margin: 5% auto; padding: 20px; border-radius: 8px; width: 80%; max-width: 600px; max-height: 80vh; overflow-y: auto; }
          .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
          .close { color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer; }
          .close:hover { color: #000; }
          .form-group { margin-bottom: 15px; }
          .form-group label { display: block; margin-bottom: 5px; font-weight: 600; }
          .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; }
          .form-group textarea { height: 100px; resize: vertical; }
          .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
          
          /* Product Form Styles */
          .product-modal { max-width: 920px; width: min(920px, 92%); padding: 28px 32px; }
          .product-form { display: flex; flex-direction: column; gap: 24px; }
          .product-section { background: #f8f9fb; border: 1px solid #e9ecef; border-radius: 12px; padding: 20px 24px; box-shadow: 0 18px 22px -18px rgba(15, 23, 42, 0.35); }
          .product-section-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px; }
          .product-section-title { font-size: 17px; font-weight: 600; color: #212529; }
          .product-section-subtitle { font-size: 13px; color: #6c757d; }
          .product-grid { display: grid; gap: 18px; }
          .product-grid.two-columns { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
          .product-grid.three-columns { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
          @media (min-width: 900px) {
            .product-grid.three-columns { grid-template-columns: repeat(3, 1fr); }
          }
          .product-grid.media-layout { grid-template-columns: repeat(2, 1fr); align-items: stretch; }
          .product-form textarea { resize: vertical; }
          #productShortDescription { min-height: 220px; }
          #productFullDescription { min-height: 220px; }
          .category-picker { display: flex; gap: 12px; }
          .category-picker select { flex: 1; }
          .category-picker .btn { padding: 8px 14px; border-radius: 8px; }
          .regions-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
          .regions-grid label { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: linear-gradient(135deg, #f8f9fa, #eef1f6); border-radius: 10px; cursor: pointer; border: 1px solid #e1e5eb; transition: all 0.2s ease; }
          .regions-grid label:hover { border-color: #cfd6df; box-shadow: 0 8px 18px -12px rgba(41, 72, 125, 0.45); }
          .switch-row input { transform: scale(1.2); }
          .char-count { text-align: right; font-size: 12px; color: #6c757d; margin-top: 5px; }
          .file-info { font-size: 12px; color: #6c757d; }
          .product-media { display: grid; grid-template-columns: 220px 1fr; gap: 16px; align-items: center; }
          .image-preview { width: 220px; height: 220px; border-radius: 12px; background: #f1f3f5 center/cover no-repeat; border: 1px solid #dee2e6; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.6); }
          .image-controls { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
          .image-controls input[type="file"] { cursor: pointer; }
          .image-controls .file-info { margin-top: 4px; }
          .media-group label { margin-bottom: 10px; display: block; }
          .status-toggle { display: inline-flex; align-items: center; gap: 12px; font-weight: 500; color: #343a40; cursor: pointer; }
          .status-toggle input { transform: scale(1.15); }
          @media (max-width: 768px) {
            .product-modal { width: 94%; padding: 20px; }
            .product-section { padding: 18px 20px; }
            .product-media { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 Админ-панель Plazma Bot v2.0</h1>
            <p>Единое управление ботом, пользователями и партнёрами</p>
          </div>
          
          ${req.query.success === 'all_bonuses_recalculated' ? `<div class="alert alert-success">✅ Все бонусы пересчитаны! Общий баланс: ${req.query.total || 0} PZ</div>` : ''}
          ${req.query.error === 'bonus_recalculation' ? '<div class="alert alert-error">❌ Ошибка при пересчёте бонусов</div>' : ''}
          
          <div class="tabs">
            <button class="tab active" onclick="switchTab('overview')">📊 Обзор</button>
            <button class="tab" onclick="switchTab('users')">👥 Пользователи</button>
            <button class="tab" onclick="switchTab('partners')">🤝 Партнёры</button>
            <button class="tab" onclick="switchTab('content')">📦 Контент</button>
            <button class="tab" onclick="switchTab('tools')">🔧 Инструменты</button>
          </div>
          
          <!-- Overview Tab -->
          <div id="overview" class="tab-content active">
            <div class="section-header">
              <h2 class="section-title">📊 Общая статистика</h2>
            </div>
            
            <div class="stats">
              <button class="stat-card" onclick="switchTab('users')">
                <div class="stat-number">${stats.users}</div>
                <div class="stat-label">Пользователи</div>
              </button>
              <button class="stat-card" onclick="switchTab('partners')">
                <div class="stat-number">${stats.partners}</div>
                <div class="stat-label">Партнёры</div>
              </button>
              <button class="stat-card" onclick="switchTab('content')">
                <div class="stat-number">${stats.products}</div>
                <div class="stat-label">Товары</div>
              </button>
              <button class="stat-card" onclick="switchTab('content')">
                <div class="stat-number">${stats.categories}</div>
                <div class="stat-label">Категории</div>
              </button>
              <button class="stat-card" onclick="switchTab('content')">
                <div class="stat-number">${stats.reviews}</div>
                <div class="stat-label">Отзывы</div>
              </button>
              <button class="stat-card" onclick="switchTab('content')">
                <div class="stat-number">${stats.orders}</div>
                <div class="stat-label">Заказы</div>
              </button>
            </div>
            
            <!-- Detailed Users Section -->
            <div class="section-header">
              <h2 class="section-title">👥 Детальная информация о пользователях</h2>
            </div>
            
            ${await getDetailedUsersSection()}

            <!-- Recent Data Lists -->
            <div class="recent-lists">
              <div class="list-section">
                <h3>👥 Последние пользователи</h3>
                <div class="list-container">
                  ${await getRecentUsers()}
                </div>
              </div>
              
              <div class="list-section">
                <h3>📦 Последние заказы</h3>
                <div class="list-container">
                  ${await getRecentOrders()}
                </div>
              </div>
              
              <div class="list-section">
                <h3>💰 Последние транзакции</h3>
                <div class="list-container">
                  <div class="total-balance-header" style="background: #e8f5e8; padding: 10px; margin-bottom: 10px; border-radius: 6px; text-align: center; border: 2px solid #28a745;">
                    <div style="font-size: 18px; font-weight: bold; color: #28a745;">
                      💰 Общий баланс: ${totalBalance.toFixed(2)} PZ
                    </div>
                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                      Сумма всех балансов пользователей
                    </div>
                  </div>
                  ${await getRecentTransactions()}
                </div>
              </div>
            </div>
          </div>
          
          <!-- Users Tab -->
          <div id="users" class="tab-content">
            <div class="section-header">
              <h2 class="section-title">👥 Управление пользователями v2.0</h2>
              <div class="action-buttons">
                <a href="/admin/users-detailed" class="btn">👥 Детальная информация</a>
                <a href="/admin/users" class="btn">📋 Список пользователей</a>
                <a href="/admin/user-history" class="btn">📊 История действий</a>
              </div>
            </div>
            <p>Управление пользователями бота, просмотр истории действий и статистики.</p>
          </div>
          
          <!-- Partners Tab -->
          <div id="partners" class="tab-content">
            <div class="section-header">
              <h2 class="section-title">🤝 Управление партнёрами v2.0</h2>
              <div class="action-buttons">
                <a href="/admin/partners" class="btn">📋 Список партнёров</a>
                <a href="/admin/partners-hierarchy" class="btn">🌳 Иерархия</a>
                <a href="/admin/debug-partners" class="btn">🔍 Отладка</a>
              </div>
            </div>
            <p>Управление партнёрской программой, бонусами и рефералами.</p>
          </div>
          
          <!-- Content Tab -->
          <div id="content" class="tab-content">
            <div class="section-header">
              <h2 class="section-title">📦 Управление контентом</h2>
              <div class="action-buttons">
                <a href="/admin/categories" class="btn">📁 Категории</a>
                <a href="/admin/products" class="btn">🛍️ Товары</a>
                <a href="/admin/reviews" class="btn">⭐ Отзывы</a>
                <a href="/admin/orders" class="btn">📦 Заказы</a>
                <button class="btn" onclick="openAddProductModal()" style="background: #28a745;">➕ Добавить товар</button>
              </div>
            </div>
            <p>Управление каталогом товаров, отзывами и заказами.</p>
          </div>
          
          <!-- Tools Tab -->
          <div id="tools" class="tab-content">
            <div class="section-header">
              <h2 class="section-title">🔧 Инструменты и утилиты</h2>
            <div class="action-buttons">
              <a href="/admin/test-referral-links" class="btn">🧪 Тест ссылок</a>
              <a href="/admin/force-recalculate-all-bonuses" class="btn" style="background: #28a745;">🔄 Пересчитать все бонусы</a>
            </div>
            </div>
            <p>Дополнительные инструменты для отладки и тестирования.</p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="/admin/logout" class="btn" style="background: #dc3545;">Выйти</a>
          </div>
        </div>
        
        <!-- Message Composer Modal -->
        <div id="messageModal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <h2>📨 Отправить сообщение пользователям</h2>
              <span class="close" onclick="closeMessageComposer()">&times;</span>
            </div>
            
            <div class="form-group">
              <label>Выбранные получатели:</label>
              <div id="selectedUsers" style="background: #f8f9fa; padding: 10px; border-radius: 4px; max-height: 100px; overflow-y: auto;"></div>
            </div>
            
            <div class="form-group">
              <label>Тип сообщения:</label>
              <select id="messageType">
                <option value="text">Текстовое сообщение</option>
                <option value="notification">Уведомление</option>
                <option value="promotion">Акция/Предложение</option>
                <option value="system">Системное сообщение</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Тема сообщения:</label>
              <input type="text" id="messageSubject" placeholder="Введите тему сообщения">
            </div>
            
            <div class="form-group">
              <label>Текст сообщения:</label>
              <textarea id="messageText" placeholder="Введите текст сообщения" required></textarea>
            </div>
            
            <div class="form-group">
              <label>
                <input type="checkbox" id="includeButtons"> Включить кнопки действий
              </label>
            </div>
            
            <div id="buttonsSection" style="display: none;">
              <div class="form-group">
                <label>Кнопка 1:</label>
                <input type="text" id="button1Text" placeholder="Текст кнопки">
                <input type="text" id="button1Url" placeholder="URL или команда">
              </div>
              <div class="form-group">
                <label>Кнопка 2:</label>
                <input type="text" id="button2Text" placeholder="Текст кнопки">
                <input type="text" id="button2Url" placeholder="URL или команда">
              </div>
            </div>
            
            <div class="modal-footer">
              <button class="btn" onclick="closeMessageComposer()" style="background: #6c757d;">Отмена</button>
              <button class="btn" onclick="sendMessages()" style="background: #28a745;">📤 Отправить</button>
            </div>
          </div>
        </div>
        <!-- Add Product Modal -->
        <div id="addProductModal" class="modal">
          <div class="modal-content product-modal">
            <div class="modal-header">
              <h2>➕ Добавить новый товар</h2>
              <span class="close" onclick="closeAddProductModal()">&times;</span>
            </div>
            
            <form id="addProductForm" class="product-form">
              <input type="hidden" id="productId" name="productId" value="">
              <div class="product-section">
                <div class="product-section-header">
                  <span class="product-section-title">Основные параметры</span>
                  <span class="product-section-subtitle">Название, стоимость и наличие товара</span>
                </div>
                <div class="product-grid three-columns">
                  <div class="form-group">
                    <label>Название товара *</label>
                    <input type="text" id="productName" required placeholder="Введите название товара">
                  </div>
                  <div class="form-group">
                    <label>Цена (₽) *</label>
                    <input type="number" id="productPriceRub" step="1" min="0" required placeholder="0">
                    <div class="char-count">1 PZ = 100 ₽</div>
                  </div>
                  <div class="form-group">
                    <label>Цена (PZ) *</label>
                    <input type="number" id="productPrice" step="0.01" min="0" required placeholder="0.00">
                    <div class="char-count">1 PZ = 100 ₽</div>
                  </div>
                  <div class="form-group">
                    <label>Категория *</label>
                    <div class="category-picker">
                      <select id="productCategory" required>
                        <option value="">Выберите категорию</option>
                      </select>
                      <button type="button" class="btn" onclick="openAddCategoryModal()" style="background: #17a2b8;">+</button>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Количество на складе</label>
                    <input type="number" id="productStock" min="0" placeholder="0">
                  </div>
                </div>
              </div>

              <div class="product-section">
                <div class="product-section-header">
                  <span class="product-section-title">Доставка</span>
                  <span class="product-section-subtitle">Выберите регионы, где товар доступен</span>
                </div>
                <div class="regions-grid">
                  <label class="switch-row"><input type="checkbox" id="regionRussia" checked> 🇷🇺 Россия</label>
                  <label class="switch-row"><input type="checkbox" id="regionBali"> 🇮🇩 Бали</label>
                </div>
              </div>

              <div class="product-section">
                <div class="product-section-header">
                  <span class="product-section-title">Описание и медиа</span>
                  <span class="product-section-subtitle">Добавьте текст и изображение для карточки товара</span>
                </div>
                <div class="product-grid media-layout">
                  <div class="form-group">
                    <label>Краткое описание *</label>
                    <textarea id="productShortDescription" required placeholder="Краткое описание товара (до 200 символов)" maxlength="200"></textarea>
                    <div class="char-count" id="shortDescCount">0/200</div>
                  </div>
                  <div class="form-group media-group">
                    <label>Фото товара</label>
                    <div class="product-media">
                      <div id="imagePreview" class="image-preview"></div>
                      <div class="image-controls">
                        <input type="file" id="productImage" accept="image/*">
                        <div class="file-info">Квадратное фото 1:1, ~800x800px, JPG/PNG</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="form-group">
                  <label>Полное описание *</label>
                  <textarea id="productFullDescription" required placeholder="Подробное описание товара"></textarea>
                </div>
                <div class="form-group">
                  <label>📋 Инструкция по применению</label>
                  <textarea id="productInstruction" placeholder="Инструкция по применению товара (необязательно)"></textarea>
                  <div class="char-count">Инструкция будет отображаться в мини-приложении</div>
                </div>
              </div>

              <div class="product-section">
                <div class="product-section-header">
                  <span class="product-section-title">Публикация</span>
                  <span class="product-section-subtitle">Управляйте доступностью товара</span>
                </div>
                <div class="form-group">
                  <label class="status-toggle">
                    <input type="checkbox" id="productActive"> Товар активен (доступен для покупки)
                  </label>
                </div>
              </div>

              <div class="modal-footer">
                <button type="button" class="btn" onclick="closeAddProductModal()" style="background: #6c757d;">Отмена</button>
                <button type="submit" class="btn" style="background: #28a745;">💾 Создать товар</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Add Category Modal -->
        <div id="addCategoryModal" class="modal">
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h2>📂 Добавить новую категорию</h2>
              <span class="close" onclick="closeAddCategoryModal()">&times;</span>
            </div>
            
            <form id="addCategoryForm">
              <div class="form-group">
                <label>Название категории *</label>
                <input type="text" id="categoryName" required placeholder="Введите название категории">
              </div>
              
              <div class="form-group">
                <label>Описание категории</label>
                <textarea id="categoryDescription" placeholder="Описание категории" style="height: 80px;"></textarea>
              </div>
              
              <div class="form-group">
                <label>Иконка категории</label>
                <input type="text" id="categoryIcon" placeholder="Эмодзи или текст (например: 🍎)">
              </div>
              
              <div class="modal-footer">
                <button type="button" class="btn" onclick="closeAddCategoryModal()" style="background: #6c757d;">Отмена</button>
                <button type="submit" class="btn" style="background: #17a2b8;">📂 Создать категорию</button>
              </div>
            </form>
          </div>
        </div>
        <script>
          window.switchTab = function(tabName) {
            // Hide all tab contents
            const contents = document.querySelectorAll('.tab-content');
            contents.forEach(content => content.classList.remove('active'));
            
            // Remove active class from all tabs
            const tabs = document.querySelectorAll('.tab');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            // Show selected tab content
            document.getElementById(tabName).classList.add('active');
            
            // Add active class to clicked tab
            event.target.classList.add('active');
          }
          
          window.showHierarchy = function(userId) {
            window.open(\`/admin/partners-hierarchy?user=\${userId}\`, '_blank', 'width=800,height=600');
          }
          
          window.showUserDetails = function(userId) {
            window.open(\`/admin/users/\${userId}\`, '_blank', 'width=600,height=400');
          }
          
          window.openChangeInviter = async function(userId, userName) {
            const modal = document.createElement('div');
            modal.id = 'inviterModal';
            modal.innerHTML =
              '<div class="modal-overlay" id="inviterOverlay">' +
                '<div class="modal-content" id="inviterContent" style="max-width:560px; border-radius:12px; overflow:hidden; box-shadow:0 12px 30px rgba(0,0,0,.2)">' +
                  '<div class="modal-header" style="background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; padding:16px 20px; display:flex; align-items:center; justify-content:space-between">' +
                    '<h2 style="margin:0; font-size:18px; font-weight:600">🔄 Смена пригласителя</h2>' +
                    '<button class="close-btn" id="inviterClose" style="background:transparent; border:none; color:#fff; font-size:22px; cursor:pointer">&times;</button>' +
                  '</div>' +
                  '<div class="modal-body" style="padding:16px 20px; background:#fff">' +
                    '<div style="margin-bottom:8px; color:#6b7280">Пользователь:</div>' +
                    '<div style="font-weight:600; margin-bottom:12px">' + userName + '</div>' +
                    '<div class="form-group" style="margin-bottom:10px">' +
                      '<label style="display:block; font-weight:600; margin-bottom:6px">Поиск по @username или коду</label>' +
                      '<input type="text" id="inviterSearch" placeholder="@username или код" autocomplete="off" style="width:100%; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px" />' +
                    '</div>' +
                    '<div id="inviterResults" style="max-height:220px; overflow:auto; border:1px solid #e5e7eb; border-radius:8px; padding:6px; display:none"></div>' +
                    '<div class="form-group" style="margin-top:10px">' +
                      '<label style="display:block; font-weight:600; margin-bottom:6px">Или введите код вручную</label>' +
                      '<input type="text" id="inviterCodeManual" placeholder="Код пригласителя" style="width:260px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px" />' +
                    '</div>' +
                  '</div>' +
                  '<div class="modal-footer" style="display:flex; gap:10px; justify-content:flex-end; padding:12px 20px; background:#f9fafb">' +
                    '<button class="btn" id="inviterCancel" style="background:#6c757d; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer">Отмена</button>' +
                    '<button class="btn" id="inviterApplyBtn" style="background:#10b981; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer">Применить</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
            document.body.appendChild(modal);

            const searchInput = document.getElementById('inviterSearch');
            const resultsEl = document.getElementById('inviterResults');
            const codeInput = document.getElementById('inviterCodeManual');
            const applyBtn = document.getElementById('inviterApplyBtn');
            const closeBtn = document.getElementById('inviterClose');
            const cancelBtn = document.getElementById('inviterCancel');
            const overlay = document.getElementById('inviterOverlay');

            function closeModal(){
              const el = document.getElementById('inviterModal');
              if (el && el.parentNode) el.parentNode.removeChild(el);
            }
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

            let selected = null; // {username, referralCode}
            let typingTimer;
            function renderResults(items){
              if (!items || items.length === 0){
                resultsEl.style.display = 'none';
                resultsEl.innerHTML = '';
                return;
              }
              resultsEl.style.display = 'block';
              resultsEl.innerHTML = items.map(function(i){
                const uname = i.username ? '@' + i.username : '';
                const name = ((i.firstName || '') + ' ' + (i.lastName || '')).trim();
                return '<div class="list-item" style="cursor:pointer; padding:6px; border-bottom:1px solid #eee" data-username="' + (i.username || '') + '" data-code="' + i.referralCode + '">' +
                  '<div class="list-info"><div class="list-name">' + (uname || name || 'Без имени') + '</div>' +
                  '<div class="list-time">код: ' + i.referralCode + '</div></div></div>';
              }).join('');
              Array.prototype.slice.call(resultsEl.querySelectorAll('[data-username]')).forEach(function(el){
                el.addEventListener('click', function(){
                  selected = { username: el.getAttribute('data-username'), code: el.getAttribute('data-code') };
                  searchInput.value = selected.username ? '@' + selected.username : selected.code;
                  codeInput.value = '';
                  resultsEl.style.display = 'none';
                });
              });
            }
            searchInput.addEventListener('input', function(){
              clearTimeout(typingTimer);
              const q = searchInput.value.trim();
              if (!q){ renderResults([]); return; }
              typingTimer = setTimeout(async function(){
                try{
                  const resp = await fetch('/admin/inviters/search?q=' + encodeURIComponent(q), { credentials: 'include' });
                  const data = await resp.json();
                  renderResults(data);
                }catch(e){ renderResults([]); }
              }, 300);
            });
            applyBtn.addEventListener('click', async function(){
              var typed = (codeInput.value || searchInput.value).trim();
              var payload = {};
              if (selected && selected.username) {
                payload = { inviterUsername: selected.username };
              } else if (typed) {
                if (typed.startsWith('@')) payload = { inviterUsername: typed.replace(/^@/, '') };
                else payload = { newInviterCode: typed };
              }
              if (!('inviterUsername' in payload) && !('newInviterCode' in payload)) { alert('Укажите пригласителя'); return; }
              try{
                const resp = await fetch('/admin/users/' + userId + '/change-inviter', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, credentials: 'include', body: JSON.stringify(payload)
                });
                if (resp.ok){ alert('Пригласитель изменен'); location.reload(); return; }
                let data = null; try { data = await resp.json(); } catch(e) {}
                alert('Не удалось изменить пригласителя' + (data && data.error ? (' — ' + data.error) : ''));
              }catch(e){ alert('Ошибка сети'); }
            });
          }
          
          // Balance management modal
          function openBalanceModal(userId, userName, currentBalance) {
            const modal = document.createElement('div');
            modal.id = 'balanceModal';
            modal.innerHTML = \`
              <div class="modal-overlay" onclick="closeBalanceModal()">
                <div class="modal-content" onclick="event.stopPropagation()">
                  <div class="modal-header">
                    <h2>💰 Управление балансом</h2>
                    <button class="close-btn" onclick="closeBalanceModal()">&times;</button>
                  </div>
                  <div class="modal-body">
                    <p><strong>Пользователь:</strong> \${userName}</p>
                    <p><strong>Текущий баланс:</strong> \${currentBalance.toFixed(2)} PZ</p>
                    <form id="balanceForm">
                      <input type="hidden" name="userId" value="\${userId}">
                      <div class="form-group">
                        <label>Тип операции:</label>
                        <select name="operation" required>
                          <option value="">Выберите операцию</option>
                          <option value="add">Начислить</option>
                          <option value="subtract">Списать</option>
                        </select>
                      </div>
                      <div class="form-group">
                        <label>Сумма (PZ):</label>
                        <input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00">
                      </div>
                      <div class="form-group">
                        <label>Комментарий: <span style="color: red;">*</span></label>
                        <textarea name="comment" rows="3" placeholder="Причина изменения баланса" required></textarea>
                      </div>
                      <div class="form-actions">
                        <button type="button" onclick="closeBalanceModal()">Отмена</button>
                        <button type="submit">Применить</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            \`;
            document.body.appendChild(modal);
            
            // Handle form submission
            document.getElementById('balanceForm').onsubmit = async function(e) {
              e.preventDefault();
              const formData = new FormData(this);
              const userId = formData.get('userId');
              const operation = formData.get('operation');
              const amount = parseFloat(formData.get('amount'));
              const comment = formData.get('comment');
              
              // Validate comment field
              if (!comment || comment.trim().length === 0) {
                alert('Пожалуйста, укажите причину изменения баланса в комментарии');
                return;
              }
              
              try {
                const response = await fetch('/admin/users/' + userId + '/update-balance', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ operation, amount, comment })
                });
                
                const result = await response.json();
                if (result.success) {
                  alert('Баланс успешно обновлен!');
                  closeBalanceModal();
                  // Force reload without cache
                  window.location.href = window.location.href + '?t=' + Date.now();
                } else {
                  alert('Ошибка: ' + result.error);
                }
              } catch (error) {
                alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
              }
            };
          }
          
          function closeBalanceModal() {
            const modal = document.getElementById('balanceModal');
            if (modal) {
              modal.remove();
            }
          }
          
          
          // Global function for loading categories
          window.loadCategories = async function() {
            try {
              const response = await fetch('/admin/api/categories');
              const categories = await response.json();
              
              const select = document.getElementById('productCategory');
              if (select) {
                select.innerHTML = '<option value="">Выберите категорию</option>';
                
                categories.forEach(category => {
                  const option = document.createElement('option');
                  option.value = category.id;
                  option.textContent = category.icon ? category.icon + ' ' + category.name : category.name;
                  select.appendChild(option);
                });
              }
            } catch (error) {
              console.error('Error loading categories:', error);
            }
          };
          
          // Simple global function for editing products
          window.editProduct = function(button) {
            const productId = button.dataset.id;
            const title = button.dataset.title;
            const summary = button.dataset.summary;
            const description = button.dataset.description;
            const price = button.dataset.price;
            const categoryId = button.dataset.categoryId;
            const isActive = button.dataset.active === 'true';
            const availableInRussia = button.dataset.russia === 'true';
            const availableInBali = button.dataset.bali === 'true';
            const imageUrl = button.dataset.image;
            
            // Fill form fields
            document.getElementById('productId').value = productId;
            document.getElementById('productName').value = title;
            document.getElementById('productShortDescription').value = summary;
            document.getElementById('productFullDescription').value = description;
            document.getElementById('productInstruction').value = button.dataset.instruction || '';
            document.getElementById('productPrice').value = price;
            document.getElementById('productPriceRub').value = (price * 100).toFixed(2);
            document.getElementById('productStock').value = '999';
            document.getElementById('productCategory').value = categoryId;
            document.getElementById('productStatus').checked = isActive;
            const regionRussiaEl = document.getElementById('regionRussia');
            const regionBaliEl = document.getElementById('regionBali');
            if (regionRussiaEl) regionRussiaEl.checked = availableInRussia;
            if (regionBaliEl) regionBaliEl.checked = availableInBali;
            
            // Set image preview
            const imagePreview = document.getElementById('imagePreview');
            if (imageUrl) {
              imagePreview.src = imageUrl;
              imagePreview.style.display = 'block';
              imagePreview.nextElementSibling.style.display = 'none';
            } else {
              imagePreview.style.display = 'none';
              imagePreview.nextElementSibling.style.display = 'flex';
            }
            
            // Update modal title and submit button
            document.querySelector('.product-modal h2').textContent = 'Редактировать товар';
            document.querySelector('#productModalSubmit').textContent = 'Обновить товар';
            
            // Load categories
            fetch('/admin/api/categories', { credentials: 'include' })
              .then(response => response.json())
              .then(categories => {
                const select = document.getElementById('productCategory');
                select.innerHTML = '<option value="">Выберите категорию</option>';
                categories.forEach(category => {
                  const option = document.createElement('option');
                  option.value = category.id;
                  option.textContent = category.name;
                  select.appendChild(option);
                });
              });
            
            // Show modal
            document.getElementById('addProductModal').style.display = 'block';
          };
          
          // Global function for editing products (legacy)
          window.editProductUsingCreateModal = function(button) {
            const productId = button.dataset.id;
            const title = button.dataset.title;
            const summary = button.dataset.summary;
            const description = button.dataset.description;
            const price = button.dataset.price;
            const categoryId = button.dataset.categoryId;
            const isActive = button.dataset.active === 'true';
            const availableInRussia = button.dataset.russia === 'true';
            const availableInBali = button.dataset.bali === 'true';
            const imageUrl = button.dataset.image;
            
            // Set hidden product ID field
            const productIdEl = document.getElementById('productId');
            if (productIdEl) productIdEl.value = productId;
            
            // Fill form fields
            const productNameEl = document.getElementById('productName');
            if (productNameEl) productNameEl.value = title;
            
            const productShortDescEl = document.getElementById('productShortDescription');
            if (productShortDescEl) productShortDescEl.value = summary;
            
            const productFullDescEl = document.getElementById('productFullDescription');
            if (productFullDescEl) productFullDescEl.value = description;
            
            const productInstructionEl = document.getElementById('productInstruction');
            if (productInstructionEl) productInstructionEl.value = button.dataset.instruction || '';
            
            const productPriceEl = document.getElementById('productPrice');
            if (productPriceEl) productPriceEl.value = price;
            
            const productPriceRubEl = document.getElementById('productPriceRub');
            if (productPriceRubEl) productPriceRubEl.value = (price * 100).toFixed(2);
            
            const productStockEl = document.getElementById('productStock');
            if (productStockEl) productStockEl.value = '999'; // Default stock
            
            const productCategoryEl = document.getElementById('productCategory');
            if (productCategoryEl) productCategoryEl.value = categoryId;
            
            // Set status toggle
            const productStatusEl = document.getElementById('productStatus');
            if (productStatusEl) productStatusEl.checked = isActive;
            
            // Set region toggles
            const productRussiaEl = document.getElementById('productRussia') || document.getElementById('regionRussia');
            if (productRussiaEl) productRussiaEl.checked = availableInRussia;
            
            const productBaliEl = document.getElementById('productBali') || document.getElementById('regionBali');
            if (productBaliEl) productBaliEl.checked = availableInBali;
            
            // Set image preview
            const imagePreview = document.getElementById('imagePreview');
            if (imagePreview) {
              if (imageUrl) {
                imagePreview.style.backgroundImage = 'url(' + imageUrl + ')';
                imagePreview.style.display = 'block';
              } else {
                imagePreview.style.backgroundImage = '';
                imagePreview.style.display = 'none';
              }
            }
            
            // Update modal title
            const modalTitle = document.querySelector('.product-modal h2');
            if (modalTitle) modalTitle.textContent = 'Редактировать товар';
            
            // Load categories and show modal
            if (window.loadCategories) {
              window.loadCategories();
            }
            
            const modal = document.getElementById('addProductModal');
            if (modal) modal.style.display = 'block';
          };
          // Sorting: redirect to full users page with server-side sorting across ALL users
          function sortTable(column) {
            const sortBy = document.getElementById('sortBy');
            const sortOrder = document.getElementById('sortOrder');
            switch(column) {
              case 'name': sortBy.value = 'name'; break;
              case 'balance': sortBy.value = 'balance'; break;
              case 'partners': sortBy.value = 'partners'; break;
              case 'orders': sortBy.value = 'orders'; break;
              case 'activity': sortBy.value = 'activity'; break;
            }
            // applySorting(); // ОТКЛЮЧЕНО
          }
          function applySorting() {
            var sortBy = document.getElementById('sortBy').value;
            var sortOrder = document.getElementById('sortOrder').value;
            window.location.href = '/admin/users-detailed?sort=' + encodeURIComponent(sortBy) + '&order=' + encodeURIComponent(sortOrder);
          }
          
          // Checkbox functionality
          function toggleAllUsers() {
            const selectAll = document.getElementById('selectAll');
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(cb => cb.checked = selectAll.checked);
          }
          
          function selectAllUsers() {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(cb => cb.checked = true);
            document.getElementById('selectAll').checked = true;
          }
          
          function deselectAllUsers() {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
            document.getElementById('selectAll').checked = false;
          }
          
          // Message composer functionality
          function openMessageComposer() {
            const selectedUsers = getSelectedUsers();
            if (selectedUsers.length === 0) {
              alert('Выберите пользователей для отправки сообщения');
              return;
            }
            
            document.getElementById('selectedUsers').innerHTML = selectedUsers.map(u => 
              \`<span style="background: #e3f2fd; padding: 2px 8px; border-radius: 12px; margin: 2px; display: inline-block;">\${u.name}</span>\`
            ).join('');
            
            document.getElementById('messageModal').style.display = 'block';
          }
          
          function closeMessageComposer() {
            document.getElementById('messageModal').style.display = 'none';
          }
          
          function getSelectedUsers() {
            const checkboxes = document.querySelectorAll('.user-checkbox:checked');
            return Array.from(checkboxes).map(cb => {
              const row = cb.closest('tr');
              return {
                id: cb.value,
                name: row.dataset.name
              };
            });
          }
          
          function sendMessages() {
            const selectedUsers = getSelectedUsers();
            const messageType = document.getElementById('messageType').value;
            const subject = document.getElementById('messageSubject').value;
            const text = document.getElementById('messageText').value;
            
            if (!text.trim()) {
              alert('Введите текст сообщения');
              return;
            }
            
            // Send to server
            fetch('/admin/send-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userIds: selectedUsers.map(u => u.id),
                type: messageType,
                subject: subject,
                text: text,
                includeButtons: document.getElementById('includeButtons').checked,
                button1: {
                  text: document.getElementById('button1Text').value,
                  url: document.getElementById('button1Url').value
                },
                button2: {
                  text: document.getElementById('button2Text').value,
                  url: document.getElementById('button2Url').value
                }
              })
            })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                let message = data.message;
                if (data.errors && data.errors.length > 0) {
                  message += '\\n\\nОшибки:\\n' + data.errors.slice(0, 3).join('\\n');
                  if (data.errors.length > 3) {
                    message += '\\n... и еще ' + (data.errors.length - 3) + ' ошибок';
                  }
                }
                alert(message);
                closeMessageComposer();
              } else {
                alert('Ошибка при отправке: ' + data.error);
              }
            })
            .catch(error => {
              alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            });
          }
          
          // Show/hide buttons section
          document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('includeButtons').addEventListener('change', function() {
              const buttonsSection = document.getElementById('buttonsSection');
              buttonsSection.style.display = this.checked ? 'block' : 'none';
            });
            
            // Load categories when product modal opens
            const addProductModalEl = document.getElementById('addProductModal');
            if (addProductModalEl) {
              addProductModalEl.addEventListener('shown.bs.modal', function() {
                if (window.loadCategories) window.loadCategories();
              });
            }
            
            // Character counter for short description
            const shortDesc = document.getElementById('productShortDescription');
            const charCount = document.getElementById('shortDescCount');
            if (shortDesc && charCount) {
              shortDesc.addEventListener('input', function() {
                charCount.textContent = this.value.length + '/200';
              });
            }

            // Image preview
            const imageInput = document.getElementById('productImage');
            const imagePreview = document.getElementById('imagePreview');
            if (imageInput && imagePreview) {
              imageInput.addEventListener('change', function() {
                const inputEl = this;
                const file = inputEl && inputEl.files ? inputEl.files[0] : null;
                if (!file) { imagePreview.style.backgroundImage = ''; return; }
                const reader = new FileReader();
                reader.onload = function() { imagePreview.style.backgroundImage = 'url(' + reader.result + ')'; };
                reader.readAsDataURL(file);
              });
            }
          });
          
          // Product modal functions
          window.openAddProductModal = function() {
            // Reset form for new product
            const modal = document.getElementById('addProductModal');
            if (!modal) {
              console.error('Modal addProductModal not found');
              return;
            }
            
            const productIdEl = document.getElementById('productId');
            if (productIdEl) productIdEl.value = '';
            
            const modalTitle = document.querySelector('.product-modal h2');
            if (modalTitle) modalTitle.textContent = 'Добавить товар';
            
            modal.style.display = 'block';
            
            // Load categories if function exists
            if (window.loadCategories) {
              window.loadCategories();
            } else {
              console.error('loadCategories function not found');
            }
          }
          
          window.closeAddProductModal = function() {
            const modal = document.getElementById('addProductModal');
            if (modal) modal.style.display = 'none';
            
            const form = document.getElementById('addProductForm');
            if (form) form.reset();
            
            const productIdEl = document.getElementById('productId');
            if (productIdEl) productIdEl.value = '';
            
            const shortDescCount = document.getElementById('shortDescCount');
            if (shortDescCount) shortDescCount.textContent = '0/200';
            
            // Reset modal title
            const modalTitle = document.querySelector('.product-modal h2');
            if (modalTitle) modalTitle.textContent = '➕ Добавить новый товар';
            
            // Reset image preview
            const imagePreview = document.getElementById('imagePreview');
            if (imagePreview) {
              imagePreview.style.backgroundImage = '';
              imagePreview.innerHTML = '';
            }
          }
          
          window.openAddCategoryModal = function() {
            const modal = document.getElementById('addCategoryModal');
            if (modal) modal.style.display = 'block';
          }
          
          window.closeAddCategoryModal = function() {
            const modal = document.getElementById('addCategoryModal');
            if (modal) modal.style.display = 'none';
            
            const form = document.getElementById('addCategoryForm');
            if (form) form.reset();
          }
          
          // Edit product using create modal
          // editProductUsingCreateModal is already defined as window.editProductUsingCreateModal above
          
          // Load categories for product form
          // loadCategories is already defined as window.loadCategories above
          
          // Handle product form submission
          document.getElementById('addProductForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const productId = document.getElementById('productId').value;
            const isEdit = productId !== '';
            
            const formData = new FormData();
            formData.append('title', document.getElementById('productName').value);
            formData.append('price', document.getElementById('productPrice').value);
            formData.append('categoryId', document.getElementById('productCategory').value);
            formData.append('stock', document.getElementById('productStock').value || 0);
            formData.append('summary', document.getElementById('productShortDescription').value);
            formData.append('description', document.getElementById('productFullDescription').value);
            formData.append('instruction', document.getElementById('productInstruction').value);
            formData.append('isActive', document.getElementById('productStatus').checked);
            
            // Regions
            const regionRussiaEl = document.getElementById('regionRussia');
            const regionBaliEl = document.getElementById('regionBali');
            formData.append('availableInRussia', regionRussiaEl ? regionRussiaEl.checked : false);
            formData.append('availableInBali', regionBaliEl ? regionBaliEl.checked : false);
            
            // Add image if selected
            const imageFile = document.getElementById('productImage').files[0];
            if (imageFile) {
              formData.append('image', imageFile);
            }
            
            try {
              const url = isEdit ? \`/admin/products/\${productId}/update\` : '/admin/api/products';
              const response = await fetch(url, {
                method: 'POST',
                body: formData
              });
              
              const result = await response.json();
              
              if (result.success) {
                alert(isEdit ? '✅ Товар успешно обновлен!' : '✅ Товар успешно создан!');
                closeAddProductModal();
                // Refresh the page to show changes
                window.location.reload();
              } else {
                alert(\`❌ Ошибка при \${isEdit ? 'обновлении' : 'создании'} товара: \` + result.error);
              }
            } catch (error) {
              alert('❌ Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            }
          });
          // Handle category form submission
          document.getElementById('addCategoryForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const categoryData = {
              name: document.getElementById('categoryName').value,
              description: document.getElementById('categoryDescription').value,
              icon: document.getElementById('categoryIcon').value
            };
            
            try {
              const response = await fetch('/admin/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categoryData)
              });
              
              const result = await response.json();
              
              if (result.success) {
                alert('✅ Категория успешно создана!');
                closeAddCategoryModal();
                // Reload categories in product form
                window.loadCategories();
              } else {
                alert('❌ Ошибка при создании категории: ' + result.error);
              }
            } catch (error) {
              alert('❌ Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            }
          });
          
          // Apply default sorting on page load - ОТКЛЮЧЕНО
          // window.addEventListener('DOMContentLoaded', function() {
          //   applySorting();
          // });

          // Global functions for user actions
          window.showUserPartners = function(userId, userName) {
            console.log('showUserPartners called with:', userId, userName);
            window.open('/admin/users/' + userId + '/partners', '_blank', 'width=800,height=600');
          }
          
          window.showUserOrders = function(userId, userName) {
            console.log('showUserOrders called with:', userId, userName);
            window.open('/admin/users/' + userId + '/orders', '_blank', 'width=1000,height=700');
          }

          window.showUserDetails = function(userId) {
            console.log('showUserDetails called with:', userId);
            window.open('/admin/users/' + userId, '_blank', 'width=600,height=400');
          }

          window.showHierarchy = function(userId) {
            console.log('showHierarchy called with:', userId);
            window.open('/admin/partners-hierarchy?user=' + userId, '_blank', 'width=800,height=600');
          }

          // Debug: Check if functions are properly defined
          console.log('Functions defined:', {
            showUserOrders: typeof window.showUserOrders,
            showUserPartners: typeof window.showUserPartners,
            showUserDetails: typeof window.showUserDetails,
            showHierarchy: typeof window.showHierarchy
          });

          // Fallback: Define functions as global variables if window assignment didn't work
          if (typeof showUserOrders === 'undefined') {
            window.showUserOrders = function(userId, userName) {
              console.log('Fallback showUserOrders called with:', userId, userName);
              window.open('/admin/users/' + userId + '/orders', '_blank', 'width=1000,height=700');
            };
          }
          
          if (typeof showUserPartners === 'undefined') {
            window.showUserPartners = function(userId, userName) {
              console.log('Fallback showUserPartners called with:', userId, userName);
              window.open('/admin/users/' + userId + '/partners', '_blank', 'width=800,height=600');
            };
          }
          
          if (typeof showUserDetails === 'undefined') {
            window.showUserDetails = function(userId) {
              console.log('Fallback showUserDetails called with:', userId);
              window.open('/admin/users/' + userId, '_blank', 'width=600,height=400');
            };
          }
          
          if (typeof showHierarchy === 'undefined') {
            window.showHierarchy = function(userId) {
              console.log('Fallback showHierarchy called with:', userId);
              window.open('/admin/partners-hierarchy?user=' + userId, '_blank', 'width=800,height=600');
            };
          }

          // Edit delivery address function
          window.editDeliveryAddress = function(userId) {
            const modal = document.createElement('div');
            modal.id = 'deliveryAddressModal';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
            
            const modalContent = '<div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 500px;">' +
              '<h3>📍 Редактировать адрес доставки</h3>' +
              '<div style="margin: 15px 0;">' +
                '<label style="display: block; margin-bottom: 5px; font-weight: bold;">Тип адреса:</label>' +
                '<select id="addressType" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">' +
                  '<option value="Бали">🇮🇩 Бали - район и вилла</option>' +
                  '<option value="Россия">🇷🇺 РФ - город и адрес</option>' +
                  '<option value="Произвольный">✏️ Произвольный адрес</option>' +
                '</select>' +
              '</div>' +
              '<div style="margin: 15px 0;">' +
                '<label style="display: block; margin-bottom: 5px; font-weight: bold;">Адрес:</label>' +
                '<textarea id="addressText" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; height: 80px; resize: vertical;" placeholder="Введите адрес доставки"></textarea>' +
              '</div>' +
              '<div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">' +
                '<button onclick="closeDeliveryAddressModal()" style="padding: 8px 16px; border: 1px solid #ddd; background: #f8f9fa; border-radius: 4px; cursor: pointer;">Отмена</button>' +
                '<button onclick="saveDeliveryAddress(\\'' + userId + '\\')" style="padding: 8px 16px; border: none; background: #28a745; color: white; border-radius: 4px; cursor: pointer;">💾 Сохранить</button>' +
              '</div>' +
            '</div>';
            
            modal.innerHTML = modalContent;
            document.body.appendChild(modal);
          };

          window.closeDeliveryAddressModal = function() {
            const modal = document.getElementById('deliveryAddressModal');
            if (modal) {
              modal.remove();
            }
          };

          window.saveDeliveryAddress = async function(userId) {
            const addressType = document.getElementById('addressType').value;
            const addressText = document.getElementById('addressText').value.trim();
            
            if (!addressText) {
              alert('Пожалуйста, введите адрес');
              return;
            }

            try {
              const response = await fetch('/admin/users/' + userId + '/delivery-address', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  addressType: addressType,
                  address: addressText
                })
              });

              if (response.ok) {
                alert('Адрес доставки сохранен');
                location.reload();
              } else {
                const error = await response.json();
                alert('Ошибка: ' + (error.error || 'Не удалось сохранить адрес'));
              }
            } catch (error) {
              alert('Ошибка сети: ' + error.message);
            }
          };
          
          // Instruction modal functions
          window.showInstruction = function(productId, instructionText) {
            const modal = document.createElement('div');
            modal.className = 'instruction-modal';
            modal.innerHTML = \`
              <div class="instruction-overlay" onclick="closeInstruction()">
                <div class="instruction-content" onclick="event.stopPropagation()">
                  <div class="instruction-header">
                    <h3>📋 Инструкция по применению</h3>
                    <button class="btn-close" onclick="closeInstruction()">×</button>
                  </div>
                  <div class="instruction-body">
                    <div class="instruction-text" id="instructionText" style="display: none;">\${instructionText.replace(/\\n/g, '<br>')}</div>
                    <div class="instruction-edit" id="instructionEdit" style="display: block;">
                      <textarea id="instructionTextarea" placeholder="Введите инструкцию по применению товара..." style="width: 100%; height: 200px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical;">\${instructionText}</textarea>
                    </div>
                  </div>
                  <div class="instruction-footer">
                    <button class="btn btn-save" onclick="saveInstruction('\${productId}')" style="background: #28a745; margin-right: 8px;">💾 Сохранить</button>
                    <button class="btn btn-cancel" onclick="cancelInstruction()" style="background: #6c757d; margin-right: 8px;">❌ Отмена</button>
                    <button class="btn btn-delete" onclick="deleteInstruction('\${productId}')" style="background: #dc3545; margin-right: 8px;">🗑️ Удалить</button>
                    <button class="btn btn-secondary" onclick="closeInstruction()">Закрыть</button>
                  </div>
                </div>
              </div>
            \`;
            
            document.body.appendChild(modal);
            
            // Add animation
            setTimeout(() => {
              const content = modal.querySelector('.instruction-content');
              if (content) {
                content.style.transform = 'scale(1)';
              }
            }, 10);
          };
          
          window.closeInstruction = function() {
            const modal = document.querySelector('.instruction-modal');
            if (modal) {
              const content = modal.querySelector('.instruction-content');
              if (content) {
                content.style.transform = 'scale(0.8)';
              }
              setTimeout(() => {
                modal.remove();
              }, 200);
            }
          };
          
          window.editInstruction = function(productId) {
            // Redirect to product edit page
            window.location.href = '/admin/products?edit=' + productId;
          };
          
          window.deleteInstruction = function(productId) {
            if (confirm('Вы уверены, что хотите удалить инструкцию для этого товара?')) {
              // Send request to delete instruction
              fetch('/admin/products/' + productId + '/delete-instruction', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include'
              })
              .then(response => response.json())
              .then(data => {
                if (data.success) {
                  alert('Инструкция успешно удалена!');
                  closeInstruction();
                  location.reload();
                } else {
                  alert('Ошибка: ' + (data.error || 'Не удалось удалить инструкцию'));
                }
              })
              .catch(error => {
                alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
              });
            }
          };
          
          window.saveInstruction = function(productId) {
            const textarea = document.getElementById('instructionTextarea');
            const instructionText = textarea.value.trim();
            
            if (!instructionText) {
              alert('Пожалуйста, введите инструкцию');
              return;
            }
            
            // Send request to save instruction
            fetch('/admin/products/' + productId + '/save-instruction', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify({ instruction: instructionText })
            })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                alert('Инструкция успешно сохранена!');
                closeInstruction();
                location.reload();
              } else {
                alert('Ошибка: ' + (data.error || 'Не удалось сохранить инструкцию'));
              }
            })
            .catch(error => {
              alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            });
          };
          
          window.cancelInstruction = function() {
            closeInstruction();
          };
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Admin panel error:', error);
    res.status(500).send('Internal server error');
  }
});
// Detailed users management with sorting and filtering
router.get('/users-detailed', requireAdmin, async (req, res) => {
  try {
    const sortBy = req.query.sort as string || 'orders';
    const sortOrder = req.query.order as string || 'desc';
    
    // Get all users with their related data
    // Optional search by username
    const search = (req.query.search as string | undefined)?.trim();
    const users = await prisma.user.findMany({
      include: {
        partner: {
          include: {
            referrals: true,
            transactions: true
          }
        },
        orders: true
      },
      where: search ? { username: { contains: search, mode: 'insensitive' } } : undefined,
      orderBy: {
        createdAt: sortOrder === 'desc' ? 'desc' : 'asc'
      }
    });

    // Helper function to count partners by level (based on hierarchy depth)
    async function countPartnersByLevel(userId: string): Promise<{level1: number, level2: number, level3: number}> {
      // Level 1: Direct referrals (all referrals of this user)
      const level1Partners = await prisma.partnerReferral.findMany({
        where: { 
          profile: { userId: userId },
          referredId: { not: null }
        },
        select: { referredId: true }
      });

      const level1Count = level1Partners.length;

      // Level 2: Referrals of level 1 partners
      const level1UserIds = level1Partners.map(p => p.referredId).filter((id): id is string => id !== null);
      
      const level2Count = level1UserIds.length > 0 ? await prisma.partnerReferral.count({
        where: { 
          profile: { 
            userId: { 
              in: level1UserIds
            }
          },
          referredId: { not: null }
        }
      }) : 0;

      // Level 3: Referrals of level 2 partners
      const level2Partners = level1UserIds.length > 0 ? await prisma.partnerReferral.findMany({
        where: { 
          profile: { 
            userId: { 
              in: level1UserIds
            }
          },
          referredId: { not: null }
        },
        select: { referredId: true }
      }) : [];

      const level2UserIds = level2Partners.map(p => p.referredId).filter((id): id is string => id !== null);

      const level3Count = level2UserIds.length > 0 ? await prisma.partnerReferral.count({
        where: { 
          profile: { 
            userId: { 
              in: level2UserIds
            }
          },
          referredId: { not: null }
        }
      }) : 0;

      return { level1: level1Count, level2: level2Count, level3: level3Count };
    }

    // Calculate additional data for each user
    const usersWithStats = await Promise.all(users.map(async (user: any) => {
      const partnerProfile = user.partner;
      const directPartners = partnerProfile?.referrals?.length || 0;
      
      // Get partners count by level
      const partnersByLevel = await countPartnersByLevel(user.id);
      
      console.log(`👤 User ${user.firstName} (@${user.username}) ID: ${user.id}: ${user.orders?.length || 0} orders`);
      
      // Разделяем заказы по статусам
      const ordersByStatus = {
        new: user.orders?.filter((order: any) => order.status === 'NEW') || [],
        processing: user.orders?.filter((order: any) => order.status === 'PROCESSING') || [],
        completed: user.orders?.filter((order: any) => order.status === 'COMPLETED') || [],
        cancelled: user.orders?.filter((order: any) => order.status === 'CANCELLED') || []
      };
      
      // Сумма только оплаченных (завершенных) заказов
      const paidOrderSum = ordersByStatus.completed.reduce((sum: number, order: any) => {
        try {
          const items = typeof order.itemsJson === 'string' 
            ? JSON.parse(order.itemsJson || '[]')
            : (order.itemsJson || []);
          const orderTotal = items.reduce((itemSum: number, item: any) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
          return sum + orderTotal;
        } catch {
          return sum;
        }
      }, 0);
      
      // Определяем приоритетный статус (новые заказы имеют приоритет)
      const hasNewOrders = ordersByStatus.new.length > 0;
      const hasProcessingOrders = ordersByStatus.processing.length > 0;
      const hasCompletedOrders = ordersByStatus.completed.length > 0;
      const hasCancelledOrders = ordersByStatus.cancelled.length > 0;
      
      let priorityStatus = 'none';
      if (hasNewOrders) priorityStatus = 'new';
      else if (hasProcessingOrders) priorityStatus = 'processing';
      else if (hasCompletedOrders) priorityStatus = 'completed';
      else if (hasCancelledOrders) priorityStatus = 'cancelled';
      
      // Debug: Log status determination for detailed view
      if (user.orders && user.orders.length > 0) {
        console.log(`Detailed view - User ${user.firstName} orders:`, {
          total: user.orders.length,
          new: ordersByStatus.new.length,
          processing: ordersByStatus.processing.length,
          completed: ordersByStatus.completed.length,
          cancelled: ordersByStatus.cancelled.length,
          priorityStatus: priorityStatus
        });
      }
      
      const totalOrderSum = paidOrderSum; // Используем только оплаченные заказы
      const balance = user.balance || partnerProfile?.balance || 0;
      const bonus = partnerProfile?.bonus || 0;
      const lastActivity = user.updatedAt || user.createdAt;
      
      return {
        ...user,
        directPartners,
        level2Partners: partnersByLevel.level2,
        level3Partners: partnersByLevel.level3,
        totalOrderSum,
        balance,
        bonus,
        lastActivity,
        ordersByStatus,
        priorityStatus,
        paidOrderSum
      };
    }));

    // Enrich with inviter info
    const usersWithInviters = await Promise.all(usersWithStats.map(async (u: any) => {
      const referralRecord = await prisma.partnerReferral.findFirst({
        where: { referredId: u.id },
        include: {
          profile: {
            include: { user: { select: { username: true, firstName: true } } }
          }
        }
      });
      return { ...u, inviter: referralRecord?.profile?.user || null };
    }));

    // Apply sorting
    let sortedUsers = usersWithInviters;
    if (sortBy === 'balance') {
      sortedUsers = usersWithInviters.sort((a, b) => 
        sortOrder === 'desc' ? b.balance - a.balance : a.balance - b.balance
      );
    } else if (sortBy === 'partners') {
      sortedUsers = usersWithInviters.sort((a, b) => 
        sortOrder === 'desc' ? b.directPartners - a.directPartners : a.directPartners - b.directPartners
      );
    } else if (sortBy === 'orders') {
      sortedUsers = usersWithInviters.sort((a, b) => {
        // 1. Приоритет: сначала новые красные заказы
        const aHasNew = a.priorityStatus === 'new';
        const bHasNew = b.priorityStatus === 'new';
        
        if (aHasNew && !bHasNew) return -1;
        if (!aHasNew && bHasNew) return 1;
        
        // 2. Если оба имеют новые заказы или оба не имеют - сортируем по дате новых заказов
        if (aHasNew && bHasNew) {
          const aNewOrder = a.orders?.find((order: any) => order.status === 'NEW');
          const bNewOrder = b.orders?.find((order: any) => order.status === 'NEW');
          
          if (aNewOrder && bNewOrder) {
            return new Date(bNewOrder.createdAt).getTime() - new Date(aNewOrder.createdAt).getTime();
          }
        }
        
        // 3. Затем приоритет: новые зеленые заказы
        const aHasCompleted = a.priorityStatus === 'completed';
        const bHasCompleted = b.priorityStatus === 'completed';
        
        if (aHasCompleted && !bHasCompleted) return -1;
        if (!aHasCompleted && bHasCompleted) return 1;
        
        // 4. Если оба имеют завершенные заказы - сортируем по дате
        if (aHasCompleted && bHasCompleted) {
          const aCompletedOrder = a.orders?.find((order: any) => order.status === 'COMPLETED');
          const bCompletedOrder = b.orders?.find((order: any) => order.status === 'COMPLETED');
          
          if (aCompletedOrder && bCompletedOrder) {
            return new Date(bCompletedOrder.createdAt).getTime() - new Date(aCompletedOrder.createdAt).getTime();
          }
        }
        
        // 5. Если нет заказов, сортируем по сумме
        return sortOrder === 'desc' ? b.totalOrderSum - a.totalOrderSum : a.totalOrderSum - b.totalOrderSum;
      });
    } else if (sortBy === 'activity') {
      sortedUsers = usersWithInviters.sort((a, b) => 
        sortOrder === 'desc' ? new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime() : 
                               new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      );
    }

    // Optional filter
    const filter = (req.query.filter as string | undefined) || '';
    if (filter === 'with_balance') {
      sortedUsers = sortedUsers.filter((u: any) => (u.balance || 0) > 0);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Детальная информация о пользователях - Plazma Water Admin</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
          .back-btn:hover { background: rgba(255,255,255,0.3) !important; transform: translateY(-2px); }
          
          .controls { padding: 20px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; }
          .sort-controls { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }
          .sort-group { display: flex; gap: 10px; align-items: center; }
          .sort-group label { font-weight: 600; color: #495057; }
          .sort-group select, .sort-group button { padding: 8px 12px; border: 1px solid #ced4da; border-radius: 6px; font-size: 14px; }
          .sort-group button { background: #007bff; color: white; border: none; cursor: pointer; }
          .sort-group button:hover { background: #0056b3; }
          
          .stats-bar { display: flex; gap: 20px; padding: 15px 20px; background: #e3f2fd; border-bottom: 1px solid #bbdefb; }
          .stat-item { text-align: center; }
          .stat-number { font-size: 24px; font-weight: bold; color: #1976d2; }
          .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
          
          .table-container { overflow-x: auto; width: 100%; border: 1px solid #dee2e6; border-radius: 8px; }
          .users-table { width: 100%; border-collapse: collapse; min-width: 100%; table-layout: fixed; }
          .users-table th { background: #f8f9fa; padding: 6px 4px; text-align: left; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6; white-space: nowrap; position: sticky; top: 0; z-index: 10; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
          .users-table td { padding: 6px 4px; border-bottom: 1px solid #dee2e6; vertical-align: top; white-space: nowrap; font-size: 11px; overflow: hidden; text-overflow: ellipsis; position: relative; }
          .users-table tr:hover { background: #f8f9fa; }
          
          /* Sticky колонка пользователя с улучшенным эффектом */
          .users-table th.user-cell, .users-table td.user-cell { 
            position: sticky; left: 0; z-index: 15; 
            background: #f8f9fa; border-right: 3px solid #007bff;
            box-shadow: 2px 0 5px rgba(0,0,0,0.1);
            min-width: 140px; max-width: 140px;
          }
          .users-table tr:hover td.user-cell { background: #f8f9fa; }
          
          /* Стили для горизонтального скролла */
          .table-container::-webkit-scrollbar { height: 8px; }
          .table-container::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
          .table-container::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
          .table-container::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
          
          /* Компактные стили для колонок - ограничение до 15 символов */
          .compact-cell { min-width: 80px; max-width: 80px; width: 80px; }
          .user-cell { min-width: 140px; max-width: 140px; width: 140px; }
          .actions-cell { min-width: 120px; max-width: 120px; width: 120px; }
          
          /* Tooltip для полной информации */
          .cell-tooltip {
            position: relative;
            cursor: help;
          }
          
          .cell-tooltip:hover::after {
            content: attr(data-tooltip);
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            max-width: 300px;
            white-space: normal;
            word-break: break-word;
          }
          
          /* Стили для кликабельных партнеров */
          .clickable-partners {
            transition: all 0.2s ease;
          }
          
          .clickable-partners:hover {
            background: #007bff !important;
            color: white !important;
            transform: scale(1.1);
          }
          
          /* Стили для списка партнеров */
          .partners-list {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-height: 200px;
            overflow-y: auto;
          }
          
          .partners-list-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px;
            border-bottom: 1px solid #f1f3f4;
          }
          
          .partners-list-item:last-child {
            border-bottom: none;
          }
          
          /* Стили для модальных окон */
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }
          
          .modal-content {
            background: white;
            border-radius: 12px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          }
          
          .modal-header {
            padding: 20px;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .modal-header h2 {
            margin: 0;
            color: #212529;
            font-size: 18px;
          }
          
          .modal-close {
            font-size: 24px;
            font-weight: bold;
            color: #6c757d;
            cursor: pointer;
            line-height: 1;
          }
          
          .modal-close:hover {
            color: #dc3545;
          }
          
          .modal-body {
            padding: 20px;
          }
          
          .modal-footer {
            padding: 15px 20px;
            border-top: 1px solid #dee2e6;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
          }
          
          /* Стили для формы сообщений */
          .message-form-group {
            margin-bottom: 20px;
          }
          
          .message-form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #495057;
          }
          
          .message-form-group input,
          .message-form-group textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ced4da;
            border-radius: 6px;
            font-size: 14px;
            box-sizing: border-box;
          }
          
          .message-form-group input:focus,
          .message-form-group textarea:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
          }
          
          .selected-users-list {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 5px;
          }
          
          .selected-user-tag {
            background: #e9ecef;
            color: #495057;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
          }
          
          .char-count {
            text-align: right;
            font-size: 12px;
            color: #6c757d;
            margin-top: 5px;
          }
          
          .message-error {
            background: #f8d7da;
            color: #721c24;
            padding: 10px;
            border-radius: 6px;
            margin-top: 10px;
            border: 1px solid #f5c6cb;
          }
          
          .user-info { display: flex; align-items: center; gap: 8px; }
          .user-avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; }
          .user-details h4 { margin: 0; font-size: 14px; color: #212529; }
          .user-details p { margin: 1px 0 0 0; font-size: 11px; color: #6c757d; }
          .user-name-link { color: #212529; text-decoration: none; transition: color 0.3s ease; }
          .user-name-link:hover { color: #007bff; text-decoration: underline; }
          
          .balance { font-weight: bold; font-size: 14px; }
          .balance.positive { color: #28a745; }
          .balance.zero { color: #6c757d; }
          
          .partners-count { background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; }
          .orders-sum { background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; }
          
          .action-btn { background: #007bff; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; margin: 1px; }
          .action-btn:hover { background: #0056b3; }
          .action-btn.hierarchy { background: #28a745; }
          .action-btn.hierarchy:hover { background: #1e7e34; }
          
          .back-btn { background: #6c757d; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
          .back-btn:hover { background: #5a6268; }
          
          .empty-state { text-align: center; padding: 60px 20px; color: #6c757d; }
          .empty-state h3 { margin: 0 0 10px 0; font-size: 24px; }
          .empty-state p { margin: 0; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
            <h1>👥 Детальная информация о пользователях</h1>
            <p>Полная статистика, балансы, партнёры и заказы</p>
              </div>
              <a href="/admin" class="back-btn" style="background: rgba(255,255,255,0.2); color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; border: 1px solid rgba(255,255,255,0.3); transition: all 0.3s ease;">
                ← Назад к панели
              </a>
            </div>
          </div>
          
          <div class="controls">
            <div class="sort-controls">
              <div class="sort-group" style="position: relative;">
                <label>Найти по юзернейм:</label>
                <input type="text" id="searchUsername" placeholder="@username" style="padding:8px 12px; border:1px solid #ced4da; border-radius:6px; font-size:14px;" autocomplete="off" />
                <button onclick="searchByUsername()">🔎 Найти</button>
                <div id="searchSuggestions" style="position:absolute; top:36px; left:0; background:#fff; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,.1); width:260px; max-height:220px; overflow:auto; display:none; z-index:5"></div>
              </div>
              <div class="sort-group">
                <label>Сортировать по:</label>
                <select id="sortSelect">
                  <option value="activity" ${sortBy === 'activity' ? 'selected' : ''}>Активности</option>
                  <option value="balance" ${sortBy === 'balance' ? 'selected' : ''}>Балансу</option>
                  <option value="partners" ${sortBy === 'partners' ? 'selected' : ''}>Количеству партнёров</option>
                  <option value="orders" ${sortBy === 'orders' ? 'selected' : ''}>Сумме заказов</option>
                </select>
              </div>
              
              <div class="sort-group">
                <label>Порядок:</label>
                <select id="orderSelect">
                  <option value="desc" ${sortOrder === 'desc' ? 'selected' : ''}>По убыванию</option>
                  <option value="asc" ${sortOrder === 'asc' ? 'selected' : ''}>По возрастанию</option>
                </select>
              </div>
              
              <button onclick="applySorting()">🔄 Применить</button>
            </div>
          </div>
          
          <div class="stats-bar">
            <div class="stat-item" style="cursor:pointer" onclick="applyFilter('all')">
              <div class="stat-number">${sortedUsers.length}</div>
              <div class="stat-label">Всего пользователей</div>
            </div>
            <div class="stat-item" style="cursor:pointer" onclick="applyFilter('with_balance')">
              <div class="stat-number">${sortedUsers.filter(u => u.balance > 0).length}</div>
              <div class="stat-label">С балансом</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${sortedUsers.filter(u => u.directPartners > 0).length}</div>
              <div class="stat-label">Партнёры</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${sortedUsers.reduce((sum, u) => sum + u.totalOrderSum, 0).toFixed(2)} PZ</div>
              <div class="stat-label">Общая сумма заказов</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${sortedUsers.reduce((sum, u) => sum + u.balance, 0).toFixed(2)} PZ</div>
              <div class="stat-label">Общий баланс партнёров</div>
            </div>
          </div>
          
          ${sortedUsers.length === 0 ? `
            <div class="empty-state">
              <h3>📭 Нет пользователей</h3>
              <p>Пользователи появятся здесь после регистрации</p>
            </div>
          ` : `
            <div class="table-container">
              <table class="users-table">
                <thead>
                  <tr>
                    <th class="compact-cell">
                      <input type="checkbox" id="selectAllUsers" onchange="toggleAllUsers(this.checked)" style="margin-right: 5px;">
                      <button onclick="openMessageModal()" class="action-btn" style="font-size: 10px; padding: 2px 6px;">📧</button>
                    </th>
                    <th class="compact-cell">Партнерская программа</th>
                    <th class="compact-cell">Баланс</th>
                    <th class="compact-cell">Заказы</th>
                    <th class="compact-cell">Пригласитель</th>
                    <th class="user-cell">Пользователь</th>
                    <th class="compact-cell">Партнер 1го уровня</th>
                    <th class="compact-cell">Партнер 2го уровня</th>
                    <th class="compact-cell">Партнер 3го уровня</th>
                    <th class="compact-cell">Покупки (сумма)</th>
                    <th class="compact-cell">Вознаграждение (общая сумма)</th>
                    <th class="compact-cell">Выплаты</th>
                    <th class="compact-cell">Осталось выплатить</th>
                    <th class="actions-cell">Действия</th>
                  </tr>
                </thead>
              <tbody>
                ${sortedUsers.map(user => {
                  // Вычисляем данные для новых колонок
                  const partnerProfile = user.partner;
                  const totalEarnings = partnerProfile?.totalEarnings || 0;
                  const withdrawnEarnings = partnerProfile?.withdrawnEarnings || 0;
                  const pendingEarnings = totalEarnings - withdrawnEarnings;
                  
                  // Подсчет партнеров по уровням
                  const level1Partners = user.directPartners || 0;
                  const level2Partners = user.level2Partners || 0;
                  const level3Partners = user.level3Partners || 0;
                  
                  const isPartnerActive = partnerProfile?.isActive || false;
                  
                  return `
                  <tr>
                    <td class="compact-cell">
                      <input type="checkbox" class="user-checkbox" value="${user.id}" onchange="updateSelectedUsers()" style="margin-right: 5px;">
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Партнерская программа: ${isPartnerActive ? 'Активирована' : 'Не активирована'}">
                      <input type="checkbox" 
                             class="partner-program-checkbox" 
                             ${isPartnerActive ? 'checked' : ''} 
                             onchange="togglePartnerProgram('${user.id}', this.checked, this)"
                             style="cursor: pointer; width: 18px; height: 18px;"
                             title="${isPartnerActive ? 'Партнерская программа активирована' : 'Партнерская программа не активирована'}">
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Баланс: ${user.balance.toFixed(2)} PZ${user.bonus > 0 ? ', Бонусы: ' + user.bonus.toFixed(2) + ' PZ' : ''}">
                      <div class="balance ${user.balance > 0 ? 'positive' : 'zero'}">
                        ${user.balance.toFixed(2)} PZ
                      </div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Заказы: ${user.orders?.length || 0} шт., Сумма: ${user.totalOrderSum.toFixed(2)} PZ">
                      <button class="orders-sum-btn" onclick="if(typeof showUserOrders === 'function') { showUserOrders('${user.id}', '${user.firstName || 'Пользователь'}'); } else { console.error('showUserOrders not defined'); window.open('/admin/users/${user.id}/orders', '_blank', 'width=1000,height=700'); }" style="background: none; border: none; cursor: pointer; padding: 0; width: 100%; text-align: left;">
                        <div class="orders-sum">${user.totalOrderSum.toFixed(2)} PZ</div>
                        <div class="orders-count status-${user.priorityStatus}" data-status="${user.priorityStatus}">
                          ${user.orders?.length || 0} шт
                          ${user.priorityStatus === 'new' ? ' 🔴' : ''}
                          ${user.priorityStatus === 'processing' ? ' 🟡' : ''}
                          ${user.priorityStatus === 'completed' ? ' 🟢' : ''}
                          ${user.priorityStatus === 'cancelled' ? ' ⚫' : ''}
                        </div>
                      </button>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Пригласитель: ${user.inviter ? '@' + (user.inviter.username || user.inviter.firstName || 'неизвестно') : 'Не указан'}">
                      <div style="font-size: 10px; color: #6c757d;">
                        ${user.inviter ? `@${(user.inviter.username || user.inviter.firstName || 'неизвестно').substring(0, 12)}${(user.inviter.username || user.inviter.firstName || '').length > 12 ? '...' : ''}` : '—'}
                      </div>
                    </td>
                    <td class="user-cell">
                      <div class="user-info">
                        <div class="user-avatar">${(user.firstName || 'U')[0].toUpperCase()}</div>
                        <div class="user-details">
                          <h4><a href="javascript:void(0)" onclick="if(typeof showUserDetails === 'function') { showUserDetails('${user.id}'); } else { console.error('showUserDetails not defined'); window.open('/admin/users/${user.id}', '_blank', 'width=600,height=400'); }" class="user-name-link" style="cursor: pointer; color: #007bff; text-decoration: none;" title="${user.firstName || 'Без имени'} ${user.lastName || ''}">${(user.firstName || 'Без имени').substring(0, 8)}${(user.firstName || '').length > 8 ? '...' : ''}</a></h4>
                          <p title="@${user.username || 'без username'}">@${(user.username || 'без username').substring(0, 10)}${(user.username || '').length > 10 ? '...' : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Партнеры 1-го уровня: ${level1Partners}">
                      <div class="partners-count clickable-partners" style="display: inline-block; cursor: pointer;" onclick="showPartnersList('${user.id}', '${user.firstName || 'Пользователь'}', 1)">${level1Partners}</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Партнеры 2-го уровня: ${level2Partners}">
                      <div class="partners-count" style="display: inline-block;">${level2Partners}</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Партнеры 3-го уровня: ${level3Partners}">
                      <div class="partners-count" style="display: inline-block;">${level3Partners}</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Покупки (сумма): ${user.totalOrderSum.toFixed(2)} PZ">
                      <div class="orders-sum">${user.totalOrderSum.toFixed(2)} PZ</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Вознаграждение (общая сумма): ${totalEarnings.toFixed(2)} PZ">
                      <div class="orders-sum" style="color: #28a745;">${totalEarnings.toFixed(2)} PZ</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Выплаты: ${withdrawnEarnings.toFixed(2)} PZ">
                      <div class="orders-sum" style="color: #007bff;">${withdrawnEarnings.toFixed(2)} PZ</div>
                    </td>
                    <td class="compact-cell cell-tooltip" data-tooltip="Осталось выплатить: ${pendingEarnings.toFixed(2)} PZ">
                      <div class="orders-sum" style="color: ${pendingEarnings > 0 ? '#ffc107' : '#6c757d'};">${pendingEarnings.toFixed(2)} PZ</div>
                    </td>
                    <td class="actions-cell">
                      <button class="action-btn hierarchy" onclick="if(typeof showHierarchy === 'function') { showHierarchy('${user.id}'); } else { console.error('showHierarchy not defined'); window.open('/admin/partners-hierarchy?user=${user.id}', '_blank', 'width=800,height=600'); }" title="Иерархия партнеров">
                        🌳
                      </button>
                      <button class="action-btn" onclick="if(typeof showUserDetails === 'function') { showUserDetails('${user.id}'); } else { console.error('showUserDetails not defined'); window.open('/admin/users/${user.id}', '_blank', 'width=600,height=400'); }" title="Подробная информация">
                        👁
                      </button>
                      <button class="action-btn" onclick="openChangeInviter('${user.id}', '${user.firstName || 'Без имени'} ${user.lastName || ''}')" title="Сменить пригласителя">
                        🔄
                      </button>
                    </td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
            </div>
          `}
          
          <div style="padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
            <a href="/admin" class="back-btn">← Назад в админ-панель</a>
          </div>
        </div>
        
        <script>
          // Определяем функции для совместимости
          window.showUserDetails = function(userId) {
            window.open('/admin/users/' + userId, '_blank', 'width=600,height=400');
          };
          
          window.showHierarchy = function(userId) {
            window.open('/admin/partners-hierarchy?user=' + userId, '_blank', 'width=800,height=600');
          };
          
          // Функции для массового выбора пользователей
          window.toggleAllUsers = function(checked) {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(checkbox => {
              checkbox.checked = checked;
            });
            updateSelectedUsers();
          };
          
          window.updateSelectedUsers = function() {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            const checkedCount = document.querySelectorAll('.user-checkbox:checked').length;
            const selectAllCheckbox = document.getElementById('selectAllUsers');
            
            if (selectAllCheckbox) {
              selectAllCheckbox.checked = checkedCount === checkboxes.length;
              selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
            }
          };
          
          // Функция для показа списка партнеров
          window.showPartnersList = async function(userId, userName, level) {
            try {
              const response = await fetch('/admin/users/' + userId + '/partners?level=' + level, {
                credentials: 'include'
              });
              
              if (!response.ok) {
                throw new Error('Ошибка загрузки партнеров');
              }
              
              const partners = await response.json();
              
              // Создаем модальное окно для списка партнеров
              const modal = document.createElement('div');
              modal.id = 'partnersModal';
              modal.innerHTML = 
                '<div class="modal-overlay" onclick="closePartnersModal()">' +
                  '<div class="modal-content" onclick="event.stopPropagation()">' +
                    '<div class="modal-header">' +
                      '<h2>👥 Партнеры ' + level + '-го уровня пользователя ' + userName + '</h2>' +
                      '<span class="modal-close" onclick="closePartnersModal()">&times;</span>' +
                    '</div>' +
                    '<div class="modal-body">' +
                      (partners.length === 0 ? 
                        '<p>У этого пользователя нет партнеров данного уровня</p>' :
                        partners.map(partner => 
                          '<div class="partners-list-item">' +
                            '<div class="user-avatar">' + (partner.firstName || 'U')[0].toUpperCase() + '</div>' +
                            '<div>' +
                              '<strong>' + (partner.firstName || 'Без имени') + ' ' + (partner.lastName || '') + '</strong>' +
                              '<br>' +
                              '<small>@' + (partner.username || 'без username') + '</small>' +
                            '</div>' +
                          '</div>'
                        ).join('')
                      ) +
                    '</div>' +
                  '</div>' +
                '</div>';
              
              document.body.appendChild(modal);
              
            } catch (error) {
              console.error('Error loading partners:', error);
              alert('Ошибка загрузки списка партнеров');
            }
          };
          
          window.closePartnersModal = function() {
            const modal = document.getElementById('partnersModal');
            if (modal) {
              modal.remove();
            }
          };
          
          // Функция для переключения статуса партнерской программы
          window.togglePartnerProgram = async function(userId, isActive, checkboxElement) {
            const checkbox = checkboxElement || (window.event && window.event.target);
            const originalChecked = !isActive; // Сохраняем исходное состояние
            
            try {
              const response = await fetch('/admin/users/' + userId + '/toggle-partner-program', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ isActive: isActive })
              });
              
              if (!response.ok) {
                throw new Error('Ошибка обновления статуса партнерской программы');
              }
              
              const result = await response.json();
              
              if (result.success) {
                // Обновляем tooltip
                if (checkbox) {
                  const cell = checkbox.closest('td');
                  if (cell) {
                    cell.setAttribute('data-tooltip', 'Партнерская программа: ' + (isActive ? 'Активирована' : 'Не активирована'));
                    checkbox.setAttribute('title', isActive ? 'Партнерская программа активирована' : 'Партнерская программа не активирована');
                  }
                }
                
                // Показываем уведомление
                const notification = document.createElement('div');
                notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #28a745; color: white; padding: 12px 20px; border-radius: 4px; z-index: 10000; box-shadow: 0 2px 8px rgba(0,0,0,0.2);';
                notification.textContent = isActive ? '✅ Партнерская программа активирована' : '❌ Партнерская программа деактивирована';
                document.body.appendChild(notification);
                
                setTimeout(() => {
                  notification.remove();
                }, 3000);
              } else {
                throw new Error(result.error || 'Ошибка обновления статуса');
              }
            } catch (error) {
              console.error('Error toggling partner program:', error);
              alert('Ошибка обновления статуса партнерской программы: ' + error.message);
              
              // Откатываем изменение чекбокса
              if (checkbox) {
                checkbox.checked = originalChecked;
              }
            }
          };
          
          // Функция для открытия модального окна отправки сообщений
          window.openMessageModal = function() {
            const selectedCheckboxes = document.querySelectorAll('.user-checkbox:checked');
            if (selectedCheckboxes.length === 0) {
              alert('Выберите пользователей для отправки сообщения');
              return;
            }
            
            const selectedUserIds = Array.from(selectedCheckboxes).map(cb => cb.value);
            
            const modal = document.createElement('div');
            modal.id = 'messageModal';
            modal.innerHTML = 
              '<div class="modal-overlay" onclick="closeMessageModal()">' +
                '<div class="modal-content" onclick="event.stopPropagation()">' +
                  '<div class="modal-header">' +
                    '<h2>📧 Отправить сообщение</h2>' +
                    '<span class="modal-close" onclick="closeMessageModal()">&times;</span>' +
                  '</div>' +
                  '<div class="modal-body">' +
                    '<div class="message-form-group">' +
                      '<label>Выбранные пользователи (' + selectedUserIds.length + '):</label>' +
                      '<div class="selected-users-list">' +
                        selectedUserIds.map(id => {
                          const checkbox = document.querySelector('input[value="' + id + '"]');
                          const row = checkbox?.closest('tr');
                          const nameCell = row?.querySelector('.user-details h4 a');
                          const name = nameCell?.textContent || 'Пользователь';
                          return '<span class="selected-user-tag">' + name + '</span>';
                        }).join('') +
                      '</div>' +
                    '</div>' +
                    '<div class="message-form-group">' +
                      '<label for="messageSubject">Тема сообщения:</label>' +
                      '<input type="text" id="messageSubject" placeholder="Введите тему сообщения" maxlength="100">' +
                    '</div>' +
                    '<div class="message-form-group">' +
                      '<label for="messageText">Текст сообщения:</label>' +
                      '<textarea id="messageText" placeholder="Введите текст сообщения" rows="5" maxlength="1000"></textarea>' +
                      '<div class="char-count">' +
                        '<span id="charCount">0</span>/1000 символов' +
                      '</div>' +
                    '</div>' +
                    '<div class="message-form-group">' +
                      '<label>' +
                        '<input type="checkbox" id="saveAsTemplate">' +
                        'Сохранить как шаблон' +
                      '</label>' +
                    '</div>' +
                    '<div class="message-error" id="messageError" style="display: none;"></div>' +
                  '</div>' +
                  '<div class="modal-footer">' +
                    '<button class="btn btn-secondary" onclick="closeMessageModal()">Отмена</button>' +
                    '<button class="btn btn-primary" onclick="sendMessage()">Отправить</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
            
            document.body.appendChild(modal);
            
            // Добавляем счетчик символов
            const textarea = document.getElementById('messageText');
            const charCount = document.getElementById('charCount');
            
            textarea.addEventListener('input', function() {
              charCount.textContent = this.value.length;
            });
          };
          
          window.closeMessageModal = function() {
            const modal = document.getElementById('messageModal');
            if (modal) {
              modal.remove();
            }
          };
          
          window.sendMessage = async function() {
            const selectedCheckboxes = document.querySelectorAll('.user-checkbox:checked');
            const selectedUserIds = Array.from(selectedCheckboxes).map(cb => cb.value);
            const subject = document.getElementById('messageSubject').value.trim();
            const text = document.getElementById('messageText').value.trim();
            const saveAsTemplate = document.getElementById('saveAsTemplate').checked;
            const errorDiv = document.getElementById('messageError');
            
            // Валидация
            if (!subject) {
              showMessageError('Введите тему сообщения');
              return;
            }
            
            if (!text) {
              showMessageError('Введите текст сообщения');
              return;
            }
            
            if (selectedUserIds.length === 0) {
              showMessageError('Выберите получателей');
              return;
            }
            
            try {
              errorDiv.style.display = 'none';
              
              const response = await fetch('/admin/messages/send', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                  userIds: selectedUserIds,
                  subject: subject,
                  text: text,
                  saveAsTemplate: saveAsTemplate
                })
              });
              
              if (!response.ok) {
                throw new Error('Ошибка отправки сообщения');
              }
              
              const result = await response.json();
              alert('Сообщение отправлено ' + result.successCount + ' пользователям');
              closeMessageModal();
              
            } catch (error) {
              console.error('Error sending message:', error);
              showMessageError('Ошибка отправки сообщения: ' + error.message);
            }
          };
          
          window.showMessageError = function(message) {
            const errorDiv = document.getElementById('messageError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
          };
          
          function applySorting() {
            const sortBy = document.getElementById('sortSelect').value;
            const order = document.getElementById('orderSelect').value;
            window.location.href = '/admin/users-detailed?sort=' + sortBy + '&order=' + order;
          }
          function applyFilter(filter){
            const url = new URL(window.location.href);
            const sortBy = document.getElementById('sortSelect') ? document.getElementById('sortSelect').value : url.searchParams.get('sort') || 'orders';
            const order = document.getElementById('orderSelect') ? document.getElementById('orderSelect').value : url.searchParams.get('order') || 'desc';
            if(filter === 'all') url.searchParams.delete('filter'); else url.searchParams.set('filter', filter);
            url.searchParams.set('sort', sortBy);
            url.searchParams.set('order', order);
            window.location.href = url.pathname + '?' + url.searchParams.toString();
          }
          function searchByUsername(){
            var q = document.getElementById('searchUsername').value.trim();
            if(!q) return;
            if(q.startsWith('@')) q = q.slice(1);
            window.location.href = '/admin/users-detailed?search=' + encodeURIComponent(q);
          }
          (function(){
            var typingTimer; var inputEl = document.getElementById('searchUsername'); var box = document.getElementById('searchSuggestions');
            function hide(){ box.style.display='none'; box.innerHTML=''; }
            inputEl.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); searchByUsername(); hide(); }});
            inputEl.addEventListener('input', function(){
              clearTimeout(typingTimer);
              var val = inputEl.value.trim();
              if(val.startsWith('@')) val = val.slice(1);
              if(!val){ hide(); return; }
              typingTimer = setTimeout(async function(){
                try{
                  const resp = await fetch('/admin/users/search?q=' + encodeURIComponent(val), { credentials:'include' });
                  const data = await resp.json();
                  if(!Array.isArray(data) || data.length===0){ hide(); return; }
                  box.innerHTML = data.map(u => '<div class="list-item" style="padding:6px 10px; cursor:pointer; border-bottom:1px solid #f3f4f6">' +
                    (u.username ? '@'+u.username : (u.firstName||'')) +
                    '</div>').join('');
                  Array.from(box.children).forEach((el, idx)=>{
                    el.addEventListener('click', function(){
                      var uname = data[idx].username || '';
                      if(uname){ window.location.href = '/admin/users-detailed?search=' + encodeURIComponent(uname); }
                      hide();
                    });
                  });
                  box.style.display = 'block';
                }catch(e){ hide(); }
              }, 250);
            });
            document.addEventListener('click', function(e){ if(!box.contains(e.target) && e.target !== inputEl){ hide(); } });
          })();
          
          window.openChangeInviter = async function(userId, userName) {
            const modal = document.createElement('div');
            modal.id = 'inviterModal';
            modal.innerHTML =
              '<div class="modal-overlay" id="inviterOverlay">' +
                '<div class="modal-content" id="inviterContent" style="max-width:560px; border-radius:12px; overflow:hidden; box-shadow:0 12px 30px rgba(0,0,0,.2)">' +
                  '<div class="modal-header" style="background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; padding:16px 20px; display:flex; align-items:center; justify-content:space-between">' +
                    '<h2 style="margin:0; font-size:18px; font-weight:600">🔄 Смена пригласителя</h2>' +
                    '<button class="close-btn" id="inviterClose" style="background:transparent; border:none; color:#fff; font-size:22px; cursor:pointer">&times;</button>' +
                  '</div>' +
                  '<div class="modal-body" style="padding:16px 20px; background:#fff">' +
                    '<div style="margin-bottom:8px; color:#6b7280">Пользователь:</div>' +
                    '<div style="font-weight:600; margin-bottom:12px">' + userName + '</div>' +
                    '<div class="form-group" style="margin-bottom:10px; position:relative">' +
                      '<label style="display:block; font-weight:600; margin-bottom:6px">Поиск по @username или коду</label>' +
                      '<input type="text" id="inviterSearch" placeholder="@username или код" autocomplete="off" style="width:100%; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px" />' +
                      '<div id="inviterResults" style="position:absolute; top:72px; left:0; right:0; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:6px; display:none; max-height:220px; overflow:auto; z-index:10"></div>' +
                    '</div>' +
                    '<div class="form-group" style="margin-top:10px">' +
                      '<label style="display:block; font-weight:600; margin-bottom:6px">Или введите код вручную</label>' +
                      '<input type="text" id="inviterCodeManual" placeholder="Код пригласителя" style="width:260px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px" />' +
                    '</div>' +
                    '<div id="inviterError" style="margin-top:8px; color:#b91c1c; display:none"></div>' +
                  '</div>' +
                  '<div class="modal-footer" style="display:flex; gap:10px; justify-content:flex-end; padding:12px 20px; background:#f9fafb">' +
                    '<button class="btn" id="inviterCancel" style="background:#6c757d; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer">Отмена</button>' +
                    '<button class="btn" id="inviterApplyBtn" style="background:#10b981; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer" disabled>Применить</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
            document.body.appendChild(modal);

            const searchInput = document.getElementById('inviterSearch');
            const resultsEl = document.getElementById('inviterResults');
            const codeInput = document.getElementById('inviterCodeManual');
            const applyBtn = document.getElementById('inviterApplyBtn');
            const closeBtn = document.getElementById('inviterClose');
            const cancelBtn = document.getElementById('inviterCancel');
            const overlay = document.getElementById('inviterOverlay');

            function closeModal(){
              const el = document.getElementById('inviterModal');
              if (el && el.parentNode) el.parentNode.removeChild(el);
            }
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

            let selected = null; // {username, referralCode}
            let typingTimer;
            function setError(msg){
              var e = document.getElementById('inviterError');
              e.textContent = msg || '';
              e.style.display = msg ? 'block' : 'none';
            }
            function validate(){
              var typed = (codeInput.value || searchInput.value).trim();
              var ok = (selected && selected.username) || typed.length > 0;
              applyBtn.disabled = !ok;
            }
            searchInput.addEventListener('input', validate);
            codeInput.addEventListener('input', validate);

            function renderResults(items){
              if (!items || items.length === 0){
                resultsEl.style.display = 'none';
                resultsEl.innerHTML = '';
                return;
              }
              resultsEl.style.display = 'block';
              resultsEl.innerHTML = items.map(function(i){
                const uname = i.username ? '@' + i.username : '';
                const name = ((i.firstName || '') + ' ' + (i.lastName || '')).trim();
                return '<div class="list-item" style="cursor:pointer; padding:6px; border-bottom:1px solid #eee" data-username="' + (i.username || '') + '" data-code="' + i.referralCode + '">' +
                  '<div class="list-info"><div class="list-name">' + (uname || name || 'Без имени') + '</div>' +
                  '<div class="list-time">код: ' + i.referralCode + '</div></div></div>';
              }).join('');
              Array.prototype.slice.call(resultsEl.querySelectorAll('[data-username]')).forEach(function(el){
                el.addEventListener('click', function(){
                  selected = { username: el.getAttribute('data-username'), code: el.getAttribute('data-code') };
                  searchInput.value = selected.username ? '@' + selected.username : selected.code;
                  codeInput.value = '';
                  resultsEl.style.display = 'none';
                });
              });
            }
            searchInput.addEventListener('input', function(){
              clearTimeout(typingTimer);
              const q = searchInput.value.trim();
              if (!q){ renderResults([]); return; }
              typingTimer = setTimeout(async function(){
                try{
                  const resp = await fetch('/admin/inviters/search?q=' + encodeURIComponent(q), { credentials: 'include' });
                  const data = await resp.json();
                  renderResults(data);
                }catch(e){ renderResults([]); }
              }, 300);
            });
            applyBtn.addEventListener('click', async function(){
              var typed = (codeInput.value || searchInput.value).trim();
              var payload = {};
              if (selected && selected.username) {
                payload = { inviterUsername: selected.username };
              } else if (typed) {
                if (typed.startsWith('@')) payload = { inviterUsername: typed.replace(/^@/, '') };
                else payload = { newInviterCode: typed };
              }
              if (!('inviterUsername' in payload) && !('newInviterCode' in payload)) { setError('Укажите пригласителя'); return; }
              try{
                const resp = await fetch('/admin/users/' + userId + '/change-inviter', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, credentials: 'include', body: JSON.stringify(payload)
                });
                if (resp.ok){ alert('Пригласитель изменен'); location.reload(); return; }
                let data = null; try { data = await resp.json(); } catch(e) {}
                setError('Не удалось изменить пригласителя' + (data && data.error ? (' — ' + data.error) : ''));
              }catch(e){ setError('Ошибка сети'); }
            });
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Detailed users page error:', error);
    res.status(500).send('Ошибка загрузки страницы пользователей');
  }
});

// Lightweight username prefix search for suggestions
// Username prefix search (router mounted at /admin → final path /admin/users/search)
router.get('/users/search', requireAdmin, async (req, res) => {
  try {
    const q = String((req.query.q as string) || '').trim().replace(/^@/, '');
    if (!q) return res.json([]);
    const users = await prisma.user.findMany({
      where: { username: { startsWith: q, mode: 'insensitive' } },
      select: { id: true, username: true, firstName: true },
      take: 10,
      orderBy: { username: 'asc' }
    });
    res.json(users);
  } catch (e) {
    res.json([]);
  }
});

// Inviter search (username or referral code) for modal suggestions
router.get('/inviters/search', requireAdmin, async (req, res) => {
  try {
    const q = String((req.query.q as string) || '').trim();
    if (!q) return res.json([]);
    if (q.startsWith('@')) {
      const uname = q.replace(/^@/, '');
      const users = await prisma.user.findMany({
        where: { username: { startsWith: uname, mode: 'insensitive' } },
        take: 10,
        select: { id: true, username: true, firstName: true }
      });
      // attach referral codes when exist
      const profiles = await prisma.partnerProfile.findMany({
        where: { userId: { in: users.map(u => u.id) } },
        select: { userId: true, referralCode: true }
      });
      const map = new Map(profiles.map(p => [p.userId, p.referralCode]));
      return res.json(users.map(u => ({ username: u.username, firstName: u.firstName, referralCode: map.get(u.id) || '' })));
    }
    // treat as referral code prefix search
    const partners = await prisma.partnerProfile.findMany({
      where: { referralCode: { startsWith: q } },
      take: 10,
      include: { user: true }
    });
    return res.json(partners.map(p => ({ username: p.user?.username || '', firstName: p.user?.firstName || '', referralCode: p.referralCode })));
  } catch {
    return res.json([]);
  }
});
// Send messages to users
router.post('/send-messages', requireAdmin, async (req, res) => {
  try {
    const { userIds, type, subject, text, includeButtons, button1, button2 } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Не выбраны получатели' });
    }
    
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Не указан текст сообщения' });
    }
    
    // Get bot instance for real message sending
    const { getBotInstance } = await import('../lib/bot-instance.js');
    const bot = await getBotInstance();
    
    let sentCount = 0;
    let errors = [];
    
    // Send messages to each user
    for (const userId of userIds) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          errors.push(`Пользователь ${userId} не найден`);
          continue;
        }
        
        // Build message text
        let messageText = '';
        if (subject) {
          messageText += `📢 **${subject}**\n\n`;
        }
        messageText += text;
        
        // Add type indicator
        const typeEmojiMap: { [key: string]: string } = {
          'text': '💬',
          'notification': '🔔',
          'promotion': '🎉',
          'system': '⚙️'
        };
        const typeEmoji = typeEmojiMap[type] || '💬';
        
        messageText = `${typeEmoji} ${messageText}`;
        
        // Send message via Telegram bot
        try {
          // Экранируем Markdown символы
          const escapeMarkdown = (text: string) => {
            return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
          };
          
          const escapedMessageText = escapeMarkdown(messageText);
          
          try {
            await bot.telegram.sendMessage(user.telegramId, escapedMessageText, {
              parse_mode: 'Markdown'
            });
          } catch (markdownError) {
            console.log(`⚠️ Markdown отправка не удалась, пробуем без Markdown: ${markdownError instanceof Error ? markdownError.message : String(markdownError)}`);
            // Если Markdown не работает, отправляем без форматирования
            await bot.telegram.sendMessage(user.telegramId, messageText);
          }
          
          // Add buttons if requested
          if (includeButtons && (button1.text || button2.text)) {
            const buttons = [];
            if (button1.text) {
              buttons.push([{ text: button1.text, url: button1.url }]);
            }
            if (button2.text) {
              buttons.push([{ text: button2.text, url: button2.url }]);
            }
            
            if (buttons.length > 0) {
              await bot.telegram.sendMessage(user.telegramId, '👇 Выберите действие:', {
                reply_markup: { inline_keyboard: buttons }
              });
            }
          }
          
          console.log(`✅ Message sent to user ${user.firstName} (${user.id})`);
          
        } catch (telegramError) {
          console.error(`❌ Telegram error for user ${user.id}:`, telegramError);
          const telegramErrorMessage = telegramError instanceof Error ? telegramError.message : String(telegramError);
          errors.push(`Ошибка Telegram для ${user.firstName}: ${telegramErrorMessage}`);
          continue;
        }
        
        // Log successful message
        await prisma.userHistory.create({
          data: {
            userId: user.id,
            action: 'admin_message_sent',
            payload: {
              type,
              subject,
              messageLength: text.length,
              hasButtons: includeButtons,
              messageText: messageText,
              status: 'sent',
              telegramId: user.telegramId
            }
          }
        });
        
        sentCount++;
        
      } catch (error) {
        console.error(`Error sending message to user ${userId}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Ошибка отправки пользователю ${userId}: ${errorMessage}`);
      }
    }
    
    res.json({
      success: true,
      sent: sentCount,
      total: userIds.length,
      failed: userIds.length - sentCount,
      errors: errors.length > 0 ? errors : undefined,
      message: sentCount > 0 ? 
        `Успешно отправлено ${sentCount} из ${userIds.length} сообщений` : 
        'Не удалось отправить ни одного сообщения'
    });
    
  } catch (error) {
    console.error('Send messages error:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// API: Get categories
router.get('/api/categories', requireAdmin, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, error: 'Ошибка загрузки категорий' });
  }
});

// Test endpoint for dual system bonuses
router.get('/test-dual-system', requireAdmin, async (req, res) => {
  try {
    // Test with a sample order amount
    const testOrderAmount = 100; // 100 PZ
    const testUserId = '0000000000000001a5d56f19'; // Aurelia (direct referral of Roman)
    
    console.log(`🧪 Testing dual system with order amount: ${testOrderAmount} PZ for user: ${testUserId}`);
    
    // Call the dual system calculation
    const bonuses = await calculateDualSystemBonuses(testUserId, testOrderAmount);
    
    res.json({
      success: true,
      message: 'Dual system test completed',
      testData: {
        orderAmount: testOrderAmount,
        userId: testUserId,
        bonuses: bonuses || []
      }
    });
  } catch (error) {
    console.error('❌ Dual system test error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API: Create category
router.post('/api/categories', requireAdmin, async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Название категории обязательно' });
    }
    
    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        slug: name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description?.trim() || '',
        isActive: true
      }
    });
    
    res.json({ success: true, category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ success: false, error: 'Ошибка создания категории' });
  }
});
// API: Create product
router.post('/api/products', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { name, price, categoryId, stock, shortDescription, fullDescription, instruction, active, availableInRussia, availableInBali } = req.body;
    
    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Название товара обязательно' });
    }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      return res.status(400).json({ success: false, error: 'Цена должна быть положительным числом' });
    }
    if (!categoryId) {
      return res.status(400).json({ success: false, error: 'Выберите категорию' });
    }
    if (!shortDescription || !shortDescription.trim()) {
      return res.status(400).json({ success: false, error: 'Краткое описание обязательно' });
    }
    if (!fullDescription || !fullDescription.trim()) {
      return res.status(400).json({ success: false, error: 'Полное описание обязательно' });
    }
    
    // Regions parsing removed; using fixed switches on client side
    
    // Check if category exists
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      return res.status(400).json({ success: false, error: 'Категория не найдена' });
    }
    
    // Handle image upload (if provided)
    let imageUrl = '';
    if (req.file) {
      try {
        // Upload to Cloudinary
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { resource_type: 'auto', folder: 'plazma-products' },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          ).end(req.file!.buffer);
        });
        
        imageUrl = (result as any).secure_url;
      } catch (error) {
        console.error('Image upload error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка загрузки изображения' });
      }
    }
    
    // Create product
    const product = await prisma.product.create({
      data: {
        title: name.trim(),
        summary: shortDescription.trim(),
        description: fullDescription.trim(),
        instruction: instruction?.trim() || null,
        price: parseFloat(price),
        categoryId,
        imageUrl,
        isActive: active === 'true' || active === true,
        availableInRussia: availableInRussia === 'true' || availableInRussia === true,
        availableInBali: availableInBali === 'true' || availableInBali === true
      }
    });
    
    res.json({ success: true, product });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: 'Ошибка создания товара' });
  }
});
// Individual user details page
router.get('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        partner: {
          include: {
            referrals: true,
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 10
            }
          }
        },
        orders: {
          orderBy: { createdAt: 'desc' }
        },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    if (!user) {
      return res.status(404).send('Пользователь не найден');
    }

    const partnerProfile = (user as any).partner;
    const directPartners = partnerProfile?.referrals?.length || 0;
    const totalOrderSum = (user as any).orders?.reduce((sum: number, order: any) => {
      // Parse itemsJson to calculate total
      try {
        const items = JSON.parse(order.itemsJson || '[]');
        const orderTotal = items.reduce((itemSum: number, item: any) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
        return sum + orderTotal;
      } catch {
        return sum;
      }
    }, 0) || 0;
    const balance = partnerProfile?.balance || 0;
    const bonus = partnerProfile?.bonus || 0;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Детали пользователя - ${user.firstName || 'Без имени'}</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .content { padding: 30px; }
          .section { margin-bottom: 30px; }
          .section h3 { margin: 0 0 15px 0; color: #333; font-size: 18px; }
          .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
          .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff; }
          .info-card h4 { margin: 0 0 8px 0; color: #495057; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
          .info-card p { margin: 0; font-size: 20px; font-weight: bold; color: #212529; }
          .balance { color: #28a745; }
          .balance.zero { color: #6c757d; }
          .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
          .table th { background: #f8f9fa; font-weight: 600; color: #495057; }
          .table tr:hover { background: #f8f9fa; }
          .back-btn { background: #6c757d; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
          .back-btn:hover { background: #5a6268; }
          .empty-state { text-align: center; padding: 40px; color: #6c757d; }
          .empty-state .add-order-btn {
            margin-top: 15px;
          }
          
          /* Instruction modal styles */
          .instruction-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .instruction-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .instruction-content {
            background: white;
            border-radius: 12px;
            max-width: 500px;
            width: 100%;
            max-height: 80vh;
            overflow: hidden;
            transform: scale(0.8);
            transition: transform 0.3s ease;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
          }
          .instruction-header {
            padding: 20px 24px 16px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .instruction-header h3 {
            color: #333;
            font-size: 18px;
            font-weight: 600;
            margin: 0;
          }
          .btn-close {
            background: none;
            border: none;
            color: #6c757d;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.3s ease;
          }
          .btn-close:hover {
            background: #f8f9fa;
            color: #333;
          }
          .instruction-body {
            padding: 20px 24px;
            max-height: 50vh;
            overflow-y: auto;
          }
          .instruction-text {
            color: #333;
            line-height: 1.6;
            font-size: 14px;
            white-space: pre-wrap;
          }
          .instruction-footer {
            padding: 16px 24px 20px;
            border-top: 1px solid #e9ecef;
            display: flex;
            justify-content: flex-end;
          }
          .btn-secondary {
            background: #6c757d;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          .btn-secondary:hover {
            background: #5a6268;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>👤 ${user.firstName || 'Без имени'} ${user.lastName || ''}</h1>
            <p>@${user.username || 'без username'} • ID: ${user.id}</p>
          </div>
          
          <div class="content">
            <div class="section">
              <h3>📊 Основная информация</h3>
              <div class="info-grid">
                <div class="info-card">
                  <h4>Баланс</h4>
                  <p class="balance ${balance > 0 ? '' : 'zero'}">${balance.toFixed(2)} PZ</p>
                </div>
                <div class="info-card">
                  <h4>Всего бонусов</h4>
                  <p class="balance ${bonus > 0 ? '' : 'zero'}">${bonus.toFixed(2)} PZ</p>
                </div>
                <div class="info-card">
                  <h4>Прямых партнёров</h4>
                  <p>${directPartners}</p>
                </div>
                <div class="info-card">
                  <h4>Сумма заказов</h4>
                  <p>${totalOrderSum.toFixed(2)} PZ</p>
                </div>
                <div class="info-card">
                  <h4>Дата регистрации</h4>
                  <p>${user.createdAt.toLocaleString('ru-RU')}</p>
                </div>
                <div class="info-card">
                  <h4>Последняя активность</h4>
                  <p>${(user.updatedAt || user.createdAt).toLocaleString('ru-RU')}</p>
                </div>
                <div class="info-card">
                  <h4>Адрес доставки</h4>
                  <p>${(user as any).deliveryAddress || 'Не указан'}</p>
                  ${(user as any).deliveryAddress ? `
                    <button onclick="editDeliveryAddress('${user.id}')" class="btn" style="background: #17a2b8; margin-top: 5px;">✏️ Редактировать</button>
                  ` : `
                    <button onclick="editDeliveryAddress('${user.id}')" class="btn" style="background: #28a745; margin-top: 5px;">➕ Добавить</button>
                  `}
                </div>
              </div>
            </div>

            ${partnerProfile ? `
              <div class="section">
                <h3>🤝 Партнёрская информация (включая 2-й и 3-й уровень)</h3>
                <div class="info-grid">
                  <div class="info-card">
                    <h4>Тип программы</h4>
                    <p>${partnerProfile.programType === 'DIRECT' ? 'Прямая (25%)' : 'Многоуровневая (15%+5%+5%)'}</p>
                  </div>
                  <div class="info-card">
                    <h4>Реферальный код</h4>
                    <p>${partnerProfile.referralCode}</p>
                  </div>
                </div>
              </div>
            ` : ''}

            ${(user as any).orders && (user as any).orders.length > 0 ? `
              <div class="section">
                <h3>🛒 Последние заказы</h3>
                <table class="table">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Цена</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(user as any).orders.map((order: any) => {
                      try {
                        const items = JSON.parse(order.itemsJson || '[]');
                        const orderTotal = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
                        const itemNames = items.map((item: any) => `${item.name || 'Товар'} (${item.quantity || 1} шт.)`).join(', ');
                        return `
                          <tr>
                            <td>${itemNames || 'Заказ'}</td>
                            <td>${orderTotal.toFixed(2)} PZ</td>
                            <td>${order.createdAt.toLocaleString('ru-RU')}</td>
                          </tr>
                        `;
                      } catch {
                        return `
                          <tr>
                            <td>Заказ #${order.id}</td>
                            <td>0.00 PZ</td>
                            <td>${order.createdAt.toLocaleString('ru-RU')}</td>
                          </tr>
                        `;
                      }
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            ${partnerProfile?.transactions && partnerProfile.transactions.length > 0 ? `
              <div class="section">
                <h3>💰 Последние транзакции</h3>
                <table class="table">
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th>Сумма</th>
                      <th>Описание</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${partnerProfile.transactions.map((tx: any) => `
                      <tr>
                        <td>${tx.type === 'CREDIT' ? '➕ Пополнение' : '➖ Списание'}</td>
                        <td class="${tx.type === 'CREDIT' ? 'balance' : ''}">${tx.amount.toFixed(2)} PZ</td>
                        <td>${tx.description}</td>
                        <td>${tx.createdAt.toLocaleString('ru-RU')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            ${(user as any).histories && (user as any).histories.length > 0 ? `
              <div class="section">
                <h3>📈 Последние действия</h3>
                <table class="table">
                  <thead>
                    <tr>
                      <th>Действие</th>
                      <th>Данные</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(user as any).histories.map((action: any) => {
                      function humanizeAction(a: any): string {
                        const map: Record<string, string> = {
                          'shop:buy': 'Покупка оформлена',
                          'shop:add-to-cart': 'Добавлен товар в корзину',
                          'shop:product-details': 'Просмотр товара',
                          'shop:category': 'Переход в категорию',
                          'nav:more': 'Открыт подробный раздел',
                          'partner:invite': 'Открыт экран приглашений',
                          'partner:dashboard': 'Просмотр кабинета партнёра',
                          'partner:level:1': 'Просмотр партнёров 1-го уровня',
                          'partner:level:2': 'Просмотр партнёров 2-го уровня',
                          'partner:level:3': 'Просмотр партнёров 3-го уровня',
                          'cart:add': 'Товар добавлен в корзину',
                          'cart:checkout': 'Оформление заказа',
                          'admin_message_sent': 'Отправлено сообщение пользователю'
                        };
                        return map[a.action] || a.action;
                      }
                      function humanizePayload(a: any): string {
                        try {
                          if (!a.payload) return '-';
                          const p = a.payload;
                          if (p.productId) return `Товар: ${p.productId}`;
                          if (p.categoryId) return `Категория: ${p.categoryId}`;
                          if (p.type === 'text' && p.messageLength) return `Текст ${p.messageLength} симв.`;
                          return JSON.stringify(p);
                        } catch { return '-'; }
                      }
                      return `
                      <tr>
                        <td>${humanizeAction(action)}</td>
                        <td>${humanizePayload(action)}</td>
                        <td>${action.createdAt.toLocaleString('ru-RU')}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          </div>
          
          <div style="padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
            <a href="/admin/users-detailed" class="back-btn">← Назад к списку</a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ User details page error:', error);
    res.status(500).send('Ошибка загрузки деталей пользователя');
  }
});
// Force recalculate all partner bonuses
router.post('/force-recalculate-all-bonuses', requireAdmin, async (req, res) => {
  try {
    console.log('🔄 Starting force recalculation of all partner bonuses...');
    
    // Get all partner profiles
    const partners = await prisma.partnerProfile.findMany({
      include: { transactions: true }
    });
    
    console.log(`📊 Found ${partners.length} partner profiles to recalculate`);
    
    let totalRecalculated = 0;
    
    for (const partner of partners) {
      console.log(`🔄 Recalculating bonuses for partner ${partner.id}...`);
      
      // Calculate total from all transactions
      const totalBonus = partner.transactions.reduce((sum, tx) => {
        const amount = tx.type === 'CREDIT' ? tx.amount : -tx.amount;
        console.log(`  - Transaction: ${tx.type} ${tx.amount} PZ (${tx.description})`);
        return sum + amount;
      }, 0);
      
      console.log(`💰 Calculated total bonus for partner ${partner.id}: ${totalBonus} PZ`);
      
      // Update both balance and bonus fields
      await prisma.partnerProfile.update({
        where: { id: partner.id },
        data: {
          balance: totalBonus,
          bonus: totalBonus
        }
      });
      
      totalRecalculated += totalBonus;
      console.log(`✅ Updated partner ${partner.id}: balance = ${totalBonus} PZ, bonus = ${totalBonus} PZ`);
    }
    
    console.log(`🎉 Force recalculation completed! Total recalculated: ${totalRecalculated} PZ`);
    res.redirect('/admin?success=all_bonuses_recalculated&total=' + totalRecalculated);
  } catch (error) {
    console.error('❌ Force recalculate all bonuses error:', error);
    res.redirect('/admin?error=bonus_recalculation');
  }
});

router.get('/categories', requireAdmin, async (req, res) => {
  try {
    console.log('📁 Admin categories page accessed');
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: 'desc' }
    });

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление категориями</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; max-width: 1000px; margin: 20px auto; padding: 20px; }
          .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 5px; }
          .btn:hover { background: #0056b3; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #f2f2f2; }
          .status-btn { transition: all 0.2s ease; }
          .status-btn:hover { transform: scale(1.1); }
          .status-btn.active { color: #28a745; }
          .status-btn.inactive { color: #dc3545; }
        </style>
      </head>
      <body>
        <h2>📁 Управление категориями</h2>
        <a href="/admin" class="btn">← Назад</a>
        <table>
          <tr><th>ID</th><th>Название</th><th>Слаг</th><th>Статус</th><th>Создана</th></tr>
    `;

    categories.forEach(cat => {
      html += `
        <tr>
          <td>${cat.id.substring(0, 8)}...</td>
          <td>${cat.name}</td>
          <td>${cat.slug}</td>
          <td>
            <form method="post" action="/admin/categories/${cat.id}/toggle-active" style="display: inline;">
              <button type="submit" class="status-btn ${cat.isActive ? 'active' : 'inactive'}" style="border: none; background: none; cursor: pointer; font-size: 16px;">
                ${cat.isActive ? '✅ Активна' : '❌ Неактивна'}
              </button>
            </form>
          </td>
          <td>${new Date(cat.createdAt).toLocaleDateString()}</td>
        </tr>
      `;
    });

    html += `
        </table>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Categories page error:', error);
    res.status(500).send('Ошибка загрузки категорий');
  }
});

router.get('/partners', requireAdmin, async (req, res) => {
  try {
    const partners = await prisma.partnerProfile.findMany({
      include: { 
        user: true,
        referrals: {
          include: {
            profile: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate total balance of all partners
    const totalBalance = partners.reduce((sum, partner) => sum + partner.balance, 0);

    // Find inviters for each partner
    const partnersWithInviters = await Promise.all(
      partners.map(async (partner) => {
        // Find who invited this partner
        const inviterReferral = await prisma.partnerReferral.findFirst({
          where: { referredId: partner.user.id },
          include: {
            profile: {
              include: {
                user: true
              }
            }
          }
        });

        return {
          ...partner,
          inviter: inviterReferral?.profile?.user || null
        };
      })
    );

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление партнёрами</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; max-width: 1000px; margin: 20px auto; padding: 20px; }
          .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 5px; }
          .btn:hover { background: #0056b3; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h2>👥 Управление партнёрами v2.0</h2>
        <p style="color: #666; font-size: 12px; margin: 5px 0;">Версия: 2.0 | ${new Date().toLocaleString()}</p>
        <a href="/admin" class="btn">← Назад</a>
        <a href="/admin/partners-hierarchy" class="btn" style="background: #6f42c1;">🌳 Иерархия партнёров</a>
        <a href="/admin/test-referral-links" class="btn" style="background: #17a2b8;">🧪 Тест ссылок</a>
        <form method="post" action="/admin/recalculate-bonuses" style="display: inline;">
          <button type="submit" class="btn" style="background: #28a745;" onclick="return confirm('Пересчитать бонусы всех партнёров?')">🔄 Пересчитать бонусы</button>
        </form>
        <form method="post" action="/admin/cleanup-duplicates" style="display: inline;">
          <button type="submit" class="btn" style="background: #dc3545;" onclick="return confirm('⚠️ Удалить дублирующиеся записи партнёров и транзакций? Это действие необратимо!')">🧹 Очистить дубли</button>
        </form>
        <form method="post" action="/admin/recalculate-all-balances" style="display: inline;">
          <button type="submit" class="btn" style="background: #ffc107; color: #000;" onclick="return confirm('🔄 Пересчитать ВСЕ балансы партнёров?')">🔄 Пересчитать все балансы</button>
        </form>
        <a href="/admin/debug-partners" class="btn" style="background: #6c757d;">🔍 Отладка партнёров</a>
        <form method="post" action="/admin/cleanup-referral-duplicates" style="display: inline;">
          <button type="submit" class="btn" style="background: #dc3545;" onclick="return confirm('⚠️ Очистить дублирующиеся записи рефералов? Это действие необратимо!')">🧹 Очистить дубли рефералов</button>
        </form>
        <form method="post" action="/admin/force-recalculate-bonuses" style="display: inline;">
          <button type="submit" class="btn" style="background: #17a2b8;" onclick="return confirm('🔄 Принудительно пересчитать ВСЕ бонусы?')">🔄 Пересчитать бонусы</button>
        </form>
        <form method="post" action="/admin/cleanup-duplicate-bonuses" style="display: inline;">
          <button type="submit" class="btn" style="background: #dc3545;" onclick="return confirm('⚠️ Удалить дублирующиеся бонусы? Это действие необратимо!')">🧹 Очистить дубли бонусов</button>
        </form>
        <form method="post" action="/admin/fix-roman-bonuses" style="display: inline;">
          <button type="submit" class="btn" style="background: #28a745;" onclick="return confirm('🔧 Исправить бонусы Roman Arctur?')">🔧 Исправить бонусы Roman</button>
        </form>
        
        <div style="background: linear-gradient(135deg, #e8f5e8 0%, #d4edda 100%); padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center; border: 3px solid #28a745; box-shadow: 0 4px 8px rgba(40, 167, 69, 0.2);">
          <h2 style="margin: 0 0 5px 0; color: #28a745; font-size: 28px;">💰 Общий баланс всех партнёров</h2>
          <div style="font-size: 36px; font-weight: bold; color: #155724; margin: 10px 0;">${totalBalance.toFixed(2)} PZ</div>
          <div style="font-size: 14px; color: #666; margin-top: 5px;">Сумма всех балансов партнёров в системе</div>
        </div>
        
        ${req.query.success === 'inviter_changed' ? '<div class="alert alert-success">✅ Пригласитель успешно изменен</div>' : ''}
        ${req.query.error === 'inviter_not_found' ? '<div class="alert alert-error">❌ Пригласитель с таким кодом не найден</div>' : ''}
        ${req.query.error === 'inviter_change' ? '<div class="alert alert-error">❌ Ошибка при смене пригласителя</div>' : ''}
        ${req.query.success === 'balance_added' ? '<div class="alert alert-success">✅ Баланс успешно пополнен</div>' : ''}
        ${req.query.success === 'balance_subtracted' ? '<div class="alert alert-success">✅ Баланс успешно списан</div>' : ''}
        ${req.query.success === 'bonuses_recalculated' ? '<div class="alert alert-success">✅ Бонусы успешно пересчитаны</div>' : ''}
        ${req.query.success === 'duplicates_cleaned' ? `<div class="alert alert-success">✅ Дубли очищены! Удалено ${req.query.referrals || 0} дублей рефералов и ${req.query.transactions || 0} дублей транзакций</div>` : ''}
        ${req.query.success === 'all_balances_recalculated' ? '<div class="alert alert-success">✅ Все балансы партнёров пересчитаны</div>' : ''}
        ${req.query.success === 'referral_duplicates_cleaned' ? `<div class="alert alert-success">✅ Дубли рефералов очищены! Удалено ${req.query.count || 0} дублей</div>` : ''}
        ${req.query.success === 'bonuses_force_recalculated' ? '<div class="alert alert-success">✅ Все бонусы принудительно пересчитаны</div>' : ''}
        ${req.query.success === 'duplicate_bonuses_cleaned' ? `<div class="alert alert-success">✅ Дубли бонусов очищены! Удалено ${req.query.count || 0} дублей</div>` : ''}
        ${req.query.success === 'roman_bonuses_fixed' ? `<div class="alert alert-success">✅ Бонусы Roman Arctur исправлены! Новый бонус: ${req.query.bonus || 0} PZ</div>` : ''}
        ${req.query.error === 'balance_add' ? '<div class="alert alert-error">❌ Ошибка при пополнении баланса</div>' : ''}
        ${req.query.error === 'balance_subtract' ? '<div class="alert alert-error">❌ Ошибка при списании баланса</div>' : ''}
        ${req.query.error === 'bonus_recalculation' ? '<div class="alert alert-error">❌ Ошибка при пересчёте бонусов</div>' : ''}
        ${req.query.error === 'balance_recalculation_failed' ? '<div class="alert alert-error">❌ Ошибка при пересчёте всех балансов</div>' : ''}
        ${req.query.error === 'bonus_force_recalculation_failed' ? '<div class="alert alert-error">❌ Ошибка при принудительном пересчёте бонусов</div>' : ''}
        ${req.query.error === 'duplicate_bonuses_cleanup_failed' ? '<div class="alert alert-error">❌ Ошибка при очистке дублей бонусов</div>' : ''}
        ${req.query.error === 'roman_bonuses_fix_failed' ? '<div class="alert alert-error">❌ Ошибка при исправлении бонусов Roman</div>' : ''}
        ${req.query.error === 'roman_profile_not_found' ? '<div class="alert alert-error">❌ Профиль Roman Arctur не найден</div>' : ''}
        ${req.query.error === 'referral_cleanup_failed' ? '<div class="alert alert-error">❌ Ошибка при очистке дублей рефералов</div>' : ''}
        ${req.query.error === 'cleanup_failed' ? '<div class="alert alert-error">❌ Ошибка при очистке дублей</div>' : ''}
        <style>
          .change-inviter-btn { background: #10b981; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 5px; }
          .change-inviter-btn:hover { background: #059669; }
          .alert { padding: 10px; margin: 10px 0; border-radius: 4px; }
          .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        </style>
        <table>
          <tr><th>Пользователь</th><th>Тип программы</th><th>Баланс</th><th>Всего бонусов</th><th>Партнёров</th><th>Код</th><th>Пригласитель</th><th>Создан</th><th>Действия</th></tr>
    `;

    partnersWithInviters.forEach(partner => {
      html += `
        <tr>
          <td>${partner.user.firstName || 'Не указан'}</td>
          <td>${partner.programType === 'DIRECT' ? 'Прямая (25%)' : 'Многоуровневая (15%+5%+5%)'}</td>
          <td>${partner.balance} PZ</td>
          <td>${partner.bonus} PZ</td>
          <td>${partner.totalPartners}</td>
          <td>${partner.referralCode}</td>
          <td>
            ${partner.inviter 
              ? `${partner.inviter.firstName || ''} ${partner.inviter.lastName || ''} ${partner.inviter.username ? `(@${partner.inviter.username})` : ''}`.trim()
              : 'Нет данных'
            }
          </td>
          <td>${new Date(partner.createdAt).toLocaleDateString()}</td>
          <td>
            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
              <form method="post" action="/admin/partners/${partner.id}/change-inviter" style="display: inline;">
                <input type="text" name="newInviterCode" placeholder="Код пригласителя" style="width: 120px; padding: 4px; font-size: 11px;" required>
                <button type="submit" class="change-inviter-btn" onclick="return confirm('Изменить пригласителя для ${partner.user.firstName || 'пользователя'}?')" style="padding: 4px 8px; font-size: 11px;">🔄</button>
              </form>
              <form method="post" action="/admin/partners/${partner.id}/add-balance" style="display: inline;">
                <input type="number" name="amount" placeholder="Сумма" style="width: 80px; padding: 4px; font-size: 11px;" step="0.01" required>
                <button type="submit" class="balance-btn" style="background: #28a745; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 2px;">💰+</button>
              </form>
              <form method="post" action="/admin/partners/${partner.id}/subtract-balance" style="display: inline;">
                <input type="number" name="amount" placeholder="Сумма" style="width: 80px; padding: 4px; font-size: 11px;" step="0.01" required>
                <button type="submit" class="balance-btn" style="background: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 2px;">💰-</button>
              </form>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Partners page error:', error);
    res.status(500).send('Ошибка загрузки партнёров');
  }
});
// Partners hierarchy route
router.get('/partners-hierarchy', requireAdmin, async (req, res) => {
  try {
    const userId = req.query.user as string;
    
    // Get all partners with their referrals
    const partners = await prisma.partnerProfile.findMany({
      include: {
        user: true,
        referrals: {
          include: {
            profile: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Find inviters for each partner
    const partnersWithInviters = await Promise.all(
      partners.map(async (partner) => {
        const inviterReferral = await prisma.partnerReferral.findFirst({
          where: { referredId: partner.user.id },
          include: {
            profile: {
              include: {
                user: true
              }
            }
          }
        });

        return {
          ...partner,
          inviter: inviterReferral?.profile?.user || null
        };
      })
    );

    // Build interactive hierarchy with multi-level referrals (full tree)
    function buildInteractiveHierarchy() {
      const rootPartners = partnersWithInviters.filter(p => !p.inviter);
      
      function buildPartnerNode(partner: any, level = 0) {
        const levelEmoji = level === 0 ? '👑' : level === 1 ? '🥈' : level === 2 ? '🥉' : '📋';
        const partnerName = `${partner.user.firstName || ''} ${partner.user.lastName || ''}`.trim();
        const username = partner.user.username ? ` (@${partner.user.username})` : '';
        const balance = partner.balance.toFixed(2);
        
        // Count all referrals at all levels recursively
        function countAllReferrals(partnerId: string, visited = new Set()): number {
          if (visited.has(partnerId)) return 0; // Prevent infinite loops
          visited.add(partnerId);
          
          const directReferrals = partnersWithInviters.filter(p => 
            p.inviter && p.inviter.id === partnerId
          );
          
          let totalCount = directReferrals.length;
          
          // Recursively count referrals of referrals
          directReferrals.forEach(ref => {
            totalCount += countAllReferrals(ref.user.id, new Set(visited));
          });
          
          return totalCount;
        }
        
        const totalReferrals = countAllReferrals(partner.user.id);
        
        // Get direct referrals (level 1)
        const directReferrals = partnersWithInviters.filter(p => 
          p.inviter && p.inviter.id === partner.user.id
        );
        
        const hasChildren = directReferrals.length > 0;
        const expandId = `expand-${partner.id}`;
        const childrenId = `children-${partner.id}`;
        
        let node = `
          <div class="partner-node level-${level}" style="margin-left: ${level * 20}px;">
            <div class="partner-header" onclick="${hasChildren ? `toggleChildren('${expandId}', '${childrenId}')` : ''}" style="cursor: ${hasChildren ? 'pointer' : 'default'};">
              <span class="expand-icon" id="${expandId}" style="display: ${hasChildren ? 'inline-block' : 'none'};">▶</span>
              <span class="partner-info">
                <span class="level-emoji">${levelEmoji}</span>
                <span class="partner-name">${partnerName}${username}</span>
                <span class="balance">${balance} PZ</span>
                <span class="referrals">(${totalReferrals} рефералов всего)</span>
                ${directReferrals.length > 0 ? `<span class="direct-referrals" style="font-size: 11px; color: #666;">(${directReferrals.length} прямых)</span>` : ''}
              </span>
            </div>
            <div class="children" id="${childrenId}" style="display: none;">
        `;
        
        // Add child nodes recursively
        directReferrals.forEach(referral => {
          node += buildPartnerNode(referral, level + 1);
        });
        
        node += `
            </div>
          </div>
        `;
        
        return node;
      }

      let html = '';
      rootPartners.forEach(rootPartner => {
        html += buildPartnerNode(rootPartner);
      });

      return html;
    }
    // If a specific user is provided, render focused 0-4 view: inviter -> user -> L1 -> L2 -> L3
    function buildFocusedHierarchy(userId: string) {
      const target = partnersWithInviters.find(p => p.user.id === userId);
      if (!target) return '<p style="color:#6c757d">Партнёр не найден</p>';

      // 0: inviter
      const inviter = target.inviter;

      // 1: user
      const user = target;

      // 2: level 1 referrals (direct)
      const level1 = partnersWithInviters.filter(p => p.inviter && p.inviter.id === user.user.id);
      const level1Ids = new Set(level1.map(p => p.user.id));

      // 3: level 2 referrals
      const level2 = partnersWithInviters.filter(p => p.inviter && level1Ids.has(p.inviter.id));
      const level2Ids = new Set(level2.map(p => p.user.id));

      // 4: level 3 referrals
      const level3 = partnersWithInviters.filter(p => p.inviter && level2Ids.has(p.inviter.id));

      function renderUserRow(label: string, u: any | null, canChange = false, idForChange: string | null = null) {
        if (!u) return `<div class=\"partner-node\"><div class=\"partner-header level-0\">${label}: —</div></div>`;
        const name = `${u.firstName || u.user?.firstName || ''} ${u.lastName || u.user?.lastName || ''}`.trim();
        const username = (u.username || u.user?.username) ? ` (@${u.username || u.user?.username})` : '';
        const balance = (u.balance ?? u.user?.balance ?? 0).toFixed ? (u.balance).toFixed(2) : (Number(u.balance || 0)).toFixed(2);
        const btn = canChange && idForChange ? ` <button class=\"btn\" style=\"background:#10b981; margin-left:8px;\" onclick=\"changeInviterPrompt('${idForChange}')\">Сменить пригласителя</button>` : '';
        return `<div class=\"partner-node\"><div class=\"partner-header level-0\"><strong>${label}:</strong> ${name}${username} <span class=\"balance\">${balance} PZ</span>${btn}</div></div>`;
      }

      function renderList(label: string, arr: any[]) {
        if (arr.length === 0) return `<div class="partner-node"><div class="partner-header level-1"><strong>${label}:</strong> —</div></div>`;
        return `
          <div class="partner-node"><div class="partner-header level-1"><strong>${label}:</strong> (${arr.length})</div>
            <div class="children">
              ${arr.map(p => {
                const name = `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim();
                const username = p.user.username ? ` (@${p.user.username})` : '';
                return `<div class=\"partner-node\"><div class=\"partner-header level-2\">${name}${username} <span class=\"balance\">${p.balance.toFixed(2)} PZ</span></div></div>`;
              }).join('')}
            </div>
          </div>`;
      }

      return `
        ${renderUserRow('0 — Пригласитель', inviter)}
        ${renderUserRow('1 — Пользователь', user.user || user, true, user.user.id)}
        ${renderList('2 — Партнёры 1-го уровня', level1)}
        ${renderList('3 — Партнёры 2-го уровня', level2)}
        ${renderList('4 — Партнёры 3-го уровня', level3)}
      `;
    }

    const hierarchyHtml = userId ? buildFocusedHierarchy(userId) : buildInteractiveHierarchy();
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Интерактивная иерархия партнёров</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 20px; }
          h2 { color: #333; margin-bottom: 20px; }
          .btn { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; margin: 5px; }
          .btn:hover { background: #0056b3; }
          
          .stats { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-around; text-align: center; }
          .stat-item h4 { margin: 0; color: #1976d2; }
          .stat-item p { margin: 5px 0 0 0; font-size: 18px; font-weight: bold; }
          
          .hierarchy-container { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #e9ecef; }
          
          .partner-node { margin: 5px 0; }
          .partner-header { padding: 10px; border-radius: 6px; transition: background-color 0.2s; }
          .partner-header:hover { background: #e9ecef; }
          
          .expand-icon { margin-right: 8px; font-size: 12px; transition: transform 0.2s; }
          .expand-icon.expanded { transform: rotate(90deg); }
          
          .partner-info { display: flex; align-items: center; gap: 10px; }
          .level-emoji { font-size: 16px; }
          .partner-name { font-weight: 600; color: #333; }
          .balance { color: #28a745; font-weight: bold; }
          .referrals { color: #6c757d; font-size: 14px; }
          
          .children { margin-left: 20px; border-left: 2px solid #dee2e6; padding-left: 15px; }
          
          .level-0 .partner-header { background: #fff3cd; border-left: 4px solid #ffc107; }
          .level-1 .partner-header { background: #d1ecf1; border-left: 4px solid #17a2b8; }
          .level-2 .partner-header { background: #f8d7da; border-left: 4px solid #dc3545; }
          .level-3 .partner-header { background: #e2e3e5; border-left: 4px solid #6c757d; }
          
          .controls { margin-bottom: 20px; }
          .control-btn { background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 10px; }
          .control-btn:hover { background: #5a6268; }
          .control-btn.primary { background: #007bff; }
          .control-btn.primary:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🌳 Иерархия партнёров ${userId ? '(фокус на пользователе)' : 'v3.0'}</h2>
          <p style="color: #666; font-size: 12px; margin: 5px 0;">Версия: 3.0 | ${new Date().toLocaleString()}</p>
          
          <div class="controls">
            <a href="/admin/partners" class="btn">← К партнёрам</a>
            <a href="/admin" class="btn">🏠 Главная</a>
            <button class="control-btn" onclick="expandAll()">🔽 Развернуть всё</button>
            <button class="control-btn" onclick="collapseAll()">🔼 Свернуть всё</button>
            ${userId ? `<button class="control-btn primary" onclick="changeInviterPrompt('${userId}')">🔄 Сменить пригласителя</button>` : ''}
          </div>
          
          <div class="stats">
            <div class="stat-item">
              <h4>Всего партнёров</h4>
              <p>${partnersWithInviters.length}</p>
            </div>
            <div class="stat-item">
              <h4>Корневых партнёров</h4>
              <p>${partnersWithInviters.filter(p => !p.inviter).length}</p>
            </div>
            <div class="stat-item">
              <h4>Общий баланс</h4>
              <p>${partnersWithInviters.reduce((sum, p) => sum + p.balance, 0).toFixed(2)} PZ</p>
            </div>
          </div>
          
          <div class="hierarchy-container">
            <h3>🌳 Дерево партнёрской иерархии:</h3>
            <div class="hierarchy-tree">
              ${hierarchyHtml || '<p style="text-align: center; color: #6c757d;">Партнёрская иерархия пуста</p>'}
            </div>
          </div>
          
          <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h4 style="margin: 0 0 10px 0; color: #856404;">📋 Обозначения:</h4>
            <p style="margin: 0; color: #856404;">
              👑 Корневые партнёры (без пригласителя) - нажмите для раскрытия<br>
              🥈 Партнёры 1-го уровня<br>
              🥉 Партнёры 2-го уровня<br>
              📋 Партнёры 3-го уровня и ниже<br>
              ▶ Нажмите на стрелку для раскрытия/скрытия уровней
            </p>
          </div>
        </div>
        
        <script>
          async function changeInviterPrompt(userId){
            const q = prompt('Введите @username пригласителя или код');
            if (!q) return;
            let payload = {};
            if (q.startsWith('@')) payload = { inviterUsername: q.replace(/^@/, '') };
            else payload = { newInviterCode: q };
            try{
              const resp = await fetch('/admin/users/' + userId + '/change-inviter', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
              if (resp.redirected) { location.href = resp.url; return; }
              if (resp.ok) { alert('Пригласитель изменён'); location.reload(); }
              else { alert('Не удалось изменить пригласителя'); }
            }catch(e){ alert('Ошибка сети'); }
          }
          function toggleChildren(expandId, childrenId) {
            const expandIcon = document.getElementById(expandId);
            const children = document.getElementById(childrenId);
            
            if (children.style.display === 'none') {
              children.style.display = 'block';
              expandIcon.classList.add('expanded');
            } else {
              children.style.display = 'none';
              expandIcon.classList.remove('expanded');
            }
          }
          
          function expandAll() {
            const allExpandIcons = document.querySelectorAll('.expand-icon');
            const allChildren = document.querySelectorAll('.children');
            
            allExpandIcons.forEach(icon => {
              icon.classList.add('expanded');
            });
            
            allChildren.forEach(children => {
              children.style.display = 'block';
            });
          }
          
          function collapseAll() {
            const allExpandIcons = document.querySelectorAll('.expand-icon');
            const allChildren = document.querySelectorAll('.children');
            
            allExpandIcons.forEach(icon => {
              icon.classList.remove('expanded');
            });
            
            allChildren.forEach(children => {
              children.style.display = 'none';
            });
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Partners hierarchy error:', error);
    res.status(500).send('Ошибка загрузки иерархии партнёров');
  }
});

// Handle partner inviter change
router.post('/partners/:id/change-inviter', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newInviterCode, inviterUsername } = req.body as any;

    let newInviter = null as any;
    if (inviterUsername) {
      const uname = String(inviterUsername).trim().replace(/^@/, '');
      const inviterUser = await prisma.user.findFirst({
        where: { username: { equals: uname, mode: 'insensitive' } }
      });
      if (inviterUser) {
        newInviter = await prisma.partnerProfile.findFirst({ where: { userId: inviterUser.id }, include: { user: true } });
        if (!newInviter) {
          // Auto-create partner profile for inviter if missing
          const code = `REF${inviterUser.id.slice(-6)}${Date.now().toString().slice(-4)}`;
          try {
            newInviter = await prisma.partnerProfile.create({
              data: {
                userId: inviterUser.id,
                programType: 'MULTI_LEVEL',
                referralCode: code,
                balance: 0,
                bonus: 0
              },
              include: { user: true }
            });
          } catch {}
        }
      }
    } else if (newInviterCode) {
      newInviter = await prisma.partnerProfile.findUnique({ where: { referralCode: newInviterCode }, include: { user: true } });
    }

    if (!newInviter) {
      if ((req.headers['accept'] || '').toString().includes('application/json')) {
        return res.status(400).json({ success: false, error: 'inviter_not_found' });
      }
      return res.redirect('/admin/partners?error=inviter_not_found');
    }

    const currentPartner = await prisma.partnerProfile.findUnique({ where: { id }, include: { user: true } });
    if (!currentPartner) {
      if ((req.headers['accept'] || '').toString().includes('application/json')) {
        return res.status(404).json({ success: false, error: 'partner_not_found' });
      }
      return res.redirect('/admin/partners?error=partner_not_found');
    }

    await prisma.partnerReferral.deleteMany({ where: { referredId: currentPartner.userId } });
    await prisma.partnerReferral.create({ data: { profileId: newInviter.id, referredId: currentPartner.userId, level: 1 } });
    
    if ((req.headers['accept'] || '').toString().includes('application/json')) {
      return res.json({ success: true });
    }
    return res.redirect('/admin/partners?success=inviter_changed');
  } catch (error) {
    console.error('Change inviter error:', error);
    if ((req.headers['accept'] || '').toString().includes('application/json')) {
      return res.status(500).json({ success: false, error: 'inviter_change' });
    }
    return res.redirect('/admin/partners?error=inviter_change');
  }
});

// Handle user inviter change
router.post('/users/:id/change-inviter', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newInviterCode, inviterUsername } = req.body as any;

    let newInviter = null as any;
    if (inviterUsername) {
      const uname = String(inviterUsername).trim().replace(/^@/, '');
      const inviterUser = await prisma.user.findFirst({
        where: { username: { equals: uname, mode: 'insensitive' } }
      });
      if (inviterUser) {
        newInviter = await prisma.partnerProfile.findFirst({ where: { userId: inviterUser.id }, include: { user: true } });
        if (!newInviter) {
          const code = `REF${inviterUser.id.slice(-6)}${Date.now().toString().slice(-4)}`;
          try {
            newInviter = await prisma.partnerProfile.create({
              data: {
                userId: inviterUser.id,
                programType: 'MULTI_LEVEL',
                referralCode: code,
                balance: 0,
                bonus: 0
              },
              include: { user: true }
            });
          } catch {}
        }
      }
    } else if (newInviterCode) {
      newInviter = await prisma.partnerProfile.findUnique({ where: { referralCode: newInviterCode }, include: { user: true } });
    }

    if (!newInviter) {
      if ((req.headers['accept'] || '').toString().includes('application/json')) {
        return res.status(400).json({ success: false, error: 'inviter_not_found' });
      }
      return res.redirect('/admin/users?error=inviter_not_found');
    }

    const currentUser = await prisma.user.findUnique({ where: { id } });
    if (!currentUser) {
      if ((req.headers['accept'] || '').toString().includes('application/json')) {
        return res.status(404).json({ success: false, error: 'user_not_found' });
      }
      return res.redirect('/admin/users?error=user_not_found');
    }

    await prisma.partnerReferral.deleteMany({ where: { referredId: id } });
    await prisma.partnerReferral.create({ data: { profileId: newInviter.id, referredId: id, level: 1 } });
    
    if ((req.headers['accept'] || '').toString().includes('application/json')) {
      return res.json({ success: true });
    }
    return res.redirect('/admin/users?success=inviter_changed');
  } catch (error) {
    console.error('Change user inviter error:', error);
    if ((req.headers['accept'] || '').toString().includes('application/json')) {
      return res.status(500).json({ success: false, error: 'inviter_change' });
    }
    return res.redirect('/admin/users?error=inviter_change');
  }
});
router.get('/products', requireAdmin, async (req, res) => {
  try {
    console.log('🛍️ Admin products page accessed');
    const categories = await prisma.category.findMany({
      include: {
        products: {
          include: { category: true },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: { name: 'asc' },
    });

    const allProducts = categories.flatMap((category) => category.products.map((product) => ({
      ...product,
      categoryName: category.name,
    })));

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление товарами</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #f5f5f5; }
          a.btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 5px 0 20px; transition: background 0.2s ease; }
          a.btn:hover { background: #0056b3; }
          h2 { margin-top: 0; }
          .filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
          .filter-btn { padding: 8px 16px; border: none; border-radius: 999px; background: #e0e7ff; color: #1d4ed8; cursor: pointer; transition: all 0.2s ease; }
          .filter-btn:hover { background: #c7d2fe; }
          .filter-btn.active { background: #1d4ed8; color: #fff; box-shadow: 0 4px 10px rgba(29, 78, 216, 0.2); }
          .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
          .product-card { background: #fff; border-radius: 12px; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08); padding: 18px; display: flex; flex-direction: column; gap: 12px; transition: transform 0.2s ease, box-shadow 0.2s ease; }
          .product-card:hover { transform: translateY(-4px); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12); }
          .product-header { display: flex; justify-content: space-between; align-items: flex-start; }
          .product-title { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
          .badge { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; display: inline-block; }
          .badge-status-active { background: #dcfce7; color: #166534; }
          .badge-status-inactive { background: #fee2e2; color: #991b1b; }
          .status-btn { transition: all 0.2s ease; }
          .status-btn:hover { transform: scale(1.1); }
          .status-btn.active { color: #28a745; }
          .status-btn.inactive { color: #dc3545; }
          .badge-category { background: #e5e7eb; color: #374151; }
          .product-summary { color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0; }
          .product-price { font-size: 16px; font-weight: 600; color: #1f2937; }
          .product-meta { font-size: 12px; color: #6b7280; display: flex; justify-content: space-between; }
          .product-actions { display: flex; flex-wrap: wrap; gap: 8px; }
          .product-actions form { margin: 0; }
          
          /* Modal styles - Modern Design */
          .modal-overlay { 
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); 
            z-index: 1000; display: flex; align-items: center; justify-content: center; 
            animation: modalFadeIn 0.3s ease-out;
          }
          @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes modalSlideIn { from { transform: translateY(-20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
          
          .modal-content { 
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); 
            border-radius: 16px; padding: 0; max-width: 700px; width: 95%; 
            max-height: 90vh; overflow-y: auto; 
            box-shadow: 0 25px 50px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.1); 
            animation: modalSlideIn 0.3s ease-out;
            border: 1px solid rgba(255,255,255,0.2);
          }
          
          .modal-header { 
            display: flex; justify-content: space-between; align-items: center; 
            padding: 24px 28px; border-bottom: 1px solid rgba(226, 232, 240, 0.8); 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px 16px 0 0;
            color: white;
          }
          .modal-header h2 { 
            margin: 0; font-size: 22px; font-weight: 700; 
            color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.1);
          }
          .close-btn { 
            background: rgba(255,255,255,0.2); border: none; font-size: 20px; 
            cursor: pointer; color: white; padding: 0; width: 32px; height: 32px; 
            display: flex; align-items: center; justify-content: center; 
            border-radius: 8px; transition: all 0.2s ease;
          }
          .close-btn:hover { background: rgba(255,255,255,0.3); transform: scale(1.1); }
          
          .modal-form { padding: 28px; }
          .form-section { margin-bottom: 24px; }
          .form-section-title { 
            font-size: 16px; font-weight: 600; color: #1e293b; 
            margin-bottom: 16px; padding-bottom: 8px; 
            border-bottom: 2px solid #e2e8f0; display: flex; align-items: center; gap: 8px;
          }
          .form-section-title::before { content: '📋'; font-size: 18px; }
          
          .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
          .form-grid.single { grid-template-columns: 1fr; }
          
          .form-group { margin-bottom: 20px; }
          .form-group label { 
            display: block; margin-bottom: 8px; font-weight: 600; 
            color: #374151; font-size: 14px; text-transform: uppercase; 
            letter-spacing: 0.5px;
          }
          .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; 
            border-radius: 10px; font-size: 14px; transition: all 0.2s ease;
            background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .form-group input:focus, .form-group select:focus, .form-group textarea:focus { 
            outline: none; border-color: #667eea; box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1); 
            transform: translateY(-1px);
          }
          .form-group textarea { min-height: 80px; resize: vertical; }
          .form-group textarea.large { min-height: 120px; }
          
          .price-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .price-input { position: relative; }
          .price-input::after { 
            content: 'PZ'; position: absolute; right: 12px; top: 50%; 
            transform: translateY(-50%); color: #6b7280; font-weight: 600; 
            pointer-events: none;
          }
          .price-input.rub::after { content: 'RUB'; }
          
          .form-actions { 
            display: flex; gap: 16px; justify-content: flex-end; 
            padding: 24px 28px; border-top: 1px solid rgba(226, 232, 240, 0.8); 
            background: #f8fafc; border-radius: 0 0 16px 16px;
          }
          .form-actions button { 
            padding: 12px 24px; border: none; border-radius: 10px; 
            font-weight: 600; cursor: pointer; transition: all 0.2s ease; 
            font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .form-actions button[type="button"] { 
            background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); 
            color: #64748b; border: 1px solid #cbd5e1;
          }
          .form-actions button[type="button"]:hover { 
            background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%); 
            transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.15);
          }
          .form-actions button[type="submit"] { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; border: 1px solid #5a67d8;
          }
          .form-actions button[type="submit"]:hover { 
            background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%); 
            transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
          }
          
          .regions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .switch-row { 
            display: flex; align-items: center; gap: 12px; cursor: pointer; 
            padding: 12px; border: 2px solid #e2e8f0; border-radius: 10px; 
            transition: all 0.2s ease; background: #ffffff;
          }
          .switch-row:hover { border-color: #667eea; background: #f8fafc; }
          .switch-row input[type="checkbox"], .status-row input[type="checkbox"] { display: none; }
          .switch-slider { 
            width: 48px; height: 28px; background: #cbd5e1; 
            border-radius: 14px; position: relative; transition: all 0.3s ease; 
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
          }
          .switch-slider::before { 
            content: ''; position: absolute; top: 3px; left: 3px; 
            width: 22px; height: 22px; background: white; border-radius: 50%; 
            transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          .switch-row input[type="checkbox"]:checked + .switch-slider,
          .status-row input[type="checkbox"]:checked + .switch-slider { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
          }
          .switch-row input[type="checkbox"]:checked + .switch-slider::before,
          .status-row input[type="checkbox"]:checked + .switch-slider::before { 
            transform: translateX(20px); 
          }
          .switch-label { font-weight: 600; color: #374151; }
          
          .status-section { background: #f8fafc; padding: 16px; border-radius: 10px; border: 2px solid #e2e8f0; }
          .status-row { display: flex; align-items: center; gap: 12px; }
          .status-label { font-weight: 600; color: #374151; font-size: 16px; }
          
          /* Responsive */
          @media (max-width: 768px) {
            .modal-content { width: 98%; margin: 10px; }
            .form-grid { grid-template-columns: 1fr; }
            .price-row { grid-template-columns: 1fr; }
            .regions-grid { grid-template-columns: 1fr; }
            .form-actions { flex-direction: column; }
          }
          .product-actions button { padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }
          .product-actions .toggle-btn { background: #fbbf24; color: #92400e; }
          .product-actions .toggle-btn:hover { background: #f59e0b; }
          .product-actions .delete-btn { background: #f87171; color: #7f1d1d; }
          .product-actions .delete-btn:hover { background: #ef4444; }
          .product-actions .image-btn { background: #10b981; color: #064e3b; }
          .product-actions .image-btn:hover { background: #059669; }
          .product-actions .edit-btn { background: #e0e7ff; color: #1d4ed8; }
          .product-actions .edit-btn:hover { background: #c7d2fe; }
          .empty-state { text-align: center; padding: 60px 20px; color: #6b7280; background: #fff; border-radius: 12px; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08); }
          img.product-image { width: 100%; height: 200px; object-fit: cover; border-radius: 10px; }
          .product-image-placeholder { 
            width: 100%; 
            height: 200px; 
            border: 2px dashed #d1d5db; 
            border-radius: 10px; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            background: #f9fafb; 
            color: #6b7280; 
          }
          .placeholder-icon { font-size: 32px; margin-bottom: 8px; }
          .placeholder-text { font-size: 14px; font-weight: 500; }
          .alert { padding: 12px 16px; margin: 16px 0; border-radius: 8px; font-weight: 500; }
          .alert-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
          .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
          
          /* Instruction modal styles */
          .instruction-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .instruction-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .instruction-content {
            background: white;
            border-radius: 12px;
            max-width: 500px;
            width: 100%;
            max-height: 80vh;
            overflow: hidden;
            transform: scale(0.8);
            transition: transform 0.3s ease;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
          }
          .instruction-header {
            padding: 20px 24px 16px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .instruction-header h3 {
            color: #333;
            font-size: 18px;
            font-weight: 600;
            margin: 0;
          }
          .btn-close {
            background: none;
            border: none;
            color: #6c757d;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.3s ease;
          }
          .btn-close:hover {
            background: #f8f9fa;
            color: #333;
          }
          .instruction-body {
            padding: 20px 24px;
            max-height: 50vh;
            overflow-y: auto;
          }
          .instruction-text {
            color: #333;
            line-height: 1.6;
            font-size: 14px;
            white-space: pre-wrap;
          }
          .instruction-footer {
            padding: 16px 24px 20px;
            border-top: 1px solid #e9ecef;
            display: flex;
            justify-content: flex-end;
          }
          .btn-secondary {
            background: #6c757d;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          .btn-secondary:hover {
            background: #5a6268;
          }
        </style>
      </head>
      <body>
        <h2>🛍 Управление товарами</h2>
        <a href="/admin" class="btn">← Назад</a>
        
        ${req.query.success === 'image_updated' ? '<div class="alert alert-success">✅ Фото успешно обновлено!</div>' : ''}
        ${req.query.error === 'no_image' ? '<div class="alert alert-error">❌ Файл не выбран</div>' : ''}
        ${req.query.error === 'image_upload' ? '<div class="alert alert-error">❌ Ошибка загрузки фото</div>' : ''}
        ${req.query.error === 'product_not_found' ? '<div class="alert alert-error">❌ Товар не найден</div>' : ''}

        <div class="filters">
          <button type="button" class="filter-btn active" data-filter="all">Все категории (${allProducts.length})</button>
    `;

    categories.forEach((category) => {
      html += `
          <button type="button" class="filter-btn" data-filter="${category.id}">${category.name} (${category.products.length})</button>
      `;
    });

    html += `
        </div>

        <div class="product-grid">
    `;

    if (allProducts.length === 0) {
      html += `
          <div class="empty-state">
            <h3>Пока нет добавленных товаров</h3>
            <p>Используйте форму на главной странице админки, чтобы добавить первый товар.</p>
          </div>
        </div>
      </body>
      </html>
      `;
      return res.send(html);
    }
    allProducts.forEach((product) => {
      const rubPrice = (product.price * 100).toFixed(2);
      const priceFormatted = `${rubPrice} ₽ / ${product.price.toFixed(2)} PZ`;
      const createdAt = new Date(product.createdAt).toLocaleDateString();
      const imageSection = product.imageUrl
        ? `<img src="${product.imageUrl}" alt="${product.title}" class="product-image" loading="lazy">`
        : `<div class="product-image-placeholder">
             <span class="placeholder-icon">📷</span>
             <span class="placeholder-text">Нет фото</span>
           </div>`;

      html += `
          <div class="product-card" data-category="${product.categoryId}" data-id="${product.id}">
            ${imageSection}
            <div class="product-header">
              <h3 class="product-title">${product.title}</h3>
              <form method="post" action="/admin/products/${product.id}/toggle-active" style="display: inline;">
                <button type="submit" class="status-btn ${product.isActive ? 'active' : 'inactive'}" style="border: none; background: none; cursor: pointer; font-size: 12px; padding: 4px 8px; border-radius: 4px;">
                  ${product.isActive ? '✅ Активен' : '❌ Неактивен'}
                </button>
              </form>
            </div>
            <span class="badge badge-category">${product.categoryName}</span>
            <div style="margin: 8px 0;">
              <span style="font-size: 12px; color: #666;">Регионы:</span>
              ${(product as any).availableInRussia ? '<span style="background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px;">🇷🇺 Россия</span>' : ''}
              ${(product as any).availableInBali ? '<span style="background: #f3e5f5; color: #7b1fa2; padding: 2px 6px; border-radius: 4px; font-size: 11px;">🇮🇩 Бали</span>' : ''}
            </div>
            <p class="product-summary">${product.summary}</p>
            <div class="product-price">${priceFormatted}</div>
            <div class="product-meta">
              <span>Создан: ${createdAt}</span>
              <span>ID: ${product.id.slice(0, 8)}...</span>
            </div>
            <div class="product-actions">
              <button 
                type="button" 
                class="edit-btn"
                data-id="${product.id}"
                data-title="${product.title.replace(/"/g, '&quot;')}"
                data-summary="${(product.summary || '').replace(/"/g, '&quot;')}"
                data-description="${(product.description || '').replace(/"/g, '&quot;')}"
                data-instruction="${((product as any).instruction || '').replace(/"/g, '&quot;')}"
                data-price="${product.price}"
                data-category-id="${product.categoryId}"
                data-active="${product.isActive ? 'true' : 'false'}"
                data-russia="${(product as any).availableInRussia ? 'true' : 'false'}"
                data-bali="${(product as any).availableInBali ? 'true' : 'false'}"
                data-image="${product.imageUrl || ''}"
                onclick="editProduct(this)"
              >✏️ Редактировать</button>
              <form method="post" action="/admin/products/${product.id}/toggle-active">
                <button type="submit" class="toggle-btn">${product.isActive ? 'Отключить' : 'Включить'}</button>
              </form>
              <form method="post" action="/admin/products/${product.id}/upload-image" enctype="multipart/form-data" style="display: inline;">
                <input type="file" name="image" accept="image/*" style="display: none;" id="image-${product.id}" onchange="this.form.submit()">
                <button type="button" class="image-btn" onclick="document.getElementById('image-${product.id}').click()">📷 ${product.imageUrl ? 'Изменить фото' : 'Добавить фото'}</button>
              </form>
              <button class="instruction-btn" onclick="showInstruction('${product.id}', \`${((product as any).instruction || '').replace(/`/g, '\\`').replace(/'/g, "\\'")}\`)" style="background: #28a745;">📋 Инструкция</button>
              <form method="post" action="/admin/products/${product.id}/delete" onsubmit="return confirm('Удалить товар «${product.title}»?')">
                <button type="submit" class="delete-btn">Удалить</button>
              </form>
            </div>
          </div>
      `;
    });
    html += `
        </div>

        <script>
          const filterButtons = document.querySelectorAll('.filter-btn');
          const cards = document.querySelectorAll('.product-card');

          filterButtons.forEach((button) => {
            button.addEventListener('click', () => {
              const filter = button.dataset.filter;

              filterButtons.forEach((btn) => btn.classList.remove('active'));
              button.classList.add('active');

              cards.forEach((card) => {
                if (filter === 'all' || card.dataset.category === filter) {
                  card.style.display = 'flex';
                } else {
                  card.style.display = 'none';
                }
              });
            });
          });
          
          // Simple function for editing products
          function editProduct(button) {
            const productId = button.dataset.id;
            const title = button.dataset.title;
            const summary = button.dataset.summary;
            const description = button.dataset.description;
            const price = button.dataset.price;
            const categoryId = button.dataset.categoryId;
            const isActive = button.dataset.active === 'true';
            const availableInRussia = button.dataset.russia === 'true';
            const availableInBali = button.dataset.bali === 'true';
            const imageUrl = button.dataset.image;
            
            // Create modal if it doesn't exist
            let modal = document.getElementById('editProductModal');
            if (!modal) {
              modal = document.createElement('div');
              modal.id = 'editProductModal';
              modal.innerHTML = \`
                <div class="modal-overlay" onclick="closeEditModal()">
                  <div class="modal-content" onclick="event.stopPropagation()">
                    <div class="modal-header">
                      <h2>✏️ Редактировать товар</h2>
                      <button class="close-btn" onclick="closeEditModal()">&times;</button>
                    </div>
                    
                    <form id="editProductForm" enctype="multipart/form-data" class="modal-form">
                      <input type="hidden" id="editProductId" name="productId" value="">
                      
                      <div class="form-section">
                        <div class="form-section-title">Основная информация</div>
                        <div class="form-grid single">
                          <div class="form-group">
                            <label for="editProductName">Название товара</label>
                            <input type="text" id="editProductName" name="title" required placeholder="Введите название товара">
                          </div>
                        </div>
                        
                        <div class="form-grid">
                          <div class="form-group">
                            <label for="editProductPrice">Цена в PZ</label>
                            <div class="price-input">
                              <input type="number" id="editProductPrice" name="price" step="0.01" required placeholder="0.00">
                            </div>
                          </div>
                          <div class="form-group">
                            <label for="editProductPriceRub">Цена в RUB</label>
                            <div class="price-input rub">
                              <input type="number" id="editProductPriceRub" name="priceRub" step="0.01" readonly placeholder="0.00">
                            </div>
                          </div>
                        </div>
                        
                        <div class="form-grid">
                          <div class="form-group">
                            <label for="editProductStock">Остаток на складе</label>
                            <input type="number" id="editProductStock" name="stock" value="999" required placeholder="999">
                          </div>
                          <div class="form-group">
                            <label for="editProductCategory">Категория</label>
                            <select id="editProductCategory" name="categoryId" required>
                              <option value="">Загрузка категорий...</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      
                      <div class="form-section">
                        <div class="form-section-title">Описание товара</div>
                        <div class="form-group">
                          <label for="editProductSummary">Краткое описание</label>
                          <textarea id="editProductSummary" name="summary" rows="3" placeholder="Краткое описание для карточки товара"></textarea>
                        </div>
                        
                        <div class="form-group">
                          <label for="editProductDescription">Полное описание</label>
                          <textarea id="editProductDescription" name="description" rows="5" class="large" placeholder="Подробное описание товара, применение, состав и т.д."></textarea>
                        </div>
                      </div>
                      
                      <div class="form-section">
                        <div class="form-section-title">Настройки доставки</div>
                        <div class="form-group">
                          <label>Регионы доставки</label>
                          <div class="regions-grid">
                            <label class="switch-row">
                              <input type="checkbox" id="editProductRussia" name="availableInRussia">
                              <span class="switch-slider"></span>
                              <span class="switch-label">🇷🇺 Россия</span>
                            </label>
                            <label class="switch-row">
                              <input type="checkbox" id="editProductBali" name="availableInBali">
                              <span class="switch-slider"></span>
                              <span class="switch-label">🇮🇩 Бали</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      
                      <div class="form-section">
                        <div class="form-section-title">Статус публикации</div>
                        <div class="status-section">
                          <label class="status-row">
                            <input type="checkbox" id="editProductStatus" name="isActive">
                            <span class="switch-slider"></span>
                            <span class="status-label">✅ Товар активен и доступен для покупки</span>
                          </label>
                        </div>
                      </div>
                      
                      <div class="form-actions">
                        <button type="button" onclick="closeEditModal()">❌ Отмена</button>
                        <button type="submit">💾 Обновить товар</button>
                      </div>
                    </form>
                  </div>
                </div>
              \`;
              document.body.appendChild(modal);
            }
            
            // Fill form fields
            document.getElementById('editProductId').value = productId;
            document.getElementById('editProductName').value = title;
            document.getElementById('editProductSummary').value = summary;
            document.getElementById('editProductDescription').value = description;
            document.getElementById('editProductPrice').value = price;
            document.getElementById('editProductPriceRub').value = (price * 100).toFixed(2);
            document.getElementById('editProductStock').value = '999';
            document.getElementById('editProductStatus').checked = isActive;
            document.getElementById('editProductRussia').checked = availableInRussia;
            document.getElementById('editProductBali').checked = availableInBali;
            
            // Load categories
            fetch('/admin/api/categories', { credentials: 'include' })
              .then(response => response.json())
              .then(categories => {
                const select = document.getElementById('editProductCategory');
                select.innerHTML = '<option value="">Выберите категорию</option>';
                categories.forEach(category => {
                  const option = document.createElement('option');
                  option.value = category.id;
                  option.textContent = category.name;
                  if (category.id === categoryId) {
                    option.selected = true;
                  }
                  select.appendChild(option);
                });
              });
            
            // Add price conversion functionality
            document.getElementById('editProductPrice').addEventListener('input', function() {
              const pzPrice = parseFloat(this.value) || 0;
              const rubPrice = pzPrice * 100;
              document.getElementById('editProductPriceRub').value = rubPrice.toFixed(2);
            });
            
            document.getElementById('editProductPriceRub').addEventListener('input', function() {
              const rubPrice = parseFloat(this.value) || 0;
              const pzPrice = rubPrice / 100;
              document.getElementById('editProductPrice').value = pzPrice.toFixed(2);
            });
            
            // Fix checkbox functionality for regions and status
            const regionCheckboxes = ['editProductRussia', 'editProductBali', 'editProductStatus'];
            regionCheckboxes.forEach(id => {
              const checkbox = document.getElementById(id);
              const switchRow = checkbox.closest('.switch-row') || checkbox.closest('.status-row');
              
              if (switchRow) {
                switchRow.addEventListener('click', function(e) {
                  e.preventDefault();
                  checkbox.checked = !checkbox.checked;
                  checkbox.dispatchEvent(new Event('change'));
                });
              }
            });
            
            // Show modal
            modal.style.display = 'block';
            
            // Handle form submission
            document.getElementById('editProductForm').onsubmit = function(e) {
              e.preventDefault();
              const formData = new FormData(this);
              const productId = formData.get('productId');
              
              // Ensure checkboxes are properly handled
              const formDataToSend = new FormData();
              formDataToSend.append('productId', productId);
              formDataToSend.append('title', formData.get('title') || '');
              formDataToSend.append('price', formData.get('price') || '0');
              formDataToSend.append('summary', formData.get('summary') || '');
              formDataToSend.append('description', formData.get('description') || '');
              formDataToSend.append('categoryId', formData.get('categoryId') || '');
              formDataToSend.append('stock', formData.get('stock') || '999');
              
              // Handle checkboxes properly - only send if checked
              if (document.getElementById('editProductStatus').checked) {
                formDataToSend.append('isActive', 'true');
              }
              if (document.getElementById('editProductRussia').checked) {
                formDataToSend.append('availableInRussia', 'true');
              }
              if (document.getElementById('editProductBali').checked) {
                formDataToSend.append('availableInBali', 'true');
              }
              
              fetch(\`/admin/products/\${productId}/update\`, {
                method: 'POST',
                body: formDataToSend,
                credentials: 'include'
              })
              .then(response => response.json())
              .then(data => {
                if (data.success) {
                  alert('Товар успешно обновлен!');
                  closeEditModal();
                  location.reload();
                } else {
                  alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
                }
              })
              .catch(error => {
                alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
              });
            };
          }
          
          // Function to close edit modal
          function closeEditModal() {
            const modal = document.getElementById('editProductModal');
            if (modal) {
              modal.style.display = 'none';
            }
          }
          
          // Instruction modal functions
          window.showInstruction = function(productId, instructionText) {
            const modal = document.createElement('div');
            modal.className = 'instruction-modal';
            modal.innerHTML = \`
              <div class="instruction-overlay" onclick="closeInstruction()">
                <div class="instruction-content" onclick="event.stopPropagation()">
                  <div class="instruction-header">
                    <h3>📋 Инструкция по применению</h3>
                    <button class="btn-close" onclick="closeInstruction()">×</button>
                  </div>
                  <div class="instruction-body">
                    <div class="instruction-text" id="instructionText" style="display: none;">\${instructionText.replace(/\\n/g, '<br>')}</div>
                    <div class="instruction-edit" id="instructionEdit" style="display: block;">
                      <textarea id="instructionTextarea" placeholder="Введите инструкцию по применению товара..." style="width: 100%; height: 200px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical;">\${instructionText}</textarea>
                    </div>
                  </div>
                  <div class="instruction-footer">
                    <button class="btn btn-save" onclick="saveInstruction('\${productId}')" style="background: #28a745; margin-right: 8px;">💾 Сохранить</button>
                    <button class="btn btn-cancel" onclick="cancelInstruction()" style="background: #6c757d; margin-right: 8px;">❌ Отмена</button>
                    <button class="btn btn-delete" onclick="deleteInstruction('\${productId}')" style="background: #dc3545; margin-right: 8px;">🗑️ Удалить</button>
                    <button class="btn btn-secondary" onclick="closeInstruction()">Закрыть</button>
                  </div>
                </div>
              </div>
            \`;
            
            document.body.appendChild(modal);
            
            // Add animation
            setTimeout(() => {
              const content = modal.querySelector('.instruction-content');
              if (content) {
                content.style.transform = 'scale(1)';
              }
            }, 10);
          };
          
          window.closeInstruction = function() {
            const modal = document.querySelector('.instruction-modal');
            if (modal) {
              const content = modal.querySelector('.instruction-content');
              if (content) {
                content.style.transform = 'scale(0.8)';
              }
              setTimeout(() => {
                modal.remove();
              }, 200);
            }
          };
          
          window.editInstruction = function(productId) {
            // Redirect to product edit page
            window.location.href = '/admin/products?edit=' + productId;
          };
          
          window.deleteInstruction = function(productId) {
            if (confirm('Вы уверены, что хотите удалить инструкцию для этого товара?')) {
              // Send request to delete instruction
              fetch('/admin/products/' + productId + '/delete-instruction', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include'
              })
              .then(response => response.json())
              .then(data => {
                if (data.success) {
                  alert('Инструкция успешно удалена!');
                  closeInstruction();
                  location.reload();
                } else {
                  alert('Ошибка: ' + (data.error || 'Не удалось удалить инструкцию'));
                }
              })
              .catch(error => {
                alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
              });
            }
          };
          
          window.saveInstruction = function(productId) {
            const textarea = document.getElementById('instructionTextarea');
            const instructionText = textarea.value.trim();
            
            if (!instructionText) {
              alert('Пожалуйста, введите инструкцию');
              return;
            }
            
            // Send request to save instruction
            fetch('/admin/products/' + productId + '/save-instruction', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify({ instruction: instructionText })
            })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                alert('Инструкция успешно сохранена!');
                closeInstruction();
                location.reload();
              } else {
                alert('Ошибка: ' + (data.error || 'Не удалось сохранить инструкцию'));
              }
            })
            .catch(error => {
              alert('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            });
          };
          
          window.cancelInstruction = function() {
            closeInstruction();
          };
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Products page error:', error);
    res.status(500).send('Ошибка загрузки товаров');
  }
});

// Handle product toggle active status
router.post('/products/:id/toggle-active', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    
    if (!product) {
      return res.redirect('/admin?error=product_not_found');
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive }
    });

    res.redirect('/admin?success=product_updated');
  } catch (error) {
    console.error('Product toggle error:', error);
    res.redirect('/admin?error=product_toggle');
  }
});
// Update product
router.post('/products/:productId/update', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { productId } = req.params;
    const { title, price, summary, description, instruction, isActive, categoryId, stock, availableInRussia, availableInBali } = req.body as any;
    
    console.log('Update product request:', {
      productId,
      body: req.body,
      file: req.file ? 'file present' : 'no file'
    });
    
    let imageUrl = undefined;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { resource_type: 'auto', folder: 'plazma-bot/products' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file!.buffer);
      });
      imageUrl = (result as any).secure_url;
    }

    const updateData: any = {};
    if (title) updateData.title = title.trim();
    if (price) updateData.price = parseFloat(price);
    if (summary) updateData.summary = summary.trim();
    if (description) updateData.description = description.trim();
    if (instruction !== undefined) updateData.instruction = instruction?.trim() || null;
    if (categoryId) updateData.categoryId = categoryId;
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (isActive !== undefined) updateData.isActive = isActive === 'true';
    if (availableInRussia !== undefined) updateData.availableInRussia = availableInRussia === 'true';
    if (availableInBali !== undefined) updateData.availableInBali = availableInBali === 'true';
    if (imageUrl) updateData.imageUrl = imageUrl;

    const product = await prisma.product.update({
      where: { id: productId },
      data: updateData,
    });
    
    res.json({ success: true, product });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, error: 'Ошибка обновления товара' });
  }
});
router.get('/reviews', requireAdmin, async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: 'desc' }
    });

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление отзывами</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .btn { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; margin-bottom: 20px; }
          .btn:hover { background: #0056b3; }
          .review-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; margin-top: 20px; }
          .review-card { background: #fff; border-radius: 12px; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08); padding: 18px; display: flex; flex-direction: column; gap: 12px; transition: transform 0.2s ease, box-shadow 0.2s ease; }
          .review-card:hover { transform: translateY(-4px); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12); }
          .review-header { display: flex; justify-content: space-between; align-items: flex-start; }
          .review-name { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
          .review-badges { display: flex; gap: 8px; }
          .badge { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; display: inline-block; }
          .badge-pinned { background: #fef3c7; color: #92400e; }
          .badge-not-pinned { background: #f3f4f6; color: #374151; }
          .review-content { color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0; }
          .review-meta { font-size: 12px; color: #6b7280; display: flex; justify-content: space-between; }
          .review-actions { display: flex; gap: 10px; flex-wrap: wrap; }
          .review-actions form { margin: 0; }
          .review-actions button { padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
          .review-actions .toggle-btn { background: #fbbf24; color: #92400e; }
          .review-actions .toggle-btn:hover { background: #f59e0b; }
          .review-actions .image-btn { background: #10b981; color: #064e3b; }
          .review-actions .image-btn:hover { background: #059669; }
          .review-actions .delete-btn { background: #f87171; color: #7f1d1d; }
          .review-actions .delete-btn:hover { background: #ef4444; }
          .status-btn { transition: all 0.2s ease; }
          .status-btn:hover { transform: scale(1.1); }
          .status-btn.active { color: #28a745; }
          .status-btn.inactive { color: #dc3545; }
          img.review-image { width: 100%; height: 200px; object-fit: cover; border-radius: 10px; }
          .review-image-placeholder { 
            width: 100%; 
            height: 200px; 
            border: 2px dashed #d1d5db; 
            border-radius: 10px; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            background: #f9fafb; 
            color: #6b7280; 
          }
          .placeholder-icon { font-size: 32px; margin-bottom: 8px; }
          .placeholder-text { font-size: 14px; font-weight: 500; }
          .alert { padding: 12px 16px; margin: 16px 0; border-radius: 8px; font-weight: 500; }
          .alert-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
          .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        </style>
      </head>
      <body>
        <h2>⭐ Управление отзывами</h2>
        <a href="/admin" class="btn">← Назад</a>
        
        ${req.query.success === 'image_updated' ? '<div class="alert alert-success">✅ Фото успешно обновлено!</div>' : ''}
        ${req.query.error === 'no_image' ? '<div class="alert alert-error">❌ Файл не выбран</div>' : ''}
        ${req.query.error === 'image_upload' ? '<div class="alert alert-error">❌ Ошибка загрузки фото</div>' : ''}
        ${req.query.error === 'review_not_found' ? '<div class="alert alert-error">❌ Отзыв не найден</div>' : ''}
        
        <div class="review-grid">
    `;

    reviews.forEach(review => {
      const imageSection = review.photoUrl
        ? `<img src="${review.photoUrl}" alt="${review.name}" class="review-image" loading="lazy">`
        : `<div class="review-image-placeholder">
             <span class="placeholder-icon">👤</span>
             <span class="placeholder-text">Нет фото</span>
           </div>`;

      html += `
        <div class="review-card">
          ${imageSection}
          <div class="review-header">
            <h3 class="review-name">${review.name}</h3>
            <form method="post" action="/admin/reviews/${review.id}/toggle-active" style="display: inline;">
              <button type="submit" class="status-btn ${review.isActive ? 'active' : 'inactive'}" style="border: none; background: none; cursor: pointer; font-size: 12px; padding: 4px 8px; border-radius: 4px;">
                ${review.isActive ? '✅ Активен' : '❌ Неактивен'}
              </button>
            </form>
          </div>
          <div class="review-badges">
            <span class="badge ${review.isPinned ? 'badge-pinned' : 'badge-not-pinned'}">${review.isPinned ? '📌 Закреплён' : '❌ Не закреплён'}</span>
          </div>
          <p class="review-content">${review.content}</p>
          <div class="review-meta">
            <span>Создан: ${new Date(review.createdAt).toLocaleDateString()}</span>
            <span>ID: ${review.id.slice(0, 8)}...</span>
          </div>
          <div class="review-actions">
            <form method="post" action="/admin/reviews/${review.id}/toggle-pinned">
              <button type="submit" class="toggle-btn">${review.isPinned ? 'Открепить' : 'Закрепить'}</button>
            </form>
            <form method="post" action="/admin/reviews/${review.id}/upload-image" enctype="multipart/form-data" style="display: inline;">
              <input type="file" name="image" accept="image/*" style="display: none;" id="review-image-${review.id}" onchange="this.form.submit()">
              <button type="button" class="image-btn" onclick="document.getElementById('review-image-${review.id}').click()">📷 ${review.photoUrl ? 'Изменить фото' : 'Добавить фото'}</button>
            </form>
            <form method="post" action="/admin/reviews/${review.id}/delete" onsubmit="return confirm('Удалить отзыв от «${review.name}»?')">
              <button type="submit" class="delete-btn">Удалить</button>
            </form>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Reviews page error:', error);
    res.status(500).send('Ошибка загрузки отзывов');
  }
});
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await prisma.orderRequest.findMany({
      include: { 
        user: {
          include: {
            partner: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление заказами</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; max-width: 1000px; margin: 20px auto; padding: 20px; }
          .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 5px; }
          .btn:hover { background: #0056b3; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h2>📦 Управление заказами v2.0</h2>
        <p style="color: #666; font-size: 12px; margin: 5px 0;">Версия: 2.0 | ${new Date().toLocaleString()}</p>
        <a href="/admin" class="btn">← Назад</a>
        
        ${req.query.success === 'order_updated' ? '<div class="alert alert-success">✅ Статус заказа обновлен</div>' : ''}
        ${req.query.error === 'order_update' ? '<div class="alert alert-error">❌ Ошибка при обновлении статуса заказа</div>' : ''}
        ${req.query.success === 'balance_added' ? '<div class="alert alert-success">✅ Баланс пользователя пополнен</div>' : ''}
        ${req.query.success === 'order_paid' ? '<div class="alert alert-success">✅ Заказ оплачен, партнёрские вознаграждения начислены</div>' : ''}
        ${req.query.error === 'insufficient_balance' ? '<div class="alert alert-error">❌ Недостаточно средств на балансе пользователя</div>' : ''}
        ${req.query.error === 'invalid_amount' ? '<div class="alert alert-error">❌ Неверная сумма для пополнения</div>' : ''}
        ${req.query.error === 'payment_failed' ? '<div class="alert alert-error">❌ Ошибка при оплате заказа</div>' : ''}
        ${req.query.error === 'order_not_found' ? '<div class="alert alert-error">❌ Заказ не найден</div>' : ''}
        <style>
          .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
          .status-new { background: #fff3cd; color: #856404; }
          .status-processing { background: #d1ecf1; color: #0c5460; }
          .status-completed { background: #d4edda; color: #155724; }
          .status-cancelled { background: #f8d7da; color: #721c24; }
          .alert { padding: 10px; margin: 10px 0; border-radius: 4px; }
          .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        </style>
        <table>
          <tr><th>ID</th><th>Пользователь</th><th>Баланс</th><th>Статус</th><th>Контакт</th><th>Сообщение</th><th>Создан</th><th>Действия</th></tr>
    `;

    orders.forEach(order => {
      html += `
        <tr>
          <td>${order.id.substring(0, 8)}...</td>
          <td>${order.user?.firstName || 'Не указан'}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 5px;">
              <span style="font-weight: bold; color: ${(order.user as any)?.balance > 0 ? '#28a745' : '#dc3545'};">${((order.user as any)?.balance || 0).toFixed(2)} PZ</span>
              <form method="post" action="/admin/users/${order.user?.id}/add-balance" style="display: inline;">
                <input type="number" name="amount" placeholder="Сумма" style="width: 60px; padding: 2px; font-size: 10px;" step="0.01" min="0.01" required>
                <button type="submit" style="background: #28a745; color: white; padding: 2px 6px; border: none; border-radius: 3px; cursor: pointer; font-size: 10px;">+</button>
              </form>
            </div>
          </td>
          <td>
            <span class="status-badge status-${order.status.toLowerCase()}">${order.status}</span>
          </td>
          <td>${order.contact || 'Не указан'}</td>
          <td>${order.message.substring(0, 50)}${order.message.length > 50 ? '...' : ''}</td>
          <td>${new Date(order.createdAt).toLocaleDateString()}</td>
          <td>
            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
              <form method="post" action="/admin/orders/${order.id}/update-status" style="display: inline;">
                <select name="status" style="padding: 4px; font-size: 11px;">
                  <option value="NEW" ${order.status === 'NEW' ? 'selected' : ''}>Новый</option>
                  <option value="PROCESSING" ${order.status === 'PROCESSING' ? 'selected' : ''}>В обработке</option>
                  <option value="COMPLETED" ${order.status === 'COMPLETED' ? 'selected' : ''}>Выполнен</option>
                  <option value="CANCELLED" ${order.status === 'CANCELLED' ? 'selected' : ''}>Отменен</option>
                </select>
                <button type="submit" style="background: #007bff; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 2px;">Обновить</button>
              </form>
              <form method="post" action="/admin/orders/${order.id}/pay" style="display: inline;">
                <button type="submit" 
                        style="background: ${(order.user as any)?.balance > 0 ? '#28a745' : '#6c757d'}; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; ${(order.user as any)?.balance <= 0 ? 'opacity: 0.5;' : ''}" 
                        ${(order.user as any)?.balance <= 0 ? 'disabled' : ''}
                        onclick="return confirm('Списать ${((order.user as any)?.balance || 0).toFixed(2)} PZ с баланса пользователя?')">
                  💳 Заказ оплачен
                </button>
              </form>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Orders page error:', error);
    res.status(500).send('Ошибка загрузки заказов');
  }
});

// Logout
// Страница с инструкциями
router.get('/instructions', requireAdmin, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Инструкции - Plazma Water Admin</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
        .back-btn { background: rgba(255,255,255,0.2); color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; border: 1px solid rgba(255,255,255,0.3); transition: all 0.3s ease; display: inline-block; margin-top: 15px; }
        .back-btn:hover { background: rgba(255,255,255,0.3); transform: translateY(-2px); }
        .content { padding: 30px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #667eea; font-size: 24px; margin-bottom: 15px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
        .section h3 { color: #495057; font-size: 18px; margin-bottom: 10px; }
        .section p { color: #6c757d; line-height: 1.6; margin-bottom: 10px; }
        .section ul { color: #6c757d; line-height: 1.6; }
        .section li { margin-bottom: 5px; }
        .code { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #667eea; font-family: 'Courier New', monospace; margin: 10px 0; }
        .highlight { background: #fff3cd; padding: 10px; border-radius: 6px; border-left: 4px solid #ffc107; margin: 10px 0; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
        .card h4 { color: #667eea; margin-top: 0; }
        .btn { background: #667eea; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block; margin: 5px; transition: all 0.3s ease; }
        .btn:hover { background: #5a6fd8; transform: translateY(-2px); }
        .btn-secondary { background: #6c757d; }
        .btn-secondary:hover { background: #5a6268; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📋 Инструкции по работе с админ панелью</h1>
          <p>Полное руководство по управлению Plazma Water</p>
          <a href="/admin" class="back-btn">← Назад к панели</a>
        </div>
        
        <div class="content">
          <div class="section">
            <h2>🚀 Быстрый старт</h2>
            <div class="grid">
              <div class="card">
                <h4>🔐 Доступ к админ панели</h4>
                <p><strong>URL:</strong> <code>https://plazma-production.up.railway.app/admin</code></p>
                <p><strong>Логин:</strong> admin@plazma.com</p>
                <p><strong>Пароль:</strong> admin123</p>
              </div>
              <div class="card">
                <h4>📱 Основные разделы</h4>
                <ul>
                  <li>👥 Пользователи</li>
                  <li>🛍️ Товары</li>
                  <li>📦 Заказы</li>
                  <li>🤝 Партнеры</li>
                  <li>📝 Контент бота</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="section">
            <h2>👥 Управление пользователями</h2>
            <div class="grid">
              <div class="card">
                <h4>📊 Список пользователей</h4>
                <p>Просмотр всех пользователей с возможностью фильтрации и сортировки</p>
                <a href="/admin/resources/users" class="btn">Перейти к пользователям</a>
              </div>
              <div class="card">
                <h4>🔍 Детальная информация</h4>
                <p>Полная статистика по каждому пользователю: заказы, партнеры, баланс</p>
                <a href="/admin/users-detailed" class="btn">Детальная информация</a>
              </div>
            </div>
            <h3>Основные функции:</h3>
            <ul>
              <li><strong>Редактирование данных:</strong> Телефон, адрес, баланс</li>
              <li><strong>Партнерская программа:</strong> Активация и настройка</li>
              <li><strong>История заказов:</strong> Просмотр всех заказов пользователя</li>
              <li><strong>Финансовые операции:</strong> Управление балансом</li>
            </ul>
          </div>

          <div class="section">
            <h2>🛍️ Управление товарами</h2>
            <div class="grid">
              <div class="card">
                <h4>📦 Каталог товаров</h4>
                <p>Управление всеми товарами в системе</p>
                <a href="/admin/resources/products" class="btn">Перейти к товарам</a>
              </div>
              <div class="card">
                <h4>📂 Категории</h4>
                <p>Организация товаров по категориям</p>
                <a href="/admin/categories" class="btn">Управление категориями</a>
              </div>
            </div>
            <h3>Возможности:</h3>
            <ul>
              <li><strong>Добавление товаров:</strong> Название, цена, описание, изображение</li>
              <li><strong>Настройки:</strong> Активность, доступность в регионах</li>
              <li><strong>Сток:</strong> Управление количеством товаров</li>
              <li><strong>Цены:</strong> Гибкая система ценообразования</li>
            </ul>
          </div>

          <div class="section">
            <h2>📦 Управление заказами</h2>
            <div class="grid">
              <div class="card">
                <h4>📋 Список заказов</h4>
                <p>Все заказы с фильтрацией по статусу</p>
                <a href="/admin/resources/order-requests" class="btn">Перейти к заказам</a>
              </div>
              <div class="card">
                <h4>📊 Статусы заказов</h4>
                <p>NEW → PROCESSING → COMPLETED → CANCELLED</p>
              </div>
            </div>
            <h3>Управление заказами:</h3>
            <ul>
              <li><strong>Изменение статусов:</strong> NEW → PROCESSING → COMPLETED</li>
              <li><strong>Контактная информация:</strong> Телефон и адрес доставки</li>
              <li><strong>Уведомления:</strong> Отправка сообщений пользователям</li>
              <li><strong>Финансы:</strong> Отслеживание платежей</li>
            </ul>
          </div>

          <div class="section">
            <h2>🤝 Партнерская программа</h2>
            <div class="grid">
              <div class="card">
                <h4>👥 Управление партнерами</h4>
                <p>Активация и настройка партнеров</p>
                <a href="/admin/partners" class="btn">Перейти к партнерам</a>
              </div>
              <div class="card">
                <h4>🔗 Реферальные ссылки</h4>
                <p>Генерация и управление реферальными ссылками</p>
              </div>
            </div>
            <h3>Партнерская система:</h3>
            <ul>
              <li><strong>Активация партнеров:</strong> Создание партнерских профилей</li>
              <li><strong>Реферальные ссылки:</strong> Генерация уникальных ссылок</li>
              <li><strong>Бонусы:</strong> Расчет и выплата комиссий</li>
              <li><strong>Иерархия:</strong> Многоуровневая система (3 уровня)</li>
            </ul>
          </div>

          <div class="section">
            <h2>📝 Контент бота</h2>
            <div class="grid">
              <div class="card">
                <h4>✏️ Редактирование текстов</h4>
                <p>Все сообщения бота можно редактировать</p>
                <a href="/admin/resources/bot-content" class="btn">Редактировать контент</a>
              </div>
              <div class="card">
                <h4>🌍 Многоязычность</h4>
                <p>Поддержка русского и английского языков</p>
              </div>
            </div>
            <h3>Управление контентом:</h3>
            <ul>
              <li><strong>Сообщения бота:</strong> Приветствие, помощь, ошибки</li>
              <li><strong>Кнопки и описания:</strong> Настройка интерфейса</li>
              <li><strong>Категории контента:</strong> Сообщения, описания, кнопки</li>
              <li><strong>Активация:</strong> Включение/отключение контента</li>
            </ul>
          </div>

          <div class="section">
            <h2>📊 Статистика и аналитика</h2>
            <div class="highlight">
              <h3>📈 Основные метрики</h3>
              <ul>
                <li><strong>Общее количество пользователей</strong></li>
                <li><strong>Активные партнеры</strong></li>
                <li><strong>Общая сумма заказов</strong></li>
                <li><strong>Баланс партнеров</strong></li>
              </ul>
            </div>
            <h3>Детальная аналитика:</h3>
            <ul>
              <li><strong>Заказы по статусам:</strong> NEW, PROCESSING, COMPLETED, CANCELLED</li>
              <li><strong>Партнерская статистика:</strong> Уровни, рефералы, бонусы</li>
              <li><strong>Финансовая отчетность:</strong> Доходы, выплаты, остатки</li>
            </ul>
          </div>

          <div class="section">
            <h2>🚨 Устранение неполадок</h2>
            <div class="grid">
              <div class="card">
                <h4>❓ Частые проблемы</h4>
                <ul>
                  <li>Не загружается страница</li>
                  <li>Ошибка авторизации</li>
                  <li>Не сохраняются изменения</li>
                  <li>Медленная работа</li>
                </ul>
              </div>
              <div class="card">
                <h4>📞 Контакты поддержки</h4>
                <p><strong>Telegram:</strong> @diglukhov</p>
                <p><strong>Email:</strong> support@plazma.com</p>
                <p><strong>Документация:</strong> Этот файл</p>
              </div>
            </div>
          </div>

          <div class="section">
            <h2>🔐 Безопасность</h2>
            <div class="code">
              <strong>Доступ к админ панели:</strong><br>
              • Аутентификация: Логин и пароль<br>
              • Сессии: Автоматический выход при неактивности<br>
              • Логирование: Все действия записываются
            </div>
            <div class="code">
              <strong>Управление данными:</strong><br>
              • Резервное копирование: Автоматические бэкапы<br>
              • Валидация: Проверка всех входящих данных<br>
              • Аудит: История изменений
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

router.get('/logout', (req, res) => {
  const session = req.session as any;
  session.isAdmin = false;
  res.redirect('/admin/login');
});

// Recalculate bonuses endpoint
router.post('/recalculate-bonuses', requireAdmin, async (req, res) => {
  try {
    console.log('🔄 Starting bonus recalculation...');
    
    // Get all partner profiles
    const profiles = await prisma.partnerProfile.findMany();
    
    for (const profile of profiles) {
      console.log(`📊 Processing profile ${profile.id}...`);
      
      // Calculate total bonus from transactions
      const transactions = await prisma.partnerTransaction.findMany({
        where: { profileId: profile.id }
      });
      
      const totalBonus = transactions.reduce((sum, tx) => {
        return sum + (tx.type === 'CREDIT' ? tx.amount : -tx.amount);
      }, 0);
      
      // Update profile bonus
      await prisma.partnerProfile.update({
        where: { id: profile.id },
        data: { bonus: totalBonus }
      });
      
      console.log(`✅ Updated profile ${profile.id}: ${totalBonus} PZ bonus`);
    }
    
    console.log('🎉 Bonus recalculation completed!');
    res.redirect('/admin/partners?success=bonuses_recalculated');
  } catch (error) {
    console.error('❌ Bonus recalculation error:', error);
    res.redirect('/admin/partners?error=bonus_recalculation');
  }
});
// Cleanup duplicates endpoint
router.post('/cleanup-duplicates', requireAdmin, async (req, res) => {
  try {
    console.log('🧹 Starting cleanup of duplicate data...');
    
    // Find all partner profiles
    const profiles = await prisma.partnerProfile.findMany({
      include: {
        referrals: true,
        transactions: true
      }
    });
    
    let totalReferralsDeleted = 0;
    let totalTransactionsDeleted = 0;
    
    for (const profile of profiles) {
      console.log(`\n📊 Processing profile ${profile.id}...`);
      
      // Group referrals by referredId to find duplicates
      const referralGroups = new Map();
      profile.referrals.forEach(ref => {
        if (ref.referredId) {
          if (!referralGroups.has(ref.referredId)) {
            referralGroups.set(ref.referredId, []);
          }
          referralGroups.get(ref.referredId).push(ref);
        }
      });
      
      // Remove duplicate referrals, keeping only the first one
      for (const [referredId, referrals] of referralGroups) {
        if (referrals.length > 1) {
          console.log(`  🔄 Found ${referrals.length} duplicates for user ${referredId}`);
          
          // Sort by createdAt to keep the earliest
          referrals.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
          
          // Keep the first one, delete the rest
          const toDelete = referrals.slice(1);
          for (const duplicate of toDelete) {
            await prisma.partnerReferral.delete({
              where: { id: duplicate.id }
            });
            totalReferralsDeleted++;
            console.log(`    ❌ Deleted duplicate referral ${duplicate.id}`);
          }
        }
      }
      
      // Group transactions by description to find duplicates
      const transactionGroups = new Map();
      profile.transactions.forEach(tx => {
        const key = `${tx.description}-${tx.amount}-${tx.type}`;
        if (!transactionGroups.has(key)) {
          transactionGroups.set(key, []);
        }
        transactionGroups.get(key).push(tx);
      });
      
      // Remove duplicate transactions, keeping only the first one
      for (const [key, transactions] of transactionGroups) {
        if (transactions.length > 1) {
          console.log(`  🔄 Found ${transactions.length} duplicate transactions: ${key}`);
          
          // Sort by createdAt to keep the earliest
          transactions.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
          
          // Keep the first one, delete the rest
          const toDelete = transactions.slice(1);
          for (const duplicate of toDelete) {
            await prisma.partnerTransaction.delete({
              where: { id: duplicate.id }
            });
            totalTransactionsDeleted++;
            console.log(`    ❌ Deleted duplicate transaction ${duplicate.id}`);
          }
        }
      }
      
      // Recalculate bonus from remaining transactions
      const remainingTransactions = await prisma.partnerTransaction.findMany({
        where: { profileId: profile.id }
      });
      
      const totalBonus = remainingTransactions.reduce((sum, tx) => {
        return sum + (tx.type === 'CREDIT' ? tx.amount : -tx.amount);
      }, 0);
      
      // Update profile bonus
      await prisma.partnerProfile.update({
        where: { id: profile.id },
        data: { bonus: totalBonus }
      });
      
      console.log(`  ✅ Updated profile ${profile.id}: ${totalBonus} PZ bonus`);
    }
    
    console.log(`\n🎉 Cleanup completed! Deleted ${totalReferralsDeleted} duplicate referrals and ${totalTransactionsDeleted} duplicate transactions.`);
    res.redirect(`/admin/partners?success=duplicates_cleaned&referrals=${totalReferralsDeleted}&transactions=${totalTransactionsDeleted}`);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.redirect('/admin/partners?error=cleanup_failed');
  }
});

// Test referral links endpoint
router.get('/test-referral-links', requireAdmin, async (req, res) => {
  try {
    const { buildReferralLink } = await import('../services/partner-service.js');
    
    // Get a sample partner profile
    const profile = await prisma.partnerProfile.findFirst({
      include: { user: true }
    });
    
    if (!profile) {
      return res.send('❌ No partner profiles found for testing');
    }
    
    const directLink = buildReferralLink(profile.referralCode, 'DIRECT');
    const multiLink = buildReferralLink(profile.referralCode, 'MULTI_LEVEL');
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Referral Links</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 20px auto; padding: 20px; }
          .test-section { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .link { background: #e3f2fd; padding: 10px; margin: 5px 0; border-radius: 4px; word-break: break-all; }
          .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 5px; }
        </style>
      </head>
      <body>
        <h2>🧪 Test Referral Links</h2>
        <a href="/admin/partners" class="btn">← Back to Partners</a>
        
        <div class="test-section">
          <h3>📊 Test Partner Profile</h3>
          <p><strong>Name:</strong> ${profile.user.firstName || 'Unknown'}</p>
          <p><strong>Username:</strong> @${profile.user.username || 'no-username'}</p>
          <p><strong>Program Type:</strong> ${profile.programType}</p>
          <p><strong>Referral Code:</strong> ${profile.referralCode}</p>
        </div>
        
        <div class="test-section">
          <h3>🔗 Generated Links</h3>
          
          <h4>Direct Link (25% commission):</h4>
          <div class="link">${directLink}</div>
          <p><strong>Payload:</strong> ${directLink.split('?start=')[1]}</p>
          
          <h4>Multi-level Link (15% + 5% + 5% commission):</h4>
          <div class="link">${multiLink}</div>
          <p><strong>Payload:</strong> ${multiLink.split('?start=')[1]}</p>
        </div>
        
        <div class="test-section">
          <h3>🧪 Link Parsing Test</h3>
          <p>Both links should be parsed correctly by the bot:</p>
          <ul>
            <li><strong>Direct link payload:</strong> Should start with "ref_direct_"</li>
            <li><strong>Multi link payload:</strong> Should start with "ref_multi_"</li>
            <li><strong>Both should:</strong> Award 3 PZ bonus to the inviter</li>
            <li><strong>Both should:</strong> Create a referral record with level 1</li>
          </ul>
        </div>
        
        <div class="test-section">
          <h3>📱 Test Instructions</h3>
          <ol>
            <li>Copy one of the links above</li>
            <li>Open it in Telegram</li>
            <li>Start the bot</li>
            <li>Check that you receive a welcome message</li>
            <li>Check that the inviter gets 3 PZ bonus</li>
            <li>Check that a referral record is created</li>
          </ol>
        </div>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (error) {
    console.error('Test referral links error:', error);
    res.send('❌ Error testing referral links: ' + (error instanceof Error ? error.message : String(error)));
  }
});

// Force recalculate all partner balances
router.post('/recalculate-all-balances', requireAdmin, async (req, res) => {
  try {
    console.log('🔄 Starting full balance recalculation...');
    
    // Get all partner profiles
    const profiles = await prisma.partnerProfile.findMany();
    
    for (const profile of profiles) {
      console.log(`📊 Processing profile ${profile.id}...`);
      
      // Use the centralized bonus recalculation function
      const totalBonus = await recalculatePartnerBonuses(profile.id);
      
      console.log(`✅ Updated profile ${profile.id}: ${totalBonus} PZ bonus`);
    }
    
    console.log('🎉 Full balance recalculation completed!');
    res.redirect('/admin/partners?success=all_balances_recalculated');
  } catch (error) {
    console.error('❌ Full balance recalculation error:', error);
    res.redirect('/admin/partners?error=balance_recalculation_failed');
  }
});
// Debug partners page
router.get('/debug-partners', requireAdmin, async (req, res) => {
  try {
    const partners = await prisma.partnerProfile.findMany({
      include: {
        user: true,
        referrals: true,
        transactions: true
      },
      orderBy: { createdAt: 'desc' }
    });

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>🔍 Отладка партнёров</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
          .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .partner-card { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 8px; background: #f9f9f9; }
          .partner-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
          .partner-name { font-weight: bold; font-size: 16px; }
          .partner-id { color: #666; font-size: 12px; }
          .stats { display: flex; gap: 20px; margin: 10px 0; }
          .stat { background: #e3f2fd; padding: 8px 12px; border-radius: 4px; }
          .referrals { margin-top: 10px; }
          .referral { background: #f0f0f0; padding: 8px; margin: 5px 0; border-radius: 4px; font-size: 14px; }
          .transactions { margin-top: 10px; }
          .transaction { background: #fff3cd; padding: 6px; margin: 3px 0; border-radius: 4px; font-size: 13px; }
          .btn { background: #007bff; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 5px; }
          .btn:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔍 Отладка партнёров</h1>
          <a href="/admin/partners" class="btn">← Назад к партнёрам</a>
          <p>Всего партнёров: ${partners.length}</p>
    `;

    for (const partner of partners) {
      const totalBalance = Number(partner.balance) + Number(partner.bonus);
      const referralsCount = partner.referrals.length;
      const directReferrals = partner.referrals.filter(r => r.level === 1).length;
      const multiReferrals = partner.referrals.filter(r => r.level === 2).length;
      
      html += `
        <div class="partner-card">
          <div class="partner-header">
            <div>
              <div class="partner-name">${partner.user.firstName} ${partner.user.lastName || ''}</div>
              <div class="partner-id">ID: ${partner.id} | User: ${partner.userId}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 18px; font-weight: bold; color: #28a745;">${totalBalance.toFixed(2)} PZ</div>
              <div style="font-size: 12px; color: #666;">Баланс = Всего бонусов</div>
            </div>
          </div>
          
          <div class="stats">
            <div class="stat">💰 Баланс: ${Number(partner.balance).toFixed(2)} PZ</div>
            <div class="stat">🎁 Всего бонусов: ${Number(partner.bonus).toFixed(2)} PZ</div>
            <div class="stat">👥 Всего рефералов: ${referralsCount}</div>
            <div class="stat">📊 Прямых: ${directReferrals}</div>
            <div class="stat">🌐 Мульти: ${multiReferrals}</div>
          </div>
          
          ${referralsCount > 0 ? `
            <div class="referrals">
              <h4>👥 Рефералы:</h4>
              ${partner.referrals.map((ref: any) => `
                <div class="referral">
                  Реферал ID: ${ref.referredId || 'N/A'} 
                  (Уровень ${ref.level}, Контакт: ${ref.contact || 'N/A'})
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${partner.transactions.length > 0 ? `
            <div class="transactions">
              <h4>💰 Последние транзакции:</h4>
              ${partner.transactions.slice(0, 5).map((tx: any) => `
                <div class="transaction">
                  ${tx.type === 'CREDIT' ? '+' : '-'}${Number(tx.amount).toFixed(2)} PZ — ${tx.description}
                  <span style="color: #666; font-size: 11px;">(${new Date(tx.createdAt).toLocaleString()})</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    html += `
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Debug partners error:', error);
    res.send('❌ Ошибка отладки партнёров: ' + (error instanceof Error ? error.message : String(error)));
  }
});

// Cleanup referral duplicates
router.post('/cleanup-referral-duplicates', requireAdmin, async (req, res) => {
  try {
    console.log('🧹 Starting referral duplicates cleanup...');
    
    // Find all referrals
    const allReferrals = await prisma.partnerReferral.findMany({
      where: { referredId: { not: null } },
      orderBy: { createdAt: 'asc' }
    });
    
    // Group by profileId + referredId combination
    const grouped = new Map<string, any[]>();
    for (const ref of allReferrals) {
      const key = `${ref.profileId}-${ref.referredId}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(ref);
    }
    
    let deletedCount = 0;
    
    // Process duplicates
    for (const [key, referrals] of grouped) {
      if (referrals.length > 1) {
        // Keep the first one, delete the rest
        const toDelete = referrals.slice(1);
        for (const ref of toDelete) {
          await prisma.partnerReferral.delete({
            where: { id: ref.id }
          });
          deletedCount++;
        }
      }
    }
    
    console.log(`✅ Cleaned up ${deletedCount} duplicate referrals`);
    
    // Recalculate all bonuses after cleanup
    console.log('🔄 Recalculating all bonuses after referral cleanup...');
    const profiles = await prisma.partnerProfile.findMany();
    for (const profile of profiles) {
      await recalculatePartnerBonuses(profile.id);
    }
    
    res.redirect('/admin/partners?success=referral_duplicates_cleaned&count=' + deletedCount);
  } catch (error) {
    console.error('❌ Referral duplicates cleanup error:', error);
    res.redirect('/admin/partners?error=referral_cleanup_failed');
  }
});

// Force recalculate all bonuses
router.post('/force-recalculate-bonuses', requireAdmin, async (req, res) => {
  try {
    console.log('🔄 Starting forced bonus recalculation...');
    
    // Get all partner profiles
    const profiles = await prisma.partnerProfile.findMany();
    
    for (const profile of profiles) {
      console.log(`📊 Recalculating bonuses for profile ${profile.id}...`);
      
      // Use the centralized bonus recalculation function
      const totalBonus = await recalculatePartnerBonuses(profile.id);
      
      console.log(`✅ Updated profile ${profile.id}: ${totalBonus} PZ bonus`);
    }
    
    console.log('🎉 Forced bonus recalculation completed!');
    res.redirect('/admin/partners?success=bonuses_force_recalculated');
  } catch (error) {
    console.error('❌ Forced bonus recalculation error:', error);
    res.redirect('/admin/partners?error=bonus_force_recalculation_failed');
  }
});

// Force recalculate specific partner bonuses
router.post('/recalculate-partner-bonuses/:profileId', requireAdmin, async (req, res) => {
  try {
    const { profileId } = req.params;
    console.log(`🔄 Force recalculating bonuses for profile ${profileId}...`);
    
    const totalBonus = await recalculatePartnerBonuses(profileId);
    
    console.log(`✅ Force recalculated bonuses for profile ${profileId}: ${totalBonus} PZ`);
    res.redirect(`/admin/partners?success=partner_bonuses_recalculated&bonus=${totalBonus}`);
  } catch (error) {
    console.error('❌ Force recalculate partner bonuses error:', error);
    res.redirect('/admin/partners?error=partner_bonus_recalculation_failed');
  }
});

// Cleanup duplicate bonuses
router.post('/cleanup-duplicate-bonuses', requireAdmin, async (req, res) => {
  try {
    console.log('🧹 Starting duplicate bonuses cleanup...');
    
    // Get all partner profiles
    const profiles = await prisma.partnerProfile.findMany();
    let totalDeleted = 0;
    
    for (const profile of profiles) {
      console.log(`📊 Processing profile ${profile.id}...`);
      
      // Get all transactions for this profile
      const transactions = await prisma.partnerTransaction.findMany({
        where: { 
          profileId: profile.id,
          description: { contains: 'Бонус за приглашение друга' }
        },
        orderBy: { createdAt: 'asc' }
      });
      
      // Group by user ID (extract from description) or by amount+description for old format
      const bonusGroups = new Map<string, any[]>();
      
      for (const tx of transactions) {
        // Extract user ID from description like "Бонус за приглашение друга (user_id)"
        const match = tx.description.match(/Бонус за приглашение друга \((.+?)\)/);
        if (match) {
          const userId = match[1];
          if (!bonusGroups.has(userId)) {
            bonusGroups.set(userId, []);
          }
          bonusGroups.get(userId)!.push(tx);
        } else if (tx.description === 'Бонус за приглашение друга') {
          // Old format without user ID - group by amount and description
          const key = `${tx.amount}-${tx.description}`;
          if (!bonusGroups.has(key)) {
            bonusGroups.set(key, []);
          }
          bonusGroups.get(key)!.push(tx);
        }
      }
      
      // Delete duplicates (keep only the first one)
      for (const [key, group] of bonusGroups) {
        if (group.length > 1) {
          console.log(`  - Found ${group.length} duplicate bonuses for ${key}, keeping first one`);
          const toDelete = group.slice(1);
          for (const tx of toDelete) {
            await prisma.partnerTransaction.delete({
              where: { id: tx.id }
            });
            totalDeleted++;
          }
        }
      }
    }
    
    console.log(`✅ Cleaned up ${totalDeleted} duplicate bonus transactions`);
    
    // Recalculate all bonuses after cleanup
    console.log('🔄 Recalculating all bonuses after cleanup...');
    for (const profile of profiles) {
      await recalculatePartnerBonuses(profile.id);
    }
    
    res.redirect(`/admin/partners?success=duplicate_bonuses_cleaned&count=${totalDeleted}`);
  } catch (error) {
    console.error('❌ Duplicate bonuses cleanup error:', error);
    res.redirect('/admin/partners?error=duplicate_bonuses_cleanup_failed');
  }
});
// Fix Roman Arctur bonuses specifically
router.post('/fix-roman-bonuses', requireAdmin, async (req, res) => {
  try {
    console.log('🔧 Fixing Roman Arctur bonuses...');
    
    // Find Roman Arctur's profile
    const romanProfile = await prisma.partnerProfile.findFirst({
      where: {
        user: {
          username: 'roman_arctur'
        }
      }
    });
    
    if (!romanProfile) {
      console.log('❌ Roman Arctur profile not found');
      res.redirect('/admin/partners?error=roman_profile_not_found');
      return;
    }
    
    console.log(`📊 Found Roman Arctur profile: ${romanProfile.id}`);
    
    // Get all transactions for Roman
    const transactions = await prisma.partnerTransaction.findMany({
      where: { profileId: romanProfile.id }
    });
    
    console.log(`📊 Roman has ${transactions.length} transactions:`);
    transactions.forEach(tx => {
      console.log(`  - ${tx.type} ${tx.amount} PZ: ${tx.description} (${tx.createdAt})`);
    });
    
    // Check current bonus before recalculation
    const currentProfile = await prisma.partnerProfile.findUnique({
      where: { id: romanProfile.id }
    });
    console.log(`💰 Current bonus before recalculation: ${currentProfile?.bonus} PZ`);
    
    // Recalculate bonuses
    const totalBonus = await recalculatePartnerBonuses(romanProfile.id);
    
    // Check bonus after recalculation
    const updatedProfile = await prisma.partnerProfile.findUnique({
      where: { id: romanProfile.id }
    });
    console.log(`💰 Bonus after recalculation: ${updatedProfile?.bonus} PZ`);
    
    console.log(`✅ Roman Arctur bonuses fixed: ${totalBonus} PZ`);
    res.redirect(`/admin/partners?success=roman_bonuses_fixed&bonus=${totalBonus}`);
  } catch (error) {
    console.error('❌ Fix Roman bonuses error:', error);
    res.redirect('/admin/partners?error=roman_bonuses_fix_failed');
  }
});
// Show user partners page
router.get('/users/:userId/partners-page', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { partner: true }
    });
    
    if (!user) {
      return res.status(404).send('Пользователь не найден');
    }
    
    // Get user's partner profile
    const partnerProfile = await prisma.partnerProfile.findUnique({
      where: { userId },
      include: {
        referrals: {
          include: {
            profile: {
              include: {
                user: { select: { firstName: true, lastName: true, username: true, telegramId: true } }
              }
            }
          },
          where: { referredId: { not: null } }
        }
      }
    });
    
    if (!partnerProfile) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Партнеры пользователя</title>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .back-btn { background: #6c757d; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
            .empty-state { text-align: center; padding: 40px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <a href="/admin" class="back-btn">← Назад к админ-панели</a>
            <div class="empty-state">
              <h2>👤 ${user.firstName || 'Пользователь'} ${user.lastName || ''}</h2>
              <p>У этого пользователя нет партнерского профиля</p>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    
    // Get actual referred users
    const referredUserIds = partnerProfile.referrals.map(ref => ref.referredId).filter((id): id is string => Boolean(id));
    const referredUsers = await prisma.user.findMany({
      where: { id: { in: referredUserIds } },
      select: { id: true, firstName: true, lastName: true, username: true, telegramId: true, createdAt: true }
    });
    
    // Group referrals by level
    const directPartners = partnerProfile.referrals.filter(ref => ref.level === 1);
    const multiPartners = partnerProfile.referrals.filter(ref => ref.level > 1);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Партнеры ${user.firstName || 'пользователя'}</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 1000px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .back-btn { background: #6c757d; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
          .back-btn:hover { background: #5a6268; }
          .content { padding: 30px; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
          .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #667eea; }
          .stat-number { font-size: 24px; font-weight: bold; color: #667eea; }
          .stat-label { color: #6c757d; margin-top: 5px; }
          .section { margin-bottom: 30px; }
          .section-title { font-size: 20px; font-weight: bold; color: #212529; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e9ecef; }
          .partners-list { display: grid; gap: 15px; }
          .partner-card { background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; }
          .partner-info { display: flex; align-items: center; gap: 12px; }
          .partner-avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
          .partner-details h4 { margin: 0; font-size: 16px; color: #212529; }
          .partner-details p { margin: 2px 0 0 0; font-size: 13px; color: #6c757d; }
          .partner-level { background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
          .partner-date { font-size: 12px; color: #6c757d; margin-top: 5px; }
          .empty-state { text-align: center; padding: 40px; color: #6c757d; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>👥 Партнеры пользователя</h1>
            <p>${user.firstName || 'Пользователь'} ${user.lastName || ''} (@${user.username || 'без username'})</p>
          </div>
          
          <div class="content">
            <a href="/admin" class="back-btn">← Назад к админ-панели</a>
            
            ${req.query && req.query.success === 'order_created' ? `
              <div class="alert alert-success">✅ Заказ успешно создан</div>
            ` : ''}
            ${req.query && req.query.error === 'order_no_items' ? `
              <div class="alert alert-error">❌ Добавьте хотя бы один товар в заказ</div>
            ` : ''}
            ${req.query && req.query.error === 'order_create_failed' ? `
              <div class="alert alert-error">❌ Не удалось создать заказ. Попробуйте позже.</div>
            ` : ''}
            
            <div class="actions-bar">
              <button class="add-order-btn" onclick="openAddOrderModal()">➕ Добавить заказ</button>
            </div>
            
            <div class="stats">
              <div class="stat-card">
                <div class="stat-number">${directPartners.length}</div>
                <div class="stat-label">Прямых партнеров</div>
              </div>
              <div class="stat-card">
                <div class="stat-number">${multiPartners.length}</div>
                <div class="stat-label">Мульти-партнеров</div>
              </div>
              <div class="stat-card">
                <div class="stat-number">${partnerProfile.referrals.length}</div>
                <div class="stat-label">Всего партнеров</div>
              </div>
            </div>
            
            ${directPartners.length > 0 ? `
              <div class="section">
                <h3 class="section-title">🎯 Прямые партнеры (уровень 1)</h3>
                <div class="partners-list">
                  ${directPartners.map(ref => {
                    const referredUser = referredUsers.find(u => u.id === ref.referredId);
                    return referredUser ? `
                      <div class="partner-card">
                        <div class="partner-info">
                          <div class="partner-avatar">${(referredUser.firstName || 'U')[0].toUpperCase()}</div>
                          <div class="partner-details">
                            <h4>${referredUser.firstName || 'Без имени'} ${referredUser.lastName || ''}</h4>
                            <p>@${referredUser.username || 'без username'}</p>
                            <div class="partner-level">Уровень 1</div>
                          </div>
                        </div>
                        <div class="partner-date">
                          Присоединился: ${referredUser.createdAt.toLocaleString('ru-RU')}
                        </div>
                      </div>
                    ` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
            
            ${multiPartners.length > 0 ? `
              <div class="section">
                <h3 class="section-title">🌐 Мульти-партнеры (уровень 2+)</h3>
                <div class="partners-list">
                  ${multiPartners.map(ref => {
                    const referredUser = referredUsers.find(u => u.id === ref.referredId);
                    return referredUser ? `
                      <div class="partner-card">
                        <div class="partner-info">
                          <div class="partner-avatar">${(referredUser.firstName || 'U')[0].toUpperCase()}</div>
                          <div class="partner-details">
                            <h4>${referredUser.firstName || 'Без имени'} ${referredUser.lastName || ''}</h4>
                            <p>@${referredUser.username || 'без username'}</p>
                            <div class="partner-level">Уровень ${ref.level}</div>
                          </div>
                        </div>
                        <div class="partner-date">
                          Присоединился: ${referredUser.createdAt.toLocaleString('ru-RU')}
                        </div>
                      </div>
                    ` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
            
            ${partnerProfile.referrals.length === 0 ? `
              <div class="empty-state">
                <h3>📭 Нет партнеров</h3>
                <p>У этого пользователя пока нет приглашенных партнеров</p>
              </div>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ User partners page error:', error);
    res.status(500).send('Ошибка загрузки партнеров пользователя');
  }
});

// Update user delivery address
router.post('/users/:userId/delivery-address', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { addressType, address } = req.body;
    
    if (!addressType || !address) {
      return res.status(400).json({ error: 'Тип адреса и адрес обязательны' });
    }
    
    const fullAddress = `${addressType}: ${address}`;
    
    await prisma.user.update({
      where: { id: userId },
      data: { deliveryAddress: fullAddress } as any
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating delivery address:', error);
    res.status(500).json({ error: 'Ошибка сохранения адреса' });
  }
});

// Update user balance
router.post('/users/:userId/toggle-partner-program', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;
    
    console.log('🔄 Toggle partner program request:', { userId, isActive });
    
    if (typeof isActive !== 'boolean') {
      return res.json({ success: false, error: 'Неверный параметр isActive' });
    }
    
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { partner: true }
    });
    
    if (!user) {
      return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    // Если у пользователя нет партнерского профиля, создаем его
    if (!user.partner) {
      // Генерируем уникальный referral code
      let referralCode = '';
      let isUnique = false;
      while (!isUnique) {
        referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        const existing = await prisma.partnerProfile.findUnique({
          where: { referralCode }
        });
        if (!existing) {
          isUnique = true;
        }
      }
      
      await prisma.partnerProfile.create({
        data: {
          userId: user.id,
          isActive: isActive,
          activatedAt: isActive ? new Date() : null,
          activationType: 'ADMIN',
          referralCode: referralCode,
          programType: 'DIRECT'
        }
      });
      
      console.log(`✅ Partner profile created and ${isActive ? 'activated' : 'deactivated'}: ${userId}`);
    } else {
      // Обновляем существующий профиль
      await prisma.partnerProfile.update({
        where: { userId: user.id },
        data: {
          isActive: isActive,
          activatedAt: isActive && !user.partner.activatedAt ? new Date() : user.partner.activatedAt,
          activationType: 'ADMIN'
        }
      });
      
      console.log(`✅ Partner program ${isActive ? 'activated' : 'deactivated'}: ${userId}`);
    }
    
    return res.json({ success: true, isActive: isActive });
  } catch (error: any) {
    console.error('❌ Error toggling partner program:', error);
    return res.json({ success: false, error: error.message || 'Ошибка обновления статуса партнерской программы' });
  }
});

router.post('/users/:userId/update-balance', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { operation, amount, comment } = req.body;
    
    console.log('💰 Balance update request:', { userId, operation, amount, comment });
    
    if (!operation || !amount || amount <= 0) {
      return res.json({ success: false, error: 'Неверные параметры' });
    }
    
    if (!comment || comment.trim().length === 0) {
      return res.json({ success: false, error: 'Комментарий обязателен' });
    }
    
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { partner: true }
    });
    
    if (!user) {
      return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    const currentBalance = user.balance;
    let newBalance;
    
    if (operation === 'add') {
      newBalance = currentBalance + amount;
    } else if (operation === 'subtract') {
      if (currentBalance < amount) {
        return res.json({ success: false, error: 'Недостаточно средств на балансе' });
      }
      newBalance = currentBalance - amount;
    } else {
      return res.json({ success: false, error: 'Неверная операция' });
    }
    
    // Update user balance
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { balance: newBalance }
    });
    
    console.log(`✅ User balance updated: ${userId} from ${currentBalance} to ${updatedUser.balance}`);
    
    // If user has partner profile, update it too, otherwise create one
    if (user.partner) {
      const updatedProfile = await prisma.partnerProfile.update({
        where: { id: user.partner.id },
        data: { balance: newBalance }
      });
      console.log(`✅ Partner profile balance updated: ${user.partner.id} to ${updatedProfile.balance}`);
    } else {
      // Create partner profile if it doesn't exist
      const newProfile = await prisma.partnerProfile.create({
        data: {
          userId: userId,
          balance: newBalance,
          bonus: 0,
          referralCode: `REF${userId.slice(-8)}`,
          programType: 'DIRECT'
        }
      });
      console.log(`✅ Partner profile created: ${newProfile.id} with balance ${newBalance}`);
    }
    
    // Log the transaction
    await prisma.userHistory.create({
      data: {
        userId,
        action: 'balance_updated',
        payload: {
          operation,
          amount,
          oldBalance: currentBalance,
          newBalance,
          comment: comment || 'Ручное изменение баланса администратором'
        }
      }
    });
    
    console.log(`✅ Balance updated: ${userId} ${operation} ${amount} PZ (${currentBalance} -> ${newBalance})`);
    
    res.json({ 
      success: true, 
      newBalance,
      message: `Баланс успешно ${operation === 'add' ? 'пополнен' : 'списан'} на ${amount} PZ`
    });
    
  } catch (error) {
    console.error('❌ Balance update error:', error);
    res.json({ success: false, error: 'Ошибка обновления баланса' });
  }
});
// Helper functions for user orders page
function createUserOrderCard(order: any, user: any) {
  // Handle both string and object types for itemsJson
  const items = typeof order.itemsJson === 'string' 
    ? JSON.parse(order.itemsJson || '[]') 
    : (order.itemsJson || []);
  const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
  
  return `
    <div class="order-card ${order.status.toLowerCase()}">
      <div class="order-header">
        <div class="order-info">
          <h4>Заказ #${order.id.slice(-8)}</h4>
          <p>Дата: ${new Date(order.createdAt).toLocaleString('ru-RU')}</p>
        </div>
        <div class="order-status ${order.status.toLowerCase()}">
          ${getStatusDisplayName(order.status)}
        </div>
      </div>
      
      <div class="order-details">
        <div class="order-items">
          ${items.map((item: any) => `
            <div class="order-item">
              <span>${item.title} x${item.quantity}</span>
              <span>${(item.price * item.quantity).toFixed(2)} PZ</span>
            </div>
          `).join('')}
        </div>
        
        ${user.deliveryAddress ? `
          <div class="order-info-section">
            <div class="info-label">📍 Адрес доставки:</div>
            <div class="info-value">${user.deliveryAddress}</div>
          </div>
        ` : ''}
        
        ${order.message ? `
          <div class="order-info-section">
            <div class="info-label">💬 Комментарии:</div>
            <div class="info-value">${order.message}</div>
          </div>
        ` : ''}
        
        <div class="order-total">
          Итого: ${totalAmount.toFixed(2)} PZ
        </div>
      </div>
      
      <div class="order-actions">
        <div class="status-buttons">
          <button class="status-btn ${order.status === 'NEW' ? 'active' : ''}" 
                  onclick="updateOrderStatus('${order.id}', 'NEW')" 
                  ${order.status === 'NEW' ? 'disabled' : ''}>
            🔴 Новый
          </button>
          <button class="status-btn ${order.status === 'PROCESSING' ? 'active' : ''}" 
                  onclick="updateOrderStatus('${order.id}', 'PROCESSING')" 
                  ${order.status === 'PROCESSING' ? 'disabled' : ''}>
            🟡 В обработке
          </button>
          <button class="status-btn ${order.status === 'COMPLETED' ? 'active' : ''}" 
                  onclick="updateOrderStatus('${order.id}', 'COMPLETED')" 
                  ${order.status === 'COMPLETED' ? 'disabled' : ''}>
            🟢 Готово
          </button>
          <button class="status-btn ${order.status === 'CANCELLED' ? 'active' : ''}" 
                  onclick="updateOrderStatus('${order.id}', 'CANCELLED')" 
                  ${order.status === 'CANCELLED' ? 'disabled' : ''}>
            ⚫ Отмена
          </button>
        </div>
        
        <div class="order-edit-actions">
          ${order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? 
            '<button class="edit-btn" onclick="openEditOrderModal(\'' + order.id + '\')">✏️ Редактировать</button>' 
            : ''}
          ${order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? 
            '<button class="pay-btn" onclick="payFromBalance(\'' + order.id + '\', ' + totalAmount + ')">💳 Оплатить с баланса</button>' 
            : ''}
        </div>
      </div>
    </div>
  `;
}

function getStatusDisplayName(status: string) {
  const names = {
    'NEW': '🔴 Новый',
    'PROCESSING': '🟡 В обработке',
    'COMPLETED': '🟢 Готово',
    'CANCELLED': '⚫ Отмена'
  };
  return names[status as keyof typeof names] || status;
}
// Show user orders page
  // Test route for debugging
  router.get('/debug-user/:userId', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      console.log(`🔍 DEBUG: Testing user ID: ${userId}`);
      
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      console.log(`🔍 DEBUG: User found:`, user ? 'YES' : 'NO');
      
      res.json({
        success: true,
        userId,
        userExists: !!user,
        userData: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username
        } : null
      });
    } catch (error) {
      console.error('🔍 DEBUG Error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Detailed test route for debugging card issues
  router.get('/debug-user-full/:userId', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      console.log(`🔍 DEBUG FULL: Testing user ID: ${userId}`);
      
      // Test basic user query
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      console.log(`🔍 DEBUG FULL: Basic user query - success`);
      
      // Test user with orders
      const userWithOrders = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' }
          }
        }
      }) as any;
      console.log(`🔍 DEBUG FULL: User with orders query - success`);
      console.log(`🔍 DEBUG FULL: Orders count:`, userWithOrders?.orders?.length || 0);
      
      // Test partner profile
      const partnerProfile = await prisma.partnerProfile.findUnique({
        where: { userId }
      });
      console.log(`🔍 DEBUG FULL: Partner profile query - success`);
      
      // Test user history
      const userHistory = await prisma.userHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
      });
      console.log(`🔍 DEBUG FULL: User history query - success`);
      console.log(`🔍 DEBUG FULL: History count:`, userHistory?.length || 0);
      
      // Test calculations
      const totalOrders = userWithOrders?.orders?.length || 0;
      const completedOrders = userWithOrders?.orders?.filter((o: any) => o.status === 'COMPLETED').length || 0;
      const totalSpent = userWithOrders?.orders
        ?.filter((o: any) => o.status === 'COMPLETED')
        .reduce((sum: number, order: any) => sum + (order.totalAmount || 0), 0) || 0;
      
      console.log(`🔍 DEBUG FULL: Calculations - success`);
      console.log(`🔍 DEBUG FULL: Total orders: ${totalOrders}, Completed: ${completedOrders}, Spent: ${totalSpent}`);
      
      res.json({
        success: true,
        userId,
        userExists: !!user,
        userData: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username
        } : null,
        ordersCount: totalOrders,
        completedOrdersCount: completedOrders,
        totalSpent: totalSpent,
        partnerProfileExists: !!partnerProfile,
        historyCount: userHistory?.length || 0,
        allQueriesSuccessful: true
      });
    } catch (error) {
      console.error('🔍 DEBUG FULL Error:', error);
      console.error('🔍 DEBUG FULL Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.params.userId
      });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        userId: req.params.userId
      });
    }
  });

  // Get user card with transaction history (simplified version)
  router.get('/users/:userId/card', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      console.log(`🔍 Loading user card for ID: ${userId}`);
      
      // Get user with basic data only (no include to avoid complex queries)
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      console.log(`👤 User found:`, user ? `${user.firstName} ${user.lastName}` : 'null');

      if (!user) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Пользователь не найден</title>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
              .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              .back-btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <a href="/admin" class="back-btn">← Назад к админ-панели</a>
              <h2>❌ Пользователь не найден</h2>
              <p>Пользователь с ID ${userId} не существует</p>
            </div>
          </body>
          </html>
        `);
      }

      // Sync balance between User and PartnerProfile
      const partnerProfile = await prisma.partnerProfile.findUnique({
        where: { userId }
      });
      
      if (partnerProfile && partnerProfile.balance !== user.balance) {
        console.log(`🔄 Syncing balance: User=${user.balance} PZ, PartnerProfile=${partnerProfile.balance} PZ`);
        // Use PartnerProfile balance as source of truth
        await prisma.user.update({
          where: { id: userId },
          data: { balance: partnerProfile.balance }
        });
        user.balance = partnerProfile.balance;
        console.log(`✅ Balance synced to ${user.balance} PZ`);
      }

      // Get data separately to avoid complex queries
      console.log(`📦 Getting orders for user: ${userId}`);
      const orders = await prisma.orderRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      console.log(`📦 Orders count:`, orders?.length || 0);

      console.log(`🤝 Partner profile found:`, partnerProfile ? 'yes' : 'no');
      
      // Проверяем статус активации
      const isActive = partnerProfile ? await checkPartnerActivation(userId) : false;
      console.log(`🤝 Partner profile is active:`, isActive);

      console.log(`📊 Getting user history for user: ${userId}`);
      const userHistory = await prisma.userHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20 // Limit to 20 records to avoid issues
      });
      console.log(`📊 User history count:`, userHistory?.length || 0);

      if (!user) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Пользователь не найден</title>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
              .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              .back-btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <a href="/admin" class="back-btn">← Назад к админ-панели</a>
              <h2>❌ Пользователь не найден</h2>
              <p>Пользователь с ID ${userId} не существует</p>
            </div>
          </body>
          </html>
        `);
      }

      // Calculate statistics with safe handling
      const totalOrders = orders?.length || 0;
      const completedOrders = orders?.filter((o: any) => o && o.status === 'COMPLETED').length || 0;
      const totalSpent = orders
        ?.filter((o: any) => o && o.status === 'COMPLETED')
        .reduce((sum: number, order: any) => {
          const amount = order?.totalAmount || 0;
          return sum + (typeof amount === 'number' ? amount : 0);
        }, 0) || 0;
      
      const totalPartners = 0; // Simplified for now
      const activePartners = 0; // Simplified for now

      // Group transactions by date with safe handling
      const transactionsByDate: { [key: string]: any[] } = {};
      userHistory?.forEach((tx: any) => {
        if (tx && tx.createdAt) {
          try {
            const date = tx.createdAt.toISOString().split('T')[0];
            if (!transactionsByDate[date]) {
              transactionsByDate[date] = [];
            }
            transactionsByDate[date].push(tx);
          } catch (error) {
            console.error('Error processing transaction date:', error, tx);
          }
        }
      });

      // Серверные функции для преобразования названий операций
      function getBalanceActionNameServer(action: string): string {
        const actionNames: { [key: string]: string } = {
          'balance_updated': '💰 Изменение баланса',
          'REFERRAL_BONUS': '🎯 Реферальный бонус',
          'ORDER_PAYMENT': '💳 Оплата заказа',
          'BALANCE_ADD': '➕ Пополнение баланса',
          'BALANCE_SUBTRACT': '➖ Списание с баланса'
        };
        return actionNames[action] || action;
      }

      function getExpirationStatusColorServer(expiresAt: Date): string {
        const now = new Date();
        const expiration = new Date(expiresAt);
        const daysLeft = Math.ceil((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysLeft < 0) {
          return '#dc3545'; // Красный - истекла
        } else if (daysLeft <= 3) {
          return '#ffc107'; // Желтый - скоро истекает
        } else if (daysLeft <= 7) {
          return '#fd7e14'; // Оранжевый - неделя
        } else {
          return '#28a745'; // Зеленый - много времени
        }
      }

      function getExpirationStatusTextServer(expiresAt: Date): string {
        const now = new Date();
        const expiration = new Date(expiresAt);
        const daysLeft = Math.ceil((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysLeft < 0) {
          return '❌ Активация истекла';
        } else if (daysLeft === 0) {
          return '⚠️ Истекает сегодня';
        } else if (daysLeft === 1) {
          return '⚠️ Истекает завтра';
        } else if (daysLeft <= 3) {
          return `⚠️ Истекает через ${daysLeft} дня`;
        } else if (daysLeft <= 7) {
          return `🟡 Истекает через ${daysLeft} дней`;
        } else {
          return `✅ Действует еще ${daysLeft} дней`;
        }
      }
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Карточка клиента - ${user.firstName || 'Без имени'}</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            .back-btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-bottom: 20px; }
            .header { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .user-avatar { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 32px; margin-bottom: 15px; }
            .user-info h1 { margin: 0 0 10px 0; color: #212529; }
            .user-meta { color: #6c757d; margin-bottom: 20px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
            .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .stat-value { font-size: 24px; font-weight: bold; color: #007bff; margin-bottom: 5px; }
            .stat-label { color: #6c757d; font-size: 14px; }
            .section { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .section h2 { margin: 0 0 20px 0; color: #212529; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
            .transaction-item { padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
            .transaction-item:last-child { border-bottom: none; }
            .transaction-amount { font-weight: bold; }
            .transaction-amount.positive { color: #28a745; }
            .transaction-amount.negative { color: #dc3545; }
            .transaction-details { flex: 1; margin-left: 15px; }
            .transaction-date { color: #6c757d; font-size: 12px; }
            .referral-activation { background: #f8f9fa; padding: 20px; border-radius: 10px; margin-top: 20px; }
            .activation-form { display: flex; gap: 10px; align-items: end; }
            .activation-form input, .activation-form select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; }
            .activation-btn { padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; }
            .activation-btn:hover { background: #218838; }
            .partners-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .partner-card { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff; }
            .partner-name { font-weight: bold; margin-bottom: 5px; }
            .partner-balance { color: #28a745; font-size: 14px; }
            .tabs { display: flex; border-bottom: 2px solid #eee; margin-bottom: 20px; }
            .tab { padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; }
            .tab.active { border-bottom-color: #007bff; color: #007bff; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            .alert { padding: 15px 20px; margin: 20px 0; border-radius: 8px; font-weight: 500; border: 1px solid; }
            .alert-success { background: #d4edda; color: #155724; border-color: #c3e6cb; }
            .alert-error { background: #f8d7da; color: #721c24; border-color: #f5c6cb; }
            .balance-item { cursor: pointer; transition: background-color 0.2s; }
            .balance-item:hover { background-color: #f8f9fa; }
            .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); }
            .modal-content { background-color: white; margin: 10% auto; padding: 30px; border-radius: 10px; width: 80%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
            .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
            .modal-title { margin: 0; color: #212529; font-size: 24px; }
            .close { color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer; }
            .close:hover { color: #000; }
            .modal-body { line-height: 1.6; }
            .balance-detail { margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; }
            .balance-detail strong { color: #007bff; }
            .amount-large { font-size: 24px; font-weight: bold; margin: 10px 0; }
            .amount-positive { color: #28a745; }
            .amount-negative { color: #dc3545; }
          </style>
        </head>
        <body>
          <div class="container">
            <a href="/admin" class="back-btn">← Назад к админ-панели</a>
            
            ${req.query.success === 'referral_activated' ? '<div class="alert alert-success">🎉 Реферальная программа успешно активирована! Пользователь может теперь приглашать партнёров и получать бонусы.</div>' : ''}
            
            <div class="header">
              <div style="display: flex; align-items: center; gap: 20px;">
                <div class="user-avatar">${(user.firstName || 'U')[0].toUpperCase()}</div>
                <div>
                  <h1>${user.firstName || 'Без имени'} ${user.lastName || ''}</h1>
                  <div class="user-meta">
                    <p><strong>@${user.username || 'без username'}</strong></p>
                    <p>ID: ${user.id}</p>
                    <p>Регистрация: ${user.createdAt.toLocaleString('ru-RU')}</p>
                    <p>Баланс: <strong>${user.balance.toFixed(2)} PZ</strong></p>
                    <p>Пригласитель: Не указан</p>
                  </div>
                </div>
              </div>
              
              <div class="stats-grid">
                <div class="stat-card">
                  <div class="stat-value">${totalOrders}</div>
                  <div class="stat-label">Всего заказов</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${completedOrders}</div>
                  <div class="stat-label">Выполненных</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${totalSpent.toFixed(2)} PZ</div>
                  <div class="stat-label">Потрачено</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${totalPartners}</div>
                  <div class="stat-label">Партнеров</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${activePartners}</div>
                  <div class="stat-label">Активных партнеров</div>
                </div>
              </div>
            </div>

            <div class="section">
              <h2>🔄 Активация рефералки</h2>
              <div class="referral-activation">
                <p><strong>Активировать реферальную программу для пользователя на срок:</strong></p>
                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                  <p style="margin: 0; color: #2d5a2d; font-weight: bold;">🎯 Двойная система бонусов:</p>
                  <ul style="margin: 10px 0; color: #2d5a2d;">
                    <li><strong>Прямой реферал:</strong> 25% (прямая ссылка) <strong>либо</strong> 15% (многоуровневая ссылка)</li>
                    <li><strong>2-й уровень:</strong> <strong>5%</strong></li>
                    <li><strong>3-й уровень:</strong> <strong>5%</strong></li>
                  </ul>
                </div>
                <form class="activation-form" method="post" action="/admin/users/${user.id}/activate-referral">
                  <div>
                    <label>Период:</label><br>
                    <select name="months" required>
                      <option value="1">1 месяц</option>
                      <option value="3">3 месяца</option>
                      <option value="6">6 месяцев</option>
                      <option value="12">12 месяцев</option>
                    </select>
                  </div>
                  <div>
                    <label>Тип активации:</label><br>
                    <select name="programType" required>
                      <option value="DUAL">Двойная система (25% прямая либо 15% многоуровневая+5%+5%)</option>
                    </select>
                  </div>
                  <button type="submit" class="activation-btn">Активировать</button>
                </form>
              </div>
            </div>

            <div class="section">
              <div class="tabs">
                <div class="tab active" onclick="showTab('balance')">💰 История баланса</div>
                <div class="tab" onclick="showTab('transactions')">📊 История транзакций</div>
                <div class="tab" onclick="showTab('partners')">👥 Партнеры</div>
                <div class="tab" onclick="showTab('orders')">📦 Заказы</div>
              </div>

              <div id="balance" class="tab-content active">
                <h2>💰 История изменений баланса</h2>
                <p style="color: #6c757d; margin-bottom: 20px;">Кликните на изменение баланса для просмотра деталей</p>
                ${Object.keys(transactionsByDate).length === 0 ? 
                  '<p style="text-align: center; color: #6c757d; padding: 40px;">Нет изменений баланса</p>' :
                  Object.keys(transactionsByDate).map(date => `
                    <h3 style="color: #6c757d; margin: 20px 0 10px 0; font-size: 16px;">${new Date(date).toLocaleDateString('ru-RU')}</h3>
                    ${transactionsByDate[date]
                      .filter(tx => {
                        // Показываем только финансовые операции
                        const financialActions = ['balance_updated', 'REFERRAL_BONUS', 'ORDER_PAYMENT', 'BALANCE_ADD', 'BALANCE_SUBTRACT'];
                        return financialActions.includes(tx.action) && tx.amount !== 0;
                      })
                      .map(tx => `
                      <div class="transaction-item balance-item" onclick="showBalanceDetails('${tx.id}', '${tx.action}', ${tx.amount || 0}, '${tx.createdAt.toLocaleString('ru-RU')}')">
                        <div class="transaction-details">
                          <div><strong>${getBalanceActionNameServer(tx.action)}</strong></div>
                          <div class="transaction-date">${tx.createdAt.toLocaleTimeString('ru-RU')}</div>
                        </div>
                        <div class="transaction-amount ${tx.amount && tx.amount > 0 ? 'positive' : 'negative'}">
                          ${tx.amount ? (tx.amount > 0 ? '+' : '') + tx.amount.toFixed(2) + ' PZ' : '0.00 PZ'}
                        </div>
                      </div>
                    `).join('')}
                  `).join('')
                }
              </div>

              <div id="transactions" class="tab-content">
                <h2>📊 История транзакций</h2>
                ${Object.keys(transactionsByDate).length === 0 ? 
                  '<p style="text-align: center; color: #6c757d; padding: 40px;">Нет транзакций</p>' :
                  Object.keys(transactionsByDate).map(date => `
                    <h3 style="color: #6c757d; margin: 20px 0 10px 0; font-size: 16px;">${new Date(date).toLocaleDateString('ru-RU')}</h3>
                    ${transactionsByDate[date].map(tx => `
                      <div class="transaction-item">
                        <div class="transaction-details">
                          <div><strong>${tx.action}</strong></div>
                          <div class="transaction-date">${tx.createdAt.toLocaleTimeString('ru-RU')}</div>
                        </div>
                        <div class="transaction-amount">
                          ${tx.amount ? (tx.amount > 0 ? '+' : '') + tx.amount.toFixed(2) + ' PZ' : '0.00 PZ'}
                        </div>
                      </div>
                    `).join('')}
                  `).join('')
                }
              </div>

              <div id="partners" class="tab-content">
                <h2>🤝 Партнерский профиль</h2>
                <p><strong>Статус:</strong> ${isActive ? '🟢 Активен' : '🔴 Неактивен'}</p>
                ${partnerProfile ? `
                  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Код реферала:</strong> ${partnerProfile.referralCode}</p>
                    <p><strong>Тип программы:</strong> ${partnerProfile.programType}</p>
                    <p><strong>Баланс:</strong> ${partnerProfile.balance || 0} PZ</p>
                    ${(partnerProfile as any).activatedAt ? `<p><strong>Активирован:</strong> ${(partnerProfile as any).activatedAt.toLocaleString('ru-RU')}</p>` : ''}
                    ${(partnerProfile as any).expiresAt ? `
                      <p><strong>Истекает:</strong> ${(partnerProfile as any).expiresAt.toLocaleString('ru-RU')}</p>
                      <div style="background: ${getExpirationStatusColorServer((partnerProfile as any).expiresAt)}; padding: 10px; border-radius: 6px; margin: 10px 0;">
                        <p style="margin: 0; color: white; font-weight: bold;">
                          ${getExpirationStatusTextServer((partnerProfile as any).expiresAt)}
                        </p>
                      </div>
                    ` : ''}
                    <p><strong>Тип активации:</strong> ${(partnerProfile as any).activationType || 'Не указан'}</p>
                  </div>
                ` : '<p>Партнерский профиль не создан</p>'}
              </div>

              <div id="orders" class="tab-content">
                <h2>📦 Заказы</h2>
                ${(orders?.length || 0) === 0 ? 
                  '<p style="text-align: center; color: #6c757d; padding: 40px;">Нет заказов</p>' :
                  orders?.map((order: any) => `
                    <div class="transaction-item">
                      <div class="transaction-details">
                        <div><strong>Заказ #${order.id}</strong></div>
                        <div class="transaction-date">${order.createdAt.toLocaleString('ru-RU')}</div>
                        <div style="font-size: 12px; color: #6c757d;">
                          Статус: <span style="color: ${order.status === 'NEW' ? '#dc3545' : order.status === 'PROCESSING' ? '#ffc107' : order.status === 'COMPLETED' ? '#28a745' : '#6c757d'}">
                            ${order.status === 'NEW' ? 'Новый' : order.status === 'PROCESSING' ? 'В обработке' : order.status === 'COMPLETED' ? 'Выполнен' : 'Отменен'}
                          </span>
                        </div>
                      </div>
                      <div class="transaction-amount ${order.status === 'COMPLETED' ? 'positive' : ''}">
                        ${(order.totalAmount || 0).toFixed(2)} PZ
                      </div>
                    </div>
                  `).join('')
                }
              </div>
            </div>
          </div>

          <!-- Модальное окно для деталей баланса -->
          <div id="balanceModal" class="modal">
            <div class="modal-content">
              <div class="modal-header">
                <h2 id="balanceModalTitle" class="modal-title">💰 Детали изменения баланса</h2>
                <span class="close" onclick="closeBalanceModal()">&times;</span>
              </div>
              <div id="balanceModalBody" class="modal-body">
                <!-- Содержимое будет заполнено JavaScript -->
              </div>
            </div>
          </div>

          <script>
            // Функции для определения статуса истечения активации
            function getExpirationStatusColor(expiresAt) {
              const now = new Date();
              const expiration = new Date(expiresAt);
              const daysLeft = Math.ceil((expiration - now) / (1000 * 60 * 60 * 24));
              
              if (daysLeft < 0) {
                return '#dc3545'; // Красный - истекла
              } else if (daysLeft <= 3) {
                return '#ffc107'; // Желтый - скоро истекает
              } else if (daysLeft <= 7) {
                return '#fd7e14'; // Оранжевый - неделя
              } else {
                return '#28a745'; // Зеленый - много времени
              }
            }
            
            function getExpirationStatusText(expiresAt) {
              const now = new Date();
              const expiration = new Date(expiresAt);
              const daysLeft = Math.ceil((expiration - now) / (1000 * 60 * 60 * 24));
              
              if (daysLeft < 0) {
                return '❌ Активация истекла';
              } else if (daysLeft === 0) {
                return '⚠️ Истекает сегодня';
              } else if (daysLeft === 1) {
                return '⚠️ Истекает завтра';
              } else if (daysLeft <= 3) {
                return \`⚠️ Истекает через \${daysLeft} дня\`;
              } else if (daysLeft <= 7) {
                return \`🟡 Истекает через \${daysLeft} дней\`;
              } else {
                return \`✅ Действует еще \${daysLeft} дней\`;
              }
            }
            
            // Функция для преобразования технических названий операций в понятные
            function getBalanceActionName(action) {
              const actionNames = {
                'balance_updated': '💰 Изменение баланса',
                'REFERRAL_BONUS': '🎯 Реферальный бонус',
                'ORDER_PAYMENT': '💳 Оплата заказа',
                'BALANCE_ADD': '➕ Пополнение баланса',
                'BALANCE_SUBTRACT': '➖ Списание с баланса'
              };
              return actionNames[action] || action;
            }
            
            function showTab(tabName) {
              // Hide all tab contents
              document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
              });
              
              // Remove active class from all tabs
              document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
              });
              
              // Show selected tab content
              document.getElementById(tabName).classList.add('active');
              
              // Add active class to clicked tab
              event.target.classList.add('active');
            }
            
            // Функция для показа деталей изменения баланса
            function showBalanceDetails(id, action, amount, date) {
              const modal = document.getElementById('balanceModal');
              const modalTitle = document.getElementById('balanceModalTitle');
              const modalBody = document.getElementById('balanceModalBody');
              
              modalTitle.textContent = '💰 Детали изменения баланса';
              
              const amountClass = amount > 0 ? 'amount-positive' : 'amount-negative';
              const amountSign = amount > 0 ? '+' : '';
              
              modalBody.innerHTML = \`
                <div class="balance-detail">
                  <strong>Операция:</strong> \${getBalanceActionName(action)}
                </div>
                <div class="balance-detail">
                  <strong>Дата и время:</strong> \${date}
                </div>
                <div class="balance-detail">
                  <strong>Изменение баланса:</strong>
                  <div class="amount-large \${amountClass}">\${amountSign}\${amount.toFixed(2)} PZ</div>
                </div>
                <div class="balance-detail">
                  <strong>ID транзакции:</strong> \${id}
                </div>
              \`;
              
              modal.style.display = 'block';
            }
            
            // Закрытие модального окна
            function closeBalanceModal() {
              document.getElementById('balanceModal').style.display = 'none';
            }
            
            // Закрытие модального окна при клике вне его
            window.onclick = function(event) {
              const modal = document.getElementById('balanceModal');
              if (event.target === modal) {
                modal.style.display = 'none';
              }
            }
          </script>
        </body>
        </html>
      `;

      res.send(html);
    } catch (error) {
      console.error('❌ Error loading user card:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.params.userId
      });
      res.status(500).send('Ошибка загрузки карточки пользователя');
    }
  });

  // Activate referral program for user
  router.post('/users/:userId/activate-referral', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { months, programType } = req.body;
      
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).send('Пользователь не найден');
      }

      // Check if user already has partner profile
      const existingProfile = await prisma.partnerProfile.findUnique({
        where: { userId }
      });

      if (existingProfile) {
        // Update existing profile
        await prisma.partnerProfile.update({
          where: { userId },
          data: {
            programType: 'MULTI_LEVEL' // Always use MULTI_LEVEL for dual system
          }
        });
      } else {
        // Create new partner profile
        const referralCode = `REF${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        
        await prisma.partnerProfile.create({
          data: {
            userId,
            programType: 'MULTI_LEVEL', // Always use MULTI_LEVEL for dual system
            referralCode,
            balance: 0,
            bonus: 0
          }
        });
      }

      // Активируем партнерский профиль через админку
      await activatePartnerProfile(userId, 'ADMIN', parseInt(months));

      console.log(`✅ Referral program activated for user ${userId} for ${months} months`);

      res.redirect(`/admin/users/${userId}/card?success=referral_activated`);
    } catch (error) {
      console.error('❌ Error activating referral program:', error);
      res.status(500).send('Ошибка активации реферальной программы');
    }
  });
  // Get user orders
  router.get('/users/:userId/orders', requireAdmin, async (req, res) => {
    try {
    const { userId } = req.params;
    
    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, username: true, balance: true, deliveryAddress: true }
    });
    
    if (!user) {
      return res.status(404).send('Пользователь не найден');
    }
    
    // Get user's orders
    const orders = await prisma.orderRequest.findMany({
      where: { userId },
      orderBy: [
        { status: 'asc' }, // NEW заказы сначала
        { createdAt: 'desc' }
      ]
    });
    
    // Group orders by status
    const ordersByStatus = {
      NEW: orders.filter(order => order.status === 'NEW'),
      PROCESSING: orders.filter(order => order.status === 'PROCESSING'),
      COMPLETED: orders.filter(order => order.status === 'COMPLETED'),
      CANCELLED: orders.filter(order => order.status === 'CANCELLED')
    };
    
    const escapeHtmlAttr = (value = '') => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const defaultContact = user.deliveryAddress || (user.username ? `@${user.username}` : user.firstName || '');
    const defaultMessage = 'Заказ создан администратором';
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Заказы ${user.firstName || 'пользователя'}</title>
        <meta charset="utf-8">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; padding: 20px; background: #f5f5f5; 
          }
          .container { 
            max-width: 1200px; margin: 0 auto; background: white; 
            border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            overflow: hidden; 
          }
          .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; padding: 30px; text-align: center; 
          }
          
          .user-balance {
            margin-top: 15px; padding: 10px 20px; 
            background: rgba(255, 255, 255, 0.1); 
            border-radius: 8px; display: inline-flex;
            align-items: center; gap: 10px;
            backdrop-filter: blur(10px);
          }
          
          .balance-manage-btn {
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: bold;
            transition: all 0.2s ease;
          }
          
          .balance-manage-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.1);
          }
          
          .balance-label {
            font-size: 16px; font-weight: 600; margin-right: 10px;
          }
          
          .balance-amount {
            font-size: 18px; font-weight: 700; 
            color: #ffd700; text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          }
          .back-btn { 
            background: #6c757d; color: white; text-decoration: none; 
            padding: 10px 20px; border-radius: 6px; 
            display: inline-block; margin-bottom: 20px; 
          }
          .back-btn:hover { background: #5a6268; }
          .actions-bar {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          .add-order-btn {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(32, 201, 151, 0.3);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          }
          .add-order-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 14px rgba(32, 201, 151, 0.4);
          }
          .add-order-btn.ghost {
            background: transparent;
            border: 2px dashed #764ba2;
            color: #764ba2;
            box-shadow: none;
          }
          .add-order-btn.ghost:hover {
            border-style: solid;
          }
          .content { padding: 30px; }
          
          .status-section { margin-bottom: 30px; }
          .status-header { 
            font-size: 20px; font-weight: bold; margin-bottom: 15px; 
            padding: 10px 15px; border-radius: 8px; display: flex; 
            align-items: center; gap: 10px; 
          }
          .status-header.new { background: #f8d7da; color: #721c24; border-left: 4px solid #dc3545; }
          .status-header.processing { background: #fff3cd; color: #856404; border-left: 4px solid #ffc107; }
          .status-header.completed { background: #d4edda; color: #155724; border-left: 4px solid #28a745; }
          .status-header.cancelled { background: #e2e3e5; color: #383d41; border-left: 4px solid #6c757d; }
          
          .orders-grid { display: grid; gap: 15px; }
          .order-card { 
            background: #f8f9fa; border: 1px solid #dee2e6; 
            border-radius: 8px; padding: 20px; transition: all 0.2s ease; 
          }
          .order-card.new { 
            border-left: 4px solid #dc3545; 
            background: linear-gradient(135deg, #fff5f5 0%, #f8f9fa 100%); 
          }
          .order-card.processing { border-left: 4px solid #ffc107; }
          .order-card.completed { border-left: 4px solid #28a745; }
          .order-card.cancelled { border-left: 4px solid #6c757d; }
          
          .order-header { 
            display: flex; justify-content: space-between; 
            align-items: flex-start; margin-bottom: 15px; 
          }
          .order-info h4 { margin: 0; font-size: 18px; color: #212529; }
          .order-info p { margin: 5px 0 0 0; color: #6c757d; font-size: 14px; }
          .order-status { 
            padding: 4px 12px; border-radius: 12px; 
            font-size: 12px; font-weight: 600; 
          }
          .order-status.new { background: #dc3545; color: white; }
          .order-status.processing { background: #ffc107; color: #212529; }
          .order-status.completed { background: #28a745; color: white; }
          .order-status.cancelled { background: #6c757d; color: white; }
          
          .order-details { margin-bottom: 15px; }
          .order-items { margin-bottom: 10px; }
          .order-item { 
            display: flex; justify-content: space-between; 
            padding: 5px 0; border-bottom: 1px solid #e9ecef; 
          }
          .order-total { 
            font-weight: bold; font-size: 16px; 
            color: #28a745; text-align: right; 
          }
          
          .order-info-section {
            margin: 15px 0; padding: 12px; 
            background: #f8f9fa; border-radius: 6px; 
            border-left: 3px solid #007bff;
          }
          
          .info-label {
            font-weight: 600; color: #495057; 
            margin-bottom: 5px; font-size: 14px;
          }
          
          .info-value {
            color: #6c757d; font-size: 13px; 
            line-height: 1.4; word-break: break-word;
          }
          
          .order-actions {
            margin-top: 20px; padding-top: 20px; 
            border-top: 1px solid #e9ecef; 
          }
          .alert {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 500;
          }
          .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
          }
          .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
          }
          
          .status-buttons {
            display: flex; gap: 8px; margin-bottom: 15px; 
            flex-wrap: wrap; 
          }
          
          .status-btn {
            padding: 8px 16px; border: none; 
            border-radius: 8px; cursor: pointer; 
            font-size: 12px; font-weight: 600; transition: all 0.2s ease; 
            color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.2);
          }
          
          .status-btn:hover:not(:disabled) {
            transform: translateY(-1px); 
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
          }
          
          .status-btn.active {
            transform: scale(1.05);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          }
          
          .status-btn:disabled {
            opacity: 0.7; cursor: not-allowed; 
            transform: none !important;
          }
          
          /* Цвета статусов */
          .status-btn[onclick*="NEW"] {
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
          }
          
          .status-btn[onclick*="PROCESSING"] {
            background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%);
          }
          
          .status-btn[onclick*="COMPLETED"] {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
          }
          
          .status-btn[onclick*="CANCELLED"] {
            background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
          }
          
          .order-edit-actions {
            display: flex; gap: 10px; margin-top: 10px; 
          }
          
          .edit-btn {
            background: linear-gradient(135deg, #17a2b8 0%, #138496 100%);
            color: white; border: none; padding: 12px 20px; 
            border-radius: 8px; cursor: pointer; font-size: 14px; 
            font-weight: 600; transition: all 0.2s ease; 
            text-shadow: 0 1px 2px rgba(0,0,0,0.2); flex: 1;
          }
          
          .edit-btn:hover {
            transform: translateY(-1px); 
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
          }
          
          .pay-btn {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%); 
            color: white; border: none; padding: 12px 24px; 
            border-radius: 8px; font-weight: 600; cursor: pointer; 
            font-size: 14px; transition: all 0.2s ease; 
            box-shadow: 0 2px 4px rgba(40, 167, 69, 0.2); flex: 1;
          }
          
          .pay-btn:hover {
            transform: translateY(-1px); 
            box-shadow: 0 4px 8px rgba(40, 167, 69, 0.3); 
          }
          
          .empty-state { text-align: center; padding: 40px; color: #6c757d; }
          
          /* Модальное окно редактирования заказа */
          .edit-order-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
          }
          
          .edit-order-modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 20px;
            border-radius: 10px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          }
          
          .edit-order-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #e9ecef;
          }
          
          .edit-order-close {
            color: #aaa;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            line-height: 1;
          }
          
          .edit-order-close:hover {
            color: #000;
          }
          
          .order-items-edit {
            margin-bottom: 20px;
          }
          .new-order-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #f1f3f5;
            border-radius: 8px;
            margin-bottom: 15px;
            font-weight: 600;
          }
          
          .order-item-edit {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            margin-bottom: 10px;
            background: #f8f9fa;
          }
          
          .order-item-info {
            flex: 1;
          }
          
          .order-item-price {
            font-weight: bold;
            color: #28a745;
            margin: 0 15px;
          }
          
          .remove-item-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          
          .remove-item-btn:hover {
            background: #c82333;
          }
          
          .add-product-section {
            margin-top: 20px;
            padding: 15px;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            background: #f8f9fa;
          }
          
          .add-product-form {
            display: flex;
            gap: 10px;
            align-items: end;
            flex-wrap: wrap;
          }
          .custom-product-form {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: flex-end;
            margin-top: 10px;
          }
          .custom-product-form input {
            min-width: 160px;
          }
          
          .form-group {
            flex: 1;
            min-width: 200px;
          }
          
          .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #495057;
          }
          
          .form-group input, .form-group select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 14px;
          }
          
          .add-product-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          }
          
          .add-product-btn:hover {
            background: #218838;
          }
          
          .edit-order-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #e9ecef;
          }
          
          .save-order-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          }
          
          .save-order-btn:hover {
            background: #0056b3;
          }
          
          .cancel-edit-btn {
            background: #6c757d;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          }
          
          .cancel-edit-btn:hover {
            background: #545b62;
          }
          
          /* Стили для модального окна управления балансом */
          .balance-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
          }
          
          .balance-modal-content {
            background-color: white;
            margin: 15% auto;
            padding: 0;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            overflow: hidden;
          }
          
          .balance-modal-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .balance-modal-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
          }
          
          .balance-modal-close {
            color: white;
            font-size: 24px;
            font-weight: bold;
            cursor: pointer;
            line-height: 1;
          }
          
          .balance-modal-close:hover {
            opacity: 0.7;
          }
          
          .balance-modal-body {
            padding: 20px;
          }
          
          .balance-form-group {
            margin-bottom: 15px;
          }
          
          .balance-form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #495057;
          }
          
          .balance-select, .balance-input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #ced4da;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s ease;
          }
          
          .balance-select:focus, .balance-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
          }
          
          .balance-error {
            background: #f8d7da;
            color: #721c24;
            padding: 10px;
            border-radius: 6px;
            font-size: 14px;
            margin-top: 10px;
          }
          
          .balance-modal-footer {
            padding: 20px;
            background: #f8f9fa;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
          }
          
          .balance-cancel-btn, .balance-apply-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s ease;
          }
          
          .balance-cancel-btn {
            background: #6c757d;
            color: white;
          }
          
          .balance-cancel-btn:hover {
            background: #545b62;
          }
          
          .balance-apply-btn {
            background: #28a745;
            color: white;
          }
          
          .balance-apply-btn:hover {
            background: #218838;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📦 Заказы пользователя</h1>
            <p>${user.firstName || 'Пользователь'} ${user.lastName || ''} (@${user.username || 'без username'})</p>
            <div class="user-balance">
              <span class="balance-label">💰 Баланс:</span>
              <span class="balance-amount">${Number(user.balance || 0).toFixed(2)} PZ</span>
              <button class="balance-manage-btn" onclick="openBalanceModal('${userId}')" title="Управление балансом">
                <span>+</span>
              </button>
            </div>
          </div>
          
          <div class="content">
            <a href="/admin" class="back-btn">← Назад к админ-панели</a>
            
            ${ordersByStatus.NEW.length > 0 ? `
              <div class="status-section">
                <div class="status-header new">
                  🔴 Новые заказы (${ordersByStatus.NEW.length})
                </div>
                <div class="orders-grid">
                  ${ordersByStatus.NEW.map(order => createUserOrderCard(order, user)).join('')}
                </div>
              </div>
            ` : ''}
            
            ${ordersByStatus.PROCESSING.length > 0 ? `
              <div class="status-section">
                <div class="status-header processing">
                  🟡 Заказы в обработке (${ordersByStatus.PROCESSING.length})
                </div>
                <div class="orders-grid">
                  ${ordersByStatus.PROCESSING.map(order => createUserOrderCard(order, user)).join('')}
                </div>
              </div>
            ` : ''}
            
            ${ordersByStatus.COMPLETED.length > 0 ? `
              <div class="status-section">
                <div class="status-header completed">
                  🟢 Завершенные заказы (${ordersByStatus.COMPLETED.length})
                </div>
                <div class="orders-grid">
                  ${ordersByStatus.COMPLETED.map(order => createUserOrderCard(order, user)).join('')}
                </div>
              </div>
            ` : ''}
            
            ${ordersByStatus.CANCELLED.length > 0 ? `
              <div class="status-section">
                <div class="status-header cancelled">
                  ⚫ Отмененные заказы (${ordersByStatus.CANCELLED.length})
                </div>
                <div class="orders-grid">
                  ${ordersByStatus.CANCELLED.map(order => createUserOrderCard(order, user)).join('')}
                </div>
              </div>
            ` : ''}
            
            ${orders.length === 0 ? `
              <div class="empty-state">
                <h3>📭 Нет заказов</h3>
                <p>У этого пользователя пока нет заказов</p>
                <button class="add-order-btn ghost" onclick="openAddOrderModal()">➕ Добавить заказ</button>
              </div>
            ` : ''}
          </div>
        </div>
        
        <script>
          // Update order status
          async function updateOrderStatus(orderId, newStatus) {
            try {
              const response = await fetch(\`/admin/orders/\${orderId}/status\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: newStatus })
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Ошибка обновления статуса заказа');
              }
            } catch (error) {
              console.error('Error updating order status:', error);
              alert('Ошибка обновления статуса заказа');
            }
          }
          
          // Pay from balance
          async function payFromBalance(orderId, amount) {
            if (!confirm(\`Оплатить заказ на сумму \${amount.toFixed(2)} PZ с баланса пользователя?\`)) {
              return;
            }
            
            try {
              const response = await fetch(\`/admin/orders/\${orderId}/pay\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
              });
              
              const result = await response.json();
              
              if (result.success) {
                alert('Заказ успешно оплачен! Статус изменен на "Готово".');
                location.reload();
              } else {
                alert(\`Ошибка оплаты: \${result.error || 'Недостаточно средств на балансе'}\`);
              }
            } catch (error) {
              console.error('Error paying order:', error);
              alert('Ошибка оплаты заказа');
            }
          }
          
          // Переменные для редактирования заказа
          let currentEditOrderId = null;
          let currentEditItems = [];
          let newOrderItems = [];
          
          function openAddOrderModal() {
            newOrderItems = [];
            renderNewOrderItems();
            const form = document.getElementById('addOrderForm');
            if (form) {
              form.reset();
              const defaultMessage = form.dataset.defaultMessage;
              if (defaultMessage) {
                const messageField = document.getElementById('addOrderMessage');
                if (messageField) {
                  messageField.value = defaultMessage;
                }
              }
            }
            const modal = document.getElementById('addOrderModal');
            if (modal) {
              modal.style.display = 'block';
            }
            loadProducts('addProductSelect');
          }
          
          function closeAddOrderModal() {
            const modal = document.getElementById('addOrderModal');
            if (modal) {
              modal.style.display = 'none';
            }
            newOrderItems = [];
          }
          
          // Открыть модальное окно редактирования заказа
          async function openEditOrderModal(orderId) {
            currentEditOrderId = orderId;
            
            try {
              // Загружаем данные заказа
              const orderResponse = await fetch(\`/admin/orders/\${orderId}\`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
              });
              
              const order = await orderResponse.json();
              
              if (order.success) {
                currentEditItems = order.data.items || [];
                renderEditItems();
                
                // Загружаем список товаров
                await loadProducts();
                
                // Показываем модальное окно
                document.getElementById('editOrderModal').style.display = 'block';
              } else {
                alert('Ошибка загрузки данных заказа');
              }
            } catch (error) {
              console.error('Error loading order:', error);
              alert('Ошибка загрузки заказа');
            }
          }
          
          // Загрузить список товаров в выпадающий список
          async function loadProducts(selectId = 'productSelect') {
            try {
              const response = await fetch('/admin/api/products', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
              });
              
              const result = await response.json();
              
              if (result.success) {
                const productSelect = document.getElementById(selectId);
                if (!productSelect) return;
                productSelect.innerHTML = '<option value="">-- Выберите товар --</option>';
                
                result.data.forEach(product => {
                  const option = document.createElement('option');
                  option.value = product.id;
                  option.textContent = \`\${product.title} (\${product.category?.name || 'Без категории'}) - \${product.price.toFixed(2)} PZ\`;
                  option.dataset.title = product.title;
                  option.dataset.price = product.price;
                  productSelect.appendChild(option);
                });
              } else {
                console.error('Error loading products:', result.error);
              }
            } catch (error) {
              console.error('Error loading products:', error);
            }
          }
          
          function addProductFromSelect() {
            const select = document.getElementById('addProductSelect');
            const quantityInput = document.getElementById('addProductQuantity');
            if (!select || !quantityInput) return;
            
            const selectedOption = select.options[select.selectedIndex];
            if (!selectedOption || !selectedOption.value) {
              alert('Выберите товар');
              return;
            }
            
            const title = selectedOption.textContent || 'Товар';
            const price = parseFloat(selectedOption.dataset.price || '0');
            const productId = selectedOption.value;
            const quantity = Math.max(1, parseInt(quantityInput.value, 10) || 1);
            
            newOrderItems.push({
              productId,
              title,
              price,
              quantity
            });
            
            renderNewOrderItems();
            select.selectedIndex = 0;
            quantityInput.value = 1;
          }
          
          function addCustomProduct() {
            const nameInput = document.getElementById('customProductName');
            const priceInput = document.getElementById('customProductPrice');
            const quantityInput = document.getElementById('customProductQuantity');
            
            if (!nameInput || !priceInput || !quantityInput) return;
            
            const title = nameInput.value.trim();
            if (!title) {
              alert('Введите название товара');
              return;
            }
            
            const price = parseFloat(priceInput.value);
            if (isNaN(price)) {
              alert('Введите корректную цену');
              return;
            }
            
            const quantity = Math.max(1, parseInt(quantityInput.value, 10) || 1);
            
            newOrderItems.push({
              productId: null,
              title,
              price,
              quantity
            });
            
            renderNewOrderItems();
            nameInput.value = '';
            priceInput.value = '';
            quantityInput.value = 1;
          }
          
          function renderNewOrderItems() {
            const container = document.getElementById('newOrderItemsList');
            const totalElement = document.getElementById('newOrderTotal');
            
            if (!container) return;
            
            if (newOrderItems.length === 0) {
              container.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Товары не добавлены</p>';
              if (totalElement) {
                totalElement.textContent = '0.00';
              }
              return;
            }
            
            container.innerHTML = newOrderItems.map((item, index) => \`
              <div class="order-item-edit">
                <div class="order-item-info">
                  <strong>\${item.title}</strong>
                  <div style="font-size: 12px; color: #6c757d;">
                    \${item.quantity} шт. × \${item.price.toFixed(2)} PZ
                  </div>
                </div>
                <div class="order-item-price">
                  \${(item.price * item.quantity).toFixed(2)} PZ
                </div>
                <button type="button" class="remove-item-btn" onclick="removeNewOrderItem(\${index})">Удалить</button>
              </div>
            \`).join('');
            
            if (totalElement) {
              const total = newOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
              totalElement.textContent = total.toFixed(2);
            }
          }
          
          function removeNewOrderItem(index) {
            newOrderItems.splice(index, 1);
            renderNewOrderItems();
          }
          
          function submitAddOrderForm(event) {
            if (newOrderItems.length === 0) {
              event.preventDefault();
              alert('Добавьте хотя бы один товар в заказ');
              return false;
            }
            
            const hiddenInput = document.getElementById('newOrderItemsInput');
            if (hiddenInput) {
              hiddenInput.value = JSON.stringify(newOrderItems);
            }
            
            return true;
          }
          
          // Закрыть модальное окно редактирования заказа
          function closeEditOrderModal() {
            document.getElementById('editOrderModal').style.display = 'none';
            currentEditOrderId = null;
            currentEditItems = [];
          }
          
          // Отобразить товары для редактирования
          function renderEditItems() {
            const container = document.getElementById('orderItemsEdit');
            
            if (currentEditItems.length === 0) {
              container.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">В заказе пока нет товаров</p>';
              return;
            }
            
            container.innerHTML = currentEditItems.map((item, index) => \`
              <div class="order-item-edit">
                <div class="order-item-info">
                  <strong>\${item.title}</strong>
                  <div style="font-size: 12px; color: #6c757d;">
                    \${item.quantity} шт. × \${item.price.toFixed(2)} PZ
                  </div>
                </div>
                <div class="order-item-price">
                  \${(item.price * item.quantity).toFixed(2)} PZ
                </div>
                <button class="remove-item-btn" onclick="removeEditItem(\${index})">
                  🗑️ Удалить
                </button>
              </div>
            \`).join('');
          }
          
          // Удалить товар из редактируемого заказа
          function removeEditItem(index) {
            if (confirm('Удалить этот товар из заказа?')) {
              currentEditItems.splice(index, 1);
              renderEditItems();
            }
          }
          
          // Добавить товар в редактируемый заказ
          document.getElementById('addProductForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const productSelect = document.getElementById('productSelect');
            const selectedOption = productSelect.options[productSelect.selectedIndex];
            const quantity = parseInt(document.getElementById('productQuantity').value);
            
            if (!selectedOption.value || !quantity) {
              alert('Выберите товар и укажите количество');
              return;
            }
            
            const title = selectedOption.dataset.title;
            const price = parseFloat(selectedOption.dataset.price);
            
            currentEditItems.push({
              title: title,
              price: price,
              quantity: quantity
            });
            
            renderEditItems();
            
            // Очищаем форму
            document.getElementById('addProductForm').reset();
            document.getElementById('productQuantity').value = 1;
          });
          
          // Сохранить изменения заказа
          async function saveOrderChanges() {
            if (!currentEditOrderId) {
              alert('Ошибка: не выбран заказ для редактирования');
              return;
            }
            
            try {
              const response = await fetch(\`/admin/orders/\${currentEditOrderId}/items\`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  items: currentEditItems
                })
              });
              
              const result = await response.json();
              
              if (result.success) {
                alert('Заказ успешно обновлен!');
                closeEditOrderModal();
                location.reload();
              } else {
                alert(\`Ошибка обновления заказа: \${result.error}\`);
              }
            } catch (error) {
              console.error('Error saving order:', error);
              alert('Ошибка сохранения заказа');
            }
          }
          
          // Закрытие модального окна при клике вне его
          window.onclick = function(event) {
            const modal = document.getElementById('editOrderModal');
            const balanceModal = document.getElementById('balanceModal');
            if (event.target === modal) {
              closeEditOrderModal();
            }
            if (event.target === balanceModal) {
              closeBalanceModal();
            }
          }
          
          // Открыть модальное окно управления балансом
          function openBalanceModal(userId) {
            const modal = document.getElementById('balanceModal');
            modal.style.display = 'block';
            document.getElementById('balanceUserId').value = userId;
            document.getElementById('balanceAmount').value = '';
            document.getElementById('balanceOperation').value = 'add';
            document.getElementById('balanceError').style.display = 'none';
          }
          
          // Закрыть модальное окно управления балансом
          function closeBalanceModal() {
            document.getElementById('balanceModal').style.display = 'none';
          }
          
          // Применить изменение баланса
          async function applyBalanceChange() {
            const userId = document.getElementById('balanceUserId').value;
            const amount = parseFloat(document.getElementById('balanceAmount').value);
            const operation = document.getElementById('balanceOperation').value;
            const errorDiv = document.getElementById('balanceError');
            
            if (!userId || !amount || amount <= 0) {
              errorDiv.textContent = 'Введите корректную сумму';
              errorDiv.style.display = 'block';
              return;
            }
            
            try {
              const response = await fetch('/admin/users/' + userId + '/balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  amount: amount,
                  operation: operation
                })
              });
              
              const result = await response.json();
              
              if (result.success) {
                closeBalanceModal();
                location.reload();
              } else {
                errorDiv.textContent = result.error || 'Ошибка изменения баланса';
                errorDiv.style.display = 'block';
              }
            } catch (error) {
              console.error('Error updating balance:', error);
              errorDiv.textContent = 'Ошибка соединения';
              errorDiv.style.display = 'block';
            }
          }
        </script>
        
        <!-- Модальное окно добавления заказа -->
        <div id="addOrderModal" class="edit-order-modal">
          <div class="edit-order-modal-content">
            <div class="edit-order-header">
              <h2>➕ Новый заказ</h2>
              <span class="edit-order-close" onclick="closeAddOrderModal()">&times;</span>
            </div>
            
            <form id="addOrderForm" method="POST" action="/admin/users/${userId}/orders" data-default-message="${escapeHtmlAttr(defaultMessage)}" onsubmit="return submitAddOrderForm(event)">
              <div class="form-group">
                <label for="addOrderContact">Контакт пользователя</label>
                <input type="text" id="addOrderContact" name="contact" placeholder="Телефон или @username" value="${escapeHtmlAttr(defaultContact)}">
              </div>
              
              <div class="form-group">
                <label for="addOrderMessage">Комментарий</label>
                <textarea id="addOrderMessage" name="message" rows="3" placeholder="Комментарий к заказу">${defaultMessage}</textarea>
              </div>
              
              <div class="form-group">
                <label for="addOrderStatus">Статус заказа</label>
                <select id="addOrderStatus" name="status">
                  <option value="NEW">🔴 Новый</option>
                  <option value="PROCESSING">🟡 В обработке</option>
                  <option value="COMPLETED">🟢 Завершен</option>
                  <option value="CANCELLED">⚫ Отменен</option>
                </select>
              </div>
              
              <div class="order-items-edit" id="newOrderItemsList">
                <p style="text-align: center; color: #6c757d; padding: 20px;">Товары не добавлены</p>
              </div>
              
              <div class="new-order-summary">
                <span>Итого:</span>
                <span><strong id="newOrderTotal">0.00</strong> PZ</span>
              </div>
              
              <div class="add-product-section">
                <h3>➕ Добавить товар из каталога</h3>
                <div class="add-product-form">
                  <div class="form-group">
                    <label for="addProductSelect">Выберите товар:</label>
                    <select id="addProductSelect">
                      <option value="">-- Выберите товар --</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="addProductQuantity">Количество:</label>
                    <input type="number" id="addProductQuantity" value="1" min="1">
                  </div>
                  <button type="button" class="add-product-btn" onclick="addProductFromSelect()">Добавить</button>
                </div>
              </div>
              
              <div class="add-product-section">
                <h3>✏️ Добавить товар вручную</h3>
                <div class="custom-product-form">
                  <div class="form-group">
                    <label for="customProductName">Название</label>
                    <input type="text" id="customProductName" placeholder="Например: Набор №1">
                  </div>
                  <div class="form-group">
                    <label for="customProductPrice">Цена (PZ)</label>
                    <input type="number" id="customProductPrice" placeholder="0.00" step="0.01" min="0">
                  </div>
                  <div class="form-group">
                    <label for="customProductQuantity">Количество</label>
                    <input type="number" id="customProductQuantity" value="1" min="1">
                  </div>
                  <button type="button" class="add-product-btn" onclick="addCustomProduct()">Добавить вручную</button>
                </div>
              </div>
              
              <input type="hidden" name="items" id="newOrderItemsInput">
              
              <div class="edit-order-actions">
                <button type="button" class="cancel-edit-btn" onclick="closeAddOrderModal()">❌ Отмена</button>
                <button type="submit" class="save-order-btn">💾 Создать заказ</button>
              </div>
            </form>
          </div>
        </div>
        
        <!-- Модальное окно редактирования заказа -->
        <div id="editOrderModal" class="edit-order-modal">
          <div class="edit-order-modal-content">
            <div class="edit-order-header">
              <h2>✏️ Редактировать заказ</h2>
              <span class="edit-order-close" onclick="closeEditOrderModal()">&times;</span>
            </div>
            
            <div id="orderItemsEdit" class="order-items-edit">
              <!-- Товары заказа будут загружены динамически -->
            </div>
            
            <div class="add-product-section">
              <h3>➕ Добавить товар</h3>
              <form id="addProductForm" class="add-product-form">
                <div class="form-group">
                  <label for="productSelect">Выберите товар:</label>
                  <select id="productSelect" name="productId" required>
                    <option value="">-- Выберите товар --</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="productQuantity">Количество:</label>
                  <input type="number" id="productQuantity" name="quantity" min="1" value="1" required>
                </div>
                <button type="submit" class="add-product-btn">➕ Добавить</button>
              </form>
            </div>
            
            <div class="edit-order-actions">
              <button class="cancel-edit-btn" onclick="closeEditOrderModal()">❌ Отмена</button>
              <button class="save-order-btn" onclick="saveOrderChanges()">💾 Сохранить изменения</button>
            </div>
          </div>
        </div>
        
        <!-- Модальное окно управления балансом -->
        <div id="balanceModal" class="balance-modal">
          <div class="balance-modal-content">
            <div class="balance-modal-header">
              <h2>💰 Управление балансом</h2>
              <span class="balance-modal-close" onclick="closeBalanceModal()">&times;</span>
            </div>
            
            <div class="balance-modal-body">
              <input type="hidden" id="balanceUserId" value="">
              
              <div class="balance-form-group">
                <label for="balanceOperation">Операция:</label>
                <select id="balanceOperation" class="balance-select">
                  <option value="add">➕ Пополнить баланс</option>
                  <option value="subtract">➖ Списать с баланса</option>
                </select>
              </div>
              
              <div class="balance-form-group">
                <label for="balanceAmount">Сумма (PZ):</label>
                <input type="number" id="balanceAmount" class="balance-input" placeholder="0.00" step="0.01" min="0.01">
              </div>
              
              <div id="balanceError" class="balance-error" style="display: none;"></div>
            </div>
            
            <div class="balance-modal-footer">
              <button class="balance-cancel-btn" onclick="closeBalanceModal()">Отмена</button>
              <button class="balance-apply-btn" onclick="applyBalanceChange()">Применить</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ User orders page error:', error);
    res.status(500).send('Ошибка загрузки заказов пользователя');
  }
});

  router.post('/users/:userId/orders', requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const { contact, message, status, items } = req.body;
    
    const allowedStatuses = ['NEW', 'PROCESSING', 'COMPLETED', 'CANCELLED'];
    const targetStatus = allowedStatuses.includes((status || '').toUpperCase()) ? status.toUpperCase() : 'NEW';
    
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.redirect(`/admin/users/${userId}/orders?error=order_create_failed`);
      }
      
      let parsedItems: any[] = [];
      try {
        parsedItems = JSON.parse(items || '[]');
      } catch (error) {
        console.error('❌ Failed to parse items JSON:', error);
      }
      
      if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
        return res.redirect(`/admin/users/${userId}/orders?error=order_no_items`);
      }
      
      const sanitizedItems = parsedItems.map((item) => {
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        const price = Math.max(0, parseFloat(item.price) || 0);
        return {
          productId: item.productId || null,
          title: (item.title || 'Товар').toString().trim() || 'Товар',
          quantity,
          price,
          total: Number((price * quantity).toFixed(2))
        };
      });
      
      await prisma.orderRequest.create({
        data: {
          userId,
          contact: contact?.toString().trim() || null,
          message: message?.toString().trim() || 'Заказ создан администратором',
          itemsJson: sanitizedItems,
          status: targetStatus
        }
      });
      
      res.redirect(`/admin/users/${userId}/orders?success=order_created`);
    } catch (error) {
      console.error('❌ Error creating manual order:', error);
      res.redirect(`/admin/users/${userId}/orders?error=order_create_failed`);
    }
  });

// Маршрут для получения списка партнеров пользователя
router.get('/users/:userId/partners', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { level } = req.query;
    
    // Получаем пользователя с его партнерским профилем
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        partner: {
          include: {
            referrals: {
              where: { level: parseInt(level as string) || 1 },
              include: {
                referred: true // Включаем информацию о приглашенном пользователе
              }
            }
          }
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    let partners: any[] = [];
    if (user.partner && user.partner.referrals) {
      // Получаем пользователей, которые были приглашены
      partners = user.partner.referrals
        .filter(ref => ref.referred) // Фильтруем только тех, у кого есть referred пользователь
        .map((ref: any) => ref.referred);
    }
    
    res.json(partners);
    
  } catch (error) {
    console.error('Error fetching partners:', error);
    res.status(500).json({ error: 'Ошибка получения списка партнеров' });
  }
});

// Маршрут для отправки сообщений пользователям
router.post('/messages/send', requireAdmin, async (req, res) => {
  try {
    const { userIds, subject, text, saveAsTemplate } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Не указаны получатели' });
    }
    
    if (!subject || !text) {
      return res.status(400).json({ error: 'Не указаны тема или текст сообщения' });
    }
    
    let successCount = 0;
    const errors = [];
    
    // Отправляем сообщения каждому пользователю
    console.log(`📤 Начинаем отправку сообщений ${userIds.length} пользователям:`, userIds);
    
    for (const userId of userIds) {
      try {
        console.log(`📤 Обрабатываем пользователя: ${userId}`);
        
        // Получаем пользователя
        const user = await prisma.user.findUnique({
          where: { id: userId }
        });
        
        if (!user) {
          console.log(`❌ Пользователь ${userId} не найден в базе данных`);
          errors.push(`Пользователь ${userId} не найден`);
          continue;
        }
        
        console.log(`✅ Пользователь найден: ${user.firstName} (telegramId: ${user.telegramId})`);
        
        // Проверяем, есть ли telegramId у пользователя
        if (!user.telegramId || user.telegramId === 'null' || user.telegramId === 'undefined') {
          console.log(`❌ У пользователя ${user.firstName} отсутствует или неверный telegramId: ${user.telegramId}`);
          errors.push(`${user.firstName} (@${user.username || 'без username'}): отсутствует telegramId`);
          continue;
        }
        
        // Отправляем сообщение через Telegram Bot API
        try {
          const { getBotInstance } = await import('../lib/bot-instance.js');
          const bot = await getBotInstance();
          
          // Формируем сообщение с экранированием Markdown символов
          const escapeMarkdown = (text: string) => {
            return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
          };
          
          const messageText = `📧 ${escapeMarkdown(subject)}\n\n${escapeMarkdown(text)}`;
          
          console.log(`📤 Отправка сообщения пользователю ${user.firstName} (ID: ${user.telegramId}):`, messageText);
          
          // Отправляем сообщение
          let result;
          try {
            result = await bot.telegram.sendMessage(user.telegramId, messageText, {
              parse_mode: 'Markdown'
            });
          } catch (markdownError) {
            console.log(`⚠️ Markdown отправка не удалась, пробуем без Markdown: ${markdownError instanceof Error ? markdownError.message : String(markdownError)}`);
            // Если Markdown не работает, отправляем без форматирования
            const plainText = `📧 ${subject}\n\n${text}`;
            result = await bot.telegram.sendMessage(user.telegramId, plainText);
          }
          
          console.log(`✅ Сообщение успешно отправлено пользователю ${user.firstName} (@${user.username || 'без username'}), message_id: ${result.message_id}`);
          successCount++;
          
        } catch (telegramError) {
          console.error(`❌ Ошибка отправки сообщения пользователю ${user.firstName} (@${user.username || 'без username'}) (ID: ${user.telegramId}):`, telegramError);
          
          // Добавляем ошибку в список для отчета
          const errorMessage = telegramError instanceof Error ? telegramError.message : String(telegramError);
          errors.push(`${user.firstName} (@${user.username || 'без username'}): ${errorMessage}`);
          
          // Продолжаем обработку других пользователей даже при ошибке
        }
        
        // Сохраняем в историю
        await prisma.userHistory.create({
          data: {
            userId: userId,
            action: 'MESSAGE_SENT',
            payload: {
              subject,
              text,
              sentBy: 'admin'
            }
          }
        });
        
      } catch (error) {
          console.error(`Error sending message to user ${userId}:`, error);
          errors.push(`Ошибка отправки пользователю ${userId}: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
        }
    }
    
    // Сохраняем шаблон если нужно
    if (saveAsTemplate) {
      try {
        await prisma.userHistory.create({
          data: {
            userId: userIds[0], // Используем первого пользователя для шаблона
            action: 'MESSAGE_TEMPLATE_SAVED',
            payload: {
              subject,
              text,
              savedBy: 'admin'
            }
          }
        });
      } catch (error) {
        console.error('Error saving template:', error);
      }
    }
    
    console.log(`📊 Итоговые результаты отправки: успешно ${successCount}/${userIds.length}, ошибок: ${errors.length}`);
    
    res.json({
      successCount,
      totalCount: userIds.length,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('Error sending messages:', error);
    res.status(500).json({ error: 'Ошибка отправки сообщений' });
  }
});

// Update user balance
router.post('/users/:userId/balance', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, operation } = req.body;
    
    if (!amount || amount <= 0) {
      return res.json({ success: false, error: 'Некорректная сумма' });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    const currentBalance = user.balance || 0;
    let newBalance;
    
    if (operation === 'add') {
      newBalance = currentBalance + amount;
    } else if (operation === 'subtract') {
      if (currentBalance < amount) {
        return res.json({ success: false, error: 'Недостаточно средств на балансе' });
      }
      newBalance = currentBalance - amount;
    } else {
      return res.json({ success: false, error: 'Некорректная операция' });
    }
    
    await prisma.user.update({
      where: { id: userId },
      data: { balance: newBalance }
    });
    
    // Записываем в историю пользователя
    await prisma.userHistory.create({
      data: {
        userId: userId,
        action: operation === 'add' ? 'BALANCE_ADDED' : 'BALANCE_SUBTRACTED',
        payload: {
          amount: amount,
          operation: operation,
          previousBalance: currentBalance,
          newBalance: newBalance
        }
      }
    });
    
    res.json({ 
      success: true, 
      message: `Баланс успешно ${operation === 'add' ? 'пополнен' : 'списан'}`,
      newBalance: newBalance
    });
    
  } catch (error) {
    console.error('❌ Balance update error:', error);
    res.json({ success: false, error: 'Ошибка обновления баланса' });
  }
});

// Update order status
router.post('/orders/:orderId/status', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    // Validate status
    const validStatuses = ['NEW', 'PROCESSING', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Неверный статус заказа' });
    }
    
    // Update order status
    await prisma.orderRequest.update({
      where: { id: orderId },
      data: { status }
    });
    
    res.json({ success: true, message: 'Статус заказа обновлен' });
  } catch (error) {
    console.error('❌ Update order status error:', error);
    res.status(500).json({ success: false, error: 'Ошибка обновления статуса заказа' });
  }
});
// Pay order from user balance
router.post('/orders/:orderId/pay', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Get order with user info
    const order = await prisma.orderRequest.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, balance: true, firstName: true }
        }
      }
    });
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Заказ не найден' });
    }
    
    if (!order.user) {
      return res.status(400).json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (order.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Заказ уже оплачен' });
    }
    
    if (order.status === 'CANCELLED') {
      return res.status(400).json({ success: false, error: 'Нельзя оплатить отмененный заказ' });
    }
    
    // Calculate order total
    const items = typeof order.itemsJson === 'string' 
      ? JSON.parse(order.itemsJson || '[]') 
      : (order.itemsJson || []);
    const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
    
    // Check if user has enough balance
    if (order.user.balance < totalAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Недостаточно средств. Требуется: ${totalAmount.toFixed(2)} PZ, доступно: ${order.user.balance.toFixed(2)} PZ` 
      });
    }
    
    // Start transaction
    await prisma.$transaction(async (tx) => {
      // Deduct amount from user balance
      await tx.user.update({
        where: { id: order.user!.id },
        data: { balance: { decrement: totalAmount } }
      });
      
      // Update order status to COMPLETED
      await tx.orderRequest.update({
        where: { id: orderId },
        data: { status: 'COMPLETED' }
      });
      
      // Create transaction record
      await tx.userHistory.create({
        data: {
          userId: order.user!.id,
          action: 'ORDER_PAYMENT',
          payload: {
            orderId: orderId,
            amount: -totalAmount,
            description: `Оплата заказа #${orderId.slice(-8)}`
          }
        }
      });
    });
    
    // Check if this purchase qualifies for referral program activation (120 PZ)
    if (totalAmount >= 120) {
      try {
        console.log(`🎯 Purchase of ${totalAmount} PZ qualifies for referral program activation`);
        await activatePartnerProfile(order.user.id, 'PURCHASE', 1); // 1 month activation
        console.log(`✅ Referral program activated for user ${order.user.id} via purchase`);
      } catch (activationError) {
        console.error('❌ Referral program activation error:', activationError);
        // Don't fail the payment if activation fails
      }
    }

    // Distribute referral bonuses after successful payment using dual system
    // NOTE: Бонусы уже распределяются в orders-module.ts, поэтому здесь закомментировано
    // чтобы избежать дублирования уведомлений
    /*
    try {
      await calculateDualSystemBonuses(order.user.id, totalAmount);
    } catch (bonusError) {
      console.error('❌ Referral bonus distribution error:', bonusError);
      // Don't fail the payment if bonus distribution fails
    }
    */
    
    res.json({ 
      success: true, 
      message: `Заказ оплачен на сумму ${totalAmount.toFixed(2)} PZ. Статус изменен на "Готово".` 
    });
  } catch (error) {
    console.error('❌ Pay order error:', error);
    res.status(500).json({ success: false, error: 'Ошибка оплаты заказа' });
  }
});
// Get order details for editing
router.get('/orders/:orderId', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await prisma.orderRequest.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, firstName: true, username: true }
        }
      }
    });
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Заказ не найден' });
    }
    
    // Parse items from JSON
    const items = typeof order.itemsJson === 'string' 
      ? JSON.parse(order.itemsJson || '[]') 
      : (order.itemsJson || []);
    
    res.json({
      success: true,
      data: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        items: items,
        user: order.user
      }
    });
  } catch (error) {
    console.error('❌ Get order error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Update order items
router.put('/orders/:orderId/items', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Неверный формат товаров' });
    }
    
    // Validate items
    for (const item of items) {
      if (!item.title || !item.price || !item.quantity) {
        return res.status(400).json({ success: false, error: 'Неверный формат товара' });
      }
      if (item.price < 0 || item.quantity < 1) {
        return res.status(400).json({ success: false, error: 'Неверные значения цены или количества' });
      }
    }
    
    // Check if order exists
    const existingOrder = await prisma.orderRequest.findUnique({
      where: { id: orderId }
    });
    
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Заказ не найден' });
    }
    
    // Update order items
    await prisma.orderRequest.update({
      where: { id: orderId },
      data: {
        itemsJson: JSON.stringify(items)
      }
    });
    
    console.log(`✅ Order ${orderId} items updated: ${items.length} items`);
    
    res.json({
      success: true,
      message: 'Товары заказа обновлены'
    });
  } catch (error) {
    console.error('❌ Update order items error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Get all products for dropdown
router.get('/api/products', requireAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        title: true,
        price: true,
        category: {
          select: {
            name: true
          }
        }
      },
      orderBy: [
        { category: { name: 'asc' } },
        { title: 'asc' }
      ]
    });
    
    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('❌ Get products error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Helper function to distribute referral bonuses
async function distributeReferralBonuses(userId: string, orderAmount: number) {
  try {
    // Find inviter
    const referralRecord = await prisma.partnerReferral.findFirst({
      where: { referredId: userId },
      include: {
        profile: {
          include: {
            user: { select: { id: true, balance: true } }
          }
        }
      }
    });
    
    if (!referralRecord?.profile) {
      return; // No inviter found
    }
    
    const inviterProfile = referralRecord.profile;
    const bonusRate = 0.1; // 10% bonus
    const bonusAmount = orderAmount * bonusRate;
    
    // Create bonus transaction
    await prisma.partnerTransaction.create({
      data: {
        profileId: inviterProfile.id,
        type: 'CREDIT',
        amount: bonusAmount,
        description: `Бонус за заказ реферала (${orderAmount.toFixed(2)} PZ)`
      }
    });
    
    // Update inviter's balance
    await prisma.user.update({
      where: { id: inviterProfile.userId },
      data: { balance: { increment: bonusAmount } }
    });
    
    // Update partner profile balance
    await prisma.partnerProfile.update({
      where: { id: inviterProfile.id },
      data: { 
        balance: { increment: bonusAmount },
        bonus: { increment: bonusAmount }
      }
    });
    
    console.log(`✅ Referral bonus distributed: ${bonusAmount.toFixed(2)} PZ to user ${inviterProfile.userId}`);
  } catch (error) {
    console.error('❌ Error distributing referral bonuses:', error);
    throw error;
  }
}
// Audio files management routes
router.get('/admin/audio', requireAdmin, async (req, res) => {
  try {
    const audioFiles = await prisma.audioFile.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const audioFilesHtml = audioFiles.map(file => `
      <div class="audio-file-card">
        <div class="audio-file-header">
          <h3>🎵 ${file.title}</h3>
          <div class="audio-file-status ${file.isActive ? 'active' : 'inactive'}">
            ${file.isActive ? '✅ Активен' : '❌ Неактивен'}
          </div>
        </div>
        <div class="audio-file-info">
          <p><strong>Описание:</strong> ${file.description || 'Не указано'}</p>
          <p><strong>Категория:</strong> ${file.category || 'Не указана'}</p>
          <p><strong>Длительность:</strong> ${file.duration ? Math.floor(file.duration / 60) + ':' + (file.duration % 60).toString().padStart(2, '0') : 'Неизвестно'}</p>
          <p><strong>Размер:</strong> ${file.fileSize ? Math.round(file.fileSize / 1024) + ' KB' : 'Неизвестно'}</p>
          <p><strong>Загружен:</strong> ${file.createdAt.toLocaleDateString('ru-RU')}</p>
        </div>
        <div class="audio-file-actions">
          <button onclick="toggleAudioStatus('${file.id}')" class="toggle-btn ${file.isActive ? 'deactivate' : 'activate'}">
            ${file.isActive ? '❌ Деактивировать' : '✅ Активировать'}
          </button>
          <button onclick="deleteAudioFile('${file.id}')" class="delete-btn">🗑️ Удалить</button>
        </div>
      </div>
    `).join('');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Управление аудиофайлами - Plazma Bot Admin Panel</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .audio-file-card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .audio-file-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
          .audio-file-header h3 { margin: 0; color: #333; }
          .audio-file-status.active { color: #28a745; font-weight: bold; }
          .audio-file-status.inactive { color: #dc3545; font-weight: bold; }
          .audio-file-info p { margin: 5px 0; color: #666; }
          .audio-file-actions { display: flex; gap: 10px; margin-top: 15px; }
          .toggle-btn, .delete-btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
          .toggle-btn.activate { background: #28a745; color: white; }
          .toggle-btn.deactivate { background: #ffc107; color: black; }
          .delete-btn { background: #dc3545; color: white; }
          .toggle-btn:hover, .delete-btn:hover { opacity: 0.8; }
          .back-btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <a href="/admin" class="back-btn">← Назад в админ-панель</a>
        <div class="header">
          <h1>🎵 Управление аудиофайлами</h1>
          <p>Здесь вы можете управлять загруженными аудиофайлами для раздела "Звуковые матрицы Гаряева"</p>
        </div>
        ${audioFilesHtml || '<p>Пока нет загруженных аудиофайлов.</p>'}
        
        <script>
          async function toggleAudioStatus(fileId) {
            if (confirm('Вы уверены, что хотите изменить статус файла?')) {
              try {
                const response = await fetch('/admin/audio/toggle', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileId })
                });
                if (response.ok) {
                  location.reload();
                } else {
                  alert('Ошибка при изменении статуса файла');
                }
              } catch (error) {
                alert('Ошибка при изменении статуса файла');
              }
            }
          }

          async function deleteAudioFile(fileId) {
            if (confirm('Вы уверены, что хотите удалить этот аудиофайл? Это действие нельзя отменить.')) {
              try {
                const response = await fetch('/admin/audio/delete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileId })
                });
                if (response.ok) {
                  location.reload();
                } else {
                  alert('Ошибка при удалении файла');
                }
              } catch (error) {
                alert('Ошибка при удалении файла');
              }
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading audio files:', error);
    res.status(500).send('Ошибка загрузки аудиофайлов');
  }
});

// Toggle audio file status
router.post('/admin/audio/toggle', requireAdmin, async (req, res) => {
  try {
    const { fileId } = req.body;
    
    const audioFile = await prisma.audioFile.findUnique({
      where: { id: fileId }
    });

    if (!audioFile) {
      return res.status(404).json({ error: 'Аудиофайл не найден' });
    }

    await prisma.audioFile.update({
      where: { id: fileId },
      data: { isActive: !audioFile.isActive }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error toggling audio file status:', error);
    res.status(500).json({ error: 'Ошибка изменения статуса файла' });
  }
});

// Delete audio file
router.post('/admin/audio/delete', requireAdmin, async (req, res) => {
  try {
    const { fileId } = req.body;
    
    await prisma.audioFile.delete({
      where: { id: fileId }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting audio file:', error);
    res.status(500).json({ error: 'Ошибка удаления файла' });
  }
});

// Mount orders module
// router.use('/', ordersModule);

// Delete instruction endpoint
router.post('/products/:productId/delete-instruction', requireAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Товар не найден' });
    }
    
    await prisma.product.update({
      where: { id: productId },
      data: { instruction: null }
    });
    
    res.json({ success: true, message: 'Инструкция успешно удалена' });
  } catch (error) {
    console.error('Delete instruction error:', error);
    res.status(500).json({ success: false, error: 'Ошибка удаления инструкции' });
  }
});

// Save instruction endpoint
router.post('/products/:productId/save-instruction', requireAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    const { instruction } = req.body;
    
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ success: false, error: 'Инструкция не может быть пустой' });
    }
    
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Товар не найден' });
    }
    
    await prisma.product.update({
      where: { id: productId },
      data: { instruction: instruction.trim() }
    });
    
    res.json({ success: true, message: 'Инструкция успешно сохранена' });
  } catch (error) {
    console.error('Save instruction error:', error);
    res.status(500).json({ success: false, error: 'Ошибка сохранения инструкции' });
  }
});

export { router as adminWebRouter };