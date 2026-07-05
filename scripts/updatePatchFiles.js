#!/usr/bin/env node

/**
 * Patch File Updater
 * Updates multiple patch files to use the new shared styling system
 */

const fs = require('fs');
const path = require('path');

const NEW_HEAD_TEMPLATE = `<head>
    <meta charset="UTF-8" />
    <meta name="description" content="{{DESCRIPTION}}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{TITLE}}</title>

    <!-- Critical CSS for immediate loading -->
    <link rel="stylesheet" href="/style/critical.css" />

    <!-- Load head configuration and shared resources -->
    <script src="/scripts/headConfig.js"></script>
</head>`;

function updatePatchFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract existing title and description
        const titleMatch = content.match(/<title>(.*?)<\/title>/);
        const descriptionMatch = content.match(/<meta name="description" content="(.*?)"/);
        
        const title = titleMatch ? titleMatch[1] : 'FAForever Patch - Balance Update';
        const description = descriptionMatch ? descriptionMatch[1] : 'FAForever balance update';
        
        // Replace head section
        const headRegex = /<head>[\s\S]*?<\/head>/;
        const newHead = NEW_HEAD_TEMPLATE
            .replace('{{TITLE}}', title)
            .replace('{{DESCRIPTION}}', description);
        
        const updatedContent = content.replace(headRegex, newHead);
        
        // Remove any inline styles and scripts from body
        const cleanedContent = updatedContent
            .replace(/<style>[\s\S]*?<\/style>/g, '')
            .replace(/<script>[\s\S]*?<\/script>/g, '');
        
        fs.writeFileSync(filePath, cleanedContent);
        console.log(`✅ Updated: ${filePath}`);
        
        return true;
    } catch (error) {
        console.error(`❌ Error updating ${filePath}:`, error.message);
        return false;
    }
}

function main() {
    const patchDir = path.join(__dirname, '..', 'pages', 'balance');
    
    // Find all HTML files
    function findHtmlFiles(dir) {
        const files = [];
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                files.push(...findHtmlFiles(fullPath));
            } else if (item.endsWith('.html')) {
                files.push(fullPath);
            }
        }
        
        return files;
    }
    
    const htmlFiles = findHtmlFiles(patchDir);
    console.log(`Found ${htmlFiles.length} patch files to update...`);
    
    let updated = 0;
    for (const file of htmlFiles) {
        if (updatePatchFile(file)) {
            updated++;
        }
    }
    
    console.log(`\n✅ Successfully updated ${updated}/${htmlFiles.length} files`);
    console.log('📝 Check the SHARED-STYLING-GUIDE.md for more information');
}

if (require.main === module) {
    main();
}
