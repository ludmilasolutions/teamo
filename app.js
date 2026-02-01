// Configuración y estado global
let currentUser = null;
let currentFamily = null;
let db = null;
let currentMonth = new Date();
let categoryChart = null;

// Mensajes emocionales
const emotionalMessages = {
    positive: [
        "¡Excelente trabajo en equipo!",
        "Estamos construyendo tranquilidad juntos",
        "Cada paso cuenta, juntos somos más fuertes",
        "La comunicación es nuestro mejor aliado"
    ],
    neutral: [
        "No es culpa, es equipo",
        "Esto lo estamos ordenando juntos",
        "La plata es un medio, la familia es lo importante",
        "Un día a la vez, juntos podemos"
    ],
    warning: [
        "Respiremos hondo y ajustemos juntos",
        "Es momento de conversar y reorganizar",
        "Unidos encontramos la mejor solución",
        "La dificultad nos fortalece como equipo"
    ]
};

// Inicialización de Firebase
async function initializeFirebase() {
    try {
        const config = JSON.parse(localStorage.getItem('firebaseConfig'));
        
        if (!config) {
            redirectToSetup();
            return;
        }
        
        // Verificar si Firebase ya está inicializado
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        
        db = firebase.firestore();
        
        // Configurar persistencia offline
        await firebase.firestore().enablePersistence()
            .catch(err => {
                if (err.code === 'failed-precondition') {
                    console.warn('Múltiples pestañas abiertas, persistencia deshabilitada');
                } else if (err.code === 'unimplemented') {
                    console.warn('Navegador no compatible con persistencia');
                }
            });
        
        // Verificar autenticación
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                document.getElementById('userEmail').textContent = user.email;
                await loadFamilyData();
                await loadCurrentMonthData();
                updateEmotionalMessage();
                checkForNotifications();
            } else {
                redirectToLogin();
            }
        });
        
    } catch (error) {
        console.error('Error inicializando Firebase:', error);
        showError('Error de configuración. Por favor, revisa setup.html');
    }
}

// Redirección a setup
function redirectToSetup() {
    if (!window.location.href.includes('setup.html')) {
        window.location.href = 'setup.html';
    }
}

// Redirección a login
function redirectToLogin() {
    // Implementar página de login si es necesario
    // Por ahora, usamos autenticación automática
    const email = localStorage.getItem('lastEmail');
    const password = localStorage.getItem('lastPassword');
    
    if (email && password) {
        firebase.auth().signInWithEmailAndPassword(email, password)
            .catch(error => {
                console.error('Error de autenticación:', error);
                window.location.href = 'setup.html';
            });
    } else {
        window.location.href = 'setup.html';
    }
}

// Cargar datos de familia
async function loadFamilyData() {
    try {
        const familyId = localStorage.getItem('familyId');
        
        if (!familyId) {
            throw new Error('No se encontró familia configurada');
        }
        
        const familyDoc = await db.collection('families').doc(familyId).get();
        
        if (!familyDoc.exists) {
            throw new Error('Familia no encontrada');
        }
        
        currentFamily = {
            id: familyId,
            ...familyDoc.data()
        };
        
        // Cargar fondos
        await loadFunds();
        
        // Cargar resumen del mes actual
        await loadMonthlySummary();
        
    } catch (error) {
        console.error('Error cargando familia:', error);
        showError('Error cargando datos de familia');
    }
}

// Cargar fondos
async function loadFunds() {
    try {
        const fundsSnapshot = await db.collection('funds')
            .where('family_id', '==', currentFamily.id)
            .get();
        
        const fundsContainer = document.getElementById('fundsContainer');
        fundsContainer.innerHTML = '';
        
        fundsSnapshot.forEach(doc => {
            const fund = { id: doc.id, ...doc.data() };
            renderFundCard(fund);
        });
        
    } catch (error) {
        console.error('Error cargando fondos:', error);
    }
}

// Renderizar tarjeta de fondo
function renderFundCard(fund) {
    const fundsContainer = document.getElementById('fundsContainer');
    
    const progress = fund.monthly_target > 0 ? 
        Math.min((fund.current_balance / fund.monthly_target) * 100, 100) : 0;
    
    const status = progress >= 75 ? 'ok' : 
                   progress >= 25 ? 'bajo' : 'critico';
    
    const card = document.createElement('div');
    card.className = 'fund-card';
    card.innerHTML = `
        <div class="fund-header">
            <h3>${fund.name}</h3>
            <span class="fund-status ${status}">${status.toUpperCase()}</span>
        </div>
        <div class="fund-progress">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="fund-numbers">
                <span class="current">$${formatCurrency(fund.current_balance)}</span>
                <span class="target">/$${formatCurrency(fund.monthly_target)}</span>
            </div>
        </div>
        <div class="fund-actions">
            <button class="btn-success" onclick="addToFund('${fund.id}')">➕ Agregar</button>
            <button class="btn-warning" onclick="useFromFund('${fund.id}')">➖ Usar</button>
        </div>
    `;
    
    fundsContainer.appendChild(card);
}

// Cargar datos del mes actual
async function loadCurrentMonthData() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    try {
        // Cargar movimientos del mes
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);
        
        const movementsSnapshot = await db.collection('movements')
            .where('family_id', '==', currentFamily.id)
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .orderBy('date', 'desc')
            .get();
        
        let totalIncome = 0;
        let totalExpense = 0;
        let incomeSebastian = 0;
        let incomeLudmila = 0;
        let cashBalance = 0;
        let mpBalance = 0;
        let categoryData = {};
        let postresSales = 0;
        let postresSupplies = 0;
        
        movementsSnapshot.forEach(doc => {
            const movement = doc.data();
            
            switch (movement.type) {
                case 'income':
                    totalIncome += movement.amount;
                    if (movement.person === 'sebastian') incomeSebastian += movement.amount;
                    if (movement.person === 'ludmila') incomeLudmila += movement.amount;
                    if (movement.medium === 'efectivo') cashBalance += movement.amount;
                    if (movement.medium === 'mercadopago') mpBalance += movement.amount;
                    break;
                    
                case 'expense':
                    totalExpense += movement.amount;
                    if (movement.medium === 'efectivo') cashBalance -= movement.amount;
                    if (movement.medium === 'mercadopago') mpBalance -= movement.amount;
                    
                    // Acumular por categoría
                    if (!categoryData[movement.category]) {
                        categoryData[movement.category] = 0;
                    }
                    categoryData[movement.category] += movement.amount;
                    break;
                    
                case 'postre_venta':
                    postresSales += movement.amount;
                    if (movement.medium === 'efectivo') cashBalance += movement.amount;
                    if (movement.medium === 'mercadopago') mpBalance += movement.amount;
                    break;
                    
                case 'postre_insumo':
                    postresSupplies += movement.amount;
                    if (movement.medium === 'efectivo') cashBalance -= movement.amount;
                    if (movement.medium === 'mercadopago') mpBalance -= movement.amount;
                    break;
                    
                case 'fund_transfer':
                    // Los fondos no afectan el balance general
                    break;
            }
        });
        
        // Actualizar UI
        updateSummaryUI(totalIncome, totalExpense, incomeSebastian, incomeLudmila);
        updateMediumUI(cashBalance, mpBalance);
        updatePostresUI(postresSales, postresSupplies);
        updateCategoryChart(categoryData);
        
        // Calcular y mostrar balance
        const balance = totalIncome - totalExpense;
        updateBalanceUI(balance);
        
        // Actualizar mes actual en UI
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        document.getElementById('currentMonth').textContent = 
            `${monthNames[month]} ${year}`;
            
    } catch (error) {
        console.error('Error cargando datos del mes:', error);
    }
}

// Actualizar resumen en UI
function updateSummaryUI(totalIncome, totalExpense, incomeSebastian, incomeLudmila) {
    document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
    document.getElementById('totalExpense').textContent = formatCurrency(totalExpense);
    document.getElementById('incomeSebastian').textContent = formatCurrency(incomeSebastian);
    document.getElementById('incomeLudmila').textContent = formatCurrency(incomeLudmila);
    
    // Mostrar categorías principales
    // (Implementar lógica para mostrar top 3 categorías)
}

// Actualizar medios en UI
function updateMediumUI(cashBalance, mpBalance) {
    document.getElementById('cashBalance').textContent = formatCurrency(cashBalance);
    document.getElementById('mpBalance').textContent = formatCurrency(mpBalance);
}

// Actualizar postres en UI
function updatePostresUI(sales, supplies) {
    const result = sales - supplies;
    
    document.getElementById('postresSales').textContent = formatCurrency(sales);
    document.getElementById('postresSupplies').textContent = formatCurrency(supplies);
    document.getElementById('postresResult').textContent = formatCurrency(result);
    
    // Actualizar pantalla de postres
    document.getElementById('totalInsumos').textContent = formatCurrency(supplies);
    document.getElementById('totalVentas').textContent = formatCurrency(sales);
    document.getElementById('gananciaNeta').textContent = formatCurrency(result);
    
    const margin = sales > 0 ? ((result / sales) * 100).toFixed(1) : 0;
    document.getElementById('margen').textContent = `${margin}%`;
}

// Actualizar gráfico de categorías
function updateCategoryChart(categoryData) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    
    // Destruir gráfico anterior si existe
    if (categoryChart) {
        categoryChart.destroy();
    }
    
    const labels = [];
    const data = [];
    const backgroundColors = [];
    
    // Traducir categorías
    const categoryNames = {
        'alquiler': 'Alquiler',
        'servicios': 'Servicios',
        'comida_hogar': 'Comida Hogar',
        'transporte': 'Transporte',
        'bebe': 'Bebé',
        'mascotas': 'Mascotas',
        'salud': 'Salud',
        'ropa': 'Ropa',
        'imprevistos': 'Imprevistos'
    };
    
    // Colores para cada categoría
    const categoryColors = {
        'alquiler': '#FF6B6B',
        'servicios': '#4ECDC4',
        'comida_hogar': '#FFD166',
        'transporte': '#06D6A0',
        'bebe': '#118AB2',
        'mascotas': '#073B4C',
        'salud': '#EF476F',
        'ropa': '#7209B7',
        'imprevistos': '#8AC926'
    };
    
    // Preparar datos para el gráfico
    Object.entries(categoryData).forEach(([category, amount]) => {
        if (categoryNames[category]) {
            labels.push(categoryNames[category]);
            data.push(amount);
            backgroundColors.push(categoryColors[category] || '#999999');
        }
    });
    
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatCurrency(context.raw);
                            return label;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

// Actualizar balance en UI
function updateBalanceUI(balance) {
    const balanceElement = document.getElementById('balanceAmount');
    const monthBalanceElement = document.getElementById('monthBalance');
    
    balanceElement.textContent = formatCurrency(balance);
    monthBalanceElement.textContent = formatCurrency(balance);
    
    // Actualizar mensaje emocional basado en balance
    updateEmotionalMessage(balance);
    
    // Cambiar color según balance
    if (balance >= 0) {
        balanceElement.className = 'balance-amount positive';
        monthBalanceElement.className = 'amount positive';
    } else {
        balanceElement.className = 'balance-amount negative';
        monthBalanceElement.className = 'amount negative';
    }
}

// Actualizar mensaje emocional
function updateEmotionalMessage(balance = 0) {
    const banner = document.getElementById('emotionalBanner');
    const balanceMessage = document.getElementById('balanceMessage');
    
    let messageType = 'neutral';
    let message = '';
    
    if (balance > 10000) {
        messageType = 'positive';
        message = emotionalMessages.positive[
            Math.floor(Math.random() * emotionalMessages.positive.length)
        ];
    } else if (balance < 0) {
        messageType = 'warning';
        message = emotionalMessages.warning[
            Math.floor(Math.random() * emotionalMessages.warning.length)
        ];
    } else {
        messageType = 'neutral';
        message = emotionalMessages.neutral[
            Math.floor(Math.random() * emotionalMessages.neutral.length)
        ];
    }
    
    // Actualizar banner principal
    banner.innerHTML = `<p>"${message}"</p>`;
    
    // Actualizar color del banner
    banner.style.background = messageType === 'positive' ? 
        'linear-gradient(135deg, var(--emotional-positive), #22c55e)' :
        messageType === 'warning' ?
        'linear-gradient(135deg, var(--emotional-warning), #f59e0b)' :
        'linear-gradient(135deg, var(--emotional-calm), var(--primary-light))';
    
    // Actualizar mensaje en balance
    if (balanceMessage) {
        balanceMessage.textContent = message;
    }
}

// Formatear moneda
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Cambiar mes
function changeMonth(delta) {
    currentMonth.setMonth(currentMonth.getMonth() + delta);
    loadCurrentMonthData();
}

// Navegación entre pantallas
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
        // Remover activo de todos
        document.querySelectorAll('.nav-item').forEach(i => {
            i.classList.remove('active');
        });
        
        // Agregar activo al clickeado
        this.classList.add('active');
        
        // Ocultar todas las pantallas
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // Mostrar pantalla seleccionada
        const screenId = this.getAttribute('data-screen');
        document.getElementById(screenId).classList.add('active');
        
        // Cargar datos específicos si es necesario
        if (screenId === 'historial') {
            loadHistory();
        } else if (screenId === 'postres') {
            loadPostresHistory();
        } else if (screenId === 'fondos') {
            loadFundHistory();
        }
    });
});

// Selector de tipo de movimiento
document.querySelectorAll('.movement-type-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // Remover activo de todos
        document.querySelectorAll('.movement-type-btn').forEach(b => {
            b.classList.remove('active');
        });
        
        // Agregar activo al clickeado
        this.classList.add('active');
        
        // Ocultar todos los formularios
        document.querySelectorAll('.movement-form').forEach(form => {
            form.classList.remove('active');
        });
        
        // Mostrar formulario correspondiente
        const type = this.getAttribute('data-type');
        document.getElementById(`${type}Form`).classList.add('active');
    });
});

// Guardar gasto
async function saveExpense() {
    try {
        const amount = parseFloat(document.getElementById('expenseAmount').value);
        const category = document.getElementById('expenseCategory').value;
        const person = document.getElementById('expensePerson').value;
        const medium = document.getElementById('expenseMedium').value;
        const note = document.getElementById('expenseNote').value;
        
        let date = document.getElementById('expenseDate').value;
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }
        
        // Validaciones
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        if (!category) {
            throw new Error('Selecciona una categoría');
        }
        
        const movement = {
            family_id: currentFamily.id,
            type: 'expense',
            amount: amount,
            category: category,
            person: person,
            medium: medium,
            date: new Date(date),
            description: note || '',
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(movement);
        
        // Actualizar balance de medio si es efectivo o MP
        updateMediumBalanceAfterMovement(movement);
        
        // Mostrar confirmación
        showSuccess('Gasto registrado correctamente');
        
        // Limpiar formulario
        document.getElementById('expenseForm').reset();
        
        // Recargar datos
        await loadCurrentMonthData();
        
    } catch (error) {
        console.error('Error guardando gasto:', error);
        showError(error.message);
    }
}

// Guardar ingreso
async function saveIncome() {
    try {
        const amount = parseFloat(document.getElementById('incomeAmount').value);
        const category = document.getElementById('incomeCategory').value;
        const medium = document.getElementById('incomeMedium').value;
        const note = document.getElementById('incomeNote').value;
        
        let date = document.getElementById('incomeDate').value;
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }
        
        // Determinar persona basado en categoría
        let person = 'joint';
        if (category === 'ingreso_diario_sebastian') {
            person = 'sebastian';
        } else if (category === 'ingreso_diario_ludmila') {
            person = 'ludmila';
        }
        
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        const movement = {
            family_id: currentFamily.id,
            type: 'income',
            amount: amount,
            category: category,
            person: person,
            medium: medium,
            date: new Date(date),
            description: note || '',
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(movement);
        
        // Actualizar balance de medio
        updateMediumBalanceAfterMovement(movement);
        
        showSuccess('Ingreso registrado correctamente');
        document.getElementById('incomeForm').reset();
        await loadCurrentMonthData();
        
    } catch (error) {
        console.error('Error guardando ingreso:', error);
        showError(error.message);
    }
}

// Guardar movimiento de fondo
async function saveFundMovement() {
    try {
        const fundId = document.getElementById('fundSelect').value;
        const operation = document.getElementById('fundOperation').value;
        const amount = parseFloat(document.getElementById('fundAmount').value);
        const person = document.getElementById('fundPerson').value;
        const medium = document.getElementById('fundMedium').value;
        
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        if (!fundId) {
            throw new Error('Selecciona un fondo');
        }
        
        // Obtener datos del fondo
        const fundDoc = await db.collection('funds').doc(fundId).get();
        const fund = fundDoc.data();
        
        let newBalance = fund.current_balance;
        
        if (operation === 'ingreso') {
            newBalance += amount;
        } else {
            newBalance -= amount;
            
            if (newBalance < 0) {
                throw new Error('Saldo insuficiente en el fondo');
            }
        }
        
        // Actualizar fondo
        await db.collection('funds').doc(fundId).update({
            current_balance: newBalance,
            last_updated: firebase.firestore.FieldValue.serverTimestamp(),
            status: calculateFundStatus(newBalance, fund.monthly_target)
        });
        
        // Registrar movimiento
        const movement = {
            family_id: currentFamily.id,
            type: 'fund_transfer',
            amount: amount,
            fund_id: fundId,
            fund_operation: operation,
            person: person,
            medium: medium,
            date: new Date(),
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(movement);
        
        // Agregar al historial del fondo
        await addToFundHistory(fundId, {
            type: operation,
            amount: amount,
            date: new Date(),
            person: person
        });
        
        showSuccess(`Fondo actualizado: $${formatCurrency(newBalance)}`);
        document.getElementById('fundForm').reset();
        
        // Recargar fondos
        await loadFunds();
        await loadFundHistory();
        
    } catch (error) {
        console.error('Error en movimiento de fondo:', error);
        showError(error.message);
    }
}

// Guardar movimiento de postres
async function savePostreMovement() {
    try {
        const type = document.getElementById('postreType').value;
        const amount = parseFloat(document.getElementById('postreAmount').value);
        const medium = document.getElementById('postreMedium').value;
        const description = document.getElementById('postreDescription').value;
        
        let date = document.getElementById('postreDate').value;
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }
        
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        const movement = {
            family_id: currentFamily.id,
            type: type === 'insumo' ? 'postre_insumo' : 'postre_venta',
            amount: amount,
            category: type === 'insumo' ? 'insumos_postres' : 'ventas_postres',
            medium: medium,
            date: new Date(date),
            description: description || '',
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(movement);
        
        // Actualizar balance de medio
        updateMediumBalanceAfterMovement(movement);
        
        showSuccess(`Movimiento de postres registrado: $${formatCurrency(amount)}`);
        document.getElementById('postreForm').reset();
        
        // Recargar datos
        await loadCurrentMonthData();
        await loadPostresHistory();
        
    } catch (error) {
        console.error('Error guardando movimiento de postres:', error);
        showError(error.message);
    }
}

// Transferir entre medios
async function makeTransfer() {
    try {
        const from = document.getElementById('transferFrom').value;
        const to = document.getElementById('transferTo').value;
        const amount = parseFloat(document.getElementById('transferAmount').value);
        
        if (from === to) {
            throw new Error('No puedes transferir al mismo medio');
        }
        
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        // Registrar como gasto en origen e ingreso en destino
        const date = new Date();
        
        const expenseMovement = {
            family_id: currentFamily.id,
            type: 'expense',
            amount: amount,
            category: 'transferencia',
            person: 'joint',
            medium: from,
            date: date,
            description: `Transferencia a ${to}`,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        const incomeMovement = {
            family_id: currentFamily.id,
            type: 'income',
            amount: amount,
            category: 'transferencia',
            person: 'joint',
            medium: to,
            date: date,
            description: `Transferencia de ${from}`,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(expenseMovement);
        await db.collection('movements').add(incomeMovement);
        
        showSuccess(`Transferencia realizada: $${formatCurrency(amount)}`);
        document.getElementById('transferAmount').value = '';
        
        await loadCurrentMonthData();
        
    } catch (error) {
        console.error('Error en transferencia:', error);
        showError(error.message);
    }
}

// Agregar a fondo
async function addToFund(fundId) {
    showModal('fondo');
    document.getElementById('fundSelect').value = fundId;
    document.getElementById('fundOperation').value = 'ingreso';
}

// Usar de fondo
async function useFromFund(fundId) {
    showModal('fondo');
    document.getElementById('fundSelect').value = fundId;
    document.getElementById('fundOperation').value = 'uso';
}

// Cargar historial
async function loadHistory() {
    try {
        const typeFilter = document.getElementById('filterType').value;
        const personFilter = document.getElementById('filterPerson').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;
        
        let query = db.collection('movements')
            .where('family_id', '==', currentFamily.id)
            .orderBy('date', 'desc')
            .limit(50);
        
        // Aplicar filtros
        if (typeFilter) {
            if (typeFilter === 'postre') {
                query = query.where('type', 'in', ['postre_insumo', 'postre_venta']);
            } else {
                query = query.where('type', '==', typeFilter);
            }
        }
        
        if (personFilter) {
            query = query.where('person', '==', personFilter);
        }
        
        if (dateFrom) {
            query = query.where('date', '>=', new Date(dateFrom));
        }
        
        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            query = query.where('date', '<=', toDate);
        }
        
        const snapshot = await query.get();
        const tbody = document.getElementById('historyBody');
        tbody.innerHTML = '';
        
        if (snapshot.empty) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        No hay movimientos con los filtros seleccionados
                    </td>
                </tr>
            `;
            return;
        }
        
        snapshot.forEach(doc => {
            const movement = doc.data();
            const row = createHistoryRow(movement, doc.id);
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Error cargando historial:', error);
        showError('Error cargando historial');
    }
}

// Crear fila de historial
function createHistoryRow(movement, id) {
    const row = document.createElement('tr');
    
    // Formatear fecha
    const date = movement.date.toDate();
    const dateStr = date.toLocaleDateString('es-AR');
    
    // Determinar icono y clase según tipo
    let icon = '';
    let typeClass = '';
    let description = movement.description || '';
    
    switch (movement.type) {
        case 'income':
            icon = '💰';
            typeClass = 'income';
            description = description || 'Ingreso';
            break;
        case 'expense':
            icon = '💸';
            typeClass = 'expense';
            description = description || 'Gasto';
            break;
        case 'postre_insumo':
            icon = '🍰';
            typeClass = 'postre-insumo';
            description = description || 'Insumo postres';
            break;
        case 'postre_venta':
            icon = '💰';
            typeClass = 'postre-venta';
            description = description || 'Venta postres';
            break;
        case 'fund_transfer':
            icon = '🏦';
            typeClass = 'fund';
            description = description || (movement.fund_operation === 'ingreso' ? 
                'Ahorro en fondo' : 'Uso de fondo');
            break;
    }
    
    // Traducir persona
    const personNames = {
        'sebastian': 'Sebastián',
        'ludmila': 'Ludmila',
        'joint': 'Ambos'
    };
    
    // Traducir medio
    const mediumNames = {
        'efectivo': 'Efectivo',
        'mercadopago': 'Mercado Pago'
    };
    
    row.innerHTML = `
        <td>${dateStr}</td>
        <td><span class="movement-type ${typeClass}">${icon} ${movement.type}</span></td>
        <td>${description}</td>
        <td>${personNames[movement.person] || movement.person}</td>
        <td>${mediumNames[movement.medium] || movement.medium}</td>
        <td class="${movement.type === 'expense' || movement.type === 'postre_insumo' ? 'negative' : 'positive'}">
            ${movement.type === 'expense' || movement.type === 'postre_insumo' ? '-' : '+'}${formatCurrency(movement.amount)}
        </td>
        <td>
            <button class="btn-icon small" onclick="deleteMovement('${id}')" title="Eliminar">
                🗑️
            </button>
        </td>
    `;
    
    return row;
}

// Aplicar filtros
async function applyFilters() {
    await loadHistory();
}

// Cargar historial de postres
async function loadPostresHistory() {
    try {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3); // Últimos 3 meses
        
        const snapshot = await db.collection('movements')
            .where('family_id', '==', currentFamily.id)
            .where('type', 'in', ['postre_insumo', 'postre_venta'])
            .where('date', '>=', startDate)
            .orderBy('date', 'desc')
            .limit(20)
            .get();
        
        const container = document.getElementById('postresHistory');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<p class="empty-state">No hay movimientos de postres</p>';
            return;
        }
        
        snapshot.forEach(doc => {
            const movement = doc.data();
            const element = createPostreHistoryElement(movement);
            container.appendChild(element);
        });
        
    } catch (error) {
        console.error('Error cargando historial de postres:', error);
    }
}

// Cargar historial de fondos
async function loadFundHistory() {
    try {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6); // Últimos 6 meses
        
        const snapshot = await db.collection('movements')
            .where('family_id', '==', currentFamily.id)
            .where('type', '==', 'fund_transfer')
            .where('date', '>=', startDate)
            .orderBy('date', 'desc')
            .limit(20)
            .get();
        
        const container = document.getElementById('fundHistory');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<p class="empty-state">No hay movimientos en fondos</p>';
            return;
        }
        
        snapshot.forEach(doc => {
            const movement = doc.data();
            const element = createFundHistoryElement(movement);
            container.appendChild(element);
        });
        
    } catch (error) {
        console.error('Error cargando historial de fondos:', error);
    }
}

// Mostrar modal
function showModal(type) {
    const overlay = document.getElementById('modalOverlay');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    
    overlay.classList.add('active');
    
    switch (type) {
        case 'insumo':
            title.textContent = 'Agregar Insumo de Postres';
            body.innerHTML = `
                <form onsubmit="event.preventDefault(); saveQuickPostre('insumo')">
                    <div class="form-group">
                        <label>Monto *</label>
                        <input type="number" id="quickInsumoAmount" required min="0" step="0.01" autofocus>
                    </div>
                    <div class="form-group">
                        <label>Medio *</label>
                        <select id="quickInsumoMedium" required>
                            <option value="efectivo">Efectivo</option>
                            <option value="mercadopago">Mercado Pago</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Descripción (opcional)</label>
                        <input type="text" id="quickInsumoDesc" placeholder="Ej: Harina, huevos...">
                    </div>
                    <button type="submit" class="btn-primary">Guardar Insumo</button>
                </form>
            `;
            break;
            
        case 'venta':
            title.textContent = 'Registrar Venta de Postres';
            body.innerHTML = `
                <form onsubmit="event.preventDefault(); saveQuickPostre('venta')">
                    <div class="form-group">
                        <label>Monto *</label>
                        <input type="number" id="quickVentaAmount" required min="0" step="0.01" autofocus>
                    </div>
                    <div class="form-group">
                        <label>Medio *</label>
                        <select id="quickVentaMedium" required>
                            <option value="efectivo">Efectivo</option>
                            <option value="mercadopago">Mercado Pago</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Descripción (opcional)</label>
                        <input type="text" id="quickVentaDesc" placeholder="Ej: Torta chocolate, 6 cupcakes...">
                    </div>
                    <button type="submit" class="btn-success">Registrar Venta</button>
                </form>
            `;
            break;
    }
}

// Cerrar modal
function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

// Guardar movimiento rápido de postres
async function saveQuickPostre(type) {
    try {
        const amount = type === 'insumo' ? 
            parseFloat(document.getElementById('quickInsumoAmount').value) :
            parseFloat(document.getElementById('quickVentaAmount').value);
            
        const medium = type === 'insumo' ?
            document.getElementById('quickInsumoMedium').value :
            document.getElementById('quickVentaMedium').value;
            
        const description = type === 'insumo' ?
            document.getElementById('quickInsumoDesc').value :
            document.getElementById('quickVentaDesc').value;
        
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        
        const movement = {
            family_id: currentFamily.id,
            type: type === 'insumo' ? 'postre_insumo' : 'postre_venta',
            amount: amount,
            category: type === 'insumo' ? 'insumos_postres' : 'ventas_postres',
            medium: medium,
            date: new Date(),
            description: description || '',
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: currentUser.uid
        };
        
        await db.collection('movements').add(movement);
        
        showSuccess(type === 'insumo' ? 
            'Insumo registrado' : 
            'Venta registrada');
        
        closeModal();
        await loadCurrentMonthData();
        await loadPostresHistory();
        
    } catch (error) {
        console.error('Error guardando movimiento rápido:', error);
        showError(error.message);
    }
}

// Eliminar movimiento
async function deleteMovement(movementId) {
    if (!confirm('¿Estás seguro de eliminar este movimiento? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        await db.collection('movements').doc(movementId).delete();
        showSuccess('Movimiento eliminado');
        await loadCurrentMonthData();
        await loadHistory();
    } catch (error) {
        console.error('Error eliminando movimiento:', error);
        showError('Error eliminando movimiento');
    }
}

// Logout
function logout() {
    firebase.auth().signOut()
        .then(() => {
            localStorage.removeItem('lastEmail');
            localStorage.removeItem('lastPassword');
            window.location.href = 'setup.html';
        })
        .catch(error => {
            console.error('Error en logout:', error);
        });
}

// Mostrar notificaciones
function checkForNotifications() {
    // Verificar si hay fondos en estado crítico
    // (Implementar lógica de notificaciones)
}

// Helper: Calcular estado de fondo
function calculateFundStatus(balance, target) {
    const percentage = target > 0 ? (balance / target) * 100 : 0;
    
    if (percentage >= 75) return 'ok';
    if (percentage >= 25) return 'bajo';
    return 'critico';
}

// Helper: Actualizar balance de medio
function updateMediumBalanceAfterMovement(movement) {
    // Esta función podría actualizar un documento separado
    // que lleve el balance actual de cada medio
    // Por ahora se calcula en tiempo real
}

// Helper: Mostrar error
function showError(message) {
    // Implementar toast o alert estilizado
    alert(`❌ ${message}`);
}

// Helper: Mostrar éxito
function showSuccess(message) {
    // Implementar toast o alert estilizado
    alert(`✅ ${message}`);
}

// Helper: Cargar resumen mensual
async function loadMonthlySummary() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    const summaryId = `${year}_${month}`;
    
    try {
        const summaryDoc = await db.collection('monthly_summaries')
            .doc(summaryId)
            .get();
        
        if (summaryDoc.exists) {
            // Usar datos precalculados
            const summary = summaryDoc.data();
            // Actualizar UI con datos del resumen
        } else {
            // Calcular en tiempo real (ya lo hace loadCurrentMonthData)
        }
    } catch (error) {
        console.error('Error cargando resumen mensual:', error);
    }
}

// Inicializar aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initializeFirebase();
    
    // Configurar fecha actual en formularios
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
    
    // Configurar filtros de fecha
    const firstDay = new Date();
    firstDay.setDate(1);
    const lastDay = new Date();
    lastDay.setMonth(lastDay.getMonth() + 1);
    lastDay.setDate(0);
    
    document.getElementById('filterDateFrom').value = firstDay.toISOString().split('T')[0];
    document.getElementById('filterDateTo').value = lastDay.toISOString().split('T')[0];
});
