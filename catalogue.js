// --- THEME TOGGLE LOGIC ---
const themeToggleBtn = document.getElementById('theme-toggle');
const rootElement = document.documentElement;

let isDarkMode = localStorage.getItem('theme') === 'dark';

function updateTheme() {
    if (isDarkMode) {
        rootElement.setAttribute('data-theme', 'dark');
        themeToggleBtn.innerText = '☀️ Light Mode';
        localStorage.setItem('theme', 'dark');
    } else {
        rootElement.removeAttribute('data-theme');
        themeToggleBtn.innerText = '🌙 Dark Mode';
        localStorage.setItem('theme', 'light');
    }
}

updateTheme();
themeToggleBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    updateTheme();
});

// --- DYNAMIC VARIATIONS FORM LOGIC ---
const variationsContainer = document.getElementById('variations-container');
const addVariationBtn = document.getElementById('add-variation-btn');

// Function to attach delete logic to the trash can buttons
function attachDeleteEvent(button) {
    button.addEventListener('click', (e) => {
        const row = e.target.closest('.variation-row');
        // Prevent deleting the very last remaining row
        if (variationsContainer.children.length > 1) {
            row.remove();
        }
        updateDeleteButtons();
    });
}

// Ensure the first row cannot be deleted if it's the only one
function updateDeleteButtons() {
    const rows = variationsContainer.querySelectorAll('.variation-row');
    const deleteBtns = variationsContainer.querySelectorAll('.delete-var');
    
    if (rows.length === 1) {
        deleteBtns[0].disabled = true;
    } else {
        deleteBtns.forEach(btn => btn.disabled = false);
    }
}

// Add a new variation row
addVariationBtn.addEventListener('click', () => {
    const newRow = document.createElement('div');
    newRow.className = 'variation-row';
    newRow.innerHTML = `
        <input type="text" class="var-name" placeholder="e.g., Size M - Black" required>
        <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;
    variationsContainer.appendChild(newRow);
    
    // Attach event to the new button and update all buttons
    attachDeleteEvent(newRow.querySelector('.delete-var'));
    updateDeleteButtons();
});

// Initialize the first delete button
attachDeleteEvent(document.querySelector('.delete-var'));


// --- INVENTORY TABLE RENDERING (Mock Data Setup) ---
const inventoryBody = document.getElementById('inventory-body');

// This mimics how data will look when pulled from Firestore
let mockCatalogue = [
    {
        id: 'prod_1',
        name: 'Church Anniversary T-Shirt',
        price: 35.00,
        variations: [
            { name: 'Size S - Black', stock: 12 },
            { name: 'Size M - Black', stock: 3 }, // Low stock example
            { name: 'Size L - Black', stock: 20 }
        ]
    },
    {
        id: 'prod_2',
        name: 'Daily Devotional Book 2026',
        price: 15.00,
        variations: [
            { name: 'Standard Edition', stock: 50 }
        ]
    }
];

// Render the table
function renderTable() {
    inventoryBody.innerHTML = ''; // Clear table
    
    mockCatalogue.forEach(product => {
        const row = document.createElement('tr');
        
        // Build the HTML for the variations badges
        let variationsHTML = product.variations.map(v => {
            const lowStockClass = v.stock <= 5 ? 'stock-low' : '';
            return `
                <div class="variation-badge">
                    <span>${v.name}</span>
                    <span class="stock-count ${lowStockClass}">${v.stock}</span>
                </div>
            `;
        }).join('');

        row.innerHTML = `
            <td><strong>${product.name}</strong></td>
            <td>RM${product.price.toFixed(2)}</td>
            <td>${variationsHTML}</td>
            <td>
                <button class="btn-action btn-edit" onclick="alert('Edit logic coming soon!')">Edit</button>
                <button class="btn-action btn-delete" onclick="alert('Delete logic coming soon!')">Delete</button>
            </td>
        `;
        
        inventoryBody.appendChild(row);
    });
}

// Initial render
renderTable();

// --- FORM SUBMISSION (CREATE ITEM) ---
const productForm = document.getElementById('product-form');

productForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('product-name').value;
    const price = parseFloat(document.getElementById('product-price').value);
    
    // Gather all variations
    const variationRows = document.querySelectorAll('.variation-row');
    const variations = [];
    
    variationRows.forEach(row => {
        variations.push({
            name: row.querySelector('.var-name').value,
            stock: parseInt(row.querySelector('.var-stock').value)
        });
    });
    
    console.log("Preparing to save to Firebase:", { name, price, variations });
    alert(`Successfully drafted: ${name} with ${variations.length} variations!`);
    
    // Clear form
    productForm.reset();
    
    // Reset variations back to a single row
    variationsContainer.innerHTML = `
        <div class="variation-row">
            <input type="text" class="var-name" placeholder="e.g., Size S - Black" required>
            <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
            <button type="button" class="btn-icon delete-var" disabled>🗑️</button>
        </div>
    `;
    attachDeleteEvent(document.querySelector('.delete-var'));
});