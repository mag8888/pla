
import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:qhvgdpCniWwJzVzUoliPpzHEopBAZzOv@crossover.proxy.rlwy.net:50105';

const CategorySchema = new mongoose.Schema({
    name: String,
    description: String,
    slug: String,
}, { strict: false });

const ProductSchema = new mongoose.Schema({
    name: String,
    title: String,
    description: String,
    summary: String,
    instruction: String,
    price: Number,
    image_url: String,
    imageUrl: String,
    stock: Number,
    category: mongoose.Schema.Types.Mixed,
    categoryId: mongoose.Schema.Types.Mixed,
    is_active: Boolean,
    isActive: Boolean,
    availableInRussia: Boolean,
    availableInBali: Boolean,
}, { strict: false });

async function migrate() {
    console.log('🚀 Starting migration...');

    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URL);
        console.log('✅ Connected to MongoDB');

        // --- 1. Migrate Categories ---
        const categoryMap = new Map<string, string>(); // Name/ID -> New ID
        let allCategories: any[] = [];

        // 1a. From 'moneo'
        try {
            const moneoDb = mongoose.connection.useDb('moneo');
            const CategoryModel = moneoDb.model('Category', CategorySchema, 'Category');
            const docs = await CategoryModel.find({});
            console.log(`Found ${docs.length} categories in moneo.`);
            allCategories.push(...docs);
        } catch (e) {
            console.warn('Failed to read moneo categories:', e);
        }

        // 1b. From 'plazma_bot'
        try {
            const plazmaDb = mongoose.connection.useDb('plazma_bot');
            const PlazmaCategoryModel = plazmaDb.model('Category', CategorySchema, 'Category');
            const docs = await PlazmaCategoryModel.find({});
            console.log(`Found ${docs.length} categories in plazma_bot.`);
            allCategories.push(...docs);
        } catch (e) {
            console.warn('Failed to read plazma_bot categories:', e);
        }

        // Upsert Categories
        for (const cat of allCategories) {
            const slug = cat.slug || (cat.name ? cat.name.toLowerCase().replace(/\s+/g, '-') : 'default');
            const name = cat.name || 'Unnamed Category';

            console.log(`Migrating category: ${name} (slug: ${slug})`);

            const upserted = await prisma.category.upsert({
                where: { slug: slug },
                update: {
                    name: name,
                    description: cat.description,
                },
                create: {
                    name: name,
                    slug: slug,
                    description: cat.description,
                    isVisibleInWebapp: true,
                },
            });
            console.log(`  -> Saved category ID: ${upserted.id}`);

            if (cat.name) categoryMap.set(cat.name, upserted.id);
            if (cat._id) categoryMap.set(cat._id.toString(), upserted.id);
        }

        // Ensure Fallback Category
        const fallbackCategory = await prisma.category.upsert({
            where: { slug: 'uncategorized' },
            update: {},
            create: {
                name: 'Uncategorized',
                slug: 'uncategorized',
                isVisibleInWebapp: false,
            }
        });
        const fallbackId = fallbackCategory.id;
        console.log(`Fallback Category ID: ${fallbackId}`);


        // --- 2. Migrate Products (from 'plazma_bot' database) ---
        const plazmaDb = mongoose.connection.useDb('plazma_bot');
        const ProductModel = plazmaDb.model('Product', ProductSchema, 'Product');

        console.log('Reading Products from plazma_bot...');
        const mongoProducts = await ProductModel.find({});
        console.log(`Found ${mongoProducts.length} products.`);

        for (const prod of mongoProducts) {
            const productName = prod.title || prod.name;
            if (!productName) {
                console.warn('Skipping product without title/name:', prod);
                continue;
            }

            console.log(`Migrating product: ${productName}`);

            // Resolve Category
            let categoryId: string | null = null;
            if (prod.categoryId) {
                const catKey = prod.categoryId.toString();
                categoryId = categoryMap.get(catKey) || null;
            }
            if (!categoryId && prod.category) {
                const catKey = prod.category.toString();
                categoryId = categoryMap.get(catKey) || null;
                if (!categoryId && typeof prod.category === 'object' && prod.category.name) {
                    categoryId = categoryMap.get(prod.category.name) || null;
                }
            }

            if (!categoryId) {
                console.warn(`  ⚠️ Category not found for product: ${productName}, using Fallback.`);
                categoryId = fallbackId;
            }

            // Upsert Product (using findFirst + create/update because title is not unique)
            const existingProduct = await prisma.product.findFirst({
                where: { title: productName }
            });

            const productData = {
                summary: prod.summary || '',
                description: prod.description,
                instruction: prod.instruction,
                price: prod.price || 0,
                imageUrl: prod.image_url || prod.imageUrl,
                stock: prod.stock || 999,
                isActive: prod.is_active ?? prod.isActive ?? true,
                availableInRussia: prod.availableInRussia ?? true,
                availableInBali: prod.availableInBali ?? true,
                categoryId: categoryId!,
            };

            if (existingProduct) {
                await prisma.product.update({
                    where: { id: existingProduct.id },
                    data: productData
                });
                console.log(`  -> Updated existing product: ${existingProduct.id}`);
            } else {
                await prisma.product.create({
                    data: {
                        title: productName,
                        ...productData,
                        sku: `legacy-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    }
                });
                console.log(`  -> Created new product.`);
            }
        }

        console.log('✅ Migration completed successfully.');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        await prisma.$disconnect();
        process.exit(0);
    }
}

migrate();
