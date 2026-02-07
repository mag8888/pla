
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:qhvgdpCniWwJzVzUoliPpzHEopBAZzOv@crossover.proxy.rlwy.net:50105';

async function inspect() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URL);
        console.log('✅ Connected');

        // Inspect moneo
        const moneoDb = mongoose.connection.useDb('moneo');
        const moneoCollections = await moneoDb.db.listCollections().toArray();
        console.log('\n--- moneo Collections ---');
        for (const col of moneoCollections) {
            const count = await moneoDb.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count} docs`);
        }

        // Inspect plazma_bot
        const plazmaDb = mongoose.connection.useDb('plazma_bot');
        const plazmaCollections = await plazmaDb.db.listCollections().toArray();
        console.log('\n--- plazma_bot Collections ---');
        for (const col of plazmaCollections) {
            const count = await plazmaDb.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count} docs`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

inspect();
