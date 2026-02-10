
import { prisma } from '../src/lib/prisma.js';

async function main() {
    const categories = await prisma.category.findMany();
    console.log('Categories:', categories);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
