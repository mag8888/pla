import express from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { uploadImage } from '../services/cloudinary-service.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Main Promotions page
router.get('/', async (req, res) => {
  const promotions = await prisma.promotion.findMany({
    orderBy: { sortOrder: 'asc' }
  });

  res.send(`
    ${renderAdminHeader('Акции и спецпредложения')}
    
    <div class="table-controls">
      <button class="btn btn-primary" onclick="openPromotionModal()">
        + Добавить акцию
      </button>
    </div>

    <div class="users-table-container">
      <table class="users-table">
        <thead>
          <tr>
            <th>Сорт.</th>
            <th>Изображение</th>
            <th>Название / Описание</th>
            <th>Кнопка</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${promotions.map(p => `
            <tr>
              <td>${p.sortOrder}</td>
              <td>
                ${p.imageUrl ? `<img src="${p.imageUrl}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px;">` : '<span style="color:#ccc;">Нет фото</span>'}
              </td>
              <td>
                <div style="font-weight:600;">${p.title}</div>
                <div style="font-size:12px; color:#666; max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.description || ''}</div>
              </td>
              <td>
                ${p.buttonText ? `<span class="badge badge-info">${p.buttonText}</span>` : '<span style="color:#ccc;">—</span>'}
                ${p.buttonLink ? `<div style="font-size:10px; color:#999;">${p.buttonLink}</div>` : ''}
              </td>
              <td>
                <span class="status-badge ${p.isActive ? 'status-active' : 'status-inactive'}">
                  ${p.isActive ? 'Активна' : 'Скрыта'}
                </span>
              </td>
              <td class="actions-cell">
                <button class="action-btn" onclick='editPromotion(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
                  ✏️
                </button>
                <button class="action-btn btn-danger" onclick="deletePromotion('${p.id}')">
                  🗑️
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <div id="promotionModal" class="modal">
      <div class="modal-content" style="max-width: 550px;">
        <div class="modal-header">
          <h2 id="modalTitle">Добавить акцию</h2>
          <button class="close-btn" onclick="closePromotionModal()">×</button>
        </div>
        <form id="promotionForm" enctype="multipart/form-data">
          <input type="hidden" name="id" id="promoId">
          <div class="modal-body">
            <div class="form-group">
              <label>Название акции *</label>
              <input type="text" name="title" id="promoTitle" required placeholder="Например: Скидка 20%">
            </div>
            
            <div class="form-group">
              <label>Описание</label>
              <textarea name="description" id="promoDescription" rows="3" placeholder="Краткое описание условий..."></textarea>
            </div>

            <div class="form-group">
              <label>Изображение</label>
              <div id="imagePreview" style="margin-bottom:10px; display:none;">
                <img src="" style="max-width:100%; max-height:150px; border-radius:8px;">
              </div>
              <input type="file" name="image" id="promoImage" accept="image/*">
              <input type="hidden" name="existingImageUrl" id="promoExistingImage">
            </div>

            <div class="form-row">
              <div class="form-group half">
                <label>Порядок (сортировка)</label>
                <input type="number" name="sortOrder" id="promoSortOrder" value="0">
              </div>
              <div class="form-group half">
                <label>Статус</label>
                <select name="isActive" id="promoIsActive">
                  <option value="true">Активна</option>
                  <option value="false">Скрыта</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Текст кнопки (опционально)</label>
              <input type="text" name="buttonText" id="promoButtonText" placeholder="Например: Подробнее / Купить">
            </div>

            <div class="form-group">
              <label>Ссылка кнопки (опционально)</label>
              <input type="text" name="buttonLink" id="promoButtonLink" placeholder="https://... или internal://cart">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closePromotionModal()">Отмена</button>
            <button type="submit" class="btn btn-primary">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      function openPromotionModal() {
        document.getElementById('promotionForm').reset();
        document.getElementById('promoId').value = '';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('modalTitle').innerText = 'Добавить акцию';
        document.getElementById('promotionModal').style.display = 'flex';
      }

      function closePromotionModal() {
        document.getElementById('promotionModal').style.display = 'none';
      }

      function editPromotion(p) {
        document.getElementById('promoId').value = p.id;
        document.getElementById('promoTitle').value = p.title;
        document.getElementById('promoDescription').value = p.description || '';
        document.getElementById('promoSortOrder').value = p.sortOrder;
        document.getElementById('promoIsActive').value = p.isActive.toString();
        document.getElementById('promoButtonText').value = p.buttonText || '';
        document.getElementById('promoButtonLink').value = p.buttonLink || '';
        
        if (p.imageUrl) {
          document.getElementById('imagePreview').style.display = 'block';
          document.querySelector('#imagePreview img').src = p.imageUrl;
          document.getElementById('promoExistingImage').value = p.imageUrl;
        } else {
          document.getElementById('imagePreview').style.display = 'none';
          document.getElementById('promoExistingImage').value = '';
        }

        document.getElementById('modalTitle').innerText = 'Редактировать акцию';
        document.getElementById('promotionModal').style.display = 'flex';
      }

      document.getElementById('promotionForm').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        try {
          const res = await fetch('/admin/promotions/save', {
            method: 'POST',
            body: formData
          });
          const result = await res.json();
          if (result.success) {
            location.reload();
          } else {
            alert('Ошибка: ' + result.error);
          }
        } catch (err) {
          alert('Ошибка сети');
        }
      };

      async function deletePromotion(id) {
        if (!confirm('Удалить эту акцию?')) return;
        
        try {
          const res = await fetch('/admin/promotions/delete/' + id, { method: 'POST' });
          const result = await res.json();
          if (result.success) {
            location.reload();
          } else {
            alert('Ошибка: ' + result.error);
          }
        } catch (err) {
          alert('Ошибка при удалении');
        }
      }
    </script>

    ${renderAdminFooter()}
  `);
});

// Save Promotion (Create/Update)
router.post('/save', upload.single('image'), async (req, res) => {
  try {
    const { id, title, description, sortOrder, isActive, buttonText, buttonLink, existingImageUrl } = req.body;
    let imageUrl = existingImageUrl;

    if (req.file) {
      imageUrl = await uploadImage(req.file.buffer, { folder: 'promotions' });
    }

    const data = {
      title,
      description,
      imageUrl,
      buttonText,
      buttonLink,
      sortOrder: parseInt(sortOrder) || 0,
      isActive: isActive === 'true'
    };

    if (id) {
      await prisma.promotion.update({ where: { id }, data });
    } else {
      await prisma.promotion.create({ data });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error saving promotion:', error);
    res.json({ success: false, error: error.message });
  }
});

// Delete Promotion
router.post('/delete/:id', async (req, res) => {
  try {
    await prisma.promotion.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// --- Shared Helper Functions (Mocked imports for standalone file, but in real project use web.ts exports if possible or duplicate) ---
// Since we can't easily import locally defined functions from web.ts without refactoring web.ts to export them,
// we'll duplicate the simple header/footer renderers or rely on a layout wrapper if available.
// For this task, I'll inline a simple version compatible with web.ts styles.

function renderAdminHeader(title: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title} - Панель управления</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        /* Copying base styles for consistency */
        :root{ --admin-bg: #f5f6fb; --admin-surface: #ffffff; --admin-text: #111827; --admin-primary: #111827; --admin-border: rgba(17,24,39,0.12); --admin-danger: #dc2626; }
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--admin-bg); color: var(--admin-text); margin: 0; }
        .users-table-container { background: #fff; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); overflow: hidden; margin-top: 20px; }
        .users-table { width: 100%; border-collapse: collapse; }
        .users-table th, .users-table td { padding: 14px 18px; text-align: left; border-bottom: 1px solid var(--admin-border); }
        .users-table th { background: #f9fafb; font-weight: 600; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
        .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border-radius: 8px; border: 1px solid transparent; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: var(--admin-primary); color: #fff; }
        .btn-danger { background: var(--admin-danger); color: #fff; }
        .btn-secondary { background: #fff; border-color: #d1d5db; color: #374151; }
        .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 100; }
        .modal-content { background: #fff; padding: 24px; border-radius: 12px; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; }
        .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; }
        .form-row { display: flex; gap: 16px; }
        .half { flex: 1; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 12px; font-weight: 500; }
        .badge-info { background: #e0f2fe; color: #0369a1; }
        .status-badge { padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
        .status-active { background: #dcfce7; color: #166534; }
        .status-inactive { background: #f3f4f6; color: #374151; }
        .action-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px; border-radius: 4px; }
        .action-btn:hover { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <div style="padding: 24px; max-width: 1200px; margin: 0 auto;">
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px;">
           <a href="/admin" style="text-decoration:none; color:#6b7280;">← Назад в Админку</a>
           <h1 style="margin:0;">${title}</h1>
        </div>
  `;
}

function renderAdminFooter() {
  return `
      </div>
    </body>
    </html>
  `;
}

export const promotionsRouter = router;
