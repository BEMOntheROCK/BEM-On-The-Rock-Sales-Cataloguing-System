import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

function attachDeleteEvent(button) {
    button.addEventListener('click', (e) => {
        const row = e.target.closest('.variation-row');
        if (variationsContainer.children.length > 1) {
            row.remove();
        }
        updateDeleteButtons();
    });
}

function updateDeleteButtons() {
    const deleteBtns = variationsContainer.querySelectorAll('.delete-var');
    if (variationsContainer.children.length === 1) {
        deleteBtns[0].disabled = true;
    } else {
        deleteBtns.forEach(btn => btn.disabled = false);
    }
}

addVariationBtn.addEventListener('click', () => {
    const newRow = document.createElement('div');
    newRow.className = 'variation-row';
    newRow.innerHTML = `
        <input type="text" class="var-name" placeholder="e.g., Size M - Black" required>
        <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;
    variationsContainer.appendChild(newRow);
    attachDeleteEvent(newRow.querySelector('.delete-var'));
    updateDeleteButtons();
});

attachDeleteEvent(document.querySelector('.delete-var'));

// --- INVENTORY TABLE (Live from Firestore) ---
const inventoryBody = document.getElementById('inventory-body');

// Fetch all products from Firestore and render the table
async function loadInventory() {
    inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; opacity: 0.5;">Loading inventory...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));

        if (snapshot.empty) {
            inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; opacity: 0.5;">No products yet. Add one above.</td></tr>';
            return;
        }

        inventoryBody.innerHTML = '';

        snapshot.forEach(docSnap => {
            const product = docSnap.data();
            const productId = docSnap.id;

            const variationsHTML = product.variations.map(v => {
                const lowStockClass = v.stock <= 5 ? 'stock-low' : '';
                return `
                    <div class="variation-badge">
                        <span>${v.name}</span>
                        <span class="stock-count ${lowStockClass}">${v.stock}</span>
                    </div>
                `;
            }).join('');

            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${product.name}</strong></td>
                <td>RM${product.price.toFixed(2)}</td>
                <td>${variationsHTML}</td>
                <td>
                    <button class="btn-action btn-edit" onclick="alert('Edit coming soon!')">Edit</button>
                    <button class="btn-action btn-delete" data-id="${productId}">Delete</button>
                </td>
            `;

            // Attach delete handler to this row's button
            row.querySelector('.btn-delete').addEventListener('click', () => handleDelete(productId, product.name));

            inventoryBody.appendChild(row);
        });

    } catch (err) {
        console.error("Failed to load inventory:", err);
        inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: red;">Error loading inventory.</td></tr>';
    }
}

// Delete a product from Firestore and refresh the table
async function handleDelete(productId, productName) {
    const confirmed = confirm(`Are you sure you want to delete "${productName}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, 'catalogue', productId));
        alert(`"${productName}" has been removed from the catalogue.`);
        loadInventory(); // Refresh table
    } catch (err) {
        console.error("Delete failed:", err);
        alert('Failed to delete the product. Please try again.');
    }
}

// --- FORM SUBMISSION (Save new product to Firestore) ---
const productForm = document.getElementById('product-form');
const saveBtn = productForm.querySelector('.btn-primary');

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('product-name').value.trim();
    const price = parseFloat(document.getElementById('product-price').value);

    // Gather all variation rows
    const variationRows = document.querySelectorAll('.variation-row');
    const variations = [];

    variationRows.forEach(row => {
        variations.push({
            name: row.querySelector('.var-name').value.trim(),
            stock: parseInt(row.querySelector('.var-stock').value)
        });
    });

    // Disable button to prevent double-submission
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        await addDoc(collection(db, 'catalogue'), {
            name,
            price,
            variations,
            createdAt: serverTimestamp()
        });

        alert(`✅ "${name}" has been saved to the catalogue!`);

        // Reset form back to a clean state
        productForm.reset();
        variationsContainer.innerHTML = `
            <div class="variation-row">
                <input type="text" class="var-name" placeholder="e.g., Size S - Black" required>
                <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
                <button type="button" class="btn-icon delete-var" disabled>🗑️</button>
            </div>
        `;
        attachDeleteEvent(document.querySelector('.delete-var'));

        // Refresh table to show the newly added product
        loadInventory();

    } catch (err) {
        console.error("Failed to save product:", err);
        alert('❌ Failed to save product. Please try again.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Catalogue';
    }
});

// Load inventory on page start
loadInventory();