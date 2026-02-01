// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================
const SUPABASE_URL = 'https://rdscdgohbrkqnuxjyalg.supabase.co'; // Reemplazar con tu URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkc2NkZ29oYnJrcW51eGp5YWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTk0NDUsImV4cCI6MjA4NTQ3NTQ0NX0.nrjtRfGMBdq0KKxZaxG8Z6-CQArxdVB9hHkY-50AXMI'; // Reemplazar con tu key

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Verificar conexión
    checkOnlineStatus();
    window.addEventListener('online', () => {
        AppState.isOffline = false;
        hideOfflineIndicator();
        syncOfflineData();
    });
    window.addEventListener('offline', () => {
        AppState.isOffline = true;
        showOfflineIndicator();
    });

    // Manejar instalación PWA
    setupPWAInstall();

    // Inicializar UI
    initUI();
    
    // Verificar autenticación
    await checkAuth();
    
    // Cargar datos iniciales
    if (AppState.currentUser) {
        await loadInitialData();
        updateUI();
        startEmotionalMessagesRotation();
    }
    
    // Configurar Service Worker
    registerServiceWorker();
});

// ============================================
// AUTENTICACIÓN
// ============================================
async function checkAuth() {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
        showNotification('Error al verificar sesión', 'error');
        return;
    }
    
    if (session?.user) {
        AppState.currentUser = session.user;
        await loadUserProfile();
        return;
    }
    
    // No autenticado - mostrar login
    showLoginScreen();
}

async function loadUserProfile() {
    const { data: userData, error } = await supabase
        .from('users')
        .select('*, families(*)')
        .eq('id', AppState.currentUser.id)
        .single();
    
    if (error) {
        console.error('Error cargando perfil:', error);
        return;
    }
    
    if (!userData.family_id) {
        // Crear nueva familia
        await createNewFamily();
    } else {
        AppState.currentFamily = userData.families;
        updateUserUI(userData);
    }
}

async function createNewFamily() {
    const familyName = prompt('Nombre para tu familia:', 'Nuestra Familia');
    if (!familyName) return;
    
    // Crear familia
    const { data: family, error: familyError } = await supabase
        .from('families')
        .insert({ name: familyName })
        .select()
        .single();
    
    if (familyError) {
        showNotification('Error creando familia', 'error');
        return;
    }
    
    // Actualizar usuario con familia
    const { error: userError } = await supabase
        .from('users')
        .update({ family_id: family.id })
        .eq('id', AppState.currentUser.id);
    
    if (userError) {
        showNotification('Error actualizando usuario', 'error');
        return;
    }
    
    // Inicializar datos de familia
    const { error: initError } = await supabase.rpc('initialize_family_data', {
        family_uuid: family.id,
        admin_user_uuid: AppState.currentUser.id
    });
    
    if (initError) {
        console.error('Error inicializando datos:', initError);
    }
    
    AppState.currentFamily = family;
    await loadFamilyData();
}

async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        showNotification('Error al cerrar sesión', 'error');
        return;
    }
    
    AppState.currentUser = null;
    AppState.currentFamily = null;
    AppState.familyData = { persons: [], paymentMethods: [], categories: [], funds: [] };
    AppState.transactions = [];
    
    showLoginScreen();
}

function showLoginScreen() {
    // Implementar pantalla de login
    document.querySelector('.main-content').innerHTML = `
        <div class="login-screen">
            <h2>Bienvenidos a Familia Unida</h2>
            <p>Una herramienta para ordenar sus finanzas juntos</p>
            <form id="loginForm" class="login-form">
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" required>
                </div>
                <div class="form-group">
                    <label for="password">Contraseña</label>
                    <input type="password" id="password" required>
                </div>
                <button type="submit" class="submit-button">Iniciar sesión</button>
                <button type="button" id="showRegister" class="cancel-button">Crear cuenta</button>
            </form>
            <form id="registerForm" class="login-form hidden">
                <div class="form-group">
                    <label for="registerName">Nombre completo</label>
                    <input type="text" id="registerName" required>
                </div>
                <div class="form-group">
                    <label for="registerEmail">Email</label>
                    <input type="email" id="registerEmail" required>
                </div>
                <div class="form-group">
                    <label for="registerPassword">Contraseña</label>
                    <input type="password" id="registerPassword" required minlength="6">
                </div>
                <button type="submit" class="submit-button">Crear cuenta</button>
                <button type="button" id="showLogin" class="cancel-button">Ya tengo cuenta</button>
            </form>
        </div>
    `;
    
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    document.getElementById('showRegister')?.addEventListener('click', () => {
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
    });
    document.getElementById('showLogin')?.addEventListener('click', () => {
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('loginForm').classList.remove('hidden');
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    
    if (error) {
        showNotification(error.message, 'error');
        return;
    }
    
    AppState.currentUser = data.user;
    location.reload(); // Recargar para mostrar app completa
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
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
        showNotification(error.message, 'error');
        return;
    }
    
    showNotification('¡Cuenta creada! Revisa tu email para confirmar.', 'success');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

// ============================================
// CARGA DE DATOS
// ============================================
async function loadInitialData() {
    if (!AppState.currentFamily) return;
    
    await Promise.all([
        loadFamilyData(),
        loadTransactions(),
        loadEmotionalMessages()
    ]);
}

async function loadFamilyData() {
    if (!AppState.currentFamily) return;
    
    const [personsRes, paymentsRes, categoriesRes, fundsRes] = await Promise.all([
        supabase.from('persons').select('*').eq('family_id', AppState.currentFamily.id),
        supabase.from('payment_methods').select('*').eq('family_id', AppState.currentFamily.id),
        supabase.from('categories').select('*').eq('family_id', AppState.currentFamily.id),
        supabase.from('funds').select('*').eq('family_id', AppState.currentFamily.id)
    ]);
    
    AppState.familyData.persons = personsRes.data || [];
    AppState.familyData.paymentMethods = paymentsRes.data || [];
    AppState.familyData.categories = categoriesRes.data || [];
    AppState.familyData.funds = fundsRes.data || [];
}

async function loadTransactions() {
    if (!AppState.currentFamily) return;
    
    const startOfMonth = new Date(AppState.currentMonth.getFullYear(), AppState.currentMonth.getMonth(), 1);
    const endOfMonth = new Date(AppState.currentMonth.getFullYear(), AppState.currentMonth.getMonth() + 1, 0);
    
    const { data, error } = await supabase
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
    
    if (error) {
        console.error('Error cargando transacciones:', error);
        return;
    }
    
    AppState.transactions = data || [];
}

async function loadEmotionalMessages() {
    const { data, error } = await supabase
        .from('emotional_messages')
        .select('*')
        .eq('is_active', true);
    
    if (error) {
        console.error('Error cargando mensajes:', error);
        return;
    }
    
    AppState.emotionalMessages = data || [];
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
            
            // Cerrar menú en móvil
            if (window.innerWidth < 768) {
                document.querySelector('.side-menu').classList.remove('open');
                document.getElementById('menuOverlay').classList.remove('show');
            }
        });
    });
    
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
    
    // Filtros de historial
    document.getElementById('filterType').addEventListener('change', updateHistory);
    document.getElementById('filterPerson').addEventListener('change', updateHistory);
    document.getElementById('filterPayment').addEventListener('change', updateHistory);
    document.getElementById('filterDate').addEventListener('change', updateHistory);
    
    // Formulario de transacción
    document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
    document.getElementById('transactionType').addEventListener('change', updateTransactionForm);
    
    // Logout
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    
    // Botón de instalación
    document.getElementById('installButton')?.addEventListener('click', installPWA);
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

function updateUI() {
    updateMonthUI();
    updateDashboard();
    updateBalance();
    updateExpenses();
    updateBusiness();
    updateFunds();
}

function updateMonthUI() {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const month = monthNames[AppState.currentMonth.getMonth()];
    const year = AppState.currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${month} ${year}`;
}

function updateDashboard() {
    const transactions = AppState.transactions;
    
    // Ingresos totales
    const totalIncome = transactions
        .filter(t => t.transaction_type === 'personal_income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
    
    // Gastos del hogar
    const totalExpenses = transactions
        .filter(t => t.transaction_type === 'household_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    document.getElementById('totalExpenses').textContent = formatCurrency(totalExpenses);
    
    // Resultado postres
    const sales = transactions
        .filter(t => t.transaction_type === 'business_income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const businessResult = sales - supplies;
    document.getElementById('businessResult').textContent = formatCurrency(businessResult);
    
    // Ahorro del mes
    const monthlySavings = transactions
        .filter(t => t.transaction_type === 'fund_deposit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
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
    
    // Fondos preview
    updateFundsPreview();
}

function updateBalance() {
    const balanceCards = document.getElementById('balanceCards');
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
    const transactions = AppState.transactions.filter(t => t.transaction_type === 'household_expense');
    const categoryChart = document.getElementById('categoryChart');
    const categoryRanking = document.getElementById('categoryRanking');
    
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
        const maxAmount = Math.max(...Object.values(categories));
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
    
    document.getElementById('totalSales').textContent = formatCurrency(sales);
    document.getElementById('totalSupplies').textContent = formatCurrency(supplies);
    document.getElementById('businessProfit').textContent = formatCurrency(profit);
    
    // Fondo postres
    const dessertFund = AppState.familyData.funds.find(f => f.name === 'Fondo fijo postres');
    if (dessertFund) {
        const current = parseFloat(dessertFund.current_amount);
        const goal = parseFloat(dessertFund.monthly_goal);
        const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
        const missing = Math.max(goal - current, 0);
        
        document.getElementById('dessertFundCurrent').textContent = formatCurrency(current);
        document.getElementById('dessertFundGoal').textContent = formatCurrency(goal);
        document.getElementById('dessertFundProgress').style.width = `${percentage}%`;
        document.getElementById('dessertFundMissing').textContent = 
            `Faltan ${formatCurrency(missing)} para el objetivo`;
    }
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

function updateHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let filtered = [...AppState.transactions];
    
    // Aplicar filtros
    const typeFilter = document.getElementById('filterType').value;
    const personFilter = document.getElementById('filterPerson').value;
    const paymentFilter = document.getElementById('filterPayment').value;
    const dateFilter = document.getElementById('filterDate').value;
    
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
    
    filtered.forEach(transaction => {
        const item = document.createElement('div');
        item.className = `history-item ${getTransactionTypeClass(transaction.transaction_type)}`;
        
        const person = AppState.familyData.persons.find(p => p.id === transaction.person_id);
        const category = AppState.familyData.categories.find(c => c.id === transaction.category_id);
        const payment = AppState.familyData.paymentMethods.find(p => p.id === transaction.payment_method_id);
        const fund = AppState.familyData.funds.find(f => f.id === transaction.fund_id);
        
        let description = getTransactionDescription(transaction, category, fund);
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
}

function updateSettings() {
    // Configurar lista de personas
    const familyMembers = document.getElementById('familyMembers');
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
                    <div class="member-name">${person.name}</div>
                </div>
                <div class="member-status">
                    ${person.is_active ? 'Activo' : 'Inactivo'}
                </div>
            `;
            familyMembers.appendChild(memberEl);
        });
    }
    
    // Configurar objetivos
    const goalSettings = document.getElementById('goalSettings');
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
                <button class="save-goal" data-fund-id="${fund.id}">Guardar</button>
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
                    showNotification('Por favor ingresa un objetivo válido', 'warning');
                    return;
                }
                
                const { error } = await supabase
                    .from('funds')
                    .update({ monthly_goal: goal })
                    .eq('id', fundId);
                
                if (error) {
                    showNotification('Error actualizando objetivo', 'error');
                    return;
                }
                
                showNotification('Objetivo actualizado correctamente', 'success');
                
                // Actualizar datos locales
                const fund = AppState.familyData.funds.find(f => f.id === fundId);
                if (fund) fund.monthly_goal = goal;
                
                updateFunds();
                updateFundsPreview();
            });
        });
    }
}

// ============================================
// FORMULARIO DE TRANSACCIONES
// ============================================
function setupTransactionForm() {
    // Personas
    const personSelect = document.getElementById('transactionPerson');
    personSelect.innerHTML = '<option value="">Seleccionar persona</option>';
    AppState.familyData.persons.forEach(person => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = person.name;
        personSelect.appendChild(option);
    });
    
    // Medios de pago
    const paymentSelect = document.getElementById('transactionPayment');
    paymentSelect.innerHTML = '<option value="">Seleccionar medio</option>';
    AppState.familyData.paymentMethods.forEach(method => {
        const option = document.createElement('option');
        option.value = method.id;
        option.textContent = `${method.icon} ${method.name}`;
        paymentSelect.appendChild(option);
    });
    
    // Fondos
    const fundSelect = document.getElementById('transactionFund');
    fundSelect.innerHTML = '<option value="">Seleccionar fondo</option>';
    AppState.familyData.funds.forEach(fund => {
        const option = document.createElement('option');
        option.value = fund.id;
        option.textContent = `${fund.icon} ${fund.name}`;
        fundSelect.appendChild(option);
    });
    
    // Fecha actual por defecto
    document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
    
    updateTransactionForm();
}

function updateTransactionForm() {
    const type = document.getElementById('transactionType').value;
    const categoryField = document.getElementById('categoryField');
    const fundField = document.getElementById('fundField');
    
    // Actualizar categorías según tipo
    const categorySelect = document.getElementById('transactionCategory');
    categorySelect.innerHTML = '<option value="">Seleccionar categoría</option>';
    
    if (type) {
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
        
        categoryField.style.display = categories.length > 0 ? 'block' : 'none';
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
    
    // Para transacciones de fondo, validar fondo
    if (type.includes('fund') && !fundId) {
        showNotification('Por favor selecciona un fondo', 'warning');
        return;
    }
    
    // Para gastos del hogar y negocios, validar categoría
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
    
    // Si es uso de fondo, verificar que haya saldo suficiente
    if (type === 'fund_withdrawal') {
        const fund = AppState.familyData.funds.find(f => f.id === fundId);
        if (fund && parseFloat(fund.current_amount) < amount) {
            if (!confirm(`El fondo solo tiene ${formatCurrency(fund.current_amount)}. ¿Deseas continuar igual?`)) {
                return;
            }
        }
    }
    
    try {
        const { data, error } = await supabase
            .from('transactions')
            .insert(transactionData)
            .select()
            .single();
        
        if (error) throw error;
        
        showNotification('Movimiento registrado correctamente', 'success');
        
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
        showNotification('Error al guardar el movimiento', 'error');
        
        // Guardar en caché offline
        if (AppState.isOffline) {
            saveTransactionOffline(transactionData);
        }
    }
}

// ============================================
// FUNCIONALIDADES PWA
// ============================================
function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        AppState.deferredInstallPrompt = e;
        
        // Mostrar botón de instalación después de un tiempo
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
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registrado:', registration);
        } catch (error) {
            console.error('Error registrando Service Worker:', error);
        }
    }
}

// ============================================
// FUNCIONALIDADES OFFLINE
// ============================================
function checkOnlineStatus() {
    AppState.isOffline = !navigator.onLine;
    if (AppState.isOffline) showOfflineIndicator();
}

function showOfflineIndicator() {
    let indicator = document.querySelector('.offline-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'offline-indicator';
        indicator.textContent = '⚠️ Modo offline - Los cambios se guardarán localmente';
        document.body.appendChild(indicator);
    }
}

function hideOfflineIndicator() {
    const indicator = document.querySelector('.offline-indicator');
    if (indicator) indicator.remove();
}

function saveTransactionOffline(transactionData) {
    const offlineTransactions = JSON.parse(localStorage.getItem('offlineTransactions') || '[]');
    transactionData.id = 'offline-' + Date.now();
    transactionData.is_offline = true;
    offlineTransactions.push(transactionData);
    localStorage.setItem('offlineTransactions', JSON.stringify(offlineTransactions));
    
    showNotification('Movimiento guardado localmente. Se sincronizará cuando haya conexión.', 'warning');
}

async function syncOfflineData() {
    const offlineTransactions = JSON.parse(localStorage.getItem('offlineTransactions') || '[]');
    if (offlineTransactions.length === 0) return;
    
    showNotification(`Sincronizando ${offlineTransactions.length} movimientos...`, 'info');
    
    for (const transaction of offlineTransactions) {
        delete transaction.id;
        delete transaction.is_offline;
        
        const { error } = await supabase
            .from('transactions')
            .insert(transaction);
        
        if (error) {
            console.error('Error sincronizando transacción:', error);
            continue;
        }
    }
    
    // Limpiar caché offline
    localStorage.removeItem('offlineTransactions');
    
    // Recargar datos
    await loadInitialData();
    updateUI();
    
    showNotification('Sincronización completada', 'success');
}

// ============================================
// FUNCIONES UTILITARIAS
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

function getTransactionTypeClass(type) {
    if (type.includes('income')) return 'income';
    if (type.includes('expense')) return 'expense';
    if (type.includes('fund')) return 'fund';
    if (type.includes('business')) return 'business';
    return '';
}

function getTransactionDescription(transaction, category, fund) {
    switch(transaction.transaction_type) {
        case 'household_expense':
            return `🏠 ${category?.name || 'Gasto del hogar'}`;
        case 'personal_income':
            return `💼 ${category?.name || 'Ingreso diario'}`;
        case 'business_expense':
            return `🧁 ${category?.name || 'Insumos postres'}`;
        case 'business_income':
            return `💰 ${category?.name || 'Ventas postres'}`;
        case 'fund_deposit':
            return `🏦 Ingreso a ${fund?.name || 'fondo'}`;
        case 'fund_withdrawal':
            return `🏦 Uso de ${fund?.name || 'fondo'}`;
        default:
            return 'Movimiento';
    }
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-message">${message}</span>
    `;
    
    container.appendChild(notification);
    
    // Auto-remover después de 5 segundos
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

function updateUserUI(userData) {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const email = document.getElementById('userEmail');
    
    if (avatar) avatar.textContent = userData.full_name?.charAt(0) || 'FU';
    if (name) name.textContent = userData.full_name || 'Familia';
    if (email) email.textContent = userData.email || '';
}

function startEmotionalMessagesRotation() {
    if (AppState.emotionalMessages.length === 0) return;
    
    let index = 0;
    const messageEl = document.getElementById('emotionalMessage');
    
    setInterval(() => {
        index = (index + 1) % AppState.emotionalMessages.length;
        messageEl.textContent = AppState.emotionalMessages[index].message;
        
        // Animación suave
        messageEl.style.opacity = '0';
        setTimeout(() => {
            messageEl.style.opacity = '1';
        }, 300);
    }, 10000); // Cambiar cada 10 segundos
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
    
    const { error } = await supabase
        .from('funds')
        .update({ monthly_goal: goalValue })
        .eq('id', fundId);
    
    if (error) {
        showNotification('Error actualizando objetivo', 'error');
        return;
    }
    
    fund.monthly_goal = goalValue;
    updateFunds();
    updateFundsPreview();
    showNotification('Objetivo actualizado correctamente', 'success');
}

// ============================================
// EXPORTAR PARA SERVICE WORKER
// ============================================
if (typeof window !== 'undefined') {
    window.AppState = AppState;
    window.supabase = supabase;
}
