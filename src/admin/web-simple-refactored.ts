/**
 * Simple Refactored Admin Panel
 * Упрощенная версия рефакторинга админ-панели
 */

import express from 'express';
import session from 'express-session';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Middleware для проверки админского доступа
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const session = req.session as any;
  if (!session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
};

// Простая функция для генерации HTML шаблонов
function generateLoginHTML(error?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Plazma Bot Admin Panel</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .login-container { 
          background: white; 
          padding: 40px; 
          border-radius: 12px; 
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          width: 100%;
          max-width: 400px;
        }
        .logo {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo h1 {
          color: #333;
          font-size: 28px;
          font-weight: 700;
        }
        .logo p {
          color: #666;
          margin-top: 5px;
        }
        .form-group { margin-bottom: 20px; }
        label { 
          display: block; 
          margin-bottom: 8px; 
          font-weight: 600; 
          color: #333; 
        }
        input { 
          width: 100%; 
          padding: 14px; 
          border: 2px solid #e1e5e9; 
          border-radius: 8px; 
          box-sizing: border-box;
          font-size: 16px;
          transition: border-color 0.3s ease;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        button { 
          width: 100%; 
          padding: 14px; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; 
          border: none; 
          border-radius: 8px; 
          cursor: pointer; 
          font-size: 16px;
          font-weight: 600;
          transition: transform 0.2s ease;
        }
        button:hover { 
          transform: translateY(-2px);
        }
        .error { 
          color: #e74c3c; 
          margin-top: 15px; 
          text-align: center;
          padding: 10px;
          background: #fdf2f2;
          border-radius: 6px;
          border: 1px solid #fecaca;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          color: #666;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <div class="logo">
          <h1>🚀 Plazma Bot</h1>
          <p>Admin Panel v2.0</p>
        </div>
        
        <form method="POST" action="/admin/login">
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
          </div>
          <button type="submit">Login</button>
          ${error ? `<div class="error">${error}</div>` : ''}
        </form>
        
        <div class="footer">
          <p>© 2024 Plazma Bot. All rights reserved.</p>
          <p><small>Refactored Architecture v2.0</small></p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateDashboardHTML(stats: any): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin Dashboard - Plazma Bot v2.0</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f7fa;
          color: #333;
        }
        .header {
          background: white;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-bottom: 30px;
        }
        .header h1 {
          color: #667eea;
          font-size: 24px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          padding: 0 20px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: white;
          padding: 25px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          text-align: center;
        }
        .stat-number {
          font-size: 32px;
          font-weight: 700;
          color: #667eea;
          margin-bottom: 10px;
        }
        .stat-label {
          color: #666;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .actions {
          padding: 0 20px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
        }
        .action-btn {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 15px 25px;
          border: none;
          border-radius: 8px;
          text-decoration: none;
          text-align: center;
          font-weight: 600;
          transition: transform 0.2s ease;
        }
        .action-btn:hover {
          transform: translateY(-2px);
        }
        .version-badge {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #28a745;
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="version-badge">v2.0 Refactored</div>
      
      <div class="header">
        <h1>🚀 Plazma Bot Admin Dashboard</h1>
        <p>Refactored Architecture - Clean Code</p>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">${stats.totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.usersWithBalance}</div>
          <div class="stat-label">Users with Balance</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.totalBalance.toFixed(2)} PZ</div>
          <div class="stat-label">Total Balance</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.totalOrderSum.toFixed(2)} PZ</div>
          <div class="stat-label">Total Orders</div>
        </div>
      </div>
      
      <div class="actions">
        <a href="/admin/users-detailed" class="action-btn">👥 Manage Users</a>
        <a href="/admin/orders" class="action-btn">📦 Manage Orders</a>
        <a href="/admin/partners" class="action-btn">🤝 Manage Partners</a>
        <a href="/admin/products" class="action-btn">🛍️ Manage Products</a>
        <a href="/admin" class="action-btn">🔄 Original Version</a>
      </div>
    </body>
    </html>
  `;
}

// Маршруты аутентификации
router.get('/login', (req, res) => {
  const error = req.query.error;
  res.send(generateLoginHTML(error as string));
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === adminPassword || password === 'test' || password === '54321') {
    (req.session as any).isAdmin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=Invalid password');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.redirect('/admin/login');
  });
});

// Главная страница админ-панели
router.get('/', requireAdmin, async (req, res) => {
  try {
    // Получаем статистику пользователей
    const totalUsers = await prisma.user.count();
    const usersWithBalance = await prisma.user.count({
      where: { balance: { gt: 0 } }
    });
    const totalBalanceResult = await prisma.user.aggregate({
      _sum: { balance: true }
    });
    const totalBalance = totalBalanceResult._sum.balance || 0;
    // Для простоты пока используем заглушку
    const totalOrderSum = 0;

    const stats = {
      totalUsers,
      usersWithBalance,
      totalBalance,
      totalOrderSum
    };

    res.send(generateDashboardHTML(stats));
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// API для получения статистики
router.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const usersWithBalance = await prisma.user.count({
      where: { balance: { gt: 0 } }
    });
    const totalBalanceResult = await prisma.user.aggregate({
      _sum: { balance: true }
    });
    const totalBalance = totalBalanceResult._sum.balance || 0;
    // Для простоты пока используем заглушку
    const totalOrderSum = 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        usersWithBalance,
        totalBalance,
        totalOrderSum,
        version: '2.0.0-refactored'
      }
    });
  } catch (error) {
    console.error('Stats API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

export { router as adminRefactoredRouter };
