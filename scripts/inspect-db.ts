
import { MongoClient } from 'mongodb';

const url = 'mongodb://mongo:pJzMMKYOvHUptbOTkFgwiwLOqYVnRqUp@nozomi.proxy.rlwy.net:28672/plazma_bot?authSource=admin';

async function inspect() {
    const client = new MongoClient(url);
    try {
        await client.connect();
        console.log('Connected correctly to server');
        const admin = client.db('admin').admin();
        const dbs = await admin.listDatabases();
        console.log('Databases:', dbs.databases.map(d => d.name));

        const targetDbs = ['plazma_bot'];

        for (const dbName of targetDbs) {
            console.log(`\n\n=== Database: ${dbName} ===`);
            try {
                const targetDb = client.db(dbName);
                const collections = await targetDb.listCollections().toArray();
                console.log('Collections:', collections.map(c => c.name));

                // Check all collections for "PLAZMA Water"
                for (const col of collections) {
                    const count = await targetDb.collection(col.name).countDocuments();
                    if (count > 0) {
                        const match = await targetDb.collection(col.name).findOne({
                            $or: [
                                { title: { $regex: 'PLAZMA Water', $options: 'i' } },
                                { name: { $regex: 'PLAZMA Water', $options: 'i' } }
                            ]
                        });
                        if (match) {
                            console.log(`\n🎉 FOUND 'PLAZMA Water' in collection: ${col.name}!`);
                            console.log(match);
                        }
                    }
                }

                if (dbName === 'plazma') {
                    const colName = 'products';
                    console.log(`\nInspecting ${colName} in ${dbName}...`);
                    const item = await targetDb.collection(colName).findOne({ name: { $regex: 'Плазменный набор', $options: 'i' } });
                    if (item) {
                        console.log('Found Плазменный набор:');
                        console.log(JSON.stringify(item, null, 2));
                    }
                }
                if (dbName === 'plazma_bot') {
                    console.log(`\nInspecting Product in ${dbName}...`);
                    const items = await targetDb.collection('Product').find({}, { limit: 5 }).toArray();
                    items.forEach(item => console.log(`- ${item.title} (${item.price})`));

                    console.log(`\nInspecting AudioFile in ${dbName}...`);
                    const audio = await targetDb.collection('AudioFile').find({}).toArray();
                    console.log(`Found ${audio.length} audio files:`);
                    audio.forEach(a => console.log(`- ${a.title || a.name}`));
                }
                // Inspect Audio collections
                const audioCols = collections.filter(c => c.name.toLowerCase().includes('audio'));
                for (const col of audioCols) {
                    console.log(`\nInspecting Audio Collection: ${col.name}...`);
                    const items = await targetDb.collection(col.name).find().toArray();
                    console.log(`Found ${items.length} audio files.`);
                    if (items.length > 0) {
                        console.log('Sample:', items[0]);
                    }
                }
            } catch (e: any) {
                console.log(`Error inspecting ${dbName}: ${e.message}`);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

inspect();
