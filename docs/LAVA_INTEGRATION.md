# 🔥 Интеграция с Lava.top - Платежный сервис

## 📋 Обзор

Lava.top - это платежный сервис для Telegram ботов, который позволяет принимать платежи в криптовалютах и фиатных валютах.

## 🚀 Быстрый старт

### 1. Регистрация и настройка

1. **Создайте аккаунт** на [Lava.top](https://app.lava.top)
2. **Подтвердите email** и пройдите верификацию
3. **Создайте проект** в личном кабинете
4. **Получите API ключи**:
   - `Project ID` - идентификатор проекта
   - `Secret Key` - секретный ключ для подписи запросов

### 2. Настройка переменных окружения

Добавьте в `.env` файл:

```env
# Lava.top Integration
LAVA_PROJECT_ID=your_project_id_here
LAVA_SECRET_KEY=your_secret_key_here
LAVA_WEBHOOK_SECRET=your_custom_webhook_secret_here
LAVA_BASE_URL=https://api.lava.top
```

**⚠️ ВАЖНО**: `LAVA_WEBHOOK_SECRET` - это **ваш собственный** секретный ключ, который вы создаете для подписи webhook'ов. Это НЕ ключ от Lava.top!

#### Генерация LAVA_WEBHOOK_SECRET:

```bash
# Способ 1: Через OpenSSL (рекомендуется)
openssl rand -hex 32

# Способ 2: Через Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Способ 3: Через Python
python3 -c "import secrets; print(secrets.token_hex(32))"

# Способ 4: Простая строка (менее безопасно)
echo "plazma-water-webhook-$(date +%s)"
```

**Пример результата:**
```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

#### Автоматическая генерация:

```bash
# Используйте готовый скрипт
node scripts/generate-webhook-secret.js
```

Этот скрипт автоматически сгенерирует безопасный ключ и покажет инструкции по настройке.

### 3. Установка зависимостей

```bash
npm install crypto axios
```

## 🔧 Реализация интеграции

### 1. Создание сервиса Lava

Создайте файл `src/services/lava-service.ts`:

```typescript
import crypto from 'crypto';
import axios from 'axios';

interface LavaConfig {
  projectId: string;
  secretKey: string;
  baseUrl: string;
}

interface CreateInvoiceRequest {
  sum: number;
  orderId: string;
  hookUrl?: string;
  successUrl?: string;
  failUrl?: string;
  customFields?: Record<string, string>;
  comment?: string;
}

interface CreateInvoiceResponse {
  data: {
    id: string;
    url: string;
    shortUrl: string;
    sum: number;
    orderId: string;
    status: string;
  };
  status: string;
}

class LavaService {
  private config: LavaConfig;

  constructor() {
    this.config = {
      projectId: process.env.LAVA_PROJECT_ID!,
      secretKey: process.env.LAVA_SECRET_KEY!,
      baseUrl: process.env.LAVA_BASE_URL || 'https://api.lava.top'
    };
  }

  /**
   * Создание подписи для запроса
   */
  private createSignature(data: string): string {
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(data)
      .digest('hex');
  }

  /**
   * Создание инвойса
   */
  async createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
    const timestamp = Math.floor(Date.now() / 1000);
    const data = JSON.stringify(request);
    const signature = this.createSignature(data);

    try {
      const response = await axios.post(
        `${this.config.baseUrl}/invoice/create`,
        request,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.projectId}`,
            'X-Signature': signature,
            'X-Timestamp': timestamp.toString()
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Lava API Error:', error);
      throw new Error('Failed to create invoice');
    }
  }

  /**
   * Получение статуса инвойса
   */
  async getInvoiceStatus(invoiceId: string): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000);
    const data = JSON.stringify({ invoiceId });
    const signature = this.createSignature(data);

    try {
      const response = await axios.post(
        `${this.config.baseUrl}/invoice/status`,
        { invoiceId },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.projectId}`,
            'X-Signature': signature,
            'X-Timestamp': timestamp.toString()
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Lava API Error:', error);
      throw new Error('Failed to get invoice status');
    }
  }

  /**
   * Проверка webhook подписи
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expectedSignature = this.createSignature(payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}

export const lavaService = new LavaService();
```

### 2. Обновление схемы базы данных

Добавьте в `prisma/schema.prisma`:

```prisma
model Payment {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  userId      String   @db.ObjectId
  user        User     @relation(fields: [userId], references: [id])
  orderId     String   @unique
  invoiceId   String   @unique
  amount      Float
  currency    String   @default("RUB")
  status      PaymentStatus @default(PENDING)
  paymentUrl  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  CANCELLED
}
```

### 3. Создание модуля платежей

Создайте файл `src/modules/payment/index.ts`:

```typescript
import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { lavaService } from '../../services/lava-service.js';
import { prisma } from '../../lib/prisma.js';
import { ensureUser } from '../../lib/user-utils.js';

export async function showPaymentMethods(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💳 Оплатить картой', 'payment:card')],
    [Markup.button.callback('₿ Криптовалюта', 'payment:crypto')],
    [Markup.button.callback('📱 Мобильный платеж', 'payment:mobile')],
    [Markup.button.callback('🔙 Назад', 'back_to_cart')]
  ]);

  await ctx.reply(
    '💳 <b>Выберите способ оплаты</b>\n\n' +
    '• <b>Карта</b> - Visa, Mastercard, МИР\n' +
    '• <b>Криптовалюта</b> - Bitcoin, Ethereum, USDT\n' +
    '• <b>Мобильный</b> - СБП, QIWI, Яндекс.Деньги',
    { ...keyboard, parse_mode: 'HTML' }
  );
}

export async function createPayment(ctx: Context, amount: number, orderId: string) {
  const user = await ensureUser(ctx);
  if (!user) return;

  try {
    // Создаем запись о платеже в БД
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        orderId,
        amount,
        currency: 'RUB',
        status: 'PENDING'
      }
    });

    // Создаем инвойс в Lava
    const invoice = await lavaService.createInvoice({
      sum: amount,
      orderId: payment.id,
      hookUrl: `${process.env.PUBLIC_BASE_URL}/webhook/lava`,
      successUrl: `${process.env.PUBLIC_BASE_URL}/payment/success`,
      failUrl: `${process.env.PUBLIC_BASE_URL}/payment/fail`,
      customFields: {
        userId: user.id,
        telegramId: user.telegramId.toString()
      },
      comment: `Оплата заказа #${orderId}`
    });

    // Обновляем платеж с URL
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        invoiceId: invoice.data.id,
        paymentUrl: invoice.data.url
      }
    });

    // Отправляем ссылку на оплату
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить', invoice.data.url)],
      [Markup.button.callback('🔄 Проверить статус', `payment:check:${payment.id}`)],
      [Markup.button.callback('❌ Отменить', `payment:cancel:${payment.id}`)]
    ]);

    await ctx.reply(
      `💳 <b>Счет на оплату создан</b>\n\n` +
      `💰 Сумма: <b>${amount} ₽</b>\n` +
      `📋 Заказ: <b>#${orderId}</b>\n\n` +
      `Нажмите кнопку ниже для перехода к оплате:`,
      { ...keyboard, parse_mode: 'HTML' }
    );

  } catch (error) {
    console.error('Payment creation error:', error);
    await ctx.reply('❌ Ошибка создания платежа. Попробуйте позже.');
  }
}

export async function checkPaymentStatus(ctx: Context, paymentId: string) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      await ctx.answerCbQuery('Платеж не найден');
      return;
    }

    if (payment.status === 'PAID') {
      await ctx.answerCbQuery('✅ Платеж уже оплачен!');
      return;
    }

    // Проверяем статус в Lava
    const status = await lavaService.getInvoiceStatus(payment.invoiceId);
    
    if (status.data.status === 'success') {
      // Обновляем статус в БД
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID' }
      });

      // Обновляем статус заказа
      await prisma.orderRequest.updateMany({
        where: { id: payment.orderId },
        data: { status: 'COMPLETED' }
      });

      await ctx.answerCbQuery('✅ Платеж подтвержден!');
      await ctx.reply('🎉 <b>Платеж успешно оплачен!</b>\n\nВаш заказ будет обработан в ближайшее время.', {
        parse_mode: 'HTML'
      });
    } else {
      await ctx.answerCbQuery('⏳ Платеж еще не поступил');
    }

  } catch (error) {
    console.error('Payment status check error:', error);
    await ctx.answerCbQuery('❌ Ошибка проверки статуса');
  }
}
```

### 4. Webhook для обработки платежей

Создайте файл `src/webhooks/lava.ts`:

```typescript
import express from 'express';
import { lavaService } from '../services/lava-service.js';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Webhook для получения уведомлений о платежах
router.post('/webhook/lava', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-signature'] as string;
    const payload = req.body.toString();

    // Проверяем подпись
    if (!lavaService.verifyWebhookSignature(payload, signature)) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const data = JSON.parse(payload);
    console.log('Lava webhook received:', data);

    // Обрабатываем уведомление о платеже
    if (data.type === 'invoice_paid') {
      const { invoiceId, orderId } = data.data;

      // Находим платеж в БД
      const payment = await prisma.payment.findFirst({
        where: { invoiceId }
      });

      if (payment && payment.status === 'PENDING') {
        // Обновляем статус платежа
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'PAID' }
        });

        // Обновляем статус заказа
        await prisma.orderRequest.updateMany({
          where: { id: payment.orderId },
          data: { status: 'COMPLETED' }
        });

        // Отправляем уведомление пользователю
        const { getBotInstance } = await import('../lib/bot-instance.js');
        const bot = getBotInstance();
        
        if (bot) {
          await bot.telegram.sendMessage(
            payment.userId,
            '🎉 <b>Платеж успешно оплачен!</b>\n\n' +
            `💰 Сумма: ${payment.amount} ₽\n` +
            `📋 Заказ: #${payment.orderId}\n\n` +
            'Ваш заказ будет обработан в ближайшее время.',
            { parse_mode: 'HTML' }
          );
        }

        console.log(`Payment ${payment.id} marked as paid`);
      }
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

### 5. Подключение к основному серверу

В `src/server.ts` добавьте:

```typescript
import lavaWebhook from './webhooks/lava.js';

// Подключение webhook для Lava
app.use('/webhook', lavaWebhook);
```

### 6. Обновление модуля заказов

В `src/modules/shop/index.ts` добавьте обработку платежей:

```typescript
// Обработчик кнопки "Купить"
bot.action(/^buy_product:(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const user = await ensureUser(ctx);
  if (!user) return;

  const product = await getProductById(productId);
  if (!product) {
    await ctx.answerCbQuery('Товар не найден');
    return;
  }

  // Создаем заказ
  const order = await prisma.orderRequest.create({
    data: {
      userId: user.id,
      contact: user.phone || 'Не указан',
      message: `Покупка товара: ${product.title}`,
      itemsJson: [{
        productId: product.id,
        title: product.title,
        price: product.price,
        quantity: 1
      }],
      status: 'NEW'
    }
  });

  // Показываем способы оплаты
  await showPaymentMethods(ctx);
});
```

## 🔧 Настройка в Lava.top

### 1. В личном кабинете Lava.top:

1. **Перейдите в настройки проекта**
2. **Добавьте webhook URL**: `https://your-domain.com/webhook/lava`
3. **Настройте уведомления**:
   - ✅ Invoice paid
   - ✅ Invoice failed
   - ✅ Invoice cancelled

### 2. Настройте валюты:

- **RUB** - для российских пользователей
- **USD** - для международных пользователей
- **Криптовалюты** - Bitcoin, Ethereum, USDT

## 🧪 Тестирование

### 1. Тестовые платежи:

```typescript
// Создание тестового платежа
const testPayment = await lavaService.createInvoice({
  sum: 100,
  orderId: 'test-order-123',
  comment: 'Тестовый платеж'
});
```

### 2. Проверка webhook:

```bash
# Тест webhook с помощью curl
curl -X POST https://your-domain.com/webhook/lava \
  -H "Content-Type: application/json" \
  -H "X-Signature: your_signature" \
  -d '{"type":"invoice_paid","data":{"invoiceId":"test","orderId":"test"}}'
```

## 📊 Мониторинг

### 1. Логирование платежей:

```typescript
// Добавьте в lava-service.ts
private logPayment(action: string, data: any) {
  console.log(`[LAVA PAYMENT] ${action}:`, {
    timestamp: new Date().toISOString(),
    ...data
  });
}
```

### 2. Админ панель для мониторинга:

```typescript
// Добавьте в админ панель
router.get('/admin/payments', async (req, res) => {
  const payments = await prisma.payment.findMany({
    include: { user: true },
    orderBy: { createdAt: 'desc' }
  });
  
  // Отображение платежей в админке
});
```

## 🚨 Безопасность

### 1. Проверка подписи:

```typescript
// Всегда проверяйте подпись webhook
if (!lavaService.verifyWebhookSignature(payload, signature)) {
  throw new Error('Invalid webhook signature');
}
```

### 2. Валидация данных:

```typescript
// Проверяйте все входящие данные
if (!data.invoiceId || !data.orderId) {
  throw new Error('Invalid webhook data');
}
```

## 📈 Аналитика

### 1. Статистика платежей:

```typescript
// Общая статистика
const stats = await prisma.payment.aggregate({
  _sum: { amount: true },
  _count: { id: true },
  where: { status: 'PAID' }
});
```

### 2. Отчеты:

```typescript
// Ежедневные отчеты
const dailyStats = await prisma.payment.groupBy({
  by: ['createdAt'],
  _sum: { amount: true },
  where: { 
    status: 'PAID',
    createdAt: { gte: startOfDay }
  }
});
```

## 🔗 Полезные ссылки

- [Lava.top API Documentation](https://docs.lava.top)
- [Lava.top Dashboard](https://app.lava.top)
- [Webhook Testing](https://webhook.site)

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи сервера
2. Убедитесь в правильности webhook URL
3. Проверьте подписи запросов
4. Обратитесь в поддержку Lava.top

---

**Версия документа:** 1.0  
**Дата создания:** 2025-01-24  
**Статус:** Готово к реализации
