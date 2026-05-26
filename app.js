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

// --- DOM REFS ---
const productGrid    = document.getElementById('product-grid');
const variantGroup   = document.getElementById('variant-group');
const variantGrid    = document.getElementById('variant-grid');
const quantityGroup  = document.getElementById('quantity-group');
const quantityInput  = document.getElementById('quantity');
const stockHint      = document.getElementById('stock-hint');
const addToCartBtn   = document.getElementById('add-to-cart-btn');
const cartItemsEl    = document.getElementById('cart-items');
const grandTotalEl   = document.getElementById('grand-total');
const completeBtn    = document.getElementById('complete-btn');
const clearCartBtn   = document.getElementById('clear-cart-btn');
const qtyMinus       = document.getElementById('qty-minus');
const qtyPlus        = document.getElementById('qty-plus');

// --- STATE ---
let catalogue        = [];
let selectedProduct  = null;
let selectedVarIndex = null;

// Cart: array of { productId, productName, variationName, varIndex, unitPrice, quantity, imageBase64 }
// Persisted in localStorage so it survives page refresh
let cart = JSON.parse(localStorage.getItem('rocs_cart') || '[]');

// =====================================================
// CATALOGUE LOADING
// =====================================================
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
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? `RM${min.toFixed(2)}` : `RM${min.toFixed(2)} – RM${max.toFixed(2)}`;
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
            </div>`;
        if (!isOOS) card.addEventListener('click', () => handleProductSelect(product));
        productGrid.appendChild(card);
    });
}

// =====================================================
// SELECTION FLOW
// =====================================================
function handleProductSelect(product) {
    selectedProduct = product;
    selectedVarIndex = null;

    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.product-card[data-product-id="${product.id}"]`).classList.add('selected');

    // Reset downstream UI
    quantityGroup.classList.add('hidden');
    addToCartBtn.classList.add('hidden');
    quantityInput.value = 1;

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
            <span class="variant-stock-label">${variation.stock === 0 ? 'Out of stock' : `${variation.stock} left`}</span>`;
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
    updateStockHint();
    quantityGroup.classList.remove('hidden');
    addToCartBtn.classList.remove('hidden');
}

function updateStockHint() {
    if (!selectedProduct || selectedVarIndex === null) return;
    const variation = selectedProduct.variations[selectedVarIndex];

    // Check how many are already in the cart for this variant
    const inCart = getCartQty(selectedProduct.id, selectedVarIndex);
    const available = variation.stock - inCart;

    if (inCart > 0) {
        stockHint.textContent = `${variation.stock} in stock · ${inCart} already in cart · ${available} available`;
    } else {
        stockHint.textContent = `${variation.stock} in stock`;
    }
}

function getCartQty(productId, varIndex) {
    const existing = cart.find(i => i.productId === productId && i.varIndex === varIndex);
    return existing ? existing.quantity : 0;
}

// Quantity +/- buttons
qtyMinus.addEventListener('click', () => {
    const val = parseInt(quantityInput.value) || 1;
    if (val > 1) quantityInput.value = val - 1;
});
qtyPlus.addEventListener('click', () => {
    if (!selectedProduct || selectedVarIndex === null) return;
    const variation = selectedProduct.variations[selectedVarIndex];
    const inCart = getCartQty(selectedProduct.id, selectedVarIndex);
    const available = variation.stock - inCart;
    const val = parseInt(quantityInput.value) || 1;
    if (val < available) quantityInput.value = val + 1;
    else showToast(`Only ${available} more unit(s) available.`, 'error');
});

quantityInput.addEventListener('input', () => {
    if (!selectedProduct || selectedVarIndex === null) return;
    const variation = selectedProduct.variations[selectedVarIndex];
    const inCart = getCartQty(selectedProduct.id, selectedVarIndex);
    const available = variation.stock - inCart;
    const val = parseInt(quantityInput.value) || 1;
    if (val > available) quantityInput.value = available;
    if (val < 1) quantityInput.value = 1;
});

// =====================================================
// CART LOGIC
// =====================================================
function saveCart() {
    localStorage.setItem('rocs_cart', JSON.stringify(cart));
}

addToCartBtn.addEventListener('click', () => {
    if (!selectedProduct || selectedVarIndex === null) return;

    const variation = selectedProduct.variations[selectedVarIndex];
    const qty = parseInt(quantityInput.value) || 1;
    const inCart = getCartQty(selectedProduct.id, selectedVarIndex);
    const available = variation.stock - inCart;

    if (qty < 1) return showToast('Quantity must be at least 1.', 'error');
    if (qty > available) return showToast(`Only ${available} more unit(s) available.`, 'error');

    // Check if this exact variant is already in the cart — if so, increment
    const existing = cart.find(i => i.productId === selectedProduct.id && i.varIndex === selectedVarIndex);
    if (existing) {
        existing.quantity += qty;
    } else {
        cart.push({
            productId:     selectedProduct.id,
            productName:   selectedProduct.name,
            variationName: variation.name,
            varIndex:      selectedVarIndex,
            unitPrice:     variation.price || 0,
            quantity:      qty,
            imageBase64:   selectedProduct.imageBase64 || null
        });
    }

    saveCart();
    renderCart();
    showToast(`✅ ${selectedProduct.name} (${variation.name}) × ${qty} added to cart`);

    // Reset selection UI ready for next item
    resetSelectionUI();
});

function removeFromCart(productId, varIndex) {
    cart = cart.filter(i => !(i.productId === productId && i.varIndex === varIndex));
    saveCart();
    renderCart();
}

function updateCartQty(productId, varIndex, delta) {
    const item = cart.find(i => i.productId === productId && i.varIndex === varIndex);
    if (!item) return;

    // Check against live stock
    const product = catalogue.find(p => p.id === productId);
    const stock = product ? product.variations[varIndex]?.stock || 0 : 0;

    const newQty = item.quantity + delta;
    if (newQty < 1) { removeFromCart(productId, varIndex); return; }
    if (newQty > stock) { showToast(`Only ${stock} unit(s) in stock.`, 'error'); return; }

    item.quantity = newQty;
    saveCart();
    renderCart();
}

clearCartBtn.addEventListener('click', () => {
    if (!confirm('Clear all items from the cart?')) return;
    cart = [];
    saveCart();
    renderCart();
    resetSelectionUI();
});

function renderCart() {
    cartItemsEl.innerHTML = '';
    const isEmpty = cart.length === 0;

    clearCartBtn.classList.toggle('hidden', isEmpty);
    completeBtn.disabled = isEmpty;

    if (isEmpty) {
        cartItemsEl.innerHTML = '<p class="cart-empty">No items added yet.</p>';
        grandTotalEl.textContent = 'RM 0.00';
        return;
    }

    let grandTotal = 0;

    cart.forEach(item => {
        const lineTotal = item.unitPrice * item.quantity;
        grandTotal += lineTotal;

        const el = document.createElement('div');
        el.className = 'cart-item';

        const imgHTML = item.imageBase64
            ? `<img src="${item.imageBase64}" class="cart-item-img" alt="${item.productName}">`
            : `<div class="cart-item-img-placeholder">📦</div>`;

        el.innerHTML = `
            ${imgHTML}
            <div class="cart-item-details">
                <div class="cart-item-name">${item.productName}</div>
                <div class="cart-item-variant">${item.variationName}</div>
                <div class="cart-item-price">RM${lineTotal.toFixed(2)} (RM${item.unitPrice.toFixed(2)} each)</div>
                <div class="cart-item-qty">
                    <button class="cart-qty-btn" data-action="dec">−</button>
                    <span class="cart-qty-count">${item.quantity}</span>
                    <button class="cart-qty-btn" data-action="inc">+</button>
                </div>
            </div>
            <button class="cart-item-remove" title="Remove">✕</button>
        `;

        el.querySelector('.cart-item-remove').addEventListener('click', () => removeFromCart(item.productId, item.varIndex));
        el.querySelectorAll('.cart-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const delta = btn.dataset.action === 'inc' ? 1 : -1;
                updateCartQty(item.productId, item.varIndex, delta);
            });
        });

        cartItemsEl.appendChild(el);
    });

    grandTotalEl.textContent = `RM ${grandTotal.toFixed(2)}`;
}

function resetSelectionUI() {
    selectedProduct = null;
    selectedVarIndex = null;
    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    variantGroup.classList.add('hidden');
    quantityGroup.classList.add('hidden');
    addToCartBtn.classList.add('hidden');
    quantityInput.value = 1;
    stockHint.textContent = '';
}

// =====================================================
// COMPLETE TRANSACTION
// =====================================================
completeBtn.addEventListener('click', async () => {
    if (cart.length === 0) return showToast('Cart is empty.', 'error');

    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
    const grandTotal = cart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    completeBtn.disabled = true;
    completeBtn.textContent = 'Processing...';

    try {
        // Build transaction items array
        const items = cart.map(i => ({
            productId:     i.productId,
            productName:   i.productName,
            variationName: i.variationName,
            varIndex:      i.varIndex,
            quantity:      i.quantity,
            unitPrice:     i.unitPrice,
            lineTotal:     parseFloat((i.unitPrice * i.quantity).toFixed(2))
        }));

        // Write transaction record
        await addDoc(collection(db, 'sales'), {
            items,
            grandTotal: parseFloat(grandTotal.toFixed(2)),
            paymentMethod,
            timestamp: serverTimestamp()
        });

        // Deduct stock for every item in the cart atomically
        await Promise.all(cart.map(item =>
            runTransaction(db, async (transaction) => {
                const productRef = doc(db, 'catalogue', item.productId);
                const productDoc = await transaction.get(productRef);
                if (!productDoc.exists()) throw new Error(`"${item.productName}" no longer exists.`);
                const variations = [...productDoc.data().variations];
                const newStock = variations[item.varIndex].stock - item.quantity;
                if (newStock < 0) throw new Error(`Insufficient stock for "${item.productName} — ${item.variationName}".`);
                variations[item.varIndex].stock = newStock;
                transaction.update(productRef, { variations });
            })
        ));

        const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);
        showToast(`✅ Transaction complete! ${itemCount} item(s) · RM${grandTotal.toFixed(2)} via ${paymentMethod}`);

        // Clear cart and reload
        cart = [];
        saveCart();
        renderCart();
        resetSelectionUI();
        await loadCatalogue();

    } catch (err) {
        console.error(err);
        showToast(`❌ ${err.message}`, 'error');
    } finally {
        completeBtn.disabled = cart.length === 0;
        completeBtn.textContent = 'Complete Transaction';
    }
});

// =====================================================
// BOOT
// =====================================================
renderCart();   // Restore cart from localStorage immediately
loadCatalogue();