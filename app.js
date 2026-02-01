// ============================================
// CONFIGURACIÓN SUPABASE - COMPLETA
// ============================================

// ¡IMPORTANTE! REEMPLAZAR CON TUS DATOS REALES
const SUPABASE_URL = 'https://rdscdgohbrkqnuxjyalg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkc2NkZ29oYnJrcW51eGp5YWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTk0NDUsImV4cCI6MjA4NTQ3NTQ0NX0.nrjtRfGMBdq0KKxZaxG8Z6-CQArxdVB9hHkY-50AXMI';

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
    deferredInstallPrompt: null,
    isLoading: false
};

// ============================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Aplicación Familia Unida - Iniciando...');
    
    try {
        // Inicializar Supabase
        await initSupabase();
        
        // Inicializar UI
        initUI();
        
        // Configurar PWA
        setupPWAInstall();
        
        // Registrar Service Worker
        await registerServiceWorker();
        
        // Verificar autenticación
        await checkAuth();
        
        console.log('✅ Aplicación inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando aplicación:', error);
        showNotification('Error al iniciar la aplicación. Recarga la página.', 'error');
    }
});

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================
function formatCurrency(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (e) {
        return dateString;
    }
}

function showNotification(message, type = 'info') {
    console.log(`📢 Notificación [${type}]:`, message);
    
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
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
    
    return notification;
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return '✅';
        case 'error': return '❌';
        case 'warning': return '⚠️';
        default: return 'ℹ️';
    }
}

function setLoading(loading) {
    AppState.isLoading = loading;
    document.body.classList.toggle('loading', loading);
}

// ============================================
// INICIALIZACIÓN DE SUPABASE
// ============================================
async function initSupabase() {
    console.log('🔄 Inicializando Supabase...');
    
    try {
        // Verificar que Supabase esté cargado
        if (typeof supabase === 'undefined') {
            throw new Error('Biblioteca Supabase no encontrada');
        }
        
        // Crear cliente
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            }
        });
        
        console.log('✅ Supabase inicializado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error inicializando Supabase:', error);
        showNotification('Error de conexión. La aplicación funcionará en modo offline limitado.', 'error');
        return false;
    }
}

// ============================================
// AUTENTICACIÓN Y USUARIO
// ============================================
async function checkAuth() {
    console.log('🔐 Verificando autenticación...');
    
    if (!supabaseClient) {
        console.log('⚠️ Supabase no disponible, mostrando login');
        showLoginScreen();
        return;
    }
    
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error) {
            console.error('❌ Error al verificar sesión:', error);
            showLoginScreen();
            return;
        }
        
        if (session?.user) {
            console.log('👤 Usuario autenticado:', session.user.email);
            AppState.currentUser = session.user;
            await loadUserProfile();
        } else {
            console.log('👤 No hay sesión activa');
            showLoginScreen();
        }
    } catch (error) {
        console.error('❌ Error en checkAuth:', error);
        showLoginScreen();
    }
}

async function loadUserProfile() {
    console.log('📋 Cargando perfil de usuario...');
    setLoading(true);
    
    try {
        // Primero verificar si el usuario existe en la tabla users
        const { data: userData, error: userError } = await supabaseClient
            .from('users')
            .select('*, families(*)')
            .eq('id', AppState.currentUser.id)
            .single();
        
        if (userError) {
            console.log('👤 Usuario no encontrado en tabla users:', userError.message);
            // Usuario no existe en tabla users, redirigir a creación de familia
            await createNewFamily();
            return;
        }
        
        if (userData && userData.families) {
            AppState.currentFamily = userData.families;
            updateUserUI({
                full_name: userData.full_name || AppState.currentUser.email.split('@')[0],
                email: AppState.currentUser.email
            });
            await loadInitialData();
            updateUI();
            startEmotionalMessagesRotation();
            console.log('✅ Perfil cargado exitosamente');
        } else {
            console.log('🏠 Usuario sin familia, creando nueva...');
            await createNewFamily();
        }
    } catch (error) {
        console.error('❌ Error cargando perfil:', error);
        showNotification('Error cargando datos del usuario. Creando nueva familia...', 'warning');
        await createNewFamily();
    } finally {
        setLoading(false);
    }
}

async function createNewFamily() {
    const familyName = prompt('🏠 ¿Cómo quieres llamar a tu familia?', `Familia de ${AppState.currentUser.email.split('@')[0]}`);
    if (!familyName) {
        showNotification('Se necesita un nombre para la familia', 'warning');
        await loadUserProfile();
        return;
    }
    
    setLoading(true);
    
    try {
        // Crear familia
        const { data: family, error: familyError } = await supabaseClient
            .from('families')
            .insert({ name: familyName })
            .select()
            .single();
        
        if (familyError) {
            console.error('❌ Error creando familia:', familyError);
            throw familyError;
        }
        
        // Actualizar usuario con familia
        const { error: userError } = await supabaseClient
            .from('users')
            .upsert({
                id: AppState.currentUser.id,
                family_id: family.id,
                full_name: AppState.currentUser.user_metadata?.full_name || 'Usuario'
            });
        
        if (userError) throw userError;
        
        // Inicializar datos de familia
        await initializeFamilyData(family.id);
        
        AppState.currentFamily = family;
        updateUserUI({
            full_name: AppState.currentUser.user_metadata?.full_name || 'Usuario',
            email: AppState.currentUser.email
        });
        
        await loadInitialData();
        updateUI();
        startEmotionalMessagesRotation();
        
        showNotification(`¡Familia "${familyName}" creada exitosamente!`, 'success');
        
    } catch (error) {
        console.error('❌ Error creando familia:', error);
        showNotification('Error creando familia: ' + error.message, 'error');
        
        // Intentar modo demo
        showNotification('Usando modo demo temporal...', 'warning');
        initializeDemoData();
        updateUI();
    } finally {
        setLoading(false);
    }
}

async function initializeFamilyData(familyId) {
    console.log('🏗️ Inicializando datos de familia...');
    
    try {
        // Insertar personas
        await supabaseClient.from('persons').insert([
            { family_id: familyId, name: 'Sebastián', avatar_color: '#4F46E5' },
            { family_id: familyId, name: 'Ludmila', avatar_color: '#EC4899' }
        ]);
        
        // Insertar medios de pago
        await supabaseClient.from('payment_methods').insert([
            { family_id: familyId, name: 'Efectivo', icon: '💰' },
            { family_id: familyId, name: 'Mercado Pago', icon: '📱' }
        ]);
        
        // Insertar categorías
        const categories = [
            // Gastos del hogar
            { family_id: familyId, name: 'Alquiler', type: 'household_expense', color: '#EF4444', icon: '🏠' },
            { family_id: familyId, name: 'Servicios', type: 'household_expense', color: '#3B82F6', icon: '💡' },
            { family_id: familyId, name: 'Comida hogar', type: 'household_expense', color: '#10B981', icon: '🛒' },
            { family_id: familyId, name: 'Transporte', type: 'household_expense', color: '#F59E0B', icon: '🚗' },
            { family_id: familyId, name: 'Bebé', type: 'household_expense', color: '#8B5CF6', icon: '👶' },
            { family_id: familyId, name: 'Mascotas', type: 'household_expense', color: '#F97316', icon: '🐕' },
            { family_id: familyId, name: 'Salud', type: 'household_expense', color: '#EC4899', icon: '❤️' },
            { family_id: familyId, name: 'Ropa', type: 'household_expense', color: '#06B6D4', icon: '👕' },
            { family_id: familyId, name: 'Imprevistos', type: 'household_expense', color: '#71717A', icon: '🎲' },
            // Postres
            { family_id: familyId, name: 'Insumos postres', type: 'business_expense', color: '#8B5CF6', icon: '🧁' },
            { family_id: familyId, name: 'Ventas postres', type: 'business_income', color: '#10B981', icon: '💰' },
            // Ingresos
            { family_id: familyId, name: 'Ingreso diario Sebastián', type: 'personal_income', color: '#4F46E5', icon: '💼' },
            { family_id: familyId, name: 'Ingreso diario Ludmila', type: 'personal_income', color: '#EC4899', icon: '💼' }
        ];
        
        await supabaseClient.from('categories').insert(categories);
        
        // Insertar fondos
        await supabaseClient.from('funds').insert([
            { family_id: familyId, name: 'Fondo fijo hogar', monthly_goal: 0, current_amount: 0, color: '#10B981', icon: '🏠' },
            { family_id: familyId, name: 'Fondo fijo postres', monthly_goal: 0, current_amount: 0, color: '#8B5CF6', icon: '🧁' }
        ]);
        
        console.log('✅ Datos de familia inicializados');
        
    } catch (error) {
        console.error('❌ Error inicializando datos de familia:', error);
        throw error;
    }
}

function initializeDemoData() {
    console.log('🎮 Inicializando datos demo...');
    
    AppState.currentFamily = {
        id: 'demo-family-' + Date.now(),
        name: 'Familia Demo',
        created_at: new Date().toISOString()
    };
    
    AppState.familyData = {
        persons: [
            { id: 'demo-1', name: 'Sebastián', avatar_color: '#4F46E5', is_active: true },
            { id: 'demo-2', name: 'Ludmila', avatar_color: '#EC4899', is_active: true }
        ],
        paymentMethods: [
            { id: 'demo-1', name: 'Efectivo', icon: '💰', current_balance: 0 },
            { id: 'demo-2', name: 'Mercado Pago', icon: '📱', current_balance: 0 }
        ],
        categories: [
            { id: 'demo-1', name: 'Alquiler', type: 'household_expense', color: '#EF4444', icon: '🏠' },
            { id: 'demo-2', name: 'Comida hogar', type: 'household_expense', color: '#10B981', icon: '🛒' },
            { id: 'demo-3', name: 'Ingreso diario Sebastián', type: 'personal_income', color: '#4F46E5', icon: '💼' },
            { id: 'demo-4', name: 'Ingreso diario Ludmila', type: 'personal_income', color: '#EC4899', icon: '💼' }
        ],
        funds: [
            { id: 'demo-1', name: 'Fondo fijo hogar', monthly_goal: 0, current_amount: 0, color: '#10B981', icon: '🏠' }
        ]
    };
    
    AppState.transactions = [];
}

// ============================================
// PANTALLA DE LOGIN/REGISTRO
// ============================================
function showLoginScreen() {
    console.log('👋 Mostrando pantalla de login...');
    
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) {
        console.error('❌ No se encontró .main-content');
        return;
    }
    
    mainContent.innerHTML = `
        <div class="login-container">
            <div class="login-header">
                <h1>👨‍👩‍👧‍👦 Familia Unida</h1>
                <p class="subtitle">Ordenando finanzas juntos, sin estrés</p>
                <div class="emotional-quote">
                    <p>"Esto lo estamos ordenando juntos"</p>
                </div>
            </div>
            
            <div class="login-forms">
                <!-- Formulario de Login -->
                <form id="loginForm" class="auth-form">
                    <h2>Iniciar Sesión</h2>
                    <div class="form-group">
                        <label for="loginEmail">Email</label>
                        <input type="email" id="loginEmail" required placeholder="tu@email.com">
                    </div>
                    <div class="form-group">
                        <label for="loginPassword">Contraseña</label>
                        <input type="password" id="loginPassword" required placeholder="••••••">
                    </div>
                    <button type="submit" class="btn-primary">
                        Iniciar Sesión
                    </button>
                    <p class="switch-form">
                        ¿No tienes cuenta? <a href="#" id="showRegister">Crear una</a>
                    </p>
                </form>
                
                <!-- Formulario de Registro -->
                <form id="registerForm" class="auth-form" style="display: none;">
                    <h2>Crear Cuenta</h2>
                    <div class="form-group">
                        <label for="registerName">Nombre Completo</label>
                        <input type="text" id="registerName" required placeholder="Ej: Sebastián y Ludmila">
                    </div>
                    <div class="form-group">
                        <label for="registerEmail">Email</label>
                        <input type="email" id="registerEmail" required placeholder="tu@email.com">
                    </div>
                    <div class="form-group">
                        <label for="registerPassword">Contraseña (mínimo 6 caracteres)</label>
                        <input type="password" id="registerPassword" required minlength="6" placeholder="••••••">
                    </div>
                    <button type="submit" class="btn-success">
                        Crear Cuenta
                    </button>
                    <p class="switch-form">
                        ¿Ya tienes cuenta? <a href="#" id="showLogin">Iniciar sesión</a>
                    </p>
                </form>
            </div>
            
            <div class="login-footer">
                <p>💝 Diseñado con amor para ayudar a familias a ordenar sus finanzas juntos</p>
            </div>
        </div>
    `;
    
    // Agregar estilos inline para la pantalla de login
    const style = document.createElement('style');
    style.textContent = `
        .login-container {
            max-width: 400px;
            margin: 3rem auto;
            padding: 2rem;
            background: white;
            border-radius: 1rem;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            animation: fadeIn 0.5s ease-out;
        }
        
        .login-header {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .login-header h1 {
            color: #4F46E5;
            margin-bottom: 0.5rem;
            font-size: 2rem;
        }
        
        .subtitle {
            color: #6B7280;
            margin-bottom: 1.5rem;
            font-size: 1.1rem;
        }
        
        .emotional-quote {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 1.5rem;
            border-radius: 0.75rem;
            color: white;
            margin-bottom: 1.5rem;
        }
        
        .emotional-quote p {
            margin: 0;
            font-style: italic;
            font-size: 1.2rem;
        }
        
        .auth-form {
            margin-bottom: 1.5rem;
        }
        
        .auth-form h2 {
            color: #374151;
            margin-bottom: 1.5rem;
            text-align: center;
        }
        
        .form-group {
            margin-bottom: 1rem;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #374151;
        }
        
        .form-group input {
            width: 100%;
            padding: 0.75rem;
            border: 2px solid #E5E7EB;
            border-radius: 0.5rem;
            font-size: 1rem;
            transition: border-color 0.3s;
        }
        
        .form-group input:focus {
            border-color: #4F46E5;
            outline: none;
        }
        
        .btn-primary, .btn-success {
            width: 100%;
            padding: 0.75rem;
            border: none;
            border-radius: 0.5rem;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: transform 0.2s, opacity 0.2s;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-success {
            background: #10B981;
            color: white;
        }
        
        .btn-primary:hover, .btn-success:hover {
            transform: translateY(-2px);
            opacity: 0.9;
        }
        
        .switch-form {
            text-align: center;
            margin-top: 1rem;
            color: #6B7280;
        }
        
        .switch-form a {
            color: #4F46E5;
            text-decoration: none;
            font-weight: 600;
        }
        
        .switch-form a:hover {
            text-decoration: underline;
        }
        
        .login-footer {
            text-align: center;
            margin-top: 2rem;
            color: #6B7280;
            font-size: 0.875rem;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
    
    // Event Listeners
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin();
    });
    
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleRegister();
    });
    
    document.getElementById('showRegister').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    });
    
    document.getElementById('showLogin').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
    });
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showNotification('Por favor completa todos los campos', 'warning');
        return;
    }
    
    setLoading(true);
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        AppState.currentUser = data.user;
        showNotification(`¡Bienvenido de vuelta, ${email}!`, 'success');
        
        // Pequeño delay para mostrar la notificación
        setTimeout(() => {
            location.reload();
        }, 1500);
        
    } catch (error) {
        console.error('❌ Error en login:', error);
        
        let errorMessage = 'Error al iniciar sesión';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos';
        } else if (error.message.includes('Email not confirmed')) {
            errorMessage = 'Confirma tu email antes de iniciar sesión';
        }
        
        showNotification(errorMessage, 'error');
    } finally {
        setLoading(false);
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
    
    setLoading(true);
    
    try {
        // Registrar usuario en Supabase Auth
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
        
        if (data.user) {
            showNotification('¡Cuenta creada exitosamente! Ya puedes iniciar sesión.', 'success');
            
            // Cambiar a formulario de login
            document.getElementById('loginEmail').value = email;
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            
            // Limpiar formulario de registro
            document.getElementById('registerName').value = '';
            document.getElementById('registerEmail').value = '';
            document.getElementById('registerPassword').value = '';
        } else {
            showNotification('Error al crear la cuenta', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        
        let errorMessage = 'Error al crear cuenta';
        if (error.message.includes('User already registered')) {
            errorMessage = 'Este email ya está registrado';
        } else if (error.message.includes('invalid email')) {
            errorMessage = 'Email inválido';
        }
        
        showNotification(errorMessage, 'error');
    } finally {
        setLoading(false);
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
        
        // Pequeño delay antes de mostrar login
        setTimeout(() => {
            showLoginScreen();
        }, 500);
        
    } catch (error) {
        console.error('❌ Error al cerrar sesión:', error);
        showNotification('Error al cerrar sesión', 'error');
    }
}

// ============================================
// CARGA DE DATOS
// ============================================
async function loadInitialData() {
    if (!AppState.currentFamily) return;
    
    console.log('📊 Cargando datos iniciales...');
    setLoading(true);
    
    try {
        await Promise.all([
            loadFamilyData(),
            loadTransactions(),
            loadEmotionalMessages()
        ]);
        console.log('✅ Datos iniciales cargados correctamente');
    } catch (error) {
        console.error('❌ Error cargando datos iniciales:', error);
        showNotification('Error cargando datos', 'warning');
    } finally {
        setLoading(false);
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
        
        console.log(`📋 Datos familiares cargados: ${AppState.familyData.persons.length} personas, ${AppState.familyData.categories.length} categorías`);
        
    } catch (error) {
        console.error('❌ Error cargando datos familiares:', error);
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
        console.log(`💰 ${AppState.transactions.length} transacciones cargadas`);
        
    } catch (error) {
        console.error('❌ Error cargando transacciones:', error);
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
            { message: 'Estamos construyendo tranquilidad' },
            { message: 'Sebastián y Ludmila están del mismo lado' },
            { message: 'La plata es un medio, la familia es lo importante' }
        ];
        
    } catch (error) {
        console.error('❌ Error cargando mensajes:', error);
        AppState.emotionalMessages = [
            { message: 'Esto lo estamos ordenando juntos' },
            { message: 'No es culpa, es equipo' },
            { message: 'Estamos construyendo tranquilidad' }
        ];
    }
}

// ============================================
// INTERFAZ DE USUARIO - NAVEGACIÓN
// ============================================
function initUI() {
    console.log('🎨 Inicializando interfaz de usuario...');
    
    // Menú lateral
    const menuButton = document.getElementById('menuButton');
    const closeMenu = document.getElementById('closeMenu');
    const menuOverlay = document.getElementById('menuOverlay');
    const sideMenu = document.querySelector('.side-menu');
    
    if (menuButton && sideMenu && menuOverlay) {
        menuButton.addEventListener('click', () => {
            sideMenu.classList.add('open');
            menuOverlay.classList.add('show');
        });
    }
    
    if (closeMenu && sideMenu && menuOverlay) {
        closeMenu.addEventListener('click', () => {
            sideMenu.classList.remove('open');
            menuOverlay.classList.remove('show');
        });
    }
    
    if (menuOverlay && sideMenu) {
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
                sideMenu?.classList.remove('open');
                menuOverlay?.classList.remove('show');
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
    
    // Botón de instalación PWA
    const installButton = document.getElementById('installButton');
    if (installButton) {
        installButton.addEventListener('click', installPWA);
    }
    
    // Configurar fecha actual en formulario
    const transactionDate = document.getElementById('transactionDate');
    if (transactionDate) {
        const today = new Date().toISOString().split('T')[0];
        transactionDate.value = today;
        transactionDate.max = today; // No permitir fechas futuras
    }
    
    // Filtros de historial
    document.getElementById('filterType')?.addEventListener('change', updateHistory);
    document.getElementById('filterPerson')?.addEventListener('change', updateHistory);
    document.getElementById('filterPayment')?.addEventListener('change', updateHistory);
    document.getElementById('filterDate')?.addEventListener('change', updateHistory);
    
    console.log('✅ Interfaz de usuario inicializada');
}

function updateUserUI(userData) {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const email = document.getElementById('userEmail');
    
    if (avatar) {
        const initials = userData.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'FU';
        avatar.textContent = initials.substring(0, 2);
        avatar.style.backgroundColor = '#4F46E5';
    }
    if (name) name.textContent = userData.full_name || 'Familia';
    if (email) email.textContent = userData.email || '';
}

function switchTab(tabName) {
    console.log(`🔄 Cambiando a pestaña: ${tabName}`);
    
    // Actualizar menú activo
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });
    
    // Mostrar pestaña activa
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === tabName);
    });
    
    // Cargar datos específicos si es necesario
    if (tabName === 'history') {
        updateHistory();
    } else if (tabName === 'add-transaction') {
        setupTransactionForm();
    } else if (tabName === 'settings') {
        updateSettings();
    }
}

// ============================================
// ACTUALIZACIÓN DE INTERFAZ
// ============================================
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
    updateFundsPreview();
}

function updateDashboard() {
    const transactions = AppState.transactions;
    
    // Ingresos totales
    const totalIncome = transactions
        .filter(t => t.transaction_type === 'personal_income')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const totalIncomeEl = document.getElementById('totalIncome');
    if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(totalIncome);
    
    // Gastos del hogar
    const totalExpenses = transactions
        .filter(t => t.transaction_type === 'household_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const totalExpensesEl = document.getElementById('totalExpenses');
    if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(totalExpenses);
    
    // Resultado postres
    const sales = transactions
        .filter(t => t.transaction_type === 'business_income')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const supplies = transactions
        .filter(t => t.transaction_type === 'business_expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const businessResult = sales - supplies;
    const businessResultEl = document.getElementById('businessResult');
    if (businessResultEl) businessResultEl.textContent = formatCurrency(businessResult);
    
    // Ahorro del mes
    const monthlySavings = transactions
        .filter(t => t.transaction_type === 'fund_deposit')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    const monthlySavingsEl = document.getElementById('monthlySavings');
    if (monthlySavingsEl) monthlySavingsEl.textContent = formatCurrency(monthlySavings);
    
    // Balance final
    const finalBalance = totalIncome - totalExpenses + businessResult - monthlySavings;
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
}

function updateBalance() {
    const balanceCards = document.getElementById('balanceCards');
    if (!balanceCards) return;
    
    balanceCards.innerHTML = '';
    
    // Calcular saldos de métodos de pago basados en transacciones
    AppState.familyData.paymentMethods.forEach(method => {
        // Calcular saldo basado en transacciones
        const income = AppState.transactions
            .filter(t => t.payment_method_id === method.id && 
                        (t.transaction_type === 'personal_income' || 
                         t.transaction_type === 'business_income' ||
                         t.transaction_type === 'fund_withdrawal'))
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const expenses = AppState.transactions
            .filter(t => t.payment_method_id === method.id && 
                        (t.transaction_type === 'household_expense' || 
                         t.transaction_type === 'business_expense' ||
                         t.transaction_type === 'fund_deposit'))
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const balance = income - expenses;
        
        const card = document.createElement('div');
        card.className = 'summary-card';
        card.innerHTML = `
            <div class="card-header">
                <span class="card-icon">${method.icon}</span>
                <h3>${method.name}</h3>
            </div>
            <div class="card-value ${balance >= 0 ? 'positive' : 'negative'}">${formatCurrency(balance)}</div>
        `;
        balanceCards.appendChild(card);
    });
    
    // Total combinado
    const total = AppState.familyData.paymentMethods.reduce((sum, method) => {
        const income = AppState.transactions
            .filter(t => t.payment_method_id === method.id && 
                        (t.transaction_type === 'personal_income' || 
                         t.transaction_type === 'business_income' ||
                         t.transaction_type === 'fund_withdrawal'))
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const expenses = AppState.transactions
            .filter(t => t.payment_method_id === method.id && 
                        (t.transaction_type === 'household_expense' || 
                         t.transaction_type === 'business_expense' ||
                         t.transaction_type === 'fund_deposit'))
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        return sum + (income - expenses);
    }, 0);
    
    const totalBalanceEl = document.getElementById('totalBalance');
    if (totalBalanceEl) {
        totalBalanceEl.textContent = formatCurrency(total);
        totalBalanceEl.className = total >= 0 ? 'positive' : 'negative';
    }
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
    
    // Crear gráfico simple
    categoryChart.innerHTML = '<h3>Distribución de gastos</h3>';
    
    if (Object.keys(categories).length === 0) {
        categoryChart.innerHTML += '<p class="empty-state">No hay gastos este mes</p>';
    } else {
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
    }
    
    // Ranking
    categoryRanking.innerHTML = '<h3>Ranking de categorías</h3>';
    
    if (Object.keys(categories).length === 0) {
        categoryRanking.innerHTML += '<p class="empty-state">No hay gastos este mes</p>';
    } else {
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
    
    const totalSalesEl = document.getElementById('totalSales');
    const totalSuppliesEl = document.getElementById('totalSupplies');
    const businessProfitEl = document.getElementById('businessProfit');
    
    if (totalSalesEl) totalSalesEl.textContent = formatCurrency(sales);
    if (totalSuppliesEl) totalSuppliesEl.textContent = formatCurrency(supplies);
    if (businessProfitEl) businessProfitEl.textContent = formatCurrency(profit);
    
    // Fondo postres
    const dessertFund = AppState.familyData.funds.find(f => f.name === 'Fondo fijo postres');
    if (dessertFund) {
        const deposits = transactions
            .filter(t => t.fund_id === dessertFund.id && t.transaction_type === 'fund_deposit')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const withdrawals = transactions
            .filter(t => t.fund_id === dessertFund.id && t.transaction_type === 'fund_withdrawal')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const current = parseFloat(dessertFund.current_amount) || 0 + deposits - withdrawals;
        const goal = parseFloat(dessertFund.monthly_goal) || 0;
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
    
    if (AppState.familyData.funds.length === 0) {
        fundsList.innerHTML = '<p class="empty-state">No hay fondos configurados</p>';
        return;
    }
    
    AppState.familyData.funds.forEach(fund => {
        // Calcular saldo actual basado en transacciones
        const deposits = AppState.transactions
            .filter(t => t.fund_id === fund.id && t.transaction_type === 'fund_deposit')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const withdrawals = AppState.transactions
            .filter(t => t.fund_id === fund.id && t.transaction_type === 'fund_withdrawal')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const current = parseFloat(fund.current_amount) || 0 + deposits - withdrawals;
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
            <div class="fund-stats">
                <span>${percentage.toFixed(0)}% de ${formatCurrency(goal)}</span>
            </div>
        `;
        
        fundsList.appendChild(fundEl);
    });
}

function updateFunds() {
    const fullFundsList = document.getElementById('fullFundsList');
    if (!fullFundsList) return;
    
    fullFundsList.innerHTML = '';
    
    if (AppState.familyData.funds.length === 0) {
        fullFundsList.innerHTML = '<div class="empty-state">No hay fondos configurados. Ve a Configuración para agregarlos.</div>';
        return;
    }
    
    AppState.familyData.funds.forEach(fund => {
        // Calcular saldo actual basado en transacciones
        const deposits = AppState.transactions
            .filter(t => t.fund_id === fund.id && t.transaction_type === 'fund_deposit')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const withdrawals = AppState.transactions
            .filter(t => t.fund_id === fund.id && t.transaction_type === 'fund_withdrawal')
            .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        
        const current = parseFloat(fund.current_amount) || 0 + deposits - withdrawals;
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

// ============================================
// HISTORIAL
// ============================================
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
        historyList.innerHTML = '<div class="empty-state">No hay movimientos para mostrar con estos filtros</div>';
        return;
    }
    
    filtered.forEach(transaction => {
        const item = document.createElement('div');
        item.className = `history-item ${getTransactionTypeClass(transaction.transaction_type)}`;
        
        const person = AppState.familyData.persons.find(p => p.id === transaction.person_id);
        const category = AppState.familyData.categories.find(c => c.id === transaction.category_id);
        const payment = AppState.familyData.paymentMethods.find(p => p.id === transaction.payment_method_id);
        const fund = AppState.familyData.funds.find(f => f.id === transaction.fund_id);
        
        let description = getTransactionDescription(transaction, category, fund);
        let details = [];
        
        if (person) details.push(`<span class="person-${person.name.toLowerCase()}">${person.name}</span>`);
        if (payment) details.push(payment.name);
        
        item.innerHTML = `
            <div class="history-info">
                <div class="history-date">${formatDate(transaction.date)}</div>
                <div class="history-description">${description}</div>
                <div class="history-details">${details.join(' • ')}</div>
                ${transaction.description ? `<div class="history-note">"${transaction.description}"</div>` : ''}
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

// ============================================
// CONFIGURACIÓN
// ============================================
function updateSettings() {
    const familyMembers = document.getElementById('familyMembers');
    const goalSettings = document.getElementById('goalSettings');
    
    // Configurar lista de personas
    if (familyMembers) {
        familyMembers.innerHTML = '';
        
        if (AppState.familyData.persons.length === 0) {
            familyMembers.innerHTML = '<p class="empty-state">No hay miembros en la familia</p>';
        } else {
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
    }
    
    // Configurar objetivos de fondos
    if (goalSettings) {
        goalSettings.innerHTML = '';
        
        if (AppState.familyData.funds.length === 0) {
            goalSettings.innerHTML = '<p class="empty-state">No hay fondos configurados</p>';
        } else {
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
                        showNotification('Por favor ingresa un objetivo válido', 'warning');
                        return;
                    }
                    
                    try {
                        const { error } = await supabaseClient
                            .from('funds')
                            .update({ monthly_goal: goal })
                            .eq('id', fundId);
                        
                        if (error) throw error;
                        
                        showNotification('Objetivo actualizado correctamente', 'success');
                        
                        // Actualizar datos locales
                        const fund = AppState.familyData.funds.find(f => f.id === fundId);
                        if (fund) fund.monthly_goal = goal;
                        
                        updateFunds();
                        updateFundsPreview();
                        
                    } catch (error) {
                        console.error('Error actualizando objetivo:', error);
                        showNotification('Error actualizando objetivo', 'error');
                    }
                });
            });
        }
    }
    
    // Configurar botón de instalación PWA
    const installButton = document.getElementById('installButton');
    if (installButton && AppState.deferredInstallPrompt) {
        installButton.style.display = 'flex';
    } else if (installButton) {
        // Verificar si ya está instalado
        if (window.matchMedia('(display-mode: standalone)').matches || 
            window.navigator.standalone === true) {
            installButton.textContent = '📱 Ya instalada';
            installButton.disabled = true;
        } else {
            installButton.style.display = 'none';
        }
    }
}

// ============================================
// FORMULARIO DE TRANSACCIONES
// ============================================
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
        const today = new Date().toISOString().split('T')[0];
        transactionDate.value = today;
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
                // No mostrar categorías para transacciones de fondo
                categoryField.style.display = 'none';
                fundField.style.display = 'block';
                return;
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
    
    if ((type === 'household_expense' || type === 'business_expense' || type === 'business_income' || type === 'personal_income') && !categoryId) {
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
    
    setLoading(true);
    
    try {
        const { data, error } = await supabaseClient
            .from('transactions')
            .insert(transactionData)
            .select()
            .single();
        
        if (error) throw error;
        
        showNotification('✅ Movimiento registrado correctamente', 'success');
        
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
        console.error('❌ Error guardando transacción:', error);
        showNotification('Error al guardar el movimiento: ' + error.message, 'error');
    } finally {
        setLoading(false);
    }
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
        showNotification('✅ Objetivo actualizado correctamente', 'success');
        
    } catch (error) {
        console.error('❌ Error actualizando objetivo:', error);
        showNotification('Error actualizando objetivo', 'error');
    }
}

// ============================================
// PWA Y SERVICE WORKER
// ============================================
function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('📱 Evento de instalación PWA capturado');
        e.preventDefault();
        AppState.deferredInstallPrompt = e;
        
        // Mostrar botón de instalación después de un tiempo
        setTimeout(() => {
            const installButton = document.getElementById('installButton');
            if (installButton) {
                installButton.style.display = 'flex';
                installButton.addEventListener('click', installPWA);
            }
        }, 5000);
    });
    
    // Verificar si ya está instalado
    window.addEventListener('appinstalled', () => {
        console.log('📱 PWA instalada');
        AppState.deferredInstallPrompt = null;
        const installButton = document.getElementById('installButton');
        if (installButton) {
            installButton.textContent = '📱 Ya instalada';
            installButton.disabled = true;
        }
    });
}

function installPWA() {
    if (!AppState.deferredInstallPrompt) {
        showNotification('La aplicación ya está instalada o no está disponible para instalación', 'info');
        return;
    }
    
    AppState.deferredInstallPrompt.prompt();
    
    AppState.deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            showNotification('¡App instalada! Ahora está disponible en tu pantalla principal.', 'success');
            console.log('📱 Usuario aceptó la instalación');
        } else {
            console.log('📱 Usuario rechazó la instalación');
        }
        AppState.deferredInstallPrompt = null;
    });
}

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('✅ Service Worker registrado correctamente:', registration.scope);
            
            // Verificar actualizaciones
            registration.addEventListener('updatefound', () => {
                console.log('🔄 Nueva versión del Service Worker encontrada');
            });
            
        } catch (error) {
            console.warn('⚠️ Service Worker no registrado:', error);
        }
    } else {
        console.warn('⚠️ Service Worker no soportado en este navegador');
    }
}

// ============================================
// FUNCIONES ADICIONALES
// ============================================
function startEmotionalMessagesRotation() {
    const messageEl = document.getElementById('emotionalMessage');
    if (!messageEl || AppState.emotionalMessages.length === 0) return;
    
    let index = Math.floor(Math.random() * AppState.emotionalMessages.length);
    messageEl.textContent = AppState.emotionalMessages[index].message;
    
    // Rotar cada 15 segundos
    setInterval(() => {
        index = (index + 1) % AppState.emotionalMessages.length;
        messageEl.style.opacity = '0';
        
        setTimeout(() => {
            messageEl.textContent = AppState.emotionalMessages[index].message;
            messageEl.style.opacity = '1';
        }, 300);
    }, 15000);
}

// ============================================
// MANEJO DE CONEXIÓN
// ============================================
window.addEventListener('online', () => {
    AppState.isOffline = false;
    console.log('🌐 Conexión restablecida');
    showNotification('Conexión restablecida. Sincronizando datos...', 'success');
    
    // Intentar sincronizar datos pendientes
    setTimeout(() => {
        loadInitialData().then(updateUI);
    }, 1000);
});

window.addEventListener('offline', () => {
    AppState.isOffline = true;
    console.log('⚠️ Sin conexión a internet');
    showNotification('Modo offline. Los cambios se guardarán localmente.', 'warning');
});

// ============================================
// EXPORTAR PARA DEBUGGING
// ============================================
window.AppState = AppState;
window.supabaseClient = supabaseClient;

console.log('🎉 app.js cargado completamente');
