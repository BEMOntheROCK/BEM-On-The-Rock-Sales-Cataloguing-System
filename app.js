import { db } from './firebase.js';
import {
    collection, getDocs, addDoc, doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME ---
const themeToggleBtn = document.getElementById('theme-toggle');
const rootElement = document.documentElement;
let isDarkMode = localStorage.getItem('theme') === 'dark';
function updateTheme() {
    if (isDarkMode) { rootElement.setAttribute('data-theme', 'dark'); themeToggleBtn.innerText = '☀️ Light Mode'; localStorage.setItem('theme', 'dark'); }
    else { rootElement.removeAttribute('data-theme'); themeToggleBtn.innerText = '🌙 Dark Mode'; localStorage.setItem('theme', 'light'); }
}
updateTheme();
themeToggleBtn.addEventListener('click', () => { isDarkMode = !isDarkMode; updateTheme(); });

// --- TOAST ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => { toast.classList.remove('toast-visible'); toast.addEventListener('transitionend', () => toast.remove()); }, 3000);
}

// --- STATE ---
const checkoutForm = document.getElementById('checkout-form');
const productGrid = document.getElementById('product-grid');
const variantGroup = document.getElementById('variant-group');
const variantGrid = document.getElementById('variant-grid');
const quantityGroup = document.getElementById('quantity-group');
const quantityInput = document.getElementById('quantity');
const totalPriceDisplay = document.getElementById('total-price');
const submitBtn = checkoutForm.querySelector('.btn-primary');

let catalogue = [];
let selectedProduct = null;
let selectedVarIndex = null;

// --- LOAD CATALOGUE ---
async function loadCatalogue() {
    productGrid.innerHTML = '<p class="grid-loading">Loading inventory...</p>';
    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));
        catalogue = [];
        snapshot.forEach(docSnap => catalogue.push({ id: docSnap.id, ...docSnap.data() }));
        if (catalogue.length === 0) {
            productGrid.innerHTML = '<p class="grid-loading">No items in inventory yet.</p>';
            return;
        }
        renderProductGrid();
    } catch (err) {
        console.error(err);
        productGrid.innerHTML = '<p class="grid-loading" style="color:red;">Error loading inventory.</p>';
    }
}

function getPriceRange(product) {
    const prices = product.variations.map(v => v.price || 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return `RM${min.toFixed(2)}`;
    return `RM${min.toFixed(2)} – RM${max.toFixed(2)}`;
}

function renderProductGrid() {
    productGrid.innerHTML = '';
    catalogue.forEach(product => {
        const totalStock = product.variations.reduce((sum, v) => sum + v.stock, 0);
        const isOOS = totalStock === 0;

        const card = document.createElement('div');
        card.className = 'product-card' + (isOOS ? ' out-of-stock' : '');
        card.dataset.productId = product.id;

        const imageHTML = product.imageBase64
            ? `<img src="${product.imageBase64}" class="product-card-img" alt="${product.name}">`
            : `<div class="product-card-img-placeholder">📦</div>`;

        card.innerHTML = `
            ${imageHTML}
            <div class="product-card-body">
                <div class="product-card-name">${product.name}</div>
                <div class="product-card-price">${getPriceRange(product)}</div>
                ${isOOS ? '<div class="product-card-oos">Out of Stock</div>' : ''}
            </div>
        `;

        if (!isOOS) card.addEventListener('click', () => handleProductSelect(product));
        productGrid.appendChild(card);
    });
}

// --- PRODUCT SELECTION ---
function handleProductSelect(product) {
    selectedProduct = product;
    selectedVarIndex = null;

    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.product-card[data-product-id="${product.id}"]`).classList.add('selected');

    quantityGroup.classList.add('hidden');
    totalPriceDisplay.innerText = '0.00';

    if (product.variations.length > 1) {
        renderVariantGrid(product);
        variantGroup.classList.remove('hidden');
    } else {
        variantGroup.classList.add('hidden');
        selectedVarIndex = 0;
        showQuantitySection();
    }
}

function renderVariantGrid(product) {
    variantGrid.innerHTML = '';
    product.variations.forEach((variation, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'variant-btn';
        btn.disabled = variation.stock === 0;
        btn.innerHTML = `
            ${variation.name}
            <span class="variant-price-label">RM${(variation.price || 0).toFixed(2)}</span>
            <span class="variant-stock-label">${variation.stock === 0 ? 'Out of stock' : `${variation.stock} left`}</span>
        `;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.variant-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedVarIndex = index;
            showQuantitySection();
        });
        variantGrid.appendChild(btn);
    });
}

function showQuantitySection() {
    quantityInput.value = 1;
    updateTotal();
    quantityGroup.classList.remove('hidden');
    quantityGroup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateTotal() {
    if (!selectedProduct || selectedVarIndex === null) { totalPriceDisplay.innerText = '0.00'; return; }
    const qty = parseInt(quantityInput.value) || 0;
    const price = selectedProduct.variations[selectedVarIndex].price || 0;
    totalPriceDisplay.innerText = (price * qty).toFixed(2);
}

quantityInput.addEventListener('input', updateTotal);

// --- SUBMIT ---
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedProduct || selectedVarIndex === null) return showToast('Please select an item and variation.', 'error');

    const variation = selectedProduct.variations[selectedVarIndex];
    const qty = parseInt(quantityInput.value);
    const unitPrice = variation.price || 0;
    const total = parseFloat((unitPrice * qty).toFixed(2));
    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

    if (qty < 1) return showToast('Quantity must be at least 1.', 'error');
    if (qty > variation.stock) return showToast(`Only ${variation.stock} unit(s) of "${variation.name}" left in stock.`, 'error');

    submitBtn.disabled = true; submitBtn.textContent = 'Processing...';

    try {
        await addDoc(collection(db, 'sales'), {
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            variationName: variation.name,
            quantity: qty,
            unitPrice,
            totalPaid: total,
            paymentMethod,
            timestamp: serverTimestamp()
        });

        const productRef = doc(db, 'catalogue', selectedProduct.id);
        await runTransaction(db, async (transaction) => {
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists()) throw new Error("Product no longer exists.");
            const variations = [...productDoc.data().variations];
            const newStock = variations[selectedVarIndex].stock - qty;
            if (newStock < 0) throw new Error("Insufficient stock.");
            variations[selectedVarIndex].stock = newStock;
            transaction.update(productRef, { variations });
        });

        showToast(`✅ Sale logged — ${selectedProduct.name} × ${qty} (RM${total.toFixed(2)}) via ${paymentMethod}`);

        selectedProduct = null; selectedVarIndex = null;
        variantGroup.classList.add('hidden');
        quantityGroup.classList.add('hidden');
        totalPriceDisplay.innerText = '0.00';
        await loadCatalogue();
    } catch (err) {
        console.error(err);
        showToast(`❌ ${err.message} — sale was not recorded.`, 'error');
    } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Complete Transaction';
    }
});

loadCatalogue();