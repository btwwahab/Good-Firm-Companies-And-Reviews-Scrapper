#!/usr/bin/env node

/**
 * Image URL Scraper for GoodFirms Companies
 * 
 * Spawns puppeteer-scraper.js as child process for each URL (same as scrape-all-goodfirms.js)
 * This creates fresh browser sessions to avoid Cloudflare rate limiting.
 * 
 * Usage: 
 *   node scripts/scrape-images.js --parallel=5           # Scrape all
 *   node scripts/scrape-images.js --parallel=5 --resume  # Resume/retry failed
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = 'storage/app/goodfirms-bpo-all-companies (1).json';
const OUTPUT_FILE = 'storage/app/goodfirms-bpo-all-companies (1).json';
const CHECKPOINT_FILE = 'storage/app/image-scrape-checkpoint.json';
const SCRAPER_SCRIPT = path.join(__dirname, 'puppeteer-scraper.js');

const SAVE_EVERY = 50;
const DELAY_BETWEEN_COMPANIES = 3000;

function formatTime(ms) {
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function loadCheckpoint() {
    try {
        const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
        return new Set(JSON.parse(data).processedUrls || []);
    } catch (e) {
        return new Set();
    }
}

async function saveCheckpoint(processedUrls) {
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify({
        processedUrls: Array.from(processedUrls),
        lastUpdated: new Date().toISOString()
    }, null, 2));
}

async function scrapeImageUrl(url) {
    return new Promise((resolve) => {
        const child = spawn('node', [SCRAPER_SCRIPT, url], {
            cwd: process.cwd(),
            timeout: 120000,
        });

        let stdout = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', () => { }); // Ignore stderr

        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const lines = stdout.trim().split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const line = lines[i].trim();
                        if (line.startsWith('{') && line.endsWith('}')) {
                            const data = JSON.parse(line);
                            const image = data.company?.basic_info?.image;
                            if (image && !data.company?.basic_info?.name?.includes('Just a moment')) {
                                resolve(image);
                                return;
                            }
                        }
                    }
                } catch (e) { }
            }
            resolve(null);
        });

        child.on('error', () => resolve(null));
        setTimeout(() => { child.kill(); resolve(null); }, 120000);
    });
}

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const parallelArg = args.find(a => a.startsWith('--parallel='));
    const limitArg = args.find(a => a.startsWith('--limit='));
    const resumeArg = args.includes('--resume');
    const parallel = parallelArg ? parseInt(parallelArg.split('=')[1]) : 5;
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   GoodFirms Image URL Scraper (Child Process)            ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // Load companies
    console.log(`📂 Loading companies from ${INPUT_FILE}...`);
    const allCompanies = JSON.parse(await fs.readFile(INPUT_FILE, 'utf-8'));

    // Load checkpoint for resume
    let processedUrls = new Set();
    if (resumeArg) {
        processedUrls = await loadCheckpoint();
        console.log(`🔄 Resume mode: ${processedUrls.size} already processed`);
    }

    // Filter companies to process
    let companies = allCompanies.map((c, idx) => ({ ...c, originalIndex: idx }));

    if (resumeArg) {
        companies = companies.filter(c => {
            const url = c.company?.basic_info?.profile_url;
            return url && !processedUrls.has(url);
        });
    }

    if (limit) {
        companies = companies.slice(0, limit);
        console.log(`📊 Limited to ${limit} companies`);
    }

    console.log(`✅ Total: ${allCompanies.length} | To process: ${companies.length}`);
    console.log(`⚡ Parallel workers: ${parallel}\n`);

    if (companies.length === 0) {
        console.log('✅ Nothing to process!');
        return;
    }

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    console.log('='.repeat(60));
    console.log('🔍 SCRAPING IMAGE URLs');
    console.log('='.repeat(60) + '\n');

    // Process in batches
    for (let i = 0; i < companies.length; i += parallel) {
        const batch = companies.slice(i, i + parallel);
        const elapsed = formatTime(Date.now() - startTime);
        const remaining = companies.length - i;
        const avgTime = (Date.now() - startTime) / (i || 1);
        const eta = formatTime(avgTime * remaining);

        console.log(`[${i + 1}-${Math.min(i + parallel, companies.length)}/${companies.length}] ${elapsed} elapsed | ETA: ${eta}`);

        // Process batch in parallel
        const results = await Promise.all(
            batch.map(async (company) => {
                const profileUrl = company.company?.basic_info?.profile_url;
                const name = company.company?.basic_info?.name || 'Unknown';
                const originalIndex = company.originalIndex;

                if (!profileUrl) {
                    return { success: false, name, originalIndex, profileUrl };
                }

                const imageUrl = await scrapeImageUrl(profileUrl);

                if (imageUrl) {
                    return { success: true, name, originalIndex, imageUrl, profileUrl };
                } else {
                    return { success: false, name, originalIndex, profileUrl };
                }
            })
        );

        // Update allCompanies and log results
        for (const result of results) {
            if (result.success) {
                allCompanies[result.originalIndex].company.basic_info.image = result.imageUrl;
                processedUrls.add(result.profileUrl);
                console.log(`  ✅ ${result.name}: ${result.imageUrl.split('/').pop()}`);
                successCount++;
            } else {
                console.log(`  ❌ ${result.name}`);
                failCount++;
            }
        }

        // Save periodically
        if ((i + parallel) % SAVE_EVERY === 0 || i + parallel >= companies.length) {
            await fs.writeFile(OUTPUT_FILE, JSON.stringify(allCompanies, null, 2));
            await saveCheckpoint(processedUrls);
            console.log(`\n  💾 Saved: ${successCount + failCount} processed | Checkpoint updated\n`);
        }

        await delay(DELAY_BETWEEN_COMPANIES);
    }

    // Final save
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(allCompanies, null, 2));
    await saveCheckpoint(processedUrls);

    const totalTime = formatTime(Date.now() - startTime);
    console.log('\n' + '='.repeat(60));
    console.log('✅ COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Success: ${successCount} | Failed: ${failCount}`);
    console.log(`⏱️  Time: ${totalTime}`);
    console.log(`📁 Output: ${OUTPUT_FILE}`);
}

main().catch(console.error);
