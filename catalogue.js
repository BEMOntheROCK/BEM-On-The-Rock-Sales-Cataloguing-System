import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME TOGGLE ---
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
themeToggleBtn.addEventListener('click', () => { isDarkMode = !isDarkMode; updateTheme(); });

// --- IMAGE UPLOAD & COMPRESSION ---
const imageUploadArea = document.getElementById('image-upload-area');
const imageInput = document.getElementById('product-image');
const imagePlaceholder = document.getElementById('image-placeholder');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');

let compressedImageBase64 = null; // Holds the final compressed Base64 string

// Click anywhere on the upload area to trigger the file picker
imageUploadArea.addEventListener('click', (e) => {
    if (e.target === removeImageBtn) return;
    imageInput.click();
});

imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
        alert('Image is too large. Please choose an image under 6MB.');
        imageInput.value = '';
        return;
    }

    // Compress the image using a canvas, targeting ~600KB actual size
    // (Base64 encoding adds ~33%, bringing the stored string to ~800KB)
    compressedImageBase64 = await compressImage(file, 600);

    // Show the preview
    imagePreview.src = compressedImageBase64;
    imagePreview.classList.remove('hidden');
    imagePlaceholder.classList.add('hidden');
    removeImageBtn.classList.remove('hidden');
});

removeImageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetImageUpload();
});

function resetImageUpload() {
    compressedImageBase64 = null;
    imageInput.value = '';
    imagePreview.src = '';
    imagePreview.classList.add('hidden');
    imagePlaceholder.classList.remove('hidden');
    removeImageBtn.classList.add('hidden');
}

// Compress image to a target file size in KB using canvas
function compressImage(file, targetKB) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');

                // Scale down dimensions if image is very large
                let { width, height } = img;
                const MAX_DIM = 1000;
                if (width > MAX_DIM || height > MAX_DIM) {
                    const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                // Binary search for the right quality level to hit target size
                let lo = 0.1, hi = 0.95, result = '';
                for (let i = 0; i < 10; i++) {
                    const mid = (lo + hi) / 2;
                    result = canvas.toDataURL('image/jpeg', mid);
                    // Base64 string length → approximate byte size (each char = 0.75 bytes)
                    const sizeKB = (result.length * 0.75) / 1024;
                    if (sizeKB > targetKB) hi = mid;
                    else lo = mid;
                }
                resolve(result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// --- DYNAMIC VARIATIONS ---
const variationsContainer = document.getElementById('variations-container');
const addVariationBtn = document.getElementById('add-variation-btn');

function attachDeleteEvent(button) {
    button.addEventListener('click', (e) => {
        const row = e.target.closest('.variation-row');
        if (variationsContainer.children.length > 1) row.remove();
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

async function loadInventory() {
    inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; opacity:0.5;">Loading inventory...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));

        if (snapshot.empty) {
            inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; opacity:0.5;">No products yet. Add one above.</td></tr>';
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

            // Show thumbnail if image exists, otherwise a placeholder icon
            const imageCell = product.imageBase64
                ? `<img src="${product.imageBase64}" class="table-thumb" alt="${product.name}">`
                : `<div class="table-thumb-placeholder">📦</div>`;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${imageCell}</td>
                <td><strong>${product.name}</strong></td>
                <td>RM${product.price.toFixed(2)}</td>
                <td>${variationsHTML}</td>
                <td>
                    <button class="btn-action btn-edit" onclick="alert('Edit coming soon!')">Edit</button>
                    <button class="btn-action btn-delete" data-id="${productId}">Delete</button>
                </td>
            `;
            row.querySelector('.btn-delete').addEventListener('click', () => handleDelete(productId, product.name));
            inventoryBody.appendChild(row);
        });

    } catch (err) {
        console.error("Failed to load inventory:", err);
        inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Error loading inventory.</td></tr>';
    }
}

async function handleDelete(productId, productName) {
    if (!confirm(`Are you sure you want to delete "${productName}"?\n\nThis cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'catalogue', productId));
        alert(`"${productName}" has been removed from the catalogue.`);
        loadInventory();
    } catch (err) {
        console.error("Delete failed:", err);
        alert('Failed to delete the product. Please try again.');
    }
}

// --- FORM SUBMISSION ---
const productForm = document.getElementById('product-form');
const saveBtn = productForm.querySelector('.btn-primary');

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('product-name').value.trim();
    const price = parseFloat(document.getElementById('product-price').value);

    const variationRows = document.querySelectorAll('.variation-row');
    const variations = [];
    variationRows.forEach(row => {
        variations.push({
            name: row.querySelector('.var-name').value.trim(),
            stock: parseInt(row.querySelector('.var-stock').value)
        });
    });

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const productData = {
            name,
            price,
            variations,
            createdAt: serverTimestamp()
        };

        // Only include imageBase64 if the admin uploaded one
        if (compressedImageBase64) {
            productData.imageBase64 = compressedImageBase64;
        }

        await addDoc(collection(db, 'catalogue'), productData);

        alert(`✅ "${name}" has been saved to the catalogue!`);

        // Reset everything
        productForm.reset();
        variationsContainer.innerHTML = `
            <div class="variation-row">
                <input type="text" class="var-name" placeholder="e.g., Size S - Black" required>
                <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
                <button type="button" class="btn-icon delete-var" disabled>🗑️</button>
            </div>
        `;
        attachDeleteEvent(document.querySelector('.delete-var'));
        resetImageUpload();
        loadInventory();

    } catch (err) {
        console.error("Failed to save product:", err);
        alert('❌ Failed to save product. Please try again.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Catalogue';
    }
});

loadInventory();