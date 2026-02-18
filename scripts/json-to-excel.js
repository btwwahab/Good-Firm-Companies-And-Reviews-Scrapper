#!/usr/bin/env node

/**
 * Convert GoodFirms JSON to Excel - DYNAMIC ALL DATA
 * 
 * Dynamically includes ALL locations and ALL reviews for each company
 * 
 * Usage: node scripts/json-to-excel.js
 */

import XLSX from 'xlsx';
import fs from 'fs';

const INPUT_FILE = 'storage/app/goodfirms-bpo-all-companies (1).json';
const OUTPUT_FILE = 'storage/app/goodfirms-bpo-companies-complete.xlsx';

console.log('📂 Loading JSON data...');
const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
console.log(`  ✅ Loaded ${data.length} companies\n`);

// Find max locations and max reviews across all companies
let maxLocations = 0;
let maxReviews = 0;

data.forEach(item => {
    const c = item.company || {};
    const business = c.business_details || {};
    const reviews = c.reviews || {};

    const locCount = (business.locations || []).length;
    const revCount = (reviews.detailed_reviews || []).length;

    if (locCount > maxLocations) maxLocations = locCount;
    if (revCount > maxReviews) maxReviews = revCount;
});

console.log(`📍 Max locations found: ${maxLocations}`);
console.log(`📝 Max reviews found: ${maxReviews}\n`);

// Flatten data for Excel - ALL FIELDS dynamically
const rows = data.map((item, index) => {
    const c = item.company || {};
    const basic = c.basic_info || {};
    const business = c.business_details || {};
    const locations = business.locations || [];
    const focus = c.service_focus || {};
    const reviews = c.reviews || {};
    const contact = c.contact_info || {};
    const social = contact.social_media || {};
    const meta = item.metadata || {};

    // Convert service focus objects to strings
    const bpoServices = Object.entries(focus.bpo_services || {})
        .map(([k, v]) => `${k}: ${v}%`)
        .join(' | ');

    const industryFocus = Object.entries(focus.industry_focus || {})
        .map(([k, v]) => `${k}: ${v}%`)
        .join(' | ');

    const clientFocus = Object.entries(focus.client_focus || {})
        .map(([k, v]) => `${k}: ${v}%`)
        .join(' | ');

    // Get strengths and weaknesses
    const strengths = reviews.strengths || [];
    const weaknesses = reviews.weaknesses || [];
    const detailedReviews = reviews.detailed_reviews || [];

    // Build row object
    const row = {
        '#': index + 1,

        // === BASIC INFO ===
        'Name': basic.name || '',
        'Slug': basic.slug || '',
        'Website': basic.website || '',
        'Profile URL': basic.profile_url || '',
        'Image URL': basic.image || '',
        'Description': basic.description || '',
        'Is Verified': basic.is_verified ? 'Yes' : 'No',
        'Is Claimed': basic.is_claimed ? 'Yes' : 'No',
        'Company LinkedIn': basic.linkedin || '',

        // === BUSINESS DETAILS ===
        'Founded Year': business.founded_year || '',
        'Team Size': business.team_size || '',
        'Hourly Rate': business.hourly_rate || '',
        'Total Locations': locations.length,
    };

    // === DYNAMIC LOCATIONS ===
    for (let i = 0; i < maxLocations; i++) {
        const loc = locations[i] || {};
        const num = i + 1;
        row[`Location ${num} Country`] = loc.country || '';
        row[`Location ${num} Address`] = loc.address || '';
        row[`Location ${num} City`] = loc.city || '';
        row[`Location ${num} State`] = loc.state || '';
        row[`Location ${num} Zip`] = loc.zip || '';
        row[`Location ${num} Phone`] = loc.phone || '';
    }

    // === SERVICE FOCUS ===
    row['BPO Services'] = bpoServices;
    row['Industry Focus'] = industryFocus;
    row['Client Focus'] = clientFocus;

    // === REVIEWS SUMMARY ===
    row['Overall Rating'] = reviews.overall_rating || '';
    row['Total Reviews'] = reviews.total_reviews || '';
    row['Recent Reviews'] = reviews.recent_reviews || '';
    row['Strengths'] = strengths.join(' | ');
    row['Weaknesses'] = weaknesses.join(' | ');
    row['Detailed Reviews Count'] = detailedReviews.length;

    // === DYNAMIC REVIEWS ===
    for (let i = 0; i < maxReviews; i++) {
        const rev = detailedReviews[i] || {};
        const num = i + 1;
        const rb = rev.rating_breakdown || {};
        const pd = rev.project_details || {};
        const qa = rev.project_qa || [];

        row[`Review ${num} ID`] = rev.id || '';
        row[`Review ${num} Title`] = rev.title || '';
        row[`Review ${num} Summary`] = rev.summary || '';
        row[`Review ${num} Reviewer Name`] = rev.reviewer_name || '';
        row[`Review ${num} Reviewer Image`] = rev.reviewer_image || '';
        row[`Review ${num} Date`] = rev.date || '';

        // Rating breakdown
        row[`Review ${num} Quality Rating`] = rb.quality || '';
        row[`Review ${num} Schedule Rating`] = rb.schedule || '';
        row[`Review ${num} Communication Rating`] = rb.communication || '';
        row[`Review ${num} Overall Rating`] = rb.overall || '';

        // Project details
        row[`Review ${num} Project Cost`] = pd.cost || '';
        row[`Review ${num} Project Status`] = pd.status || '';
        row[`Review ${num} Project Industry`] = pd.industry || '';

        // Project Q&A (flatten to string)
        const qaText = qa.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n---\n');
        row[`Review ${num} Project Q&A`] = qaText;
    }

    // === CONTACT INFO ===
    row['Phones'] = (contact.phones || []).join(', ');
    row['Social LinkedIn'] = social.linkedin || '';
    row['Social Twitter'] = social.twitter || '';
    row['Social Facebook'] = social.facebook || '';

    // === METADATA ===
    row['Source URL'] = meta.source || '';
    row['Scraped At'] = meta.scraped_at || '';
    row['Company Slug'] = meta.company_slug || '';

    return row;
});

console.log('📊 Creating Excel workbook with ALL data...');

// Create workbook
const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet(rows);

// Set column widths
const headers = Object.keys(rows[0] || {});
worksheet['!cols'] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 2, 12), 40) }));

XLSX.utils.book_append_sheet(workbook, worksheet, 'Companies');

// Write file
XLSX.writeFile(workbook, OUTPUT_FILE);

console.log(`\n✅ Excel file created: ${OUTPUT_FILE}`);
console.log(`📊 Total rows: ${rows.length}`);
console.log(`📋 Total columns: ${headers.length}`);
console.log(`📍 Location columns: ${maxLocations * 6}`);
console.log(`📝 Review columns: ${maxReviews * 15}`);
