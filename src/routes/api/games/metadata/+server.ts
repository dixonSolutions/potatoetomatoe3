import { json } from '@sveltejs/kit';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const prerender = false;

interface GameMetadata {
    id: string;
    name: string;
    author: string;
    description: string;
    thumbnail: string;
    category: string;
}

let cachedMetadata: GameMetadata[] | null = null;
let lastModified = 0;

export function GET() {
    try {
        const gamesRoot = join(process.cwd(), 'static', 'games');

        if (!existsSync(gamesRoot)) {
            return json([]);
        }

        // Simple cache invalidation based on directory modification time
        const currentTime = Date.now();
        if (cachedMetadata && currentTime - lastModified < 60000) {
            // Cache for 1 minute
            return json(cachedMetadata);
        }

        const gameIds = readdirSync(gamesRoot, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('_'))
            .map((dirent) => dirent.name);

        const allMetadata: GameMetadata[] = [];

        for (const id of gameIds) {
            const metadataPath = join(gamesRoot, id, 'online', 'metadata.json');
            if (existsSync(metadataPath)) {
                try {
                    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
                    allMetadata.push(metadata);
                } catch (error) {
                    console.error(`Error reading metadata for ${id}:`, error);
                }
            }
        }

        cachedMetadata = allMetadata;
        lastModified = currentTime;

        return json(allMetadata);
    } catch (error) {
        console.error('Error reading games metadata:', error);
        return json([]);
    }
}
