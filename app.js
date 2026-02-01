// ============================================
// CONFIGURACIÓN SUPABASE - CARGA SEGURA
// ============================================

// Verificar si Supabase ya está cargado globalmente
if (!window.supabase) {
    console.error('Supabase no está cargado. Verifica que el script de Supabase se cargue antes de app.js');
}

// Configuración (REEMPLAZAR CON TUS DATOS)
const SUPABASE_URL = 'https://tusuario.supabase.co'; // Tu URL de Supabase
const SUPABASE_ANON_KEY = 'tu-anon-key-publico-aqui'; // Tu Anon Key público

// Crear cliente Supabase solo si no existe
let supabaseClient;
try {
    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            }
        });
        console.log('Cliente Supabase inicializado correctamente');
    } else {
        throw new Error('Supabase SDK no disponible');
    }
} catch (error) {
    console.error('Error inicializando Supabase:', error);
    // Crear un cliente mock para desarrollo offline
    supabaseClient = {
        auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            signInWithPassword: async () => ({ data: null, error: new Error('Offline') }),
            signUp: async () => ({ data: null, error: new Error('Offline') }),
            signOut: async () => ({ error: null })
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: null, error: new Error('Offline') })
                }),
                single: async () => ({ data: null, error: new Error('Offline') })
            }),
            insert: () => ({
                select: () => ({
                    single: async () => ({ data: null, error: new Error('Offline') })
                })
            }),
            update: () => ({
                eq: () => ({ error: null })
            })
        }),
        rpc: async () => ({ error: new Error('Offline') })
    };
}

// ============================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================
const AppState = {
    currentUser: null,
    currentFamily: null,
    currentMonth: new Date(),
    familyData: {
        persons: [],
        paymentMethods: [],
        categories: [],
        funds: []
    },
    transactions: [],
    emotionalMessages: [],
    isOffline: false,
    deferredInstallPrompt: null
};

// ============================================
// FUNCIONES DE AYUDA
// ============================================
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-message">${message}</span>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return '✅';
        case 'error': return '❌';
        case 'warning': return '⚠️';
        default: return 'ℹ️';
    }
}

function getTransactionTypeClass(type) {
    if (type.includes('income')) return 'income';
    if (type.includes('expense')) return 'expense';
    if (type.includes('fund')) return 'fund';
    if (type.includes('business')) return 'business';
    return '';
}

// ============================================
// MANEJO DE AUTENTICACIÓN
// ============================================
async function checkAuth() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error) {
            console.error('Error al verificar sesión:', error);
            showNotification('Error de conexión. Trabajando en modo offline.', 'warning');
            AppState.isOffline = true;
            return;
        }
        
        if (session?.user) {
            AppState.currentUser = session.user;
            await loadUserProfile();
        } else {
            showLoginScreen();
        }
    } catch (error) {
        console.error('Error en autenticación:', error);
        showLoginScreen();
    }
}

async function loadUserProfile() {
    try {
        const { data: userData, error } = await supabaseClient
            .from('users')
            .select('*, families(*)')
            .eq('id', AppState.currentUser.id)
            .single();
        
        if (error) {
            console.error('Error cargando perfil:', error);
            showNotification('Error cargando datos del usuario', 'error');
            return;
        }
        
        if (userData && userData.families) {
            AppState.currentFamily = userData.families;
            updateUserUI(userData);
            await loadInitialData();
            updateUI();
            startEmotionalMessagesRotation();
        } else {
            await createNewFamily();
        }
    } catch (error) {
        console.error('Error en loadUserProfile:', error);
        showNotification('Error cargando perfil', 'error');
    }
}

async function createNewFamily() {
    const familyName = prompt('Nombre para tu familia:', 'Nuestra Familia');
    if (!familyName) return;
    
    try {
        // Crear familia
        const { data: family, error: familyError } = await supabaseClient
            .from('families')
            .insert({ name: familyName })
            .select()
            .single();
        
        if (familyError) throw familyError;
        
        // Actualizar usuario con familia
        const { error: userError } = await supabaseClient
            .from('users')
            .update({ family_id: family.id })
            .eq('id', AppState.currentUser.id);
        
        if (userError) throw userError;
        
        // Inicializar datos de familia
        const { error: initError } = await supabaseClient.rpc('initialize_family_data', {
            family_uuid: family.id,
            admin_user_uuid: AppState.currentUser.id
        });
        
        if (initError) {
            console.warn('Error inicializando datos (puede ser normal):', initError);
        }
        
        AppState.currentFamily = family;
        await loadFamilyData();
        showNotification('¡Familia creada exitosamente!', 'success');
        
    } catch (error) {
        console.error('Error creando familia:', error);
        showNotification('Error creando familia. Intenta recargar la página.', 'error');
    }
}

function showLoginScreen() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    
    mainContent.innerHTML = `
        <div class="login-screen" style="max-width: 400px; margin: 2rem auto; padding: 2rem;">
            <div style="text-align: center; margin-bottom: 2rem;">
                <h2 style="color: #4F46E5; margin-bottom: 0.5rem;">Familia Unida</h2>
                <p style="color: #6B7280;">Una herramienta para ordenar sus finanzas juntos</p>
            </div>
            
            <form id="loginForm" class="login-form" style="background: white; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="email" style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Email</label>
                    <input type="email" id="email" required style="width: 100%; padding: 0.5rem; border: 1px solid #E5E7EB; border-radius: 0.375rem;">
                </div>
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="password" style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Contraseña</label>
                    <input type="password" id="password" required style="width: 100%; padding: 0.5rem; border: 1px solid #E5E7EB; border-radius: 0.375rem;">
                </div>
                <button type="submit" class="submit-button" style="width: 100%; padding: 0.75rem; background: #4F46E5; color: white; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; margin-bottom: 1rem;">
                    Iniciar sesión
                </button>
                <button type="button" id="showRegister" class="cancel-button" style="width: 100%; padding: 0.75rem; background: #F3F4F6; color: #374151; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer;">
                    Crear cuenta
                </button>
            </form>
            
            <form id="registerForm" class="login-form hidden" style="background: white; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: none;">
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="registerName" style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Nombre completo</label>
                    <input type="text" id="registerName" required style="width: 100%; padding: 0.5rem; border: 1px solid #E5E7EB; border-radius: 0.375rem;">
                </div>
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="registerEmail" style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Email</label>
                    <input type="email" id="registerEmail" required style="width: 100%; padding: 0.5rem; border: 1px solid #E5E7EB; border-radius: 0.375rem;">
                </div>
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="registerPassword" style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Contraseña (mínimo 6 caracteres)</label>
                    <input type="password" id="registerPassword" required minlength="6" style="width: 100%; padding: 0.5rem; border: 1px solid #E5E7EB; border-radius: 0.375rem;">
                </div>
                <button type="submit" class="submit-button" style="width: 100%; padding: 0.75rem; background: #4F46E5; color: white; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; margin-bottom: 1rem;">
                    Crear cuenta
                </button>
                <button type="button" id="showLogin" class="cancel-button" style="width: 100%; padding: 0.75rem; background: #F3F4F6; color: #374151; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer;">
                    Ya tengo cuenta
                </button>
            </form>
            
            <div style="text-align: center; margin-top: 2rem; color: #6B7280; font-size: 0.875rem;">
                <p>Esta app ayuda a Sebastián y Ludmila a ordenar sus finanzas juntos 💕</p>
            </div>
        </div>
    `;
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('showRegister').addEventListener('click', () => {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    });
    document.getElementById('showLogin').addEventListener('click', () => {
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        AppState.currentUser = data.user;
        location.reload();
        
    } catch (error) {
        console.error('Error en login:', error);
        showNotification(error.message || 'Error al iniciar sesión', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: name
                }
            }
        });
        
        if (error) throw error;
        
        showNotification('¡Cuenta creada! Revisa tu email para confirmar.', 'success');
        
        // Volver al formulario de login
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
        
    } catch (error) {
        console.error('Error en registro:', error);
        showNotification(error.message || 'Error al crear cuenta', 'error');
    }
}

async function handleLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        
        AppState.currentUser = null;
        AppState.currentFamily = null;
        AppState.familyData = { persons: [], paymentMethods: [], categories: [], funds: [] };
        AppState.transactions = [];
        
        showLoginScreen();
        showNotification('Sesión cerrada exitosamente', 'success');
        
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        showNotification('Error al cerrar sesión', 'error');
    }
}

// ============================================
// CARGA DE DATOS
// ============================================
async function loadInitialData() {
    if (!AppState.currentFamily) return;
    
    try {
        await Promise.all([
            loadFamilyData(),
            loadTransactions(),
            loadEmotionalMessages()
        ]);
    } catch (error) {
        console.error('Error cargando datos iniciales:', error);
    }
}

async function loadFamilyData() {
    if (!AppState.currentFamily) return;
    
    try {
        const [personsRes, paymentsRes, categoriesRes, fundsRes] = await Promise.all([
            supabaseClient.from('persons').select('*').eq('family_id', AppState.currentFamily.id),
            supabaseClient.from('payment_methods').select('*').eq('family_id', AppState.currentFamily.id),
            supabaseClient.from('categories').select('*').eq('family_id', AppState.currentFamily.id),
            supabaseClient.from('funds').select('*').eq('family_id', AppState.currentFamily.id)
        ]);
        
        AppState.familyData.persons = personsRes.data || [];
        AppState.familyData.paymentMethods = paymentsRes.data || [];
        AppState.familyData.categories = categoriesRes.data || [];
        AppState.familyData.funds = fundsRes.data || [];
        
    } catch (error) {
        console.error('Error cargando datos familiares:', error);
    }
}

async function loadTransactions() {
    if (!AppState.currentFamily) return;
    
    try {
        const startOfMonth = new Date(AppState.currentMonth.getFullYear(), AppState.currentMonth.getMonth(), 1);
        const endOfMonth = new Date(AppState.currentMonth.getFullYear(), AppState.currentMonth.getMonth() + 1, 0);
        
        const { data, error } = await supabaseClient
            .from('transactions')
            .select(`
                *,
                category:categories(*),
                person:persons(*),
                payment_method:payment_methods(*),
                fund:funds(*)
            `)
            .eq('family_id', AppState.currentFamily.id)
            .gte('date', startOfMonth.toISOString().split('T')[0])
            .lte('date', endOfMonth.toISOString().split('T')[0])
            .order('date', { ascending: false });
        
        if (error) throw error;
        
        AppState.transactions = data || [];
        
    } catch (error) {
        console.error('Error cargando transacciones:', error);
        AppState.transactions = [];
    }
}

async function loadEmotionalMessages() {
    try {
        const { data, error } = await supabaseClient
            .from('emotional_messages')
            .select('*')
            .eq('is_active', true);
        
        if (error) throw error;
        
        AppState.emotionalMessages = data || [];
        
    } catch (error) {
        console.error('Error cargando mensajes:', error);
        AppState.emotionalMessages = [
            { message: 'Esto lo estamos ordenando juntos' },
            { message: 'No es culpa, es equipo' },
            { message: 'Estamos construyendo tranquilidad' }
        ];
    }
}

// ============================================
// INTERFAZ DE USUARIO
// ============================================
function initUI() {
    // Menú lateral
    const menuButton = document.getElementById('menuButton');
    const closeMenu = document.getElementById('closeMenu');
    const menuOverlay = document.getElementById('menuOverlay');
    const sideMenu = document.querySelector('.side-menu');
    
    if (menuButton) {
        menuButton.addEventListener('click', () => {
            sideMenu.classList.add('open');
            menuOverlay.classList.add('show');
        });
    }
    
    if (closeMenu) {
        closeMenu.addEventListener('click', () => {
            sideMenu.classList.remove('open');
            menuOverlay.classList.remove('show');
        });
    }
    
    if (menuOverlay) {
        menuOverlay.addEventListener('click', () => {
            sideMenu.classList.remove('open');
            menuOverlay.classList.remove('show');
        });
    }
    
    // Navegación por pestañas
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
            
            // Cerrar menú en móvil
            if (window.innerWidth < 768) {
                sideMenu.classList.remove('open');
                menuOverlay.classList.remove('show');
            }
        });
    });
    
    document.querySelectorAll('.cancel-button[data-tab]').forEach(button => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
    });
    
    // Navegación de meses
    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');
    
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            AppState.currentMonth.setMonth(AppState.currentMonth.getMonth() - 1);
            updateMonthUI();
            loadTransactions().then(updateUI);
        });
    }
    
    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            AppState.currentMonth.setMonth(AppState.currentMonth.getMonth() + 1);
            updateMonthUI();
            loadTransactions().then(updateUI);
        });
    }
    
    // Formulario de transacción
    const transactionForm = document.getElementById('transactionForm');
    const transactionType = document.getElementById('transactionType');
    
    if (transactionForm) {
        transactionForm.addEventListener('submit', handleTransactionSubmit);
    }
    
    if (transactionType) {
        transactionType.addEventListener('change', updateTransactionForm);
    }
    
    // Logout
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
    
    // Filtros de historial
    const filterType = document.getElementById('filterType');
    const filterPerson = document.getElementById('filterPerson');
    const filterPayment = document.getElementById('filterPayment');
    const filterDate = document.getElementById('filterDate');
    
    if (filterType) filterType.addEventListener('change', updateHistory);
    if (filterPerson) filterPerson.addEventListener('change', updateHistory);
    if (filterPayment) filterPayment.addEventListener('change', updateHistory);
    if (filterDate) filterDate.addEventListener('change', updateHistory);
    
    // Botón de instalación PWA
    const installButton = document.getElementById('installButton');
    if (installButton) {
        installButton.addEventListener('click', installPWA);
    }
    
    // Configurar fecha actual en formulario
    const transactionDate = document.getElementById('transactionDate');
    if (transactionDate) {
        transactionDate.value = new Date().toISOString().split('T')[0];
    }
}

function updateUserUI(userData) {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const email = document.getElementById('userEmail');
    
    if (avatar) avatar.textContent = userData.full_name?.charAt(0) || 'FU';
    if (name) name.textContent = userData.full_name || 'Familia';
    if (email) email.textContent = userData.email || '';
}

function switchTab(tabName) {
    // Actualizar menú activo
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });
    
    // Mostrar pestaña activa
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === tabName);
    });
    
    // Cargar datos específicos si es necesario
    if (tabName === 'history') updateHistory();
    if (tabName === 'add-transaction') setupTransactionForm();
    if (tabName === 'settings') updateSettings();
}

function updateMonthUI() {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const month = monthNames[AppState.currentMonth.getMonth()];
    const year = AppState.currentMonth.getFullYear();
    const currentMonthEl = document.getElementById('currentMonth');
    if (currentMonthEl) {
        currentMonthEl.textContent = `${month} ${year}`;
    }
}

function updateUI() {
    updateMonthUI();
    updateDashboard();
    updateBalance();
    updateExpenses();
    updateBusiness();
    updateFunds();
}

function updateDashboard() {
    const transactions = AppState.transactions;
    
    // Ingresos totales
    const totalIncome = transactions
        .filter(t => t.transaction_type === 'personal_income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalIncomeEl = document.getElementById('totalIncome');
    if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(totalIncome);
    
    // Gastos del hogar
    const totalExpenses = transactions
        .filter(t => t.transaction_type === 'household_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalExpensesEl = document.getElementById('totalExpenses');
    if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(totalExpenses);
    
    // Resultado postres
    const sales = transactions
        .filter(t => t.transaction_type === 'business_income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const businessResult = sales - supplies;
    const businessResultEl = document.getElementById('businessResult');
    if (businessResultEl) businessResultEl.textContent = formatCurrency(businessResult);
    
    // Ahorro del mes
    const monthlySavings = transactions
        .filter(t => t.transaction_type === 'fund_deposit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const monthlySavingsEl = document.getElementById('monthlySavings');
    if (monthlySavingsEl) monthlySavingsEl.textContent = formatCurrency(monthlySavings);
    
    // Balance final
    const finalBalance = totalIncome - totalExpenses + businessResult;
    const balanceEl = document.getElementById('finalBalance');
    if (balanceEl) {
        balanceEl.textContent = formatCurrency(finalBalance);
        balanceEl.className = `balance-value ${finalBalance >= 0 ? 'positive' : 'negative'}`;
    }
    
    // Mensaje de balance
    const messageEl = document.getElementById('balanceMessage');
    if (messageEl) {
        if (finalBalance >= 0) {
            messageEl.textContent = '¡Excelente trabajo en equipo! Sigan así.';
            messageEl.style.color = 'var(--color-success)';
        } else {
            messageEl.textContent = 'Es momento de revisar juntos los gastos. No es culpa, es equipo.';
            messageEl.style.color = 'var(--color-danger)';
        }
    }
    
    // Fondos preview
    updateFundsPreview();
}

function updateBalance() {
    const balanceCards = document.getElementById('balanceCards');
    if (!balanceCards) return;
    
    balanceCards.innerHTML = '';
    
    AppState.familyData.paymentMethods.forEach(method => {
        const balance = parseFloat(method.current_balance) || 0;
        const card = document.createElement('div');
        card.className = 'summary-card';
        card.innerHTML = `
            <div class="card-header">
                <span class="card-icon">${method.icon}</span>
                <h3>${method.name}</h3>
            </div>
            <div class="card-value">${formatCurrency(balance)}</div>
        `;
        balanceCards.appendChild(card);
    });
    
    // Total combinado
    const total = AppState.familyData.paymentMethods.reduce((sum, method) => 
        sum + parseFloat(method.current_balance || 0), 0);
    const totalBalanceEl = document.getElementById('totalBalance');
    if (totalBalanceEl) totalBalanceEl.textContent = formatCurrency(total);
}

function updateExpenses() {
    const categoryChart = document.getElementById('categoryChart');
    const categoryRanking = document.getElementById('categoryRanking');
    if (!categoryChart || !categoryRanking) return;
    
    const transactions = AppState.transactions.filter(t => t.transaction_type === 'household_expense');
    
    // Agrupar por categoría
    const categories = {};
    transactions.forEach(t => {
        if (!t.category) return;
        const catName = t.category.name;
        categories[catName] = (categories[catName] || 0) + parseFloat(t.amount);
    });
    
    // Crear gráfico simple
    categoryChart.innerHTML = '<h3>Distribución de gastos</h3>';
    Object.entries(categories).forEach(([name, amount]) => {
        const maxAmount = Math.max(...Object.values(categories), 1);
        const percentage = (amount / maxAmount) * 100;
        
        const bar = document.createElement('div');
        bar.className = 'category-bar';
        bar.innerHTML = `
            <div class="bar-label">${name}</div>
            <div class="bar-container">
                <div class="bar-fill" style="width: ${percentage}%"></div>
                <div class="bar-amount">${formatCurrency(amount)}</div>
            </div>
        `;
        categoryChart.appendChild(bar);
    });
    
    // Ranking
    categoryRanking.innerHTML = '<h3>Ranking de categorías</h3>';
    const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([name, amount], index) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
            <span class="category-rank">${index + 1}</span>
            <span class="category-name">${name}</span>
            <span class="category-amount">${formatCurrency(amount)}</span>
        `;
        categoryRanking.appendChild(item);
    });
}

function updateBusiness() {
    const transactions = AppState.transactions;
    
    const sales = transactions
        .filter(t => t.transaction_type === 'business_income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const profit = sales - supplies;
    
    const totalSalesEl = document.getElementById('totalSales');
    const totalSuppliesEl = document.getElementById('totalSupplies');
    const businessProfitEl = document.getElementById('businessProfit');
    
    if (totalSalesEl) totalSalesEl.textContent = formatCurrency(sales);
    if (totalSuppliesEl) totalSuppliesEl.textContent = formatCurrency(supplies);
    if (businessProfitEl) businessProfitEl.textContent = formatCurrency(profit);
    
    // Fondo postres
    const dessertFund = AppState.familyData.funds.find(f => f.name === 'Fondo fijo postres');
    if (dessertFund) {
        const current = parseFloat(dessertFund.current_amount);
        const goal = parseFloat(dessertFund.monthly_goal);
        const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
        const missing = Math.max(goal - current, 0);
        
        const dessertFundCurrentEl = document.getElementById('dessertFundCurrent');
        const dessertFundGoalEl = document.getElementById('dessertFundGoal');
        const dessertFundProgressEl = document.getElementById('dessertFundProgress');
        const dessertFundMissingEl = document.getElementById('dessertFundMissing');
        
        if (dessertFundCurrentEl) dessertFundCurrentEl.textContent = formatCurrency(current);
        if (dessertFundGoalEl) dessertFundGoalEl.textContent = formatCurrency(goal);
        if (dessertFundProgressEl) dessertFundProgressEl.style.width = `${percentage}%`;
        if (dessertFundMissingEl) {
            dessertFundMissingEl.textContent = `Faltan ${formatCurrency(missing)} para el objetivo`;
        }
    }
}

function updateFundsPreview() {
    const fundsList = document.getElementById('fundsList');
    if (!fundsList) return;
    
    fundsList.innerHTML = '';
    
    AppState.familyData.funds.forEach(fund => {
        const current = parseFloat(fund.current_amount);
        const goal = parseFloat(fund.monthly_goal);
        const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
        
        let status = 'ok';
        if (percentage < 50) status = 'low';
        if (percentage < 25) status = 'critical';
        
        const fundEl = document.createElement('div');
        fundEl.className = `fund-item ${status}`;
        fundEl.innerHTML = `
            <div class="fund-header">
                <div class="fund-name">${fund.icon} ${fund.name}</div>
                <div class="fund-amount">${formatCurrency(current)}</div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
        `;
        
        fundsList.appendChild(fundEl);
    });
}

function updateFunds() {
    const fullFundsList = document.getElementById('fullFundsList');
    if (!fullFundsList) return;
    
    fullFundsList.innerHTML = '';
    
    AppState.familyData.funds.forEach(fund => {
        const current = parseFloat(fund.current_amount);
        const goal = parseFloat(fund.monthly_goal);
        const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
        const missing = Math.max(goal - current, 0);
        
        let status = 'ok';
        if (percentage < 50) status = 'low';
        if (percentage < 25) status = 'critical';
        
        const fundEl = document.createElement('div');
        fundEl.className = `fund-item ${status}`;
        fundEl.innerHTML = `
            <div class="fund-header">
                <div class="fund-name">
                    <span class="fund-status-indicator fund-status-${status}"></span>
                    <span>${fund.icon} ${fund.name}</span>
                </div>
                <div class="fund-amount">${formatCurrency(current)}</div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="fund-stats">
                <span>Objetivo: ${formatCurrency(goal)}</span>
                <span>${percentage.toFixed(1)}%</span>
            </div>
            <div class="fund-missing">Faltan ${formatCurrency(missing)}</div>
            <div class="fund-actions">
                <button class="edit-fund" data-fund-id="${fund.id}">Editar objetivo</button>
            </div>
        `;
        
        fullFundsList.appendChild(fundEl);
    });
    
    // Agregar event listeners para editar fondos
    document.querySelectorAll('.edit-fund').forEach(button => {
        button.addEventListener('click', (e) => {
            const fundId = e.target.dataset.fundId;
            editFundGoal(fundId);
        });
    });
}

async function editFundGoal(fundId) {
    const fund = AppState.familyData.funds.find(f => f.id === fundId);
    if (!fund) return;
    
    const newGoal = prompt(`Nuevo objetivo mensual para ${fund.name}:`, fund.monthly_goal);
    if (newGoal === null) return;
    
    const goalValue = parseFloat(newGoal);
    if (isNaN(goalValue) || goalValue < 0) {
        showNotification('Por favor ingresa un valor válido', 'warning');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('funds')
            .update({ monthly_goal: goalValue })
            .eq('id', fundId);
        
        if (error) throw error;
        
        fund.monthly_goal = goalValue;
        updateFunds();
        updateFundsPreview();
        showNotification('Objetivo actualizado correctamente', 'success');
        
    } catch (error) {
        console.error('Error actualizando objetivo:', error);
        showNotification('Error actualizando objetivo', 'error');
    }
}

function setupTransactionForm() {
    // Personas
    const personSelect = document.getElementById('transactionPerson');
    if (personSelect) {
        personSelect.innerHTML = '<option value="">Seleccionar persona</option>';
        AppState.familyData.persons.forEach(person => {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = person.name;
            personSelect.appendChild(option);
        });
    }
    
    // Medios de pago
    const paymentSelect = document.getElementById('transactionPayment');
    if (paymentSelect) {
        paymentSelect.innerHTML = '<option value="">Seleccionar medio</option>';
        AppState.familyData.paymentMethods.forEach(method => {
            const option = document.createElement('option');
            option.value = method.id;
            option.textContent = `${method.icon} ${method.name}`;
            paymentSelect.appendChild(option);
        });
    }
    
    // Fondos
    const fundSelect = document.getElementById('transactionFund');
    if (fundSelect) {
        fundSelect.innerHTML = '<option value="">Seleccionar fondo</option>';
        AppState.familyData.funds.forEach(fund => {
            const option = document.createElement('option');
            option.value = fund.id;
            option.textContent = `${fund.icon} ${fund.name}`;
            fundSelect.appendChild(option);
        });
    }
    
    // Fecha actual por defecto
    const transactionDate = document.getElementById('transactionDate');
    if (transactionDate) {
        transactionDate.value = new Date().toISOString().split('T')[0];
    }
    
    updateTransactionForm();
}

function updateTransactionForm() {
    const type = document.getElementById('transactionType')?.value;
    const categoryField = document.getElementById('categoryField');
    const fundField = document.getElementById('fundField');
    
    if (!type) return;
    
    // Actualizar categorías según tipo
    const categorySelect = document.getElementById('transactionCategory');
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="">Seleccionar categoría</option>';
        
        let categoryType = '';
        switch(type) {
            case 'household_expense': categoryType = 'household_expense'; break;
            case 'personal_income': categoryType = 'personal_income'; break;
            case 'business_expense': categoryType = 'business_expense'; break;
            case 'business_income': categoryType = 'business_income'; break;
            case 'fund_deposit': 
            case 'fund_withdrawal': 
                categoryType = 'fund'; 
                break;
        }
        
        const categories = AppState.familyData.categories.filter(c => c.type === categoryType);
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            categorySelect.appendChild(option);
        });
        
        if (categoryField) {
            categoryField.style.display = categories.length > 0 ? 'block' : 'none';
        }
    }
    
    if (fundField) {
        fundField.style.display = type.includes('fund') ? 'block' : 'none';
    }
}

async function handleTransactionSubmit(e) {
    e.preventDefault();
    
    if (!AppState.currentFamily) {
        showNotification('No hay familia seleccionada', 'error');
        return;
    }
    
    const type = document.getElementById('transactionType').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const date = document.getElementById('transactionDate').value;
    const categoryId = document.getElementById('transactionCategory').value;
    const personId = document.getElementById('transactionPerson').value;
    const paymentMethodId = document.getElementById('transactionPayment').value;
    const fundId = document.getElementById('transactionFund').value;
    const note = document.getElementById('transactionNote').value;
    
    // Validaciones
    if (!type || !amount || !date || !personId || !paymentMethodId) {
        showNotification('Por favor completa todos los campos requeridos', 'warning');
        return;
    }
    
    if (amount <= 0) {
        showNotification('El monto debe ser mayor a 0', 'warning');
        return;
    }
    
    if (type.includes('fund') && !fundId) {
        showNotification('Por favor selecciona un fondo', 'warning');
        return;
    }
    
    if ((type === 'household_expense' || type === 'business_expense' || type === 'business_income') && !categoryId) {
        showNotification('Por favor selecciona una categoría', 'warning');
        return;
    }
    
    const transactionData = {
        family_id: AppState.currentFamily.id,
        transaction_type: type,
        amount: amount,
        date: date,
        person_id: personId,
        payment_method_id: paymentMethodId,
        description: note || null
    };
    
    if (categoryId) transactionData.category_id = categoryId;
    if (fundId) transactionData.fund_id = fundId;
    
    try {
        const { data, error } = await supabaseClient
            .from('transactions')
            .insert(transactionData)
            .select()
            .single();
        
        if (error) throw error;
        
        showNotification('Movimiento registrado correctamente', 'success');
        
        // Resetear formulario
        e.target.reset();
        const transactionDateEl = document.getElementById('transactionDate');
        if (transactionDateEl) transactionDateEl.value = new Date().toISOString().split('T')[0];
        
        // Actualizar datos
        await Promise.all([
            loadTransactions(),
            loadFamilyData()
        ]);
        
        updateUI();
        switchTab('dashboard');
        
    } catch (error) {
        console.error('Error guardando transacción:', error);
        showNotification('Error al guardar el movimiento', 'error');
    }
}

// ============================================
// PWA Y SERVICE WORKER
// ============================================
function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        AppState.deferredInstallPrompt = e;
        
        setTimeout(() => {
            const installButton = document.getElementById('installButton');
            if (installButton) {
                installButton.style.display = 'flex';
            }
        }, 3000);
    });
}

function installPWA() {
    if (!AppState.deferredInstallPrompt) {
        showNotification('La aplicación ya está instalada', 'info');
        return;
    }
    
    AppState.deferredInstallPrompt.prompt();
    
    AppState.deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            showNotification('¡App instalada! Ahora está disponible en tu pantalla principal.', 'success');
        }
        AppState.deferredInstallPrompt = null;
    });
}

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registrado correctamente');
        } catch (error) {
            console.warn('Service Worker no registrado:', error);
        }
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Aplicación cargando...');
    
    // Inicializar UI
    initUI();
    
    // Configurar Service Worker
    await registerServiceWorker();
    
    // Verificar autenticación
    await checkAuth();
});

// Función para rotar mensajes emocionales
function startEmotionalMessagesRotation() {
    if (AppState.emotionalMessages.length === 0) return;
    
    let index = 0;
    const messageEl = document.getElementById('emotionalMessage');
    if (!messageEl) return;
    
    // Mostrar primer mensaje
    messageEl.textContent = AppState.emotionalMessages[0].message;
    
    // Rotar cada 10 segundos
    setInterval(() => {
        index = (index + 1) % AppState.emotionalMessages.length;
        messageEl.textContent = AppState.emotionalMessages[index].message;
        
        messageEl.style.opacity = '0';
        setTimeout(() => {
            messageEl.style.opacity = '1';
        }, 300);
    }, 10000);
}

// Exportar para debugging
window.AppState = AppState;
window.supabaseClient = supabaseClient;
