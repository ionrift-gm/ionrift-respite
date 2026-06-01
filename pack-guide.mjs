/**
 * pack-guide.mjs
 * Rebuilds the Respite Guide LevelDB compendium from source JSON.
 * Usage (Foundry must be closed): node pack-guide.mjs
 * Requires: npm install classic-level (already installed)
 *
 * Reads ALL *.json files from the source directory:
 *   - The parent journal document (contains _key starting with "!journal!")
 *   - Individual page documents (contain _key starting with "!journal.pages!")
 */
import { ClassicLevel } from 'classic-level';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'packs/src/respite-guide';
const PACK_DIR = 'packs/respite-guide';

function makeStats() {
    return {
        compendiumSource: null,
        duplicateSource: null,
        coreVersion: '12.331',
        systemId: null,
        systemVersion: null,
        createdTime: null,
        modifiedTime: null,
        lastModifiedBy: null,
    };
}

async function main() {
    // Read all JSON files from the source directory
    const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.json'));
    if (!files.length) {
        console.error(`No JSON files found in ${SRC_DIR}`);
        process.exit(1);
    }

    // Separate parent journal from page documents
    let parent = null;
    const pages = [];

    for (const file of files) {
        const data = JSON.parse(readFileSync(join(SRC_DIR, file), 'utf8'));
        const key = data._key ?? '';

        if (key.startsWith('!journal.pages!')) {
            pages.push(data);
        } else if (key.startsWith('!journal!') || data.pages !== undefined) {
            parent = data;
        } else {
            console.warn(`Skipping unrecognised file: ${file}`);
        }
    }

    if (!parent) {
        console.error('No parent journal document found in source directory');
        process.exit(1);
    }

    if (!pages.length) {
        console.error('No page documents found in source directory');
        process.exit(1);
    }

    // Sort pages by sort order for deterministic output
    pages.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    const db = new ClassicLevel(PACK_DIR, { valueEncoding: 'json', createIfMissing: true });
    await db.open();

    const batch = [];

    // Journal parent document. Pages array lists page IDs.
    const journalKey = `!journal!${parent._id}`;
    const pageIds = pages.map(p => p._id);
    batch.push({
        type: 'put',
        key: journalKey,
        value: {
            _key: journalKey,
            _id: parent._id,
            name: parent.name,
            pages: pageIds,
            categories: [],
            ownership: parent.ownership || { default: 2 },
            flags: parent.flags || {},
            sort: parent.sort || 0,
            folder: parent.folder || null,
            _stats: parent._stats || makeStats(),
        }
    });

    // Journal page documents
    for (const page of pages) {
        const pageKey = `!journal.pages!${parent._id}.${page._id}`;
        batch.push({
            type: 'put',
            key: pageKey,
            value: {
                _key: pageKey,
                _id: page._id,
                name: page.name,
                type: page.type || 'text',
                title: page.title || { show: true, level: 1 },
                image: page.image || {},
                video: page.video || { controls: true, volume: 0.5 },
                src: page.src || null,
                system: page.system || {},
                text: {
                    content: page.text?.content || '',
                    format: page.text?.format || 1,
                    markdown: page.text?.markdown || '',
                },
                sort: page.sort || 0,
                ownership: page.ownership || { default: -1 },
                flags: page.flags || {},
                _stats: page._stats || makeStats(),
            }
        });
    }

    await db.batch(batch);
    await db.close();
    console.log(`Packed ${batch.length} entries (1 journal + ${pages.length} pages) into ${PACK_DIR}`);
}

main().catch(console.error);
