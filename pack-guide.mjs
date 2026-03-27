/**
 * pack-guide.mjs
 * Rebuilds the Respite Guide LevelDB compendium from source JSON.
 * Usage (Foundry must be closed): node pack-guide.mjs
 * Requires: npm install classic-level (already installed)
 */
import { ClassicLevel } from 'classic-level';
import { readFileSync } from 'fs';

const SRC = 'packs/src/respite-guide/Getting_Started_with_Respite_RespiteGuide000001.json';
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
    const src = JSON.parse(readFileSync(SRC, 'utf8'));
    const db = new ClassicLevel(PACK_DIR, { valueEncoding: 'json', createIfMissing: true });
    await db.open();

    const batch = [];

    // Journal parent document - pages array must list page IDs
    const journalKey = `!journal!${src._id}`;
    const pageIds = src.pages.map(p => p._id);
    batch.push({
        type: 'put',
        key: journalKey,
        value: {
            _key: journalKey,
            _id: src._id,
            name: src.name,
            pages: pageIds,
            categories: [],
            ownership: src.ownership || { default: 2 },
            flags: src.flags || {},
            sort: src.sort || 0,
            folder: src.folder || null,
            _stats: makeStats(),
        }
    });

    // Journal page documents
    for (const page of src.pages) {
        const pageKey = `!journal.pages!${src._id}.${page._id}`;
        batch.push({
            type: 'put',
            key: pageKey,
            value: {
                _key: pageKey,
                _id: page._id,
                name: page.name,
                type: page.type || 'text',
                title: { show: true, level: 1 },
                image: {},
                video: { controls: true, volume: 0.5 },
                src: null,
                system: {},
                text: {
                    content: page.text?.content || '',
                    format: page.text?.format || 1,
                    markdown: page.text?.markdown || '',
                },
                sort: page.sort || 0,
                ownership: page.ownership || { default: -1 },
                flags: page.flags || {},
                _stats: makeStats(),
            }
        });
    }

    await db.batch(batch);
    await db.close();
    console.log(`Packed ${batch.length} entries (1 journal + ${src.pages.length} pages) into ${PACK_DIR}`);
}

main().catch(console.error);
