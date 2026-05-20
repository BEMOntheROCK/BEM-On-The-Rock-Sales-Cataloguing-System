// Import the database connection from the file you created earlier
import { db } from './firebase.js'; 
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME TOGGLE LOGIC ---
const themeToggleBtn = document.getElementById('theme-toggle');
const rootElement = document.documentElement; // Targets the <html> tag

// Check if user has a saved preference, otherwise default to light
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

// Initialize theme on page load
updateTheme();

themeToggleBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    updateTheme();
});

// --- CHECKOUT FORM LOGIC ---
const checkoutForm = document.getElementById('checkout-form');
const productSelect = document.getElementById('product-select');
const quantityInput = document.getElementById('quantity');
const totalPriceDisplay = document.getElementById('total-price');

// Temporary mock prices (We will later fetch these from Firestore)
const mockPrices = {
    'tshirt_m': 35.00,
    'tshirt_l': 35.00,
    'book_devotional': 15.00
};

// Calculate total dynamically when selection or quantity changes
function updateTotal() {
    const selectedItem = productSelect.value;
    const qty = parseInt(quantityInput.value) || 0;
    
    if (selectedItem && mockPrices[selectedItem]) {
        const total = mockPrices[selectedItem] * qty;
        totalPriceDisplay.innerText = total.toFixed(2);
    } else {
        totalPriceDisplay.innerText = "0.00";
    }
}

productSelect.addEventListener('change', updateTotal);
quantityInput.addEventListener('input', updateTotal);

// Handle the submission
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Stop page from refreshing

    const selectedItem = productSelect.options[productSelect.selectedIndex].text;
    const qty = quantityInput.value;
    const total = totalPriceDisplay.innerText;
    
    // Find which payment method is selected
    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

    console.log("Preparing to send to Firestore:");
    console.log({
        item: selectedItem,
        quantity: qty,
        totalPaid: `RM${total}`,
        paymentMethod: paymentMethod
    });

    alert(`Sale logged successfully!\n\nItem: ${selectedItem}\nQty: ${qty}\nPaid: RM${total} via ${paymentMethod}`);
    
    // Reset form for the next customer
    checkoutForm.reset();
    totalPriceDisplay.innerText = "0.00";
});