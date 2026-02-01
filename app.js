// Configuración Supabase
const SUPABASE_URL = 'https://rdscdgohbrkqnuxjyalg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkc2NkZ29oYnJrcW51eGp5YWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTk0NDUsImV4cCI6MjA4NTQ3NTQ0NX0.nrjtRfGMBdq0KKxZaxG8Z6-CQArxdVB9hHkY-50AXMI';

// Inicializar Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado de la aplicación
let currentUser = null;
let currentFamilyId = null;
let currentMonth = new Date();
let categories = [];
let moneySources = [];

// Inicialización
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
    // Verificar sesión existente
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        await loadUserData();
        showMainScreen();
    } else {
        showLoginScreen();
    }
    
    setupEventListeners();
    setupServiceWorker();
}

// Event Listeners
function setupEventListeners() {
    // Login/Register
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('signup-form').addEventListener('submit', handleSignup);
    document.getElementById('show-register').addEventListener('click', showRegisterForm);
    document.getElementById('show-login').addEventListener('click', showLoginForm);
    
    // Navegación
    document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
    document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const screen = e.target.closest('.nav-item').dataset.screen;
            showScreen(screen);
            toggleMenu();
        });
    });
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Movimientos
    document.getElementById('add-movement').addEventListener('click', showMovementModal);
    document.getElementById('movement-form').addEventListener('submit', handleAddMovement);
    document.getElementById('movement-type').addEventListener('change', updateMovementCategories);
    
    // Cerrar modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', closeMovementModal);
    });
    document.getElementById('modal-overlay').addEventListener('click', closeMovementModal);
    
    // Navegación meses
    document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
    
    // Filtros
    document.getElementById('type-filter').addEventListener('change', loadHistory);
    document.getElementById('date-filter').addEventListener('change', loadHistory);
}

// Autenticación
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    
    if (error) {
        alert('Error al iniciar sesión: ' + error.message);
        return;
    }
    
    currentUser = data.user;
    await loadUserData();
    showMainScreen();
}

async function handleSignup(e) {
    e.preventDefault();
    
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: name
            }
        }
    });
    
    if (error) {
        alert('Error al registrarse: ' + error.message);
        return;
    }
    
    // Crear perfil
    if (data.user) {
        await supabase.from('profiles').insert({
            id: data.user.id,
            email: email,
            full_name: name
        });
    }
    
    alert('¡Cuenta creada! Ahora inicia sesión.');
    showLoginForm();
}

async function handleLogout() {
    await supabase.auth.signOut();
    currentUser = null;
    showLoginScreen();
}

// Carga de datos
async function loadUserData() {
    // Obtener perfil
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
    
    if (profile) {
        currentFamilyId = profile.family_id;
        document.getElementById('user-name').textContent = profile.full_name;
        document.getElementById('user-email').textContent = profile.email;
    }
    
    // Cargar categorías
    const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .order('type, name');
    
    categories = cats || [];
    
    // Cargar medios de dinero
    const { data: sources } = await supabase
        .from('money_sources')
        .select('*');
    
    moneySources = sources || [];
    
    // Cargar datos iniciales
    await updateBalances();
    await loadMonthlySummary();
    await loadRecentMovements();
}

// Actualizar balances
async function updateBalances() {
    const { data: balances } = await supabase
        .from('current_balances')
        .select('*')
        .eq('family_id', currentFamilyId);
    
    let total = 0;
    let cash = 0;
    let mp = 0;
    
    balances?.forEach(balance => {
        if (balance.money_source_id === 1) {
            cash = balance.amount;
        } else if (balance.money_source_id === 2) {
            mp = balance.amount;
        }
        total += balance.amount;
    });
    
    document.getElementById('cash-balance').textContent = formatCurrency(cash);
    document.getElementById('mp-balance').textContent = formatCurrency(mp);
    document.getElementById('total-balance').textContent = formatCurrency(total);
    
    // Actualizar en pantalla de saldo
    document.getElementById('cash-detail').textContent = formatCurrency(cash);
    document.getElementById('mp-detail').textContent = formatCurrency(mp);
}

// Resumen mensual
async function loadMonthlySummary() {
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    
    // Actualizar título del mes
    const monthName = monthStart.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    document.getElementById('current-month').textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    
    // Obtener movimientos del mes
    const { data: movements } = await supabase
        .from('movements')
        .select(`
            *,
            categories (name, type),
            money_sources (name)
        `)
        .eq('family_id', currentFamilyId)
        .gte('date', monthStart.toISOString().split('T')[0])
        .lte('date', monthEnd.toISOString().split('T')[0]);
    
    // Calcular totales
    let income = 0;
    let expenses = 0;
    let sales = 0;
    let supplies = 0;
    let householdExpenses = 0;
    
    movements?.forEach(mov => {
        if (mov.type === 'ingreso' || mov.type === 'ventas_postres') {
            income += mov.amount;
            if (mov.type === 'ventas_postres') sales += mov.amount;
        } else {
            expenses += mov.amount;
            if (mov.type === 'insumos_postres') supplies += mov.amount;
            if (mov.type === 'gasto_hogar') householdExpenses += mov.amount;
        }
    });
    
    const balance = income - expenses;
    const dessertsProfit = sales - supplies;
    
    // Actualizar UI
    document.getElementById('monthly-income').textContent = formatCurrency(income);
    document.getElementById('monthly-expenses').textContent = formatCurrency(expenses);
    document.getElementById('monthly-balance').textContent = formatCurrency(balance);
    document.getElementById('total-sales').textContent = formatCurrency(sales);
    document.getElementById('total-supplies').textContent = formatCurrency(supplies);
    document.getElementById('desserts-profit').textContent = formatCurrency(dessertsProfit);
    
    // Cargar fondos y ahorros
    await loadFundsAndSavings();
    
    // Actualizar gráfico de gastos
    updateExpensesChart(movements);
}

// Movimientos recientes
async function loadRecentMovements() {
    const { data: movements } = await supabase
        .from('movements')
        .select(`
            *,
            categories (name, type),
            money_sources (name)
        `)
        .eq('family_id', currentFamilyId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
    
    const container = document.getElementById('recent-movements');
    container.innerHTML = '';
    
    if (!movements?.length) {
        container.innerHTML = '<div class="text-center">No hay movimientos recientes</div>';
        return;
    }
    
    movements.forEach(mov => {
        const div = document.createElement('div');
        div.className = 'movement-item';
        
        const isIncome = mov.type === 'ingreso' || mov.type === 'ventas_postres';
        const categoryName = mov.categories?.name || mov.type;
        
        div.innerHTML = `
            <div class="movement-info">
                <h4>${categoryName}</h4>
                <small>${formatDate(mov.date)} • ${mov.money_sources?.name || ''}</small>
                ${mov.description ? `<small>${mov.description}</small>` : ''}
            </div>
            <div class="movement-amount ${isIncome ? 'positive' : 'negative'}">
                ${isIncome ? '+' : '-'}${formatCurrency(mov.amount)}
            </div>
        `;
        
        container.appendChild(div);
    });
}

// Fondos y ahorros
async function loadFundsAndSavings() {
    const { data: funds } = await supabase
        .from('accumulated_funds')
        .select(`
            *,
            categories (name)
        `)
        .eq('family_id', currentFamilyId);
    
    funds?.forEach(fund => {
        if (fund.category_id === 15) { // Fondo hogar
            document.getElementById('home-fund').textContent = formatCurrency(fund.amount);
        } else if (fund.category_id === 16) { // Fondo postres
            document.getElementById('desserts-fund').textContent = formatCurrency(fund.amount);
        } else if (fund.category_id === 17) { // Ahorro general
            document.getElementById('general-savings').textContent = formatCurrency(fund.amount);
        }
    });
}

// Historial
async function loadHistory() {
    const type = document.getElementById('type-filter').value;
    const date = document.getElementById('date-filter').value;
    
    let query = supabase
        .from('movements')
        .select(`
            *,
            categories (name, type),
            money_sources (name)
        `)
        .eq('family_id', currentFamilyId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
    
    if (type !== 'all') {
        query = query.eq('type', type);
    }
    
    if (date) {
        query = query.eq('date', date);
    }
    
    const { data: movements } = await query;
    
    const container = document.getElementById('history-list');
    container.innerHTML = '';
    
    if (!movements?.length) {
        container.innerHTML = '<div class="text-center">No hay movimientos</div>';
        return;
    }
    
    movements.forEach(mov => {
        const div = document.createElement('div');
        div.className = 'movement-item';
        
        const isIncome = mov.type === 'ingreso' || mov.type === 'ventas_postres';
        const categoryName = mov.categories?.name || mov.type;
        
        div.innerHTML = `
            <div class="movement-info">
                <h4>${categoryName}</h4>
                <small>${formatDate(mov.date)} • ${mov.money_sources?.name || ''}</small>
                ${mov.description ? `<small>${mov.description}</small>` : ''}
            </div>
            <div class="movement-amount ${isIncome ? 'positive' : 'negative'}">
                ${isIncome ? '+' : '-'}${formatCurrency(mov.amount)}
            </div>
        `;
        
        container.appendChild(div);
    });
}

// Modal de movimiento
function showMovementModal() {
    document.getElementById('movement-modal').classList.add('active');
    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById('movement-date').valueAsDate = new Date();
    document.getElementById('movement-amount').value = '';
    document.getElementById('movement-description').value = '';
}

function closeMovementModal() {
    document.getElementById('movement-modal').classList.remove('active');
    document.getElementById('modal-overlay').classList.remove('active');
}

function updateMovementCategories() {
    const type = document.getElementById('movement-type').value;
    const select = document.getElementById('movement-category');
    select.innerHTML = '<option value="">Seleccionar categoría</option>';
    
    if (!type) return;
    
    const typeCategories = categories.filter(cat => cat.type === type);
    typeCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
    });
    
    // Si es ahorros, solo hay una opción
    if (type === 'ahorros') {
        select.value = 17; // Ahorro general
    }
}

async function handleAddMovement(e) {
    e.preventDefault();
    
    const type = document.getElementById('movement-type').value;
    const categoryId = parseInt(document.getElementById('movement-category').value);
    const amount = parseFloat(document.getElementById('movement-amount').value);
    const sourceId = parseInt(document.getElementById('movement-source').value);
    const description = document.getElementById('movement-description').value;
    const date = document.getElementById('movement-date').value;
    
    if (!type || !categoryId || !amount || !sourceId || !date) {
        alert('Por favor completa todos los campos obligatorios');
        return;
    }
    
    const movement = {
        user_id: currentUser.id,
        family_id: currentFamilyId,
        type,
        category_id: categoryId,
        money_source_id: sourceId,
        amount,
        description,
        date
    };
    
    const { error } = await supabase
        .from('movements')
        .insert([movement]);
    
    if (error) {
        alert('Error al guardar movimiento: ' + error.message);
        return;
    }
    
    closeMovementModal();
    
    // Actualizar todas las vistas
    await updateBalances();
    await loadMonthlySummary();
    await loadRecentMovements();
    await loadHistory();
    
    // Mostrar confirmación
    alert('¡Movimiento guardado correctamente!');
}

// Navegación entre meses
function changeMonth(delta) {
    currentMonth.setMonth(currentMonth.getMonth() + delta);
    loadMonthlySummary();
}

// Mostrar pantallas
function showLoginScreen() {
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');
}

function showMainScreen() {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    showScreen('summary');
}

function showScreen(screenName) {
    // Actualizar navegación
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`.nav-item[data-screen="${screenName}"]`).classList.add('active');
    
    // Actualizar contenido
    document.querySelectorAll('.content-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(`${screenName}-screen`).classList.add('active');
    document.getElementById('current-screen').textContent = 
        document.querySelector(`.nav-item[data-screen="${screenName}"]`).textContent;
    
    // Cargar datos específicos de la pantalla
    switch(screenName) {
        case 'summary':
            loadMonthlySummary();
            break;
        case 'expenses':
            loadExpensesList();
            break;
        case 'desserts':
            loadDessertsMovements();
            break;
        case 'history':
            loadHistory();
            break;
    }
}

function showLoginForm() {
    document.getElementById('login-form').parentElement.classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
}

function showRegisterForm() {
    document.getElementById('login-form').parentElement.classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function toggleMenu() {
    document.getElementById('side-nav').classList.toggle('active');
}

// Funciones auxiliares
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function updateExpensesChart(movements) {
    const expensesByCategory = {};
    
    movements?.forEach(mov => {
        if (mov.type === 'gasto_hogar') {
            const catName = mov.categories?.name || 'Sin categoría';
            expensesByCategory[catName] = (expensesByCategory[catName] || 0) + mov.amount;
        }
    });
    
    const container = document.getElementById('expenses-chart');
    if (Object.keys(expensesByCategory).length === 0) {
        container.innerHTML = '<div class="text-center">No hay gastos este mes</div>';
        return;
    }
    
    let html = '';
    Object.entries(expensesByCategory).forEach(([category, amount]) => {
        html += `
            <div class="movement-item">
                <div class="movement-info">
                    <h4>${category}</h4>
                </div>
                <div class="movement-amount negative">
                    -${formatCurrency(amount)}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

async function loadExpensesList() {
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    
    const { data: movements } = await supabase
        .from('movements')
        .select(`
            *,
            categories (name)
        `)
        .eq('family_id', currentFamilyId)
        .eq('type', 'gasto_hogar')
        .gte('date', monthStart.toISOString().split('T')[0])
        .lte('date', monthEnd.toISOString().split('T')[0])
        .order('date', { ascending: false });
    
    const container = document.getElementById('expenses-list');
    container.innerHTML = '';
    
    if (!movements?.length) {
        container.innerHTML = '<div class="text-center">No hay gastos este mes</div>';
        return;
    }
    
    movements.forEach(mov => {
        const div = document.createElement('div');
        div.className = 'movement-item';
        
        div.innerHTML = `
            <div class="movement-info">
                <h4>${mov.categories?.name || 'Sin categoría'}</h4>
                <small>${formatDate(mov.date)}</small>
                ${mov.description ? `<small>${mov.description}</small>` : ''}
            </div>
            <div class="movement-amount negative">
                -${formatCurrency(mov.amount)}
            </div>
        `;
        
        container.appendChild(div);
    });
}

async function loadDessertsMovements() {
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    
    const { data: movements } = await supabase
        .from('movements')
        .select(`
            *,
            categories (name)
        `)
        .eq('family_id', currentFamilyId)
        .in('type', ['insumos_postres', 'ventas_postres'])
        .gte('date', monthStart.toISOString().split('T')[0])
        .lte('date', monthEnd.toISOString().split('T')[0])
        .order('date', { ascending: false });
    
    const container = document.getElementById('desserts-movements');
    container.innerHTML = '';
    
    if (!movements?.length) {
        container.innerHTML = '<div class="text-center">No hay movimientos de postres este mes</div>';
        return;
    }
    
    movements.forEach(mov => {
        const div = document.createElement('div');
        div.className = 'movement-item';
        
        const isSale = mov.type === 'ventas_postres';
        
        div.innerHTML = `
            <div class="movement-info">
                <h4>${mov.categories?.name || 'Sin categoría'}</h4>
                <small>${formatDate(mov.date)}</small>
                ${mov.description ? `<small>${mov.description}</small>` : ''}
            </div>
            <div class="movement-amount ${isSale ? 'positive' : 'negative'}">
                ${isSale ? '+' : '-'}${formatCurrency(mov.amount)}
            </div>
        `;
        
        container.appendChild(div);
    });
}

// Service Worker para PWA
function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registrado:', registration);
                
                // Solicitar permiso para notificaciones
                if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
            })
            .catch(error => {
                console.log('Error registrando Service Worker:', error);
            });
    }
    
    // Manejar instalación de PWA
    let deferredPrompt;
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Mostrar botón de instalación (opcional)
        setTimeout(() => {
            if (deferredPrompt && confirm('¿Deseas instalar la aplicación para un acceso más rápido?')) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('Usuario instaló la PWA');
                    }
                    deferredPrompt = null;
                });
            }
        }, 3000);
    });
}

// Suscripción a cambios en tiempo real
function setupRealtimeSubscriptions() {
    // Movimientos
    supabase.channel('movements')
        .on('postgres_changes', 
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'movements',
                filter: `family_id=eq.${currentFamilyId}`
            }, 
            (payload) => {
                console.log('Nuevo movimiento:', payload.new);
                // Actualizar UI
                updateBalances();
                loadMonthlySummary();
                loadRecentMovements();
            }
        )
        .subscribe();
}

// Inicializar suscripciones cuando el usuario esté logueado
if (currentUser && currentFamilyId) {
    setupRealtimeSubscriptions();
}
