const fs = require('fs');
const path = require('path');

// Đọc file sym để phân tích
const symPath = path.join(__dirname, '../DiplomaVerifier.sym');
const symContent = fs.readFileSync(symPath, 'utf8');

// Phân tích các template và constraints
const templateStats = {};
let currentTemplate = null;
let constraintCount = 0;

symContent.split('\n').forEach(line => {
    if (line.startsWith('template')) {
        if (currentTemplate) {
            templateStats[currentTemplate] = constraintCount;
        }
        currentTemplate = line.split(' ')[1];
        constraintCount = 0;
    } else if (line.includes('constraint')) {
        constraintCount++;
    }
});

// Thêm template cuối cùng
if (currentTemplate) {
    templateStats[currentTemplate] = constraintCount;
}

console.log('Template Constraints Analysis:');
console.log('----------------------------');
Object.entries(templateStats).forEach(([template, constraints]) => {
    console.log(`${template}: ${constraints} constraints`);
}); 