import { CartItem, Product, ICartItem } from '../models/index.js';
import { checkPartnerActivation } from './partner-service.js';
import mongoose from 'mongoose';

export async function getCartItems(userId: string) {
  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const items = await CartItem.find({ userId: userIdObj })
      .populate('productId')
      .sort({ createdAt: -1 })
      .lean();
    
    return items.map((item: any) => ({
      ...item,
      product: item.productId,
      // Сохраняем оригинальный productId как строку для callback_data
      productIdString: item.productId?._id?.toString() || item.productId?.toString() || String(item.productId),
    }));
  } catch (error: any) {
    console.error('❌ Cart: Error fetching cart items:', error.message?.substring(0, 100));
    throw error;
  }
}

export async function addProductToCart(userId: string, productId: string) {
  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const productIdObj = new mongoose.Types.ObjectId(productId);
    
    // Используем findOneAndUpdate с upsert для Mongoose
    const item = await CartItem.findOneAndUpdate(
      {
        userId: userIdObj,
        productId: productIdObj,
      },
      {
        $inc: { quantity: 1 },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return item;
  } catch (error: any) {
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    
    const isConnectionError = 
      errorName === 'MongoServerError' ||
      errorName === 'MongoNetworkError' ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('SCRAM failure');
    
    if (isConnectionError) {
      console.error('❌ Cart: Database connection error:', errorMessage.substring(0, 100));
      throw new Error('База данных временно недоступна. Попробуйте позже.');
    } else {
      console.error('❌ Cart: Unexpected error adding to cart:', error);
      throw error;
    }
  }
}

export async function clearCart(userId: string) {
  try {
    await CartItem.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
  } catch (error: any) {
    console.error('❌ Cart: Error clearing cart:', error.message?.substring(0, 100));
    throw error;
  }
}

export async function increaseProductQuantity(userId: string, productId: string) {
  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const productIdObj = new mongoose.Types.ObjectId(productId);
    
    const item = await CartItem.findOneAndUpdate(
      {
        userId: userIdObj,
        productId: productIdObj,
      },
      {
        $inc: { quantity: 1 },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return item;
  } catch (error: any) {
    console.error('❌ Cart: Error increasing quantity:', error.message?.substring(0, 100));
    throw error;
  }
}

export async function decreaseProductQuantity(userId: string, productId: string) {
  try {
    // Валидация входных данных
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error(`Invalid userId format: ${userId}`);
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new Error(`Invalid productId format: ${productId}`);
    }
    
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const productIdObj = new mongoose.Types.ObjectId(productId);
    
    const item = await CartItem.findOne({
      userId: userIdObj,
      productId: productIdObj,
    });

    if (!item) {
      console.warn(`⚠️ Cart: Item not found (userId: ${userId}, productId: ${productId})`);
      return null;
    }

    if (item.quantity <= 1) {
      await CartItem.findByIdAndDelete(item._id);
      console.log(`✅ Cart: Item deleted (quantity was 1 or less)`);
      return null;
    }

    item.quantity -= 1;
    await item.save();
    console.log(`✅ Cart: Quantity decreased to ${item.quantity}`);
    return item;
  } catch (error: any) {
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    
    // Обрабатываем ошибки валидации ObjectId
    if (errorMessage.includes('Invalid') || errorMessage.includes('Cast to ObjectId')) {
      console.error(`❌ Cart: Invalid ObjectId in decreaseProductQuantity:`, {
        userId,
        productId,
        error: errorMessage,
      });
      throw new Error('Неверный формат идентификатора товара');
    }
    
    // Обрабатываем ошибки подключения к БД
    const isConnectionError = 
      errorName === 'MongoServerError' ||
      errorName === 'MongoNetworkError' ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('SCRAM failure');
    
    if (isConnectionError) {
      console.error('❌ Cart: Database connection error in decreaseProductQuantity:', errorMessage.substring(0, 100));
      throw new Error('База данных временно недоступна. Попробуйте позже.');
    }
    
    console.error('❌ Cart: Unexpected error decreasing quantity:', error);
    throw error;
  }
}

export async function removeProductFromCart(userId: string, productId: string) {
  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const productIdObj = new mongoose.Types.ObjectId(productId);
    
    const item = await CartItem.findOne({
      userId: userIdObj,
      productId: productIdObj,
    });
    
    if (!item) {
      return null;
    }

    await CartItem.findByIdAndDelete(item._id);
    return item;
  } catch (error: any) {
    console.error('❌ Cart: Error removing product:', error.message?.substring(0, 100));
    throw error;
  }
}

/**
 * Calculate price with partner discount (10% if partner program is active)
 */
export async function calculatePriceWithDiscount(userId: string, basePrice: number): Promise<{ 
  originalPrice: number; 
  discountedPrice: number; 
  discount: number; 
  hasDiscount: boolean;
}> {
  const isPartnerActive = await checkPartnerActivation(userId);
  const discountPercent = isPartnerActive ? 10 : 0;
  const discount = (basePrice * discountPercent) / 100;
  const discountedPrice = basePrice - discount;

  return {
    originalPrice: basePrice,
    discountedPrice,
    discount,
    hasDiscount: isPartnerActive
  };
}

export async function cartItemsToText(
  items: Array<{ product: { title: string; price: number }; quantity: number }>,
  userId?: string
) {
  if (items.length === 0) {
    return 'Корзина пуста.';
  }

  // Check if user has active partner program
  let hasPartnerDiscount = false;
  if (userId) {
    hasPartnerDiscount = await checkPartnerActivation(userId);
  }

  const lines = items.map((item) => {
    const pzPrice = Number(item.product.price);
    let finalPrice = pzPrice;
    let discountInfo = '';

    if (hasPartnerDiscount) {
      const discount = (pzPrice * 10) / 100;
      finalPrice = pzPrice - discount;
      discountInfo = ` (скидка 10%: -${(discount * 100).toFixed(2)} ₽)`;
    }

    const rubPrice = (pzPrice * 100).toFixed(2);
    const finalRubPrice = (finalPrice * 100).toFixed(2);
    const totalRub = (finalPrice * item.quantity * 100).toFixed(2);
    const totalPz = (finalPrice * item.quantity).toFixed(2);
    
    return `• ${item.product.title} — ${item.quantity} шт. × ${finalRubPrice} ₽ = ${totalRub} ₽ / ${totalPz} PZ${discountInfo}`;
  });

  // Calculate total sum
  let totalPzSum = 0;
  let totalRubSum = 0;
  let totalDiscount = 0;
  
  items.forEach((item) => {
    const pzPrice = Number(item.product.price);
    let finalPrice = pzPrice;
    
    if (hasPartnerDiscount) {
      const discount = (pzPrice * 10) / 100;
      finalPrice = pzPrice - discount;
      totalDiscount += discount * item.quantity;
    }
    
    totalPzSum += finalPrice * item.quantity;
    totalRubSum += finalPrice * item.quantity * 100;
  });

  // Add total sum line
  lines.push('');
  
  if (hasPartnerDiscount && totalDiscount > 0) {
    lines.push(`🎁 Скидка партнера (10%): -${(totalDiscount * 100).toFixed(2)} ₽ / -${totalDiscount.toFixed(2)} PZ`);
  }
  
  lines.push(`💰 Общая сумма: ${totalRubSum.toFixed(2)} ₽ / ${totalPzSum.toFixed(2)} PZ`);
  
  if (hasPartnerDiscount) {
    lines.push('');
    lines.push('✨ Применена скидка 10% для партнеров');
  }

  return lines.join('\n');
}
