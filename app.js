// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================

// ¡IMPORTANTE! REEMPLAZAR CON TUS DATOS REALES
const SUPABASE_URL = 'https://rdscdgohbrkqnuxjyalg.supabase.co'; // Tu URL de Supabase
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkc2NkZ29oYnJrcW51eGp5YWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTk0NDUsImV4cCI6MjA4NTQ3NTQ0NX0.nrjtRfGMBdq0KKxZaxG8Z6-CQArxdVB9hHkY-50AXMI'; // Tu Anon Key

// Crear cliente Supabase globalmente
let supabaseClient = null;

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
// FUNCIONES DE UTILIDAD
// ============================================
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function showNotification(message, type = 'info') {
    // Crear contenedor si no existe
    let container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-message">${message}</span>
    `;
    
    container.appendChild(notification);
    
    // Auto-remover
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
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

// ============================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM cargado, iniciando aplicación...');
    
    // Inicializar Supabase
    await initSupabase();
    
    // Inicializar UI
    initUI();
    
    // Configurar PWA
    setupPWAInstall();
    
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registrado correctamente');
        } catch (error) {
            console.warn('Error registrando Service Worker:', error);
        }
    }
    
    // Verificar autenticación
    await checkAuth();
});

async function initSupabase() {
    try {
        // Verificar que Supabase esté disponible
        if (typeof supabase === 'undefined') {
            throw new Error('Supabase no está cargado. Verifica el script en index.html');
        }
        
        // Crear cliente
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            }
        });
        
        console.log('Supabase inicializado correctamente');
        return true;
    } catch (error) {
        console.error('Error inicializando Supabase:', error);
        showNotification('Error de conexión. La aplicación funcionará en modo offline.', 'error');
        return false;
    }
}

// ============================================
// AUTENTICACIÓN
// ============================================
async function checkAuth() {
    try {
        if (!supabaseClient) {
            showLoginScreen();
            return;
        }
        
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error) {
            console.error('Error al verificar sesión:', error);
            showLoginScreen();
            return;
        }
        
        if (session?.user) {
            AppState.currentUser = session.user;
            await loadUserProfile();
        } else {
            showLoginScreen();
        }
    } catch (error) {
        console.error('Error en checkAuth:', error);
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
        
        if (error) throw error;
        
        if (userData && userData.families) {
            AppState.currentFamily = userData.families;
            updateUserUI(userData);
            await loadInitialData();
            updateUI();
            startEmotionalMessagesRotation();
            showNotification(`¡Bienvenido/a ${userData.full_name || 'Familia'}!`, 'success');
        } else {
            await createNewFamily();
        }
    } catch (error) {
        console.error('Error cargando perfil:', error);
        showNotification('Error cargando datos del usuario', 'error');
        showLoginScreen();
    }
}

async function createNewFamily() {
    const familyName = prompt('Nombre para tu familia:', 'Nuestra Familia');
    if (!familyName) {
        showNotification('Se necesita un nombre para la familia', 'warning');
        return;
    }
    
    try {
        // Crear familia
        const { data: family, error: familyError } = await supabaseClient
            .from('families')
            .insert({ name: familyName })
            .select()
            .single();
        
        if (familyError) throw familyError;
        
        // Actualizar usuario
        const { error: userError } = await supabaseClient
            .from('users')
            .update({ family_id: family.id })
            .eq('id', AppState.currentUser.id);
        
        if (userError) throw userError;
        
        // Inicializar datos
        try {
            const { error: initError } = await supabaseClient.rpc('initialize_family_data', {
                family_uuid: family.id,
                admin_user_uuid: AppState.currentUser.id
            });
            
            if (initError) console.warn('Error en initialize_family_data:', initError);
        } catch (initError) {
            console.warn('No se pudo inicializar datos:', initError);
        }
        
        AppState.currentFamily = family;
        await loadInitialData();
        updateUI();
        showNotification('¡Familia creada exitosamente!', 'success');
        
    } catch (error) {
        console.error('Error creando familia:', error);
        showNotification('Error creando familia', 'error');
    }
}

function showLoginScreen() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    
    mainContent.innerHTML = `
        <div class="login-container" style="max-width: 400px; margin: 3rem auto; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 2rem;">
                <h1 style="color: #4F46E5; margin-bottom: 0.5rem; font-size: 2rem;">👨‍👩‍👧‍👦 Familia Unida</h1>
                <p style="color: #6B7280; margin-bottom: 1.5rem; font-size: 1.1rem;">Ordenando finanzas juntos, sin estrés</p>
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 1.5rem; border-radius: 0.75rem; color: white; margin-bottom: 1.5rem;">
                    <p style="margin: 0; font-style: italic; font-size: 1.2rem;">"Esto lo estamos ordenando juntos"</p>
                </div>
            </div>
            
            <form id="loginForm" style="margin-bottom: 1.5rem;">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">Email</label>
                    <input type="email" id="loginEmail" required 
                           style="width: 100%; padding: 0.75rem; border: 2px solid #E5E7EB; border-radius: 0.5rem; font-size: 1rem; transition: border-color 0.3s;"
                           placeholder="tu@email.com">
                </div>
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">Contraseña</label>
                    <input type="password" id="loginPassword" required 
                           style="width: 100%; padding: 0.75rem; border: 2px solid #E5E7EB; border-radius: 0.5rem; font-size: 1rem; transition: border-color 0.3s;"
                           placeholder="••••••">
                </div>
                <button type="submit" 
                        style="width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 0.5rem; font-weight: 600; font-size: 1rem; cursor: pointer; transition: transform 0.2s;">
                    Iniciar Sesión
                </button>
            </form>
            
            <div style="text-align: center; margin-bottom: 1.5rem; position: relative;">
                <div style="height: 1px; background: #E5E7EB; position: absolute; top: 50%; left: 0; right: 0;"></div>
                <span style="background: white; padding: 0 1rem; color: #6B7280; font-size: 0.875rem;">¿No tienes cuenta?</span>
            </div>
            
            <form id="registerForm">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">Nombre Completo</label>
                    <input type="text" id="registerName" required 
                           style="width: 100%; padding: 0.75rem; border: 2px solid #E5E7EB; border-radius: 0.5rem; font-size: 1rem;"
                           placeholder="Ej: Sebastián y Ludmila">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">Email</label>
                    <input type="email" id="registerEmail" required 
                           style="width: 100%; padding: 0.75rem; border: 2px solid #E5E7EB; border-radius: 0.5rem; font-size: 1rem;"
                           placeholder="tu@email.com">
                </div>
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">Contraseña</label>
                    <input type="password" id="registerPassword" required minlength="6"
                           style="width: 100%; padding: 0.75rem; border: 2px solid #E5E7EB; border-radius: 0.5rem; font-size: 1rem;"
                           placeholder="Mínimo 6 caracteres">
                </div>
                <button type="submit" 
                        style="width: 100%; padding: 0.75rem; background: #10B981; color: white; border: none; border-radius: 0.5rem; font-weight: 600; font-size: 1rem; cursor: pointer; transition: transform 0.2s;">
                    Crear Cuenta
                </button>
            </form>
            
            <div style="margin-top: 2rem; text-align: center; color: #6B7280; font-size: 0.875rem;">
                <p>💝 Diseñado con amor para ayudar a familias a ordenar sus finanzas juntos</p>
            </div>
        </div>
    `;
    
    // Agregar estilos dinámicos para hover
    const style = document.createElement('style');
    style.textContent = `
        #loginForm input:focus, #registerForm input:focus {
            border-color: #4F46E5 !important;
            outline: none;
        }
        #loginForm button:hover, #registerForm button:hover {
            transform: translateY(-2px) !important;
        }
        .login-container {
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
    
    // Event Listeners
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleLogin();
    });
    
    document.getElementById('registerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleRegister();
    });
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showNotification('Por favor completa todos los campos', 'warning');
        return;
    }
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        AppState.currentUser = data.user;
        showNotification('¡Bienvenido de vuelta!', 'success');
        
        // Pequeño delay para mostrar notificación
        setTimeout(() => {
            location.reload();
        }, 1000);
        
    } catch (error) {
        console.error('Error en login:', error);
        showNotification(error.message || 'Error al iniciar sesión', 'error');
    }
}

async function handleRegister() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    if (!name || !email || !password) {
        showNotification('Por favor completa todos los campos', 'warning');
        return;
    }
    
    if (password.length < 6) {
        showNotification('La contraseña debe tener al menos 6 caracteres', 'warning');
        return;
    }
    
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
        
        // Cambiar a formulario de login
        document.getElementById('loginEmail').value = email;
        document.getElementById('registerName').value = '';
        document.getElementById('registerEmail').value = '';
        document.getElementById('registerPassword').value = '';
        
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
        
        showNotification('Sesión cerrada exitosamente', 'success');
        showLoginScreen();
        
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
        console.log('Datos iniciales cargados');
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
        
        AppState.emotionalMessages = data || [
            { message: 'Esto lo estamos ordenando juntos' },
            { message: 'No es culpa, es equipo' },
            { message: 'Estamos construyendo tranquilidad' }
        ];
        
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
    document.getElementById('menuButton').addEventListener('click', () => {
        document.querySelector('.side-menu').classList.add('open');
        document.getElementById('menuOverlay').classList.add('show');
    });
    
    document.getElementById('closeMenu').addEventListener('click', () => {
        document.querySelector('.side-menu').classList.remove('open');
        document.getElementById('menuOverlay').classList.remove('show');
    });
    
    document.getElementById('menuOverlay').addEventListener('click', () => {
        document.querySelector('.side-menu').classList.remove('open');
        document.getElementById('menuOverlay').classList.remove('show');
    });
    
    // Navegación por pestañas
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
            
            if (window.innerWidth < 768) {
                document.querySelector('.side-menu').classList.remove('open');
                document.getElementById('menuOverlay').classList.remove('show');
            }
        });
    });
    
    // Botones de cancelar
    document.querySelectorAll('.cancel-button[data-tab]').forEach(button => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
    });
    
    // Navegación de meses
    document.getElementById('prevMonth').addEventListener('click', () => {
        AppState.currentMonth.setMonth(AppState.currentMonth.getMonth() - 1);
        updateMonthUI();
        loadTransactions().then(updateUI);
    });
    
    document.getElementById('nextMonth').addEventListener('click', () => {
        AppState.currentMonth.setMonth(AppState.currentMonth.getMonth() + 1);
        updateMonthUI();
        loadTransactions().then(updateUI);
    });
    
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
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    
    // Botón de instalación
    const installButton = document.getElementById('installButton');
    if (installButton) {
        installButton.addEventListener('click', installPWA);
    }
    
    // Configurar fecha por defecto
    const transactionDate = document.getElementById('transactionDate');
    if (transactionDate) {
        transactionDate.value = new Date().toISOString().split('T')[0];
    }
    
    // Filtros de historial
    document.getElementById('filterType')?.addEventListener('change', updateHistory);
    document.getElementById('filterPerson')?.addEventListener('change', updateHistory);
    document.getElementById('filterPayment')?.addEventListener('change', updateHistory);
    document.getElementById('filterDate')?.addEventListener('change', updateHistory);
}

function updateUserUI(userData) {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const email = document.getElementById('userEmail');
    
    if (avatar) {
        const initials = userData.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'FU';
        avatar.textContent = initials.substring(0, 2);
    }
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
    
    // Cargar datos específicos
    if (tabName === 'history') updateHistory();
    if (tabName === 'add-transaction') setupTransactionForm();
    if (tabName === 'settings') updateSettings();
}

function updateMonthUI() {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const month = monthNames[AppState.currentMonth.getMonth()];
    const year = AppState.currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${month} ${year}`;
}

function updateUI() {
    updateMonthUI();
    updateDashboard();
    updateBalance();
    updateExpenses();
    updateBusiness();
    updateFunds();
    updateFundsPreview();
}

function updateDashboard() {
    const transactions = AppState.transactions;
    
    // Ingresos totales
    const totalIncome = transactions
        .filter(t => t.transaction_type === 'personal_income')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
    
    // Gastos del hogar
    const totalExpenses = transactions
        .filter(t => t.transaction_type === 'household_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    document.getElementById('totalExpenses').textContent = formatCurrency(totalExpenses);
    
    // Resultado postres
    const sales = transactions
        .filter(t => t.transaction_type === 'business_income')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const businessResult = sales - supplies;
    document.getElementById('businessResult').textContent = formatCurrency(businessResult);
    
    // Ahorro del mes
    const monthlySavings = transactions
        .filter(t => t.transaction_type === 'fund_deposit')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    document.getElementById('monthlySavings').textContent = formatCurrency(monthlySavings);
    
    // Balance final
    const finalBalance = totalIncome - totalExpenses + businessResult;
    const balanceEl = document.getElementById('finalBalance');
    balanceEl.textContent = formatCurrency(finalBalance);
    balanceEl.className = `balance-value ${finalBalance >= 0 ? 'positive' : 'negative'}`;
    
    // Mensaje de balance
    const messageEl = document.getElementById('balanceMessage');
    if (finalBalance >= 0) {
        messageEl.textContent = '¡Excelente trabajo en equipo! Sigan así.';
        messageEl.style.color = 'var(--color-success)';
    } else {
        messageEl.textContent = 'Es momento de revisar juntos los gastos. No es culpa, es equipo.';
        messageEl.style.color = 'var(--color-danger)';
    }
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
    document.getElementById('totalBalance').textContent = formatCurrency(total);
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
        categories[catName] = (categories[catName] || 0) + parseFloat(t.amount || 0);
    });
    
    // Crear gráfico
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
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const profit = sales - supplies;
    
    document.getElementById('totalSales').textContent = formatCurrency(sales);
    document.getElementById('totalSupplies').textContent = formatCurrency(supplies);
    document.getElementById('businessProfit').textContent = formatCurrency(profit);
    
    // Fondo postres
    const dessertFund = AppState.familyData.funds.find(f => f.name === 'Fondo fijo postres');
    if (dessertFund) {
        const current = parseFloat(dessertFund.current_amount) || 0;
        const goal = parseFloat(dessertFund.monthly_goal) || 0;
        const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
        const missing = Math.max(goal - current, 0);
        
        document.getElementById('dessertFundCurrent').textContent = formatCurrency(current);
        document.getElementById('dessertFundGoal').textContent = formatCurrency(goal);
        document.getElementById('dessertFundProgress').style.width = `${percentage}%`;
        document.getElementById('dessertFundMissing').textContent = 
            `Faltan ${formatCurrency(missing)} para el objetivo`;
    }
}

function updateFundsPreview() {
    const fundsList = document.getElementById('fundsList');
    if (!fundsList) return;
    
    fundsList.innerHTML = '';
    
    AppState.familyData.funds.forEach(fund => {
        const current = parseFloat(fund.current_amount) || 0;
        const goal = parseFloat(fund.monthly_goal) || 0;
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
        const current = parseFloat(fund.current_amount) || 0;
        const goal = parseFloat(fund.monthly_goal) || 0;
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
    
    // Event listeners para editar fondos
    document.querySelectorAll('.edit-fund').forEach(button => {
        button.addEventListener('click', (e) => {
            const fundId = e.target.dataset.fundId;
            editFundGoal(fundId);
        });
    });
}

function updateHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let filtered = [...AppState.transactions];
    
    // Aplicar filtros
    const typeFilter = document.getElementById('filterType')?.value;
    const personFilter = document.getElementById('filterPerson')?.value;
    const paymentFilter = document.getElementById('filterPayment')?.value;
    const dateFilter = document.getElementById('filterDate')?.value;
    
    if (typeFilter && typeFilter !== 'all') {
        if (typeFilter === 'business') {
            filtered = filtered.filter(t => 
                t.transaction_type === 'business_expense' || 
                t.transaction_type === 'business_income'
            );
        } else if (typeFilter === 'fund') {
            filtered = filtered.filter(t => 
                t.transaction_type === 'fund_deposit' || 
                t.transaction_type === 'fund_withdrawal'
            );
        } else {
            filtered = filtered.filter(t => t.transaction_type === typeFilter);
        }
    }
    
    if (personFilter && personFilter !== 'all') {
        filtered = filtered.filter(t => t.person_id === personFilter);
    }
    
    if (paymentFilter && paymentFilter !== 'all') {
        filtered = filtered.filter(t => t.payment_method_id === paymentFilter);
    }
    
    if (dateFilter) {
        filtered = filtered.filter(t => t.date === dateFilter);
    }
    
    // Renderizar historial
    historyList.innerHTML = '';
    
    if (filtered.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No hay movimientos para mostrar</div>';
        return;
    }
    
    filtered.forEach(transaction => {
        const item = document.createElement('div');
        const typeClass = transaction.transaction_type.includes('income') ? 'income' : 
                         transaction.transaction_type.includes('expense') ? 'expense' : 
                         transaction.transaction_type.includes('fund') ? 'fund' : 'business';
        item.className = `history-item ${typeClass}`;
        
        const person = AppState.familyData.persons.find(p => p.id === transaction.person_id);
        const category = AppState.familyData.categories.find(c => c.id === transaction.category_id);
        const payment = AppState.familyData.paymentMethods.find(p => p.id === transaction.payment_method_id);
        const fund = AppState.familyData.funds.find(f => f.id === transaction.fund_id);
        
        let description = '';
        switch(transaction.transaction_type) {
            case 'household_expense':
                description = `🏠 ${category?.name || 'Gasto'}`;
                break;
            case 'personal_income':
                description = `💼 ${category?.name || 'Ingreso'}`;
                break;
            case 'business_expense':
                description = `🧁 ${category?.name || 'Insumos'}`;
                break;
            case 'business_income':
                description = `💰 ${category?.name || 'Ventas'}`;
                break;
            case 'fund_deposit':
                description = `🏦 Ingreso a ${fund?.name || 'fondo'}`;
                break;
            case 'fund_withdrawal':
                description = `🏦 Uso de ${fund?.name || 'fondo'}`;
                break;
        }
        
        let details = [];
        if (person) details.push(person.name);
        if (payment) details.push(payment.name);
        
        item.innerHTML = `
            <div class="history-info">
                <div class="history-date">${formatDate(transaction.date)}</div>
                <div class="history-description">${description}</div>
                <div class="history-details">${details.join(' • ')}</div>
                ${transaction.description ? `<div class="history-note">${transaction.description}</div>` : ''}
            </div>
            <div class="history-amount ${transaction.transaction_type.includes('income') || transaction.transaction_type === 'fund_withdrawal' ? 'positive' : 'negative'}">
                ${transaction.transaction_type.includes('income') || transaction.transaction_type === 'fund_withdrawal' ? '+' : '-'}${formatCurrency(transaction.amount)}
            </div>
        `;
        
        historyList.appendChild(item);
    });
    
    // Poblar filtros
    populateHistoryFilters();
}

function populateHistoryFilters() {
    const personFilter = document.getElementById('filterPerson');
    const paymentFilter = document.getElementById('filterPayment');
    
    if (personFilter && personFilter.children.length <= 1) {
        personFilter.innerHTML = '<option value="all">Todas las personas</option>';
        AppState.familyData.persons.forEach(person => {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = person.name;
            personFilter.appendChild(option);
        });
    }
    
    if (paymentFilter && paymentFilter.children.length <= 1) {
        paymentFilter.innerHTML = '<option value="all">Todos los medios</option>';
        AppState.familyData.paymentMethods.forEach(method => {
            const option = document.createElement('option');
            option.value = method.id;
            option.textContent = method.name;
            paymentFilter.appendChild(option);
        });
    }
}

function updateSettings() {
    const familyMembers = document.getElementById('familyMembers');
    const goalSettings = document.getElementById('goalSettings');
    
    // Miembros de familia
    if (familyMembers) {
        familyMembers.innerHTML = '';
        AppState.familyData.persons.forEach(person => {
            const memberEl = document.createElement('div');
            memberEl.className = 'family-member';
            memberEl.innerHTML = `
                <div class="member-info">
                    <div class="member-avatar" style="background: ${person.avatar_color}">
                        ${person.name.charAt(0)}
                    </div>
                    <div class="member-name ${person.name === 'Sebastián' ? 'person-sebastian' : 'person-ludmila'}">
                        ${person.name}
                    </div>
                </div>
                <div class="member-status">
                    ${person.is_active ? '✅ Activo' : '⏸️ Inactivo'}
                </div>
            `;
            familyMembers.appendChild(memberEl);
        });
    }
    
    // Objetivos de fondos
    if (goalSettings) {
        goalSettings.innerHTML = '';
        AppState.familyData.funds.forEach(fund => {
            const settingEl = document.createElement('div');
            settingEl.className = 'goal-setting';
            settingEl.innerHTML = `
                <div class="goal-info">
                    <div class="goal-name">${fund.icon} ${fund.name}</div>
                    <div class="goal-current">Actual: ${formatCurrency(fund.current_amount)}</div>
                </div>
                <div class="goal-input">
                    <input type="number" 
                           min="0" 
                           step="0.01" 
                           value="${fund.monthly_goal || 0}" 
                           data-fund-id="${fund.id}"
                           class="goal-input-field"
                           placeholder="Objetivo mensual">
                </div>
                <button class="save-goal" data-fund-id="${fund.id}">💾 Guardar</button>
            `;
            goalSettings.appendChild(settingEl);
        });
        
        // Event listeners para guardar objetivos
        document.querySelectorAll('.save-goal').forEach(button => {
            button.addEventListener('click', async (e) => {
                const fundId = e.target.dataset.fundId;
                const input = document.querySelector(`.goal-input-field[data-fund-id="${fundId}"]`);
                const goal = parseFloat(input.value);
                
                if (isNaN(goal) || goal < 0) {
                    showNotification('Ingresa un objetivo válido', 'warning');
                    return;
                }
                
                try {
                    const { error } = await supabaseClient
                        .from('funds')
                        .update({ monthly_goal: goal })
                        .eq('id', fundId);
                    
                    if (error) throw error;
                    
                    showNotification('Objetivo actualizado', 'success');
                    
                    // Actualizar estado local
                    const fund = AppState.familyData.funds.find(f => f.id === fundId);
                    if (fund) fund.monthly_goal = goal;
                    
                    updateFunds();
                    updateFundsPreview();
                    
                } catch (error) {
                    showNotification('Error actualizando objetivo', 'error');
                }
            });
        });
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
    
    // Fecha actual
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
    
    // Categorías según tipo
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
        showNotification('Completa todos los campos requeridos', 'warning');
        return;
    }
    
    if (amount <= 0) {
        showNotification('El monto debe ser mayor a 0', 'warning');
        return;
    }
    
    if (type.includes('fund') && !fundId) {
        showNotification('Selecciona un fondo', 'warning');
        return;
    }
    
    if ((type === 'household_expense' || type === 'business_expense' || type === 'business_income') && !categoryId) {
        showNotification('Selecciona una categoría', 'warning');
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
        
        showNotification('Movimiento registrado', 'success');
        
        // Resetear formulario
        e.target.reset();
        document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
        
        // Actualizar datos
        await Promise.all([
            loadTransactions(),
            loadFamilyData()
        ]);
        
        updateUI();
        switchTab('dashboard');
        
    } catch (error) {
        console.error('Error guardando transacción:', error);
        showNotification('Error al guardar movimiento', 'error');
    }
}

async function editFundGoal(fundId) {
    const fund = AppState.familyData.funds.find(f => f.id === fundId);
    if (!fund) return;
    
    const newGoal = prompt(`Nuevo objetivo para ${fund.name}:`, fund.monthly_goal);
    if (newGoal === null) return;
    
    const goalValue = parseFloat(newGoal);
    if (isNaN(goalValue) || goalValue < 0) {
        showNotification('Ingresa un valor válido', 'warning');
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
        showNotification('Objetivo actualizado', 'success');
        
    } catch (error) {
        showNotification('Error actualizando objetivo', 'error');
    }
}

// ============================================
// PWA
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
        showNotification('La app ya está instalada', 'info');
        return;
    }
    
    AppState.deferredInstallPrompt.prompt();
    
    AppState.deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            showNotification('¡App instalada!', 'success');
        }
        AppState.deferredInstallPrompt = null;
    });
}

// ============================================
// FUNCIONES ADICIONALES
// ============================================
function startEmotionalMessagesRotation() {
    const messageEl = document.getElementById('emotionalMessage');
    if (!messageEl || AppState.emotionalMessages.length === 0) return;
    
    let index = 0;
    messageEl.textContent = AppState.emotionalMessages[0].message;
    
    setInterval(() => {
        index = (index + 1) % AppState.emotionalMessages.length;
        messageEl.textContent = AppState.emotionalMessages[index].message;
        
        messageEl.style.opacity = '0.5';
        setTimeout(() => {
            messageEl.style.opacity = '1';
        }, 300);
    }, 10000);
}

// Exportar para debugging
window.AppState = AppState;
window.supabaseClient = supabaseClient;
