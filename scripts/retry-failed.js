#!/usr/bin/env node

/**
 * Retry Failed Companies Script
 * 
 * Finds companies that failed to scrape and retries them.
 * 
 * Usage: node scripts/retry-failed.js [--parallel=3]
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
    urlsFile: 'storage/app/private/public/goodfirms_bpo.json',
    checkpointFile: 'storage/app/goodfirms-scrape-checkpoint.json',
    outputFile: 'storage/app/goodfirms-bpo-all-companies.json',
    failedOutputFile: 'storage/app/goodfirms-failed-retry.json',
    scraperScript: path.join(__dirname, 'puppeteer-scraper.js'),
    delayBetweenCompanies: 5000,
};

async function getFailedUrls() {
    // Load all URLs
    const urlsData = JSON.parse(await fs.readFile(CONFIG.urlsFile, 'utf-8'));
    const allUrls = urlsData.companies.map(c => {
        let url = c.profile;
        if (url.includes('#')) url = url.split('#')[0];
        return url;
    });

    // Load checkpoint (successfully scraped URLs)
    let scrapedUrls = new Set();
    try {
        const checkpoint = JSON.parse(await fs.readFile(CONFIG.checkpointFile, 'utf-8'));
        scrapedUrls = new Set(checkpoint.scrapedUrls || []);
    } catch (e) {
        console.error('No checkpoint file found');
    }

    // Find failed URLs
    const failedUrls = allUrls.filter(url => !scrapedUrls.has(url));

    return failedUrls;
}

async function scrapeCompany(url) {
    return new Promise((resolve) => {
        const child = spawn('node', [CONFIG.scraperScript, url], {
            cwd: process.cwd(),
            timeout: 120000,
        });

        let stdout = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', () => { });

        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const lines = stdout.trim().split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const line = lines[i].trim();
                        if (line.startsWith('{') && line.endsWith('}')) {
                            const data = JSON.parse(line);
                            if (!data.company?.basic_info?.name?.includes('Just a moment')) {
                                resolve(data);
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

function formatTime(ms) {
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}

async function main() {
    const args = process.argv.slice(2);
    const parallelArg = args.find(a => a.startsWith('--parallel='));
    const parallel = parallelArg ? parseInt(parallelArg.split('=')[1]) : 3;

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   GoodFirms - Retry Failed Companies                     ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const failedUrls = await getFailedUrls();
    console.log(`📊 Found ${failedUrls.length} failed companies to retry`);
    console.log(`⚡ Parallel workers: ${parallel}\n`);

    if (failedUrls.length === 0) {
        console.log('✅ No failed companies to retry!');
        return;
    }

    // Load existing data
    let existingData = [];
    try {
        existingData = JSON.parse(await fs.readFile(CONFIG.outputFile, 'utf-8'));
        console.log(`📂 Loaded ${existingData.length} existing companies\n`);
    } catch (e) { }

    // Load checkpoint
    let checkpoint = { scrapedUrls: [] };
    try {
        checkpoint = JSON.parse(await fs.readFile(CONFIG.checkpointFile, 'utf-8'));
    } catch (e) { }
    const scrapedUrls = new Set(checkpoint.scrapedUrls || []);

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    const newData = [];

    console.log('='.repeat(60));
    console.log('🔍 RETRYING FAILED COMPANIES');
    console.log('='.repeat(60) + '\n');

    // Process in batches
    for (let i = 0; i < failedUrls.length; i += parallel) {
        const batch = failedUrls.slice(i, i + parallel);
        const elapsed = formatTime(Date.now() - startTime);
        const remaining = failedUrls.length - i;
        const avgTime = (Date.now() - startTime) / (i || 1);
        const eta = formatTime(avgTime * remaining);

        console.log(`[${i + 1}-${Math.min(i + parallel, failedUrls.length)}/${failedUrls.length}] ${elapsed} elapsed | ETA: ${eta}`);

        const results = await Promise.all(batch.map(url => scrapeCompany(url)));

        for (let j = 0; j < results.length; j++) {
            const result = results[j];
            const url = batch[j];

            if (result) {
                console.log(`  ✅ ${result.company?.basic_info?.name || 'Unknown'}`);
                newData.push(result);
                existingData.push(result);
                scrapedUrls.add(url);
                successCount++;
            } else {
                console.log(`  ❌ ${url.split('/').pop()}`);
                failCount++;
            }
        }

        // Save every 10 companies
        if (newData.length > 0 && newData.length % 10 === 0) {
            await fs.writeFile(CONFIG.outputFile, JSON.stringify(existingData, null, 2));
            await fs.writeFile(CONFIG.checkpointFile, JSON.stringify({
                scrapedUrls: Array.from(scrapedUrls),
                lastUpdated: new Date().toISOString(),
                totalScraped: existingData.length
            }, null, 2));
            console.log(`  💾 Saved: ${existingData.length} total companies\n`);
        }

        // Delay between batches
        if (i + parallel < failedUrls.length) {
            await new Promise(r => setTimeout(r, CONFIG.delayBetweenCompanies));
        }
    }

    // Final save
    await fs.writeFile(CONFIG.outputFile, JSON.stringify(existingData, null, 2));
    await fs.writeFile(CONFIG.checkpointFile, JSON.stringify({
        scrapedUrls: Array.from(scrapedUrls),
        lastUpdated: new Date().toISOString(),
        totalScraped: existingData.length
    }, null, 2));

    // Save retry results separately
    if (newData.length > 0) {
        await fs.writeFile(CONFIG.failedOutputFile, JSON.stringify(newData, null, 2));
    }

    const totalTime = formatTime(Date.now() - startTime);
    console.log('\n' + '='.repeat(60));
    console.log('✅ RETRY COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Success: ${successCount} | Still Failed: ${failCount}`);
    console.log(`⏱️  Time: ${totalTime}`);
    console.log(`📁 Total companies: ${existingData.length}`);
}

main().catch(console.error);
