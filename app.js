/* ============================================================
   Tamzorya — app.js : logique globale
   (connexion Supabase, profils, factures/devis, missions, équipe,
   tableau de bord, mode hors-ligne). Le mentor IA est dans js/mentor-ia/.
   ============================================================ */
// Affiche une barre discrète si une erreur de nos fichiers casse l'écran
window.addEventListener('error', e => {
  if (e.filename && /app\.js|core-ia|prompt-/.test(e.filename)) { const b = document.getElementById('errBar'); if (b) b.hidden = false; console.error(e.message); }
});
(() => {
'use strict';
const $ = id => document.getElementById(id);
let OFFICIAL_RATE = 0; // taux officiel du jour (table taux_officiels)
const isRdc = () => !!profile && profile.country === 'RDC';
const effRate = () => Number(companyData?.exchange_rate) || (isRdc() ? OFFICIAL_RATE : 0) || 2300; // ton taux, sinon le taux officiel
let ZERO_DEC = false; // monnaies sans centimes (XAF, XOF, CDF...) : on n'affiche pas « ,00 »
const fmt = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: ZERO_DEC ? 0 : 2, maximumFractionDigits: 2 });
const setStatus = (id, msg, type) => { const el = $(id); el.textContent = msg; el.className = 'status' + (type ? ' ' + type : ''); };

const SUPABASE_URL = 'https://gravdcorborgssicqkso.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vIZcbN1B5TA-vUqiC8Af0g_8a3bl5CE';
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let WID = null, ROLE = 'owner', LOCKED = false;
let companyData = null;
let catalogItems = [];
let isSignup = false;
let IS_ADMIN = false, ADMIN_ROLE = '';

function saveDraft() {
  const draft = {
    number: $('invNumber').value,
    clientName: $('clientName').value,
    clientPhone: $('clientPhone').value,
    clientEmail: $('clientEmail').value,
    rows: readRows()
  };
  localStorage.setItem('facturix_draft', JSON.stringify(draft));
}

// Déclenche la sauvegarde automatique dès qu'on tape dans les infos client
['invNumber', 'clientName', 'clientPhone', 'clientEmail'].forEach(id => {
  $(id).addEventListener('input', saveDraft);
});


const currency = () => companyData?.currency || 'CDF';
const locCur = () => { const c = currency(); return c !== 'USD' ? c : (profile.currency !== 'USD' ? profile.currency : 'CDF'); };
function applyCurrency() {
  ZERO_DEC = ['XAF', 'XOF', 'CDF', 'GNF', 'RWF', 'UGX', 'BIF', 'KMF', 'DJF', 'MGA'].includes(currency());
  document.querySelectorAll('.currSymbol').forEach(el => el.textContent = currency());
  document.querySelectorAll('.locCur').forEach(el => el.textContent = locCur());
  const sel = $('expCurrency'), keep = sel.value;
  sel.innerHTML = [locCur(), 'USD'].map(c => `<option value="${c}">${c}</option>`).join('');
  if (keep) sel.value = keep;
}

/* ---------- AUTH ---------- */
let authStep = 1;
let authKind = null; // type de compte choisi dans les blocs : commercant, prestataire, normal, equipe
const KIND_TITLE = { commercant: 'Inscription Commerçant', prestataire: 'Inscription Prestataire', normal: 'Inscription Utilisateur', equipe: 'Inscription Travailleur' };
const KIND_INFO = {
  commercant: "COMMERÇANT\n\nPour qui : boutiques, quincailleries, grossistes, importateurs.\n\nCe que tu obtiens :\n• vente au comptoir, factures et tickets de caisse\n• catalogue avec photos, stock et prix de gros\n• commandes de clients avec code de retrait\n• annuaire, messagerie et publications dans le fil\n\nPrix : plan Gratuit (10 factures par mois), ou 14 jours d'essai d'un plan payant.\n\nCe qu'il te faut : ton nom, ton e-mail, ton pays et ton type de commerce. NIF et RCCM se remplissent plus tard, ils sont facultatifs.",
  prestataire: "PRESTATAIRE\n\nPour qui : plombiers, électriciens, peintres, maçons, réparateurs et tous ceux qui vendent un service.\n\nCe que tu obtiens :\n• devis et factures, main-d'œuvre et fournitures séparées\n• dictée vocale des devis\n• missions et aides, suivi des paiements\n• devis en 1 clic depuis le catalogue d'un fournisseur\n\nPrix : plan Gratuit (5 devis par mois), ou 14 jours d'essai d'un plan payant.\n\nCe qu'il te faut : ton nom, ton e-mail, ton pays et ton métier.",
  normal: "UTILISATEUR\n\nPour qui : toute personne qui veut acheter des matériaux ou trouver un artisan.\n\nCe que tu obtiens :\n• l'annuaire des commerçants et des artisans de ton pays\n• l'assistant d'achat : décris tes travaux, il te liste les matériaux\n• commande avec un code de retrait, itinéraire GPS\n• le fil d'actualité des arrivages\n\nAucun outil de calcul ni de comptabilité. C'est 100 % gratuit.\n\nCe qu'il te faut : ton nom, ton e-mail et ton pays.",
  equipe: "TRAVAILLEUR\n\nPour qui : les aides, vendeurs et associés qui travaillent pour un patron déjà inscrit.\n\nCe qu'il te faut : le code équipe de ton patron. Il le trouve dans son espace Équipe.\n\nSelon son activité, tu seras :\n• Aide : missions et historique de tes paiements\n• Vendeur : vente au comptoir et factures\n• Associé : accès élargi décidé par ton patron\n\nTu ne vois jamais les chiffres privés du patron. C'est gratuit pour toi."
};
const KIND_NOTE = {
  commercant: "Le nom officiel, le NIF et le RCCM se règlent plus tard dans « Mon entreprise ».",
  prestataire: "Ton métier sera affiché dans l'annuaire pour que les clients te trouvent.",
  normal: "Aucun outil de gestion : tu cherches des matériaux et des artisans de ton pays.",
  equipe: "Demande le code équipe à ton patron : il le trouve dans son espace Équipe."
};
const authBt = () => document.querySelector('input[name=bt]:checked').value;
const isOwnerSignup = () => !$('isTeam').checked && authBt() !== 'normal';
const lastStep = () => isOwnerSignup() ? 3 : 2;
const signupPlan = () => isOwnerSignup() ? $('authPlan').value : 'gratuit';
const signupSubtype = () => authBt() === 'commercant' && !$('isTeam').checked ? $('authSubtype').value : '';
const PLAN_HELP = {
  gratuit: () => authBt() === 'prestataire'
    ? 'Pour démarrer sans risque : 5 devis par mois, 1 entreprise, 3 questions au Mentor IA. Gratuit pour toujours.'
    : 'Pour démarrer sans risque : 10 factures par mois, 1 entreprise, 3 questions au Mentor IA. Gratuit pour toujours.',
  standard: () => 'Le bon départ pour grandir : factures et devis illimités, 2 entreprises, 2 employés et 2 associés, 100 questions IA par mois et l\'export Excel. 14 jours d\'essai gratuit, puis 2 $/mois ou 20 $/an.',
  diamant: () => 'Passe à la vitesse supérieure : jusqu\'à 5 boutiques ou adresses, 20 employés et 10 associés, 300 questions IA, et le chat des associés en temps réel.' + (authBt() === 'prestataire' ? ' Visible par tous les clients et toutes les entreprises.' : '') + ' 14 jours d\'essai gratuit, puis 5 $/mois ou 50 $/an.',
  platine: () => 'Pour les grossistes et importateurs : 6 à 15 magasins, 30 employés et 20 associés avec droits d\'accès détaillés, et mise en relation avec les plus gros acteurs. 14 jours d\'essai gratuit, puis 10 $/mois ou 100 $/an.'
};
function updatePlanHelp() { $('planHelp').textContent = PLAN_HELP[$('authPlan').value](); }
function buildPlanOptions() {
  const opts = [['gratuit', 'Gratuit : 0 $'], ['standard', 'Standard : 2 $/mois'], ['diamant', 'Diamant : 5 $/mois']];
  if (authBt() === 'commercant' && $('authSubtype').value !== 'petit') opts.push(['platine', 'Platine : 10 $/mois']);
  const sel = $('authPlan'), prev = sel.value; sel.innerHTML = '';
  opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l + (v === 'gratuit' ? '' : ' · 14 jours d\'essai'); sel.appendChild(o); });
  sel.value = opts.some(o => o[0] === prev) ? prev : 'standard';
  updatePlanHelp();
}
const stepName = () => authStep === 1 ? 'Tes informations' : authStep === 3 ? 'Ton plan' : ({ commercant: 'Ton commerce', prestataire: 'Ton métier', normal: 'Ton pays', equipe: 'Code équipe' }[authKind] || '');
function renderAuth() {
  const su = isSignup, chooser = su && authStep === 0, k = authKind;
  $('authChoose').hidden = !chooser;
  $('kindHead').hidden = !(su && authStep >= 1 && k);
  if (su && k) $('kindTitle').textContent = KIND_TITLE[k];
  $('authNameField').hidden = !(su && authStep === 1);
  $('authPhoneField').hidden = !(su && authStep === 1);
  $('authEmailField').hidden = $('authPwdField').hidden = su && authStep !== 1;
  $('authExtra').hidden = !(su && authStep === 2);
  $('planStep').hidden = !(su && authStep === 3);
  $('authSteps').hidden = !su || chooser; $('authSteps').textContent = `Étape ${authStep} sur ${lastStep()} · ${stepName()}`;
  $('authBack').hidden = !(su && authStep >= 1);
  $('authBack').textContent = authStep === 1 ? '← Changer de type' : '← Retour';
  $('authNext').hidden = !(su && authStep >= 1 && authStep < lastStep());
  $('authSubmit').hidden = su && authStep < lastStep();
  $('switchAuth').hidden = su && authStep > 1;
  $('forgotBtn').hidden = su;
  // contenu de l'étape 2 selon le type choisi
  $('teamToggle').hidden = true; if ($('btField')) $('btField').hidden = true;
  $('ownerFields').hidden = k === 'equipe'; $('teamField').hidden = k !== 'equipe';
  $('shopField').hidden = k !== 'commercant'; $('subtypeField').hidden = k !== 'commercant';
  $('tradeField').hidden = k !== 'prestataire';
  $('kindNote').textContent = KIND_NOTE[k] || '';
  if (su && authStep === 2) dialNote();
}
function chooseKind(k) {
  authKind = k;
  $('isTeam').checked = k === 'equipe';
  const radio = document.querySelector(`input[name=bt][value="${k === 'equipe' ? 'commercant' : k}"]`); if (radio) radio.checked = true;
  $('kindInfo').hidden = true; setStatus('authMessage', '');
  authStep = 1; renderAuth();
}
document.querySelectorAll('.kind-card').forEach(b => b.addEventListener('click', () => chooseKind(b.dataset.kind)));
$('kindInfoBtn').addEventListener('click', () => { $('kindInfo').textContent = KIND_INFO[authKind] || ''; $('kindInfo').hidden = !$('kindInfo').hidden; });
$('pwShow').addEventListener('change', () => { $('authPassword').type = $('pwShow').checked ? 'text' : 'password'; });
function goNext() {
  if (authStep === 1) {
    if (!$('authName').value.trim()) { setStatus('authMessage', 'Écris ton nom.', 'err'); return; }
    if (!$('authEmail').checkValidity()) { setStatus('authMessage', 'Écris une adresse e-mail valide.', 'err'); return; }
    if ($('authPassword').value.length < 8) { setStatus('authMessage', 'Le mot de passe doit avoir 8 caractères minimum.', 'err'); return; }
  }
  if (authStep === 2 && $('isTeam').checked && !$('authTeam').value.trim()) { setStatus('authMessage', 'Écris le code équipe donné par ton patron.', 'err'); return; }
  setStatus('authMessage', ''); authStep++;
  if (authStep === 3) buildPlanOptions();
  renderAuth();
}
function setAuthMode(signup) {
  isSignup = signup; authStep = signup ? 0 : 1; authKind = null; // à l'inscription on commence par choisir son type de compte
  $('authTitle').textContent = signup ? 'Créer ton compte Tamzorya' : 'Bienvenue sur Tamzorya';
  $('authSubmit').textContent = signup ? 'Créer mon compte' : 'Se connecter';
  $('switchAuth').textContent = signup ? 'J\'ai déjà un compte' : 'Créer un compte';
  $('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  setStatus('authMessage', '');
  renderAuth();
}
$('authNext').addEventListener('click', goNext);
$('authBack').addEventListener('click', () => { authStep--; setStatus('authMessage', ''); renderAuth(); });
$('authPlan').addEventListener('change', () => { updatePlanHelp(); $('planHelp').hidden = false; });
$('planHelpBtn').addEventListener('click', () => { updatePlanHelp(); $('planHelp').hidden = !$('planHelp').hidden; });
document.querySelectorAll('input[name=bt]').forEach(r => r.addEventListener('change', renderAuth));
$('isTeam').addEventListener('change', renderAuth);
$('authSubtype').addEventListener('change', () => { if (authStep === 3) buildPlanOptions(); });
$('switchAuth').addEventListener('click', () => setAuthMode(!isSignup));
setAuthMode(false); // au démarrage : écran de connexion seulement (e-mail et mot de passe)

async function checkSession() {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) { currentUser = session.user; await openApp(); }
  } catch (err) { setStatus('authMessage', 'Erreur de connexion : ' + err.message, 'err'); }
}

function showLock() { $('appView').hidden = true; $('splash').hidden = true; $('lockView').hidden = false; }
$('lockOut').addEventListener('click', () => $('logoutBtn').click());
async function openApp() {
  $('authView').hidden = true;
  $('welcome').textContent = 'Bonjour, ' + (currentUser.user_metadata?.full_name || currentUser.email);
  const ctx = JSON.parse(localStorage.getItem('facturix_ctx') || 'null'), cached = !!ctx && ctx.uid === currentUser.id;
  const fresh = async () => {
    await loadProfile(); if (profile.business_type !== 'normal') await Promise.all([loadCompanyData(), loadCatalog()]);
    localStorage.setItem('facturix_ctx', JSON.stringify({ uid: currentUser.id, profile, WID, ROLE, companyData, catalogItems }));
  };
  if (cached) { ({ profile, WID, ROLE, companyData, catalogItems } = ctx); applyCurrency(); if (navigator.onLine) fresh().then(() => { if (LOCKED) { showLock(); return; } applyProfile(); refreshBadge(); }).catch(() => {}); }
  else { $('splash').hidden = false; await fresh(); }
  if (LOCKED) { showLock(); return; }
  applyProfile();
  $('splash').hidden = true; $('appView').hidden = false;
  loadOfficialRate();
  if (ROLE !== 'aide' && ROLE !== 'vendeur') startChat();
  if (profile.business_type === 'commercant' && ROLE !== 'aide') startOrders();
  const shopId = sessionStorage.getItem('tamzorya_shop'); // lien d'un QR de comptoir : on ouvre directement la boutique
  if (shopId && ROLE !== 'aide' && ROLE !== 'vendeur') { sessionStorage.removeItem('tamzorya_shop'); setTimeout(() => openShop(shopId), 300); if (profile.business_type === 'normal') return; }
  else if (profile.business_type === 'normal') { setPage('accueil'); return; } // vitrine particulier : rien d'autre à charger
  if (ROLE === 'aide') setPage('missions'); else if (ROLE === 'vendeur') setPage('facture'); else setPage('accueil');
  resetInvoice(); flushQueue(); loadSuggestions(); setupRealtime(); startMissionRT(); refreshBadge();
  if (ROLE === 'owner') _supabase.rpc('purge_old_vouchers'); // supprime les bons de plus de 6 mois
  if (ROLE === 'owner') { checkAdmin(); checkPayNotices(); checkSubscription(); }
}

let realtimeStarted = false;
function setupRealtime() {
  if (realtimeStarted) return;
  realtimeStarted = true;

  _supabase
    .channel('invoices-updates')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'invoices', filter: `user_id=eq.${WID}` },
      () => {
        const activeNav = document.querySelector('.nav button.active');
        if (activeNav && activeNav.dataset.page === 'historique') loadHistory();
        if (activeNav && activeNav.dataset.page === 'dashboard') loadDashboard();
      }
    )
    .subscribe();

  // Canal pour les dépenses (Mise à jour de la liste des dépenses et du Dashboard)
  _supabase
    .channel('expenses-updates')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'expenses', filter: `user_id=eq.${WID}` },
      () => {
        const activeNav = document.querySelector('.nav button.active');
        if (activeNav && activeNav.dataset.page === 'depenses') loadExpenses();
        if (activeNav && activeNav.dataset.page === 'dashboard') loadDashboard();
      }
    )
    .subscribe();
}


$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (isSignup && authStep < lastStep()) { goNext(); return; } // « Entrée » avance d'une étape
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const btn = $('authSubmit');
  btn.disabled = true;
  try {
    if (isSignup) {
      if ($('isTeam').checked && !$('authTeam').value.trim()) throw new Error('Écris le code équipe donné par ton patron.');
      setStatus('authMessage', 'Création du compte...');
      const { data, error } = await _supabase.auth.signUp({
        email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { full_name: $('authName').value.trim(), country: $('isTeam').checked ? '' : $('authCountry').value, business_type: $('isTeam').checked ? 'equipe' : document.querySelector('input[name=bt]:checked').value, phone: phoneWithCode($('authPhone').value, $('authCountry').value), shop_name: $('authShop').value.trim(), trade: $('authTrade').value.trim(), plan_type: signupPlan(), business_subtype: signupSubtype(), team_code: $('isTeam').checked ? $('authTeam').value.trim().toUpperCase() : '' } }
      });
      if (error) throw error;
      if (data.session) { currentUser = data.user; await openApp(); }
      else {
        setAuthMode(false);
        setStatus('authMessage', 'Compte créé ! Un e-mail de confirmation vient de t\'être envoyé. Ouvre-le et touche le lien : tu arriveras directement dans ton espace Tamzorya.', 'ok');
        $('resendBtn').hidden = false;
      }
    } else {
      setStatus('authMessage', 'Connexion en cours...');
      const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      await openApp();
    }
  } catch (err) {
    if (/not confirmed/i.test(err.message)) { setStatus('authMessage', 'Ton e-mail n\'est pas encore confirmé. Ouvre l\'e-mail reçu, ou demande-en un nouveau ci-dessous.', 'err'); $('resendBtn').hidden = false; }
    else setStatus('authMessage', err.message, 'err');
  } finally { btn.disabled = false; }
});

$('logoutBtn').addEventListener('click', async () => {
  const btn = $('logoutBtn');
  btn.disabled = true;
  btn.textContent = 'Déconnexion...';
  localStorage.removeItem('facturix_draft');
  try {
    // On n'attend pas plus de 3 secondes (réseau lent ou coupé)
    await Promise.race([
      _supabase.auth.signOut(),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  } catch (err) { console.error(err); }
  // Sécurité : on efface la session stockée sur cet appareil, quoi qu'il arrive
  Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k));
  location.reload();
});

/* ---------- ENTREPRISE ---------- */
const companyFields = { coIdNat: 'id_nat', coPatente: 'patente', coName: 'name', coPhone: 'phone', coEmail: 'email', coAddress: 'address', coCity: 'city', coCurrency: 'currency', coMessage: 'message', coRate: 'exchange_rate', coMomo: 'momo', coColor: 'brand_color', coTax: 'tax_id', coRccm: 'rccm', coLogo: 'logo_url' };

async function loadCompanyData() {
  try {
    const { data, error } = await _supabase.from('companies').select('*').eq('id', WID).maybeSingle();
    if (error) throw error;
    if (data) {
      companyData = data;
      Object.entries(companyFields).forEach(([id, k]) => { 
        // Condition ajoutée pour ignorer le champ logo lors du chargement textuel
        if (id !== 'coLogo' && data[k] && $(id)) {
          $(id).value = data[k]; 
        }
      });
    }
  } catch (err) { setStatus('companyStatus', 'Erreur de chargement : ' + err.message, 'err'); }
  applyCurrency();
}

$('companyForm').addEventListener('submit', async e => {
  e.preventDefault();
  setStatus('companyStatus', 'Enregistrement...');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const payload = { id: WID };
    
    // Modification ici : on ignore 'coLogo' dans cette boucle de texte
    Object.entries(companyFields).forEach(([id, k]) => {
      if (id !== 'coLogo' && $(id)) {
        payload[k] = $(id).value.trim();
      }
    });
    if (profile.plan !== 'pro') payload.brand_color = payload.tax_id = payload.rccm = null; // PRO

    payload.exchange_rate = parseFloat($('coRate').value) || 0; // 0 = utiliser le taux officiel

    // Gestion du fichier image (Logo)
    const fileInput = $('logoUpload');
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (file.size > 2 * 1024 * 1024) throw new Error('Le logo est trop lourd (2 Mo maximum).');
      const fileExt = 'jpg'; const logoBlob = await compressImage(file); // logo réduit avant l'envoi
      // On crée un nom de fichier unique basé sur l'ID de l'utilisateur
      const filePath = `${WID}/logo_${Date.now()}.${fileExt}`;

      // 1. Envoi du fichier dans le bucket "logos" sur Supabase Storage
      const { error: uploadError } = await _supabase.storage
        .from('logos')
        .upload(filePath, logoBlob, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // 2. Récupération de son URL publique d'accès
      const { data: urlData } = _supabase.storage.from('logos').getPublicUrl(filePath);
      payload.logo_url = urlData.publicUrl;
    } else if (companyData && companyData.logo_url) {
      // Si aucun nouveau fichier n'est choisi, on conserve l'ancien logo
      payload.logo_url = companyData.logo_url;
    }

    // 3. Sauvegarde ou mise à jour dans la table des entreprises
    const { error } = await _supabase.from('companies').upsert(payload);
    if (error) throw error;

    setStatus('companyStatus', 'Enregistré avec succès !', 'ok');
    await loadCompanyData();
    await loadCatalog();
  } catch (err) {
    setStatus('companyStatus', 'Erreur : ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});


/* ---------- CATALOGUE ---------- */
async function loadCatalog() {
  const { data, error } = await _supabase.from('catalog').select('*').eq('user_id', WID).order('name');
  if (error) { setStatus('productStatus', 'Erreur : ' + error.message, 'err'); }
  catalogItems = data || [];
  $('prodAcc').open = !catalogItems.length; // formulaire replié quand le catalogue a déjà des articles

  const select = $('catalogSelect');
  select.innerHTML = '';
  select.appendChild(new Option('-- Ajouter depuis le catalogue --', ''));
  catalogItems.forEach(item => select.appendChild(new Option(`${itemName(item)} (${item.price} ${currency()})`, item.id)));
  renderChips();

  const list = $('catalogList');
  list.innerHTML = '';
  if (!catalogItems.length) { list.innerHTML = '<p class="note">Ton catalogue est vide.</p>'; return; }
  catalogItems.forEach(item => list.appendChild(ownerCard(item)));
}

// Carte d'un article de MON catalogue
function ownerCard(item) {
  const st = stockInfo(item), cur = currency();
  const card = document.createElement('div'); card.className = 'cat-card';
  card.appendChild(photoBox(item.photo_path, itemName(item), st.text, st.cls));
  const body = document.createElement('div'); body.className = 'cat-body';
  const nm = document.createElement('div'); nm.className = 'cat-name'; nm.textContent = item.name || 'Sans nom';
  const pr = document.createElement('div'); pr.className = 'cat-price'; pr.textContent = `${fmt(item.price)} ${cur} / ${item.unit || 'unité'}`;
  body.append(nm, pr);
  if (item.prix_gros != null && item.quantite_seuil_gros != null) {
    const g = document.createElement('div'); g.className = 'cat-gros'; g.textContent = `Gros : ${fmt(item.prix_gros)} ${cur} dès ${item.quantite_seuil_gros}`; body.appendChild(g);
  }
  if (item.negociable) { const n = document.createElement('div'); n.className = 'cat-gros'; n.textContent = 'Négociable'; body.appendChild(n); }
  if (item.stock != null) { const s = document.createElement('div'); s.className = 'cat-gros'; s.textContent = 'Stock exact : ' + item.stock + (item.masquer_stock ? ' (nombre caché au public)' : ''); body.appendChild(s); }
  const acts = document.createElement('div'); acts.className = 'actions';
  acts.append(mk('+ Achat', 'secondary', () => buyStock(item)), mk('Supprimer', 'danger', async () => {
    if (!confirm('Supprimer « ' + itemName(item) + ' » du catalogue ?')) return;
    const { error } = await _supabase.from('catalog').delete().eq('id', item.id);
    if (error) { setStatus('productStatus', 'Erreur : ' + error.message, 'err'); return; }
    if (item.photo_path) _supabase.storage.from('catalog-photos').remove([item.photo_path]);
    loadCatalog();
  }));
  body.appendChild(acts); card.appendChild(body);
  return card;
}

$('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('prodName').value.trim(), file = $('prodPhoto').files[0];
  const gros = $('prodGros').value === '' ? null : parseFloat($('prodGros').value), seuil = $('prodSeuil').value === '' ? null : parseFloat($('prodSeuil').value);
  if (!name && !file) { setStatus('productStatus', 'Mets au moins un nom ou une photo.', 'err'); return; }
  if ((gros != null) !== (seuil != null)) { setStatus('productStatus', 'Prix de gros et quantité minimale vont ensemble : remplis les deux ou aucun.', 'err'); return; }
  setStatus('productStatus', 'Ajout...');
  let photo_path = null;
  if (file) {
    try {
      const blob = await compressImage(file);
      const path = `${WID}/${Date.now()}.jpg`;
      const up = await _supabase.storage.from('catalog-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      photo_path = path;
    } catch (err) { setStatus('productStatus', 'Photo non envoyée : ' + err.message, 'err'); return; }
  }
  const { error } = await _supabase.from('catalog').insert([{
    user_id: WID,
    name: name || null,
    price: parseFloat($('prodPrice').value),
    unit: $('prodUnit').value.trim() || 'unité',
    description: $('prodDesc').value.trim(),
    stock: $('prodStock').value === '' ? null : parseFloat($('prodStock').value),
    photo_path, prix_gros: gros, quantite_seuil_gros: seuil, masquer_stock: $('prodHide').checked, negociable: $('prodNego').checked
  }]);
  if (error) { setStatus('productStatus', 'Erreur : ' + error.message, 'err'); return; }
  $('productForm').reset();
  $('prodUnit').value = 'unité';
  setStatus('productStatus', 'Article ajouté !', 'ok');
  loadCatalog();
});

/* ---------- FACTURE ---------- */
function docTitle() {
  if (profile.business_type === 'prestataire') $('docType').value = 'devis';
  const q = $('docType').value === 'devis';
  $('invTitle').textContent = q ? 'Créer un devis' : 'Créer une facture';
  $('saveInvoiceBtn').textContent = q ? 'Enregistrer le devis' : 'Enregistrer la facture';
  $('paidField').hidden = q;
  $('newInvoiceBtn').textContent = q ? 'Nouveau devis' : 'Nouvelle facture';
  $('quoteFields').hidden = !q;
  $('invNumLabel').textContent = q ? 'Numéro du devis *' : 'Numéro de facture *';
  $('tvaRate').value = VAT[profile.country] ?? 16;
  $('tvaRate').hidden = !$('tvaOn').checked;
  $('paidNow').checked = profile.business_type !== 'prestataire';
  const tvaAuto = profile.plan === 'pro' && profile.country === 'RDC' && !!companyData?.tax_id && !!companyData?.rccm; // RDC : TVA automatique et obligatoire
  $('tvaOn').checked = tvaAuto; $('tvaOn').disabled = tvaAuto; $('tvaRate').hidden = !tvaAuto;
}

async function generateInvoiceNumber() {
  docTitle();
  const year = new Date().getFullYear();
  const pre = (($('docType') && $('docType').value === 'devis') ? 'DEV' : 'FAC') + (ROLE === 'vendeur' ? '-V' + currentUser.id.slice(0, 3).toUpperCase() : '');
  const prefix = `${pre}-${year}-`;
  let next = 1;
  try {
    const { data, error } = await _supabase.from('invoices').select('number')
      .eq('user_id', WID).like('number', prefix + '%');
    if (error) throw error;
    (data || []).forEach(r => {
      const m = r.number.match(new RegExp('^' + pre + '-\\d{4}-(\\d+)$'));
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    });
    $('invNumber').value = prefix + String(next).padStart(4, '0');
  } catch (err) {
    // hors ligne : numéro provisoire, modifiable
    $('invNumber').value = prefix + Math.floor(1000 + Math.random() * 9000);
  }
}

// A Modifier dans loadDraft :
function loadDraft() {
  const saved = localStorage.getItem('facturix_draft');
  if (!saved) return false; // Renvoie false si vide
  try {
    const draft = JSON.parse(saved);
    $('invNumber').value = draft.number || '';
    $('clientName').value = draft.clientName || '';
    $('clientPhone').value = draft.clientPhone || '';
    $('clientEmail').value = draft.clientEmail || '';
    
    if (draft.rows && draft.rows.length > 0) {
      $('invoiceItemsTable').innerHTML = ''; 
      draft.rows.forEach(row => {
        addInvoiceRow(row.description, row.unit_price, row.quantity);
      });
      return true; // Brouillon chargé avec succès !
    }
  } catch (e) {
    console.error("Erreur lors du chargement du brouillon", e);
  }
  return false;
}

// À Modifier dans resetInvoice :
async function resetInvoice() {
  $('invoiceForm').reset(); pendingOrder = null; $('retraitMsg').textContent = '';
  $('validHours').value = isPrest() ? '0' : '24';
  $('invoiceItemsTable').innerHTML = '';
  $('printArea').hidden = true; syncPrintFormat();
  $('printInvoiceBtn').hidden = true;
  $('newInvoiceBtn').hidden = true;
  setStatus('invoiceStatus', '');
  await generateInvoiceNumber();
  
  const hasDraft = loadDraft(); // On tente de charger d'abord
  if (!hasDraft) {
    addInvoiceRow(); // On ne met la ligne vide que s'il n'y a PAS de brouillon !
  }
  calculateTotal();
}


function addInvoiceRow(desc = '', price = 0, qte = 1, kind = '') {
  const tbody = $('invoiceItemsTable');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="row-desc" placeholder="Description" required></td>
    <td><input class="row-qty" type="number" min="0.01" step="any" inputmode="decimal"></td>
    <td><input class="row-price" type="number" step="0.01" min="0" inputmode="decimal"></td>
    <td><strong class="row-total">0,00</strong></td>
    <td><button class="btn danger" type="button" style="padding:4px 8px">X</button></td>`;
  const d = tr.querySelector('.row-desc');
  d.value = desc; d.setAttribute('list', 'lineSuggest');
  tr.dataset.kind = kind;
  if (kind) { tr.firstElementChild.style.borderLeft = '5px solid ' + (kind === 'main_oeuvre' ? '#16865b' : '#d4a017'); d.placeholder = kind === 'main_oeuvre' ? "Ex. Installation, pose, réparation (main-d'œuvre)" : 'Ex. Câbles, peinture, pièces (fournitures)'; }
  if (kind === 'main_oeuvre') { const qi = tr.querySelector('.row-qty'); qi.hidden = true; tr.querySelector('.row-price').placeholder = 'Montant'; }
  d.addEventListener('change', () => { const sg = lineSugg[d.value], p = tr.querySelector('.row-price'); if (sg && !parseFloat(p.value)) { p.value = sg.price; calculateTotal(); } });
  tr.querySelector('.row-qty').value = qte;
  tr.querySelector('.row-price').value = price;

  // NOUVELLES LIGNES AVEC SAUVEGARDE DU BROUILLON :
  tr.querySelector('.btn').addEventListener('click', () => { tr.remove(); calculateTotal(); saveDraft(); });
  tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { calculateTotal(); saveDraft(); }));

  tbody.appendChild(tr);
  calculateTotal();
}


$('addCustomBtn').addEventListener('click', () => addInvoiceRow());
$('addCatalogBtn').addEventListener('click', () => {
  const id = $('catalogSelect').value;
  const item = catalogItems.find(c => String(c.id) === id);
  if (item) { addInvoiceRow(itemName(item), item.price, 1); $('invoiceItemsTable').lastElementChild.dataset.cid = item.id; }
});

function readRows() {
  return [...document.querySelectorAll('#invoiceItemsTable tr')].map(tr => {
    const quantity = parseFloat(tr.querySelector('.row-qty').value) || 0;
    const unit_price = parseFloat(tr.querySelector('.row-price').value) || 0;
    return {
      description: tr.querySelector('.row-desc').value.trim(),
      kind: tr.dataset.kind || null,
      quantity, unit_price,
      total_price: Math.round(quantity * unit_price * 100) / 100
    };
  });
}

function calculateTotal() {
  const trs = document.querySelectorAll('#invoiceItemsTable tr');
  const rows = readRows();
  let grand = 0;
  rows.forEach((r, i) => { trs[i].querySelector('.row-total').textContent = fmt(r.total_price); grand += r.total_price; });
  const tv = tvaOf(taxableSum(rows));
  $('invoiceGrandTotal').textContent = fmt(grand + tv);
  $('tvaInfo').textContent = tv ? `Sous-total HT : ${fmt(grand)} · TVA ${tvaRate()} % : ${fmt(tv)}` : '';
  const sum = k => rows.filter(r => r.kind === k).reduce((a, r) => a + r.total_price, 0), lab = sum('main_oeuvre'), mat = sum('fourniture');
  const ret = $('retenueOn').checked ? Math.round(lab * RETENUE_PCT) / 100 : 0;
  $('retenueInfo').textContent = ret ? `Retenue à la source : −${fmt(ret)} · Net à percevoir : ${fmt(grand + tv - ret)}` : '';
  $('kindTotals').textContent = (lab || mat) ? `Main-d'œuvre : ${fmt(lab)} · Fournitures : ${fmt(mat)}` : '';
  const rate = effRate(), cur = currency(), loc = (profile.currency && profile.currency !== 'USD') ? profile.currency : 'CDF';
  $('altLive').textContent = rate && grand ? `≈ ${fmt(cur === 'USD' ? (grand + tv) * rate : (grand + tv) / rate)} ${cur === 'USD' ? loc : 'USD'} · ton taux : 1 USD = ${fmt(rate)} ${loc}` : '';
  return grand;
}

$('invoiceForm').addEventListener('submit', async e => {
  e.preventDefault();
  const rows = readRows().filter(r => r.description);
  if (!rows.length) { setStatus('invoiceStatus', 'Ajoute au moins un article.', 'err'); return; }
  if (rows.some(r => r.quantity <= 0)) { setStatus('invoiceStatus', 'Chaque quantité doit être supérieure à 0.', 'err'); return; }

  const ht = Math.round(rows.reduce((s, r) => s + r.total_price, 0) * 100) / 100, total_amount = Math.round((ht + tvaOf(taxableSum(rows))) * 100) / 100;
  const btn = $('saveInvoiceBtn');
  btn.disabled = true;
  if (!navigator.onLine) { // hors-ligne : on garde sur le téléphone
    const p = { inv: { user_id: WID, number: $('invNumber').value.trim(), client_name: $('clientName').value.trim(), client_phone: $('clientPhone').value.trim(), client_email: $('clientEmail').value.trim(), total_amount, currency: currency(), doc_type: $('docType').value, status: statusNow(), ...quoteExtra() }, items: rows };
    p.order_id = pendingOrder ? pendingOrder.id : null; pendingOrder = null;
    localStorage.setItem('facturix_queue', JSON.stringify([...JSON.parse(localStorage.getItem('facturix_queue') || '[]'), p]));
    preparePrintArea({ ...p.inv, created_at: new Date().toISOString() }, rows);
    $('printInvoiceBtn').hidden = false; btn.disabled = false;
    setStatus('invoiceStatus', 'Hors-ligne : enregistré sur ton téléphone, envoi automatique au retour du réseau.', 'ok');
    return;
  }
  const lim = await checkLimit($('docType').value);
  if (lim) { setStatus('invoiceStatus', lim, 'err'); btn.disabled = false; return; }
  setStatus('invoiceStatus', 'Enregistrement...');

  try {
    const { data: inv, error } = await _supabase.from('invoices').insert([{
      user_id: WID,
      number: $('invNumber').value.trim(),
      client_name: $('clientName').value.trim(),
      client_phone: $('clientPhone').value.trim(),
      client_email: $('clientEmail').value.trim(),
      total_amount,
      currency: currency(),
      doc_type: $('docType').value,
      status: statusNow(),
      ...quoteExtra()
    }]).select().single();
    if (error) throw error;

    const items = rows.map(r => ({ invoice_id: inv.id, ...r }));
    const { error: itemsError } = await _supabase.from('invoice_items').insert(items);
    if (itemsError) {
      await _supabase.from('invoices').delete().eq('id', inv.id); // évite une facture vide
      throw itemsError;
    }

    if ($('docType').value === 'facture') await decStock();
    showUsage();
    setStatus('invoiceStatus', ($('docType').value === 'devis' ? 'Devis enregistré' : 'Facture enregistrée') + ' ! Tu peux l\'imprimer ou l\'envoyer par WhatsApp depuis « ' + (isPrest() ? 'Mes devis' : 'Mes factures') + ' ».', 'ok');
    localStorage.removeItem('facturix_draft'); // Nettoie le brouillon local
    preparePrintArea(inv, items);
    $('printInvoiceBtn').hidden = false;
    $('newInvoiceBtn').hidden = false;
    autoPrintTicket(inv, items); // ticket envoyé à l'imprimante dès que Supabase confirme la vente
    if (pendingOrder) { _supabase.rpc('order_validate', { p_id: pendingOrder.id, p_invoice: inv.id }); pendingOrder = null; $('retraitMsg').textContent = ''; }
  } catch (err) {
    const dup = /duplicate|unique/i.test(err.message) ? ' (ce numéro existe déjà, change-le)' : '';
    setStatus('invoiceStatus', 'Erreur : ' + err.message + dup, 'err');
  } finally { btn.disabled = false; }
});

let PRINT_FMT = 'a4'; // format d'impression choisi : 'a4' ou 'ticket'
const ticketAuto = () => localStorage.getItem('tamzorya_autoticket') !== '0'; // activé par défaut
const momoTel = () => companyData?.momo ? '+' + waNumber(companyData.momo) : '';
const qrUrl = (txt, size) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=` + encodeURIComponent(txt);
function fillRdc(inv) { // RDC : QR du numéro Mobile Money marchand (zéro faute de saisie) et espace pour le code DGI
  const on = isRdc(), tel = momoTel();
  $('pRdc').hidden = !on; $('tRdc').hidden = !on; $('tMomo').hidden = on && !!tel;
  $('qrTicketBox').hidden = !(on && tel);
  if (!on) return;
  const img = $('pMomoQr'), timg = $('tMomoQr');
  [img, timg].forEach(i => { i.hidden = !tel; if (tel) { i.src = qrUrl('tel:' + tel, 150); i.onerror = () => { i.hidden = true; }; } }); // hors-ligne : le numéro écrit reste affiché
  $('pMomoTxt').textContent = companyData?.momo ? 'Mobile Money : ' + companyData.momo : 'Mobile Money : non renseigné';
  $('pCufn').textContent = inv.code_cisf || '____________________';
  $('tCufn').textContent = inv.code_cisf || '__________';
  if (tel) $('tMomo').hidden = false, $('tMomo').textContent = 'Mobile Money : ' + companyData.momo;
}
function syncPrintFormat() {
  const showing = !$('printArea').hidden && !$('page-facture').hidden;
  $('printSwitch').hidden = !showing;
  $('printA4').hidden = PRINT_FMT === 'ticket';
  $('printTicket').hidden = !(showing && PRINT_FMT === 'ticket');
  $('fmtA4').className = 'btn ' + (PRINT_FMT === 'a4' ? 'primary' : 'secondary');
  $('fmtTicket').className = 'btn ' + (PRINT_FMT === 'ticket' ? 'primary' : 'secondary');
  $('autoTicket').checked = ticketAuto();
  $('qrTicket').checked = localStorage.getItem('tamzorya_qrticket') !== '0';
}
$('fmtA4').addEventListener('click', () => { PRINT_FMT = 'a4'; syncPrintFormat(); });
$('fmtTicket').addEventListener('click', () => { PRINT_FMT = 'ticket'; syncPrintFormat(); });
$('qrTicket').addEventListener('change', () => localStorage.setItem('tamzorya_qrticket', $('qrTicket').checked ? '1' : '0'));
$('autoTicket').addEventListener('change', () => localStorage.setItem('tamzorya_autoticket', $('autoTicket').checked ? '1' : '0'));

// Ticket 58 mm : mêmes données que la facture A4, présentées en étroit
function fillTicket(inv, items, cur) {
  const ht = Number(inv.total_amount) - (Number(inv.tva_amount) || 0);
  $('tCoName').textContent = companyData?.name || 'Mon Entreprise';
  $('tCoDetails').textContent = [companyData?.address, companyData?.city, companyData?.phone ? 'Tél ' + companyData.phone : ''].filter(Boolean).join(' · ');
  $('tNif').textContent = companyData?.tax_id || '-';
  $('tRccm').textContent = companyData?.rccm || '-';
  $('tNumber').textContent = inv.number || '';
  $('tDate').textContent = new Date(inv.created_at || Date.now()).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('tClient').textContent = inv.client_name || '-';
  const tb = $('tItems'); tb.innerHTML = '';
  items.forEach(it => {
    const tr = document.createElement('tr');
    const d = document.createElement('td'); d.textContent = it.description;       // nom de l'article sur une ligne
    const sub = document.createElement('span'); sub.className = 'sub';            // détail du calcul juste dessous
    sub.textContent = `${it.quantity} x ${fmt(it.unit_price)}`; d.appendChild(sub);
    const q = document.createElement('td'); q.textContent = it.quantity;
    const t = document.createElement('td'); t.textContent = fmt(it.total_price);
    tr.append(d, q, t); tb.appendChild(tr);
  });
  $('tHT').textContent = fmt(ht);
  $('tTVAlabel').textContent = Number(inv.tva_rate) > 0 ? `TVA ${inv.tva_rate} %` : 'TVA';
  $('tTVA').textContent = fmt(Number(inv.tva_amount) || 0);
  $('tTTC').textContent = fmt(inv.total_amount); $('tCur').textContent = cur;
  $('tMomo').textContent = companyData?.momo ? 'Mobile Money : ' + companyData.momo : '';
  $('tMsg').textContent = companyData?.message || 'Merci pour votre confiance !';
}
// Bouton d'impression : le mode ticket applique la classe de dimensionnement juste avant d'imprimer
function doPrint() {
  if (PRINT_FMT !== 'ticket') { window.print(); return; }
  document.body.classList.add('print-ticket');
  const st = document.createElement('style'); st.textContent = '@page{size:58mm auto;margin:0}'; document.head.appendChild(st);
  const done = () => { document.body.classList.remove('print-ticket'); st.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// Impression automatique en arrière-plan via l'application passerelle RawBT (Android)
const asc = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[œ]/g, 'oe').replace(/[Œ]/g, 'OE').replace(/[\u202f\u00a0]/g, ' ').replace(/[^\x20-\x7E]/g, '?');
function escQr(data) { // QR généré par l'imprimante elle-même (ESC/POS), sans internet
  const len = data.length + 3, G = '\x1D(k';
  return '\x1B\x61\x01' + G + '\x04\x00\x31\x41\x32\x00' + G + '\x03\x00\x31\x43\x05' + G + '\x03\x00\x31\x45\x31'
    + G + String.fromCharCode(len % 256, Math.floor(len / 256)) + '\x31\x50\x30' + data + G + '\x03\x00\x31\x51\x30' + '\x1B\x61\x00';
}
function ticketText(inv, items) {
  const W = 32, line = '-'.repeat(W);
  const ctr = s => { s = asc(s); return s.length >= W ? s : ' '.repeat(Math.floor((W - s.length) / 2)) + s; };
  const lr = (l, r) => { l = asc(l); r = asc(r); return l.slice(0, Math.max(1, W - r.length - 1)).padEnd(W - r.length) + r; };
  const wrap = (s, w) => { const out = []; let cur = ''; asc(s).split(' ').forEach(x => { if ((cur + ' ' + x).trim().length > w) { if (cur) out.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); }); if (cur) out.push(cur); return out; };
  const cur = inv.currency || currency(), ht = Number(inv.total_amount) - (Number(inv.tva_amount) || 0);
  const L = [];
  wrap(companyData?.name || 'Mon Entreprise', W).forEach(x => L.push(ctr(x)));
  if (companyData?.phone) L.push(ctr('Tel ' + companyData.phone));
  if (companyData?.tax_id) L.push(ctr('NIF : ' + companyData.tax_id));
  if (companyData?.rccm) L.push(ctr('RCCM : ' + companyData.rccm));
  L.push(line, 'Ticket n. ' + asc(inv.number), 'Date : ' + asc(new Date(inv.created_at || Date.now()).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
    'Client : ' + asc(inv.client_name || '-'), line, lr('Designation', 'Total'));
  items.forEach(it => { wrap(it.description, W).forEach(x => L.push(x)); L.push(lr('  ' + it.quantity + ' x ' + fmt(it.unit_price), fmt(it.total_price))); });
  L.push(line, lr('Total HT', fmt(ht)), lr(Number(inv.tva_rate) > 0 ? 'TVA ' + inv.tva_rate + '%' : 'TVA', fmt(Number(inv.tva_amount) || 0)), lr('TOTAL TTC', fmt(inv.total_amount) + ' ' + cur), line);
  if (companyData?.momo) wrap('Mobile Money : ' + companyData.momo, W).forEach(x => L.push(ctr(x)));
  if (isRdc()) { // RDC : QR natif de l'imprimante (commandes ESC/POS) + code de facture normalisée
    if (momoTel() && localStorage.getItem('tamzorya_qrticket') !== '0') L.push(escQr('tel:' + momoTel()));
    L.push(ctr('CUFN : ' + asc(inv.code_cisf || '..................')));
  }
  wrap(companyData?.message || 'Merci pour votre confiance !', W).forEach(x => L.push(ctr(x)));
  return L.join('\n') + '\n\n\n';
}
function showToast(msg, actionLabel, actionFn, ms) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  if (actionLabel) { const b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel; b.addEventListener('click', () => { actionFn(); t.remove(); }); t.appendChild(b); }
  document.body.appendChild(t); setTimeout(() => t.remove(), ms || 6000);
}
function autoPrintTicket(inv, items) {
  try {
    if (!ticketAuto() || inv.doc_type !== 'facture' || profile.business_type !== 'commercant') return; // vente au comptoir uniquement
    if (!/Android/i.test(navigator.userAgent)) return;           // RawBT n'existe que sur Android
    const url = 'intent:base64,' + btoa(ticketText(inv, items)) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
    const go = () => { window.location.href = url; };
    // Message visible, puis lancement. Si Android bloque (vidage de la file sans clic), le bouton relance avec un vrai clic.
    showToast('Vente enregistrée. Impression du ticket en cours...', 'Imprimer', go, 12000);
    setTimeout(go, 550);
  } catch (e) { console.error('Ticket :', e); }                   // une panne d'imprimante ne doit jamais bloquer la vente
}

function preparePrintArea(inv, items) {
  // A. Gestion de l'affichage dynamique du logo de l'entreprise
  const logoImg = $('pCoLogo');
  if (companyData && companyData.logo_url) {
    logoImg.src = companyData.logo_url;
    logoImg.style.display = 'block';
  } else {
    logoImg.style.display = 'none';
  }

  // B. Gestion du Taux de change alternatif en bas de facture
  const cur = inv.currency || currency();
  const rate = Number(inv.rate_locked) || effRate();
  
  // Si la facture originale est en USD, on convertit en CDF. Si elle est en CDF, on convertit en USD.
  const altTotal = cur === 'USD' ? (inv.total_amount * rate) : (inv.total_amount / rate);
  const loc = (profile.currency && profile.currency !== 'USD') ? profile.currency : 'CDF';
  const altCurr = cur === 'USD' ? loc : 'USD';
  
  const altTotalEl = $('pAlternativeTotal');
  if (altTotalEl) {
    altTotalEl.textContent = `Soit environ : ${fmt(altTotal)} ${altCurr} (Taux : 1 USD = ${fmt(rate)} ${loc})`;
  }

  const vEl = $('pValidity');
  if (vEl) vEl.textContent = inv.valid_until ? `${validText(inv.valid_hours)} (jusqu'au ${new Date(inv.valid_until).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}). Prix et taux figés à la validation.` : '';

  // C. Remplissage des coordonnées de l'entreprise et du client
  $('pCoName').textContent = companyData?.name || 'Mon Entreprise';
  $('pCoDetails').textContent = [companyData?.address, companyData?.city].filter(Boolean).join(', ') +
    (companyData?.phone ? ' | Tél: ' + companyData.phone : '') +
    (companyData?.email ? ' | ' + companyData.email : '');
  $('pInvNumber').textContent = inv.number;
  $('pDocTitle').textContent = inv.doc_type === 'devis' ? 'DEVIS (PROFORMA)' : 'FACTURE';
  $('pDocTitle').style.color = $('pCoName').style.color = companyData?.brand_color || '';
  $('pInvDate').textContent = 'Date : ' + new Date(inv.created_at || Date.now()).toLocaleDateString('fr-FR');
  $('pClientName').textContent = inv.client_name;
  $('pClientDetails').textContent = 'Tél: ' + (inv.client_phone || '-') + ' | E-mail: ' + (inv.client_email || '-');

  // D. Remplissage du tableau des articles de la facture
  const tbody = $('pItemsTable');
  tbody.innerHTML = '';
  items.forEach(it => {
    const tr = document.createElement('tr');
    [it.description, it.quantity, fmt(it.unit_price), fmt(it.total_price)].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // E. Affichage du montant total final
  $('pGrandTotal').textContent = fmt(inv.total_amount);
  const sumK = k => items.filter(i => i.kind === k).reduce((a, i) => a + Number(i.total_price || 0), 0), lab = sumK('main_oeuvre'), mat = sumK('fourniture'), ex = [];
  if (Number(inv.tva_rate) > 0) ex.push(`Sous-total HT : ${fmt(inv.total_amount - inv.tva_amount)} ${cur}  ·  TVA ${inv.tva_rate} % (articles) : ${fmt(inv.tva_amount)} ${cur}  ·  Total TTC ci-dessus`);
  if (Number(inv.retenue_amount) > 0) { ex.push(`Retenue à la source DGI (${inv.retenue_pct} % de la main-d'œuvre) : −${fmt(inv.retenue_amount)} ${cur}`); ex.push(`Net à percevoir : ${fmt(Number(inv.total_amount) - Number(inv.retenue_amount))} ${cur}`); }
  if (Number(inv.labor_discount) > 0) ex.push(`Remise négociée sur la main-d'œuvre : −${fmt(inv.labor_discount)} ${cur}`);
  if (lab || mat) ex.push(`Main-d'œuvre : ${fmt(lab)} ${cur}  ·  Fournitures${inv.doc_type === 'devis' ? ' (estimation)' : ''} : ${fmt(mat)} ${cur}`);
  if (inv.doc_type === 'devis') {
    if (inv.deposit_pct || Number(inv.supplies_amount) > 0) ex.push(`À payer à l'approbation : ${fmt(depositOf(inv))} ${cur}` + (Number(inv.labor_amount) > 0 ? ` (fournitures en totalité + ${inv.deposit_pct || 0} % de la main-d'œuvre)` : ''));
    if (inv.valid_days) ex.push(`Devis valable ${inv.valid_days} jours.`);
  }
  if (inv.note) ex.push(inv.note);
  if (inv.doc_type !== 'devis' && Number(inv.paid_amount) > 0 && inv.status !== 'payée') ex.push(`Déjà payé : ${fmt(inv.paid_amount)} ${cur}  ·  Reste à payer : ${fmt(inv.total_amount - inv.paid_amount)} ${cur}`);
  if (companyData?.tax_id) ex.push('NIF : ' + companyData.tax_id + (companyData.rccm ? '  ·  RCCM : ' + companyData.rccm : ''));
  $('pExtra').textContent = ex.join('\n');
  document.querySelectorAll('.pCurr').forEach(el => el.textContent = cur);
  $('pCoMessage').textContent = (companyData?.message || 'Merci pour votre confiance !') + (companyData?.momo && !isRdc() ? '  ·  Mobile Money : ' + companyData.momo : '');
  fillRdc(inv);
  fillTicket(inv, items, cur);
  $('printArea').hidden = false;
  syncPrintFormat();
}

$('printInvoiceBtn').addEventListener('click', doPrint);
$('newInvoiceBtn').addEventListener('click', () => { localStorage.removeItem('facturix_draft'); resetInvoice(); });

/* ---------- HISTORIQUE ---------- */
async function loadHistory() {
  const box = $('historyList');
  box.innerHTML = '<p class="note">Chargement de ton historique...</p>';
  const { data, error } = await _supabase.from('invoices').select('*').eq('user_id', WID).order('created_at', { ascending: false });
  if (error) { box.innerHTML = ''; const p = document.createElement('p'); p.className = 'status err'; p.textContent = 'Erreur : ' + error.message; box.appendChild(p); return; }
  if (!data.length) { box.innerHTML = '<p class="note">Aucune facture pour le moment.</p>'; return; }
  box.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'catalog-list';
  data.filter(histMatch).forEach(inv => {
    const row = document.createElement('div');
    row.className = 'catalog-item';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = inv.number + ' — ' + inv.client_name;
    const meta = document.createElement('div');
    meta.className = 'note';
    const late = inv.doc_type !== 'devis' && inv.status !== 'payée' ? Math.floor((Date.now() - new Date(inv.created_at)) / 86400000) : 0;
    const exp = inv.doc_type === 'devis' && inv.valid_days && ['brouillon', 'envoyé', 'negociation'].includes(inv.status) && (Date.now() - new Date(inv.created_at)) / 86400000 > inv.valid_days;
    meta.textContent = (exp ? 'expiré · ' : '') + (late >= 7 ? '' + late + ' j · ' : '') + (inv.doc_type === 'devis' ? 'Devis' : 'Facture') + ' · ' + (inv.status === 'negociation' ? 'négociation' : isPrest() && inv.status === 'approuvé' ? 'en cours' : (inv.status || '')) + (inv.status === 'partielle' ? ' (reste ' + fmt(inv.total_amount - (inv.paid_amount || 0)) + ')' : '') + ' · ' + new Date(inv.created_at).toLocaleDateString('fr-FR') + ' · ' + fmt(inv.total_amount) + ' ' + (inv.currency || 'CDF');
    info.append(strong, meta);
    const view = document.createElement('button');
    view.type = 'button'; view.className = 'btn secondary'; view.textContent = 'Voir / Imprimer';
    view.addEventListener('click', () => openInvoice(inv));
    const acts = document.createElement('div');
    acts.className = 'actions';
    const isDevis = inv.doc_type === 'devis', counted = countedOf(inv), got = Number(inv.paid_amount) || 0;
    // Devis terminé = main-d'œuvre entièrement reçue : plus de WhatsApp, ni « confier à une aide », ni « main-d'œuvre reçue »
    const done = isDevis && got >= counted && (counted > 0 || inv.status === 'terminé');
    acts.append(view);
    if (!done) acts.append(mk('WhatsApp', 'success', () => sendWhatsApp(inv, false)));
    acts.append(mk('Dupliquer', 'secondary', () => duplicateDoc(inv)), mk('Copier le lien', 'secondary', () => { if (navigator.clipboard) navigator.clipboard.writeText(location.origin + location.pathname + '?d=' + inv.public_token); alert('Lien copié !'); }));
    const open = inv.status !== 'approuvé' && inv.status !== 'payée' && inv.status !== 'terminé';
    if (isDevis && (inv.status === 'approuvé' || inv.status === 'terminé') && !done) acts.append(mk("Main-d'œuvre reçue", 'primary', () => recordLabor(inv)), mk('Confier à une aide', 'secondary', () => missionFromDevis(inv)));
    if (inv.doc_type === 'devis' && inv.status === 'negociation') acts.append(mk('Négociation', 'primary', () => openNego(inv)));
    if (inv.client_phone) acts.append(mk('Appeler', 'secondary', () => { location.href = 'tel:' + inv.client_phone.replace(/\s/g, ''); }));
    if (inv.doc_type === 'devis' && open && inv.status !== 'negociation') acts.append(mk('Approuver', 'primary', () => approveQuote(inv)));
    if (open || (isDevis && inv.status === 'terminé' && !done)) acts.append(mk('Rappel', 'secondary', () => { if (needPro('Les relances WhatsApp')) sendWhatsApp(inv, true); }));
    if (inv.doc_type !== 'devis' && open) acts.append(mk('Paiement', 'primary', () => recordPayment(inv)));
    if (inv.doc_type !== 'devis' && open) acts.append(mk('Payée', 'secondary', async () => { await _supabase.from('invoices').update({ status: 'payée' }).eq('id', inv.id); loadHistory(); }));
    row.append(info, acts);
    list.appendChild(row);
  });
  box.appendChild(list);
}

async function openInvoice(inv) {
  const { data: items, error } = await _supabase.from('invoice_items').select('*').eq('invoice_id', inv.id);
  if (error) { alert('Erreur : ' + error.message); return; }
  setPage('facture');
  preparePrintArea(inv, items || []);
  $('printInvoiceBtn').hidden = false;
  $('newInvoiceBtn').hidden = false;
  $('printArea').scrollIntoView({ behavior: 'smooth' });
}

function periodStart() {
  const p = $('dashPeriod').value, now = new Date();
  if (p === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (p === 'year') return new Date(now.getFullYear(), 0, 1);
  return null; // depuis le début
}

async function loadDashboard() {
  const cdfEl = $('dashTotalCDF');
  const usdEl = $('dashTotalUSD');
  const countEl = $('dashCount');
  
  if (countEl) countEl.textContent = "Calcul en cours...";

  try {
    // Récupère le montant et la devise de toutes les factures de l'utilisateur connecté
    let q = _supabase.from('invoices').select('total_amount, currency, status, client_name, paid_amount, labor_amount, supplies_amount, own_supplies').eq('user_id', WID).eq('doc_type', isPrest() ? 'devis' : 'facture');
    if (isPrest()) q = q.in('status', ['approuvé', 'terminé']);
    const start = periodStart();
    if (start) q = q.gte('created_at', start.toISOString());
    const { data, error } = await q;

    if (error) throw error;

    let totalCDF = 0;
    let totalUSD = 0;

    if (data) {
      data.forEach(inv => {
        if (inv.currency === 'USD') {
          totalUSD += revOf(inv);
        } else {
          totalCDF += revOf(inv);
        }
      });
    }

    if (cdfEl) cdfEl.textContent = fmt(totalCDF) + ' ' + locCur();
    if (usdEl) usdEl.textContent = fmt(totalUSD) + ' USD';
    if (countEl) countEl.textContent = `${data ? data.length : 0} ${isPrest() ? 'mission(s)' : 'facture(s)'} sur la période.`;
    // RDC : épargne conseillée pour l'Impôt Synthétique (1 % du chiffre d'affaires de la période, dans ta monnaie)
    const tb = $('dashTaxBox');
    if (tb) {
      tb.hidden = !isRdc();
      if (isRdc()) {
        const r = effRate(), usdMain = currency() === 'USD';
        const ca = usdMain ? totalUSD + totalCDF / r : totalCDF + totalUSD * r;
        $('dashTax').textContent = `${fmt(ca * SYNTH_PCT / 100)} ${usdMain ? 'USD' : locCur()}`;
      }
    }
    await loadDashboardExpenses(totalCDF, totalUSD);
    showCash(isPrest() ? (data || []).map(r => ({ ...r, total_amount: countedOf(r) })) : data);
    await loadAdvanced();

  } catch (err) {
    if (countEl) countEl.textContent = "Erreur de chargement : " + err.message;
  }
}


/* ---------- DÉPENSES ---------- */
const todayStr = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-JJ
const expenseHint = msg => /expenses|relation|schema cache/i.test(msg) ? ' (crée d\'abord la table « expenses » dans Supabase)' : '';

async function loadExpenses() {
  if (!$('expDate').value) $('expDate').value = todayStr();
  const list = $('expenseList');
  list.innerHTML = '<p class="note">Chargement...</p>';
  const { data, error } = await _supabase.from('expenses').select('*').eq('user_id', WID)
    .order('expense_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) { list.innerHTML = ''; setStatus('expenseStatus', 'Erreur : ' + error.message + expenseHint(error.message), 'err'); return; }

  const totals = { CDF: 0, USD: 0 };
  (data || []).forEach(x => { totals[x.currency === 'USD' ? 'USD' : 'CDF'] += Number(x.amount) || 0; });
  $('expenseTotals').textContent = 'Total des dépenses : ' + fmt(totals.CDF) + ' ' + locCur() + ' · ' + fmt(totals.USD) + ' USD';

  list.innerHTML = '';
  if (!data.length) { list.innerHTML = '<p class="note">Aucune dépense enregistrée.</p>'; return; }
  data.forEach(x => {
    const row = document.createElement('div');
    row.className = 'catalog-item';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = x.description;
    const meta = document.createElement('div');
    meta.className = 'note';
    meta.textContent = new Date(x.expense_date + 'T00:00:00').toLocaleDateString('fr-FR') + ' · ' + (x.category || 'Autre') + ' · ' + fmt(x.amount) + ' ' + (x.currency || 'CDF');
    info.append(strong, meta);
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn danger'; del.textContent = 'Supprimer';
    del.addEventListener('click', async () => {
      if (!confirm('Supprimer cette dépense ?')) return;
      const { error } = await _supabase.from('expenses').delete().eq('id', x.id);
      if (error) { setStatus('expenseStatus', 'Erreur : ' + error.message, 'err'); return; }
      loadExpenses();
    });
    row.append(info, del);
    list.appendChild(row);
  });
}

$('expenseForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  setStatus('expenseStatus', 'Ajout...');
  const { error } = await _supabase.from('expenses').insert([{
    user_id: WID,
    description: $('expDesc').value.trim(),
    category: $('expCategory').value,
    amount: parseFloat($('expAmount').value),
    currency: $('expCurrency').value,
    expense_date: $('expDate').value
  }]);
  btn.disabled = false;
  if (error) { setStatus('expenseStatus', 'Erreur : ' + error.message + expenseHint(error.message), 'err'); return; }
  $('expDesc').value = ''; $('expAmount').value = '';
  setStatus('expenseStatus', 'Dépense ajoutée !', 'ok');
  loadExpenses();
});

async function loadDashboardExpenses(salesCDF, salesUSD) {
  let expCDF = 0, expUSD = 0;
  try {
    let q = _supabase.from('expenses').select('amount, currency').eq('user_id', WID);
    const start = periodStart();
    if (start) q = q.gte('expense_date', start.toLocaleDateString('en-CA'));
    const { data, error } = await q;
    if (error) throw error;
    (data || []).forEach(x => { if (x.currency === 'USD') expUSD += Number(x.amount) || 0; else expCDF += Number(x.amount) || 0; });
  } catch (err) { /* table absente : on affiche 0 */ }
  $('dashExpCDF').textContent = fmt(expCDF) + ' ' + locCur();
  $('dashExpUSD').textContent = fmt(expUSD) + ' USD';
  const setProfit = (id, val, cur) => {
    const el = $(id);
    el.textContent = fmt(val) + ' ' + cur;
    el.style.color = val < 0 ? 'var(--red)' : 'var(--green)';
  };
  setProfit('dashProfitCDF', salesCDF - expCDF, locCur());
  setProfit('dashProfitUSD', salesUSD - expUSD, 'USD');
}

/* ---------- PROFIL, PLANS, WHATSAPP ---------- */
const COUNTRIES = { 'RDC':'CDF','Congo-Brazzaville':'XAF','Cameroun':'XAF','Gabon':'XAF','Sénégal':'XOF',"Côte d'Ivoire":'XOF','Mali':'XOF','Bénin':'XOF','Nigeria':'NGN','Ghana':'GHS','Kenya':'KES','Tanzanie':'TZS','Ouganda':'UGX','Rwanda':'RWF','Afrique du Sud':'ZAR','Maroc':'MAD','Égypte':'EGP','Togo':'XOF','Burkina Faso':'XOF','Niger':'XOF','Guinée':'GNF','Tchad':'XAF','Centrafrique':'XAF','Burundi':'BIF','Madagascar':'MGA','Zambie':'ZMW','Angola':'AOA','Éthiopie':'ETB','Tunisie':'TND','Algérie':'DZD','Autre pays':'USD' };
const LIMITS = { facture: 10, devis: 5 }; // plan gratuit, par mois
const TIERS = {
  gratuit: { name: 'Gratuit', m: 0, y: 0, estab: 1, employees: 0, associes: 0, ai: 3 },
  standard: { name: 'Standard', m: 2, y: 20, estab: 2, employees: 2, associes: 2, ai: 100 },
  diamant: { name: 'Diamant', m: 5, y: 50, estab: 5, employees: 20, associes: 10, ai: 300 },
  platine: { name: 'Platine', m: 10, y: 100, estab: 15, employees: 30, associes: 20, ai: 300 }
};
// plan réellement actif (le plan « pro » technique devient un des 3 plans payants ; expiré = gratuit)
const curTier = () => profile.plan === 'pro' ? ((profile.plan_type && profile.plan_type !== 'gratuit') ? profile.plan_type : 'standard') : 'gratuit';
// fenêtre contextuelle : seulement au moment où une limite est atteinte
function upgradePopup(msg, target) {
  if (!target) { alert(msg); return; }
  const t = TIERS[target];
  if (confirm(`${msg}\n\nPasser au plan ${t.name} (${t.m} $/mois ou ${t.y} $/an) ?`)) { payTier = target; setPage('pro'); }
}
const ADMIN_WA = '243977790082'; // WhatsApp pour les abonnements PRO
const PAY = [['M-Pesa', '0811116506'], ['Airtel Money', '0977790082'], ['Orange Money', '0851405180']]; // numéros de paiement PRO
let profile = { business_type: 'commercant', plan: 'free', currency: 'CDF', country: 'RDC' };
Object.keys(COUNTRIES).forEach(c => $('authCountry').appendChild(new Option(c, c)));
// Pays proposé d'après le fuseau horaire de l'appareil (aucun service externe, rien n'est envoyé)
const TZ_COUNTRY = { 'Africa/Kinshasa': 'RDC', 'Africa/Lubumbashi': 'RDC', 'Africa/Brazzaville': 'Congo-Brazzaville', 'Africa/Douala': 'Cameroun', 'Africa/Libreville': 'Gabon', 'Africa/Dakar': 'Sénégal', 'Africa/Abidjan': "Côte d'Ivoire", 'Africa/Bamako': 'Mali', 'Africa/Porto-Novo': 'Bénin', 'Africa/Lagos': 'Nigeria', 'Africa/Accra': 'Ghana', 'Africa/Nairobi': 'Kenya', 'Africa/Dar_es_Salaam': 'Tanzanie', 'Africa/Kampala': 'Ouganda', 'Africa/Kigali': 'Rwanda', 'Africa/Johannesburg': 'Afrique du Sud', 'Africa/Casablanca': 'Maroc', 'Africa/Cairo': 'Égypte', 'Africa/Lome': 'Togo', 'Africa/Ouagadougou': 'Burkina Faso', 'Africa/Niamey': 'Niger', 'Africa/Conakry': 'Guinée', 'Africa/Ndjamena': 'Tchad', 'Africa/Bangui': 'Centrafrique', 'Africa/Bujumbura': 'Burundi', 'Indian/Antananarivo': 'Madagascar', 'Africa/Lusaka': 'Zambie', 'Africa/Luanda': 'Angola', 'Africa/Addis_Ababa': 'Éthiopie', 'Africa/Tunis': 'Tunisie', 'Africa/Algiers': 'Algérie' };
try { const g = TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone]; if (g && COUNTRIES[g]) $('authCountry').value = g; } catch (_) { /* pays choisi à la main */ }
const dialNote = () => { const c = $('authCountry').value; $('authDial').textContent = `Indicatif téléphonique : +${CALLCODE[c] || '?'} · Devise : ${COUNTRIES[c] || 'USD'} (la conversion en dollar reste disponible)`; };
$('authCountry').addEventListener('change', dialNote);
$('coCurrency').innerHTML = [...new Set(['USD', ...Object.values(COUNTRIES)])].map(c => `<option value="${c}">${c}</option>`).join('');

async function loadProfile0() {
  const md = currentUser.user_metadata || {};
  const get = () => _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  let { data } = await get();
  // Le type choisi à l'inscription fait foi : si la base n'est pas d'accord, elle se resynchronise
  if (!data || (md.business_type && md.business_type !== data.business_type)) {
    await _supabase.rpc('sync_my_profile');
    data = (await get()).data || data;
  }
  if (data) { profile = { ...profile, ...data }; if (md.business_type === 'normal') profile.business_type = 'normal'; return; }
  // Secours (SQL pas encore lancé) : valeurs de l'inscription, sans rien enregistrer
  const c = COUNTRIES[md.country] ? md.country : 'RDC';
  profile = { ...profile, business_type: md.business_type || 'commercant', country: c, currency: COUNTRIES[c], plan: 'free' };
}

function applyProfile() {
  if (!companyData || !companyData.currency) { companyData = { ...(companyData || {}), currency: profile.currency }; $('coCurrency').value = profile.currency; applyCurrency(); }
  const until = profile.plan_until ? new Date(profile.plan_until) : null;
  if (profile.plan === 'pro' && until && until < new Date()) profile.plan = 'free'; // PRO terminé
  const pro = profile.plan === 'pro', prest = profile.business_type === 'prestataire', normal = profile.business_type === 'normal';
  const days = pro && until ? Math.ceil((until - new Date()) / 86400000) : null;
  $('docTypeField').hidden = true;
  $('validField').hidden = !pro;
  $('voiceBox').hidden = !(['commercant', 'prestataire'].includes(profile.business_type) && ROLE !== 'aide');
  $('retenueBox').hidden = !(prest && isRdc()); $('cufnBox').hidden = !isRdc();
  if ($('retenuePct')) $('retenuePct').textContent = RETENUE_PCT;
  $('retraitBox').hidden = profile.business_type !== 'commercant';
  ['catalogSelect', 'addCatalogBtn', 'addCustomBtn'].forEach(i => $(i).hidden = prest);
  $('addLaborBtn').hidden = $('addMaterialBtn').hidden = !prest;
  $('coColor').disabled = $('coTax').disabled = $('coRccm').disabled = !pro;
  $('catSearch').hidden = prest;
  showUsage();
  document.querySelector('.nav button').textContent = prest ? 'Nouveau devis' : 'Nouvelle facture';
  document.querySelector('.nav button[data-page="historique"]').textContent = prest ? 'Mes devis' : 'Mes factures';
  document.querySelectorAll('.salesLbl').forEach(e => e.textContent = prest ? "Main-d'œuvre reçue" : 'Total Ventes');
  $('cashTitle').textContent = prest ? "Main-d'œuvre : reçu / à recevoir" : 'Encaissé / À encaisser';
  if (prest) $('histFilter').innerHTML = '<option value="">Tout</option><option value="attente">En attente de réponse</option><option value="cours">En cours</option><option value="fini">Terminés</option>';
  $('inviteRole').innerHTML = prest ? '<option value="aide">Aide / personnel</option>' : '<option value="vendeur">Vendeur</option><option value="associe">Associé</option>';
  $('teamHelp').textContent = prest ? "Crée un code pour une aide (personnel). Elle crée son compte avec ce code, puis ne voit que ses propres devis : jamais tes revenus ni tes dépenses." : $('teamHelp').textContent;
  $('proListCom').hidden = prest; $('proListPrest').hidden = !prest;
  $('planBar').textContent = pro ? (`Plan ${TIERS[curTier()].name} ` + (profile.statut_abonnement === 'essai' ? ' · essai gratuit' : '') + (until ? ` · jusqu'au ${until.toLocaleDateString('fr-FR')}` : '') + (days !== null && days <= 5 ? ` fin dans ${days} jour(s)` : '')) : (prest ? `Plan Gratuit · ${LIMITS.devis} devis par mois` : `Plan Gratuit · ${LIMITS.facture} factures par mois`);
  if (ROLE !== 'owner') $('planBar').textContent = `${ROLE === 'vendeur' ? 'Vendeur' : ROLE === 'aide' ? 'Aide' : 'Associé'} · ${companyData?.name || 'ton entreprise'}`;
  if (normal) {
    $('planBar').textContent = 'Espace particulier · trouve des matériaux et des artisans';
    const mb = document.querySelector('.nav button[data-page="mentor"]'); if (mb) mb.textContent = 'Assistant d\'achat';
  }
  $('proBtn').hidden = normal || ROLE !== 'owner' || (pro && !(days !== null && days <= 7));
  $('proBtn').textContent = pro ? 'Renouveler / changer' : 'Passer à un plan payant';
  const hide = normal ? ['facture', 'historique', 'entreprise', 'catalogue', 'depenses', 'dashboard', 'equipe', 'missions', 'pro']
    : ROLE === 'aide' ? ['facture', 'historique', 'entreprise', 'catalogue', 'depenses', 'dashboard', 'equipe', 'mentor', 'pro', 'annuaire', 'chat', 'commandes']
    : ROLE === 'vendeur' ? ['entreprise', 'catalogue', 'depenses', 'dashboard', 'equipe', 'mentor', 'missions', 'pro', 'annuaire', 'chat', 'commandes']
    : ROLE === 'associe' ? ['equipe'] : [];
  document.querySelectorAll('.nav button').forEach(b => b.hidden = hide.includes(b.dataset.page) || (prest && b.dataset.page === 'catalogue') || (b.dataset.action === 'dictee' && !(['commercant', 'prestataire'].includes(profile.business_type) && ROLE !== 'aide' && ROLE !== 'vendeur')) || (b.dataset.page === 'admin' && !IS_ADMIN) || (b.dataset.page === 'recues' && (profile.business_type !== 'commercant' || ROLE === 'aide' || ROLE === 'vendeur')));
  syncTopbar();
}

function needPro(what) {
  if (profile.plan === 'pro') return true;
  alert(what + ' : fonction des plans payants. Appuie sur « Passer à un plan payant » en haut.');
  return false;
}

async function checkLimit(type) {
  if (profile.plan === 'pro') return '';
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  const { count } = await _supabase.from('invoices').select('id', { count: 'exact', head: true })
    .eq('user_id', WID).eq('doc_type', type).gte('created_at', start);
  if ((count || 0) < LIMITS[type]) return '';
  const msg = `Plan Gratuit : ${LIMITS[type]} ${type === 'devis' ? 'devis' : 'factures'} par mois, c'est la limite atteinte.`;
  upgradePopup(msg, 'standard'); // Gratuit → Standard
  return msg;
}

const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = txt; b.addEventListener('click', fn); return b; };

function sendWhatsApp(inv, reminder, mode) {
  const link = location.origin + location.pathname + '?d=' + inv.public_token;
  const isQ = inv.doc_type === 'devis', nom = isQ ? 'devis' : 'facture', pro = profile.plan === 'pro';
  const co = companyData?.name || 'notre entreprise', momo = companyData?.momo, cur = inv.currency || currency();
  const tot = Number(inv.total_amount) || 0, paid = Number(inv.paid_amount) || 0, due = tot - paid;
  const hello = pro && inv.client_name ? `Bonjour ${inv.client_name},` : 'Bonjour,';
  const pay = pro && momo ? `\nPaiement Mobile Money : ${momo} (${co})` : '';
  let txt;
  if (mode === 'recu') txt = `${hello}\nNous confirmons la réception de ${fmt(paid)} ${cur} pour la ${nom} n°${inv.number}. ` + (due > 0 ? `Reste à payer : ${fmt(due)} ${cur}.${pay}` : 'Elle est entièrement réglée. Merci pour votre confiance !') + `\n${link}`;
  else if (reminder) txt = `${hello}\nRappel : votre ${nom} n°${inv.number} est en attente` + (!isQ && paid > 0 ? ` (reste ${fmt(due)} ${cur})` : '') + `. Merci de régulariser.${pay}\n${link}`;
  else if (isQ) txt = `${hello}\nVoici votre devis n°${inv.number} de la part de ${co} : ${fmt(tot)} ${cur}.` + (pro && inv.deposit_pct ? `\nPour démarrer : ${fmt(depositOf(inv))} ${cur} à l'approbation (fournitures en totalité + ${inv.deposit_pct || 0} % de la main-d'œuvre).` : '') + `${pay}\nAccepte-le ou propose ton prix ici : ${link}`;
  else txt = `${hello}\nVoici votre facture n°${inv.number} de la part de ${co} : ${fmt(tot)} ${cur}.${pay}\nConsultez-la ici : ${link}`;
  const ph = (inv.client_phone || '').trim();
  const to = waNumber(ph);
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(txt)}`, '_blank');
  if (isQ && inv.status === 'brouillon') _supabase.from('invoices').update({ status: 'envoyé' }).eq('id', inv.id).then(loadHistory);
}

async function recordPayment(inv) {
  if (!needPro('Le suivi des acomptes et paiements')) return;
  const due = inv.total_amount - (inv.paid_amount || 0);
  const a = parseFloat(prompt(`Montant reçu (reste à payer : ${fmt(due)} ${inv.currency}) :`));
  if (!(a > 0)) return;
  const paid = Math.min(inv.total_amount, (Number(inv.paid_amount) || 0) + a), status = paid >= inv.total_amount ? 'payée' : 'partielle';
  const { error } = await _supabase.from('invoices').update({ paid_amount: paid, status }).eq('id', inv.id);
  if (error) { alert('Erreur : ' + error.message); return; }
  if (confirm('Paiement enregistré. Envoyer un reçu au client sur WhatsApp ?')) sendWhatsApp({ ...inv, paid_amount: paid, status }, false, 'recu');
  loadHistory();
}

async function approveQuote(inv) {
  if (isPrest()) {
    const { error } = await _supabase.from('invoices').update({ status: 'approuvé' }).eq('id', inv.id);
    alert(error ? 'Erreur : ' + error.message : 'Devis approuvé : la mission est en cours.' + (inv.deposit_pct ? ` Acompte attendu : ${fmt(depositOf(inv))} ${inv.currency}.` : ''));
    loadHistory(); return;
  }
  if (!needPro('La conversion automatique en facture')) return;
  const { error } = await _supabase.rpc('convert_quote', { p_id: inv.id });
  alert(error ? 'Erreur : ' + error.message : 'Devis approuvé : la facture a été créée automatiquement !' + (inv.deposit_pct ? ` Acompte attendu : ${fmt(depositOf(inv))} ${inv.currency}.` : ''));
  loadHistory();
}

$('docType').addEventListener('change', generateInvoiceNumber);
$('proBtn').addEventListener('click', () => setPage('pro'));
$('forgotBtn').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if (!email) { setStatus('authMessage', 'Écris d\'abord ton e-mail ci-dessus.', 'err'); return; }
  const { error } = await _supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  setStatus('authMessage', error ? error.message : 'Un lien de réinitialisation t\'a été envoyé par e-mail.', error ? 'err' : 'ok');
});
let recovering = /type=recovery/.test(location.hash + location.search);

/* ---------- CONFIRMATION D'E-MAIL (écran Tamzorya) ---------- */
const hashP = new URLSearchParams(location.hash.replace(/^#/, ''));
const confirmErr = hashP.get('error_code') || '';
const confirming = ['signup', 'email_change', 'invite'].includes(hashP.get('type')) || new URLSearchParams(location.search).get('confirmed') === '1';
$('resendBtn').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if (!email) { setStatus('authMessage', 'Écris ton e-mail ci-dessus.', 'err'); return; }
  const { error } = await _supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + location.pathname } });
  setStatus('authMessage', error ? error.message : 'Nouvel e-mail envoyé. Vérifie aussi tes courriers indésirables.', error ? 'err' : 'ok');
});
function confirmScreen(icon, title, text, goLabel, goFn) {
  $('authView').hidden = true; $('splash').hidden = true; $('appView').hidden = true; $('confirmView').hidden = false;
  $('confirmIcon').textContent = icon; $('confirmTitle').textContent = title; $('confirmText').textContent = text;
  $('confirmGo').textContent = goLabel; $('confirmGo').onclick = goFn;
}
async function showConfirm() {
  const toLogin = () => { $('confirmView').hidden = true; $('authView').hidden = false; setAuthMode(false); };
  history.replaceState(null, '', location.pathname); // enlève les jetons de l'adresse
  if (confirmErr) {
    confirmScreen('', 'Lien expiré ou déjà utilisé', 'Ce lien de confirmation ne fonctionne plus. Connecte-toi : si ton compte n\'est pas encore confirmé, tu pourras recevoir un nouvel e-mail.', 'Aller à la connexion', toLogin);
    return;
  }
  let session = null;
  try { session = (await _supabase.auth.getSession()).data.session; } catch (_) { /* pas de session */ }
  if (session) confirmScreen('', 'E-mail confirmé !', 'Bienvenue sur Tamzorya. Ton compte est activé.', 'Ouvrir mon espace', async () => { $('confirmView').hidden = true; currentUser = session.user; await openApp(); });
  else confirmScreen('', 'E-mail confirmé !', 'Ton compte est activé. Connecte-toi pour entrer dans ton espace.', 'Me connecter', toLogin);
}
function showReset() { recovering = true; $('authView').hidden = true; $('appView').hidden = true; $('resetView').hidden = false; }
_supabase.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') showReset(); });
$('resetForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('newPw').value !== $('newPw2').value) { setStatus('resetMsg', 'Les deux mots de passe sont différents.', 'err'); return; }
  setStatus('resetMsg', 'Enregistrement...');
  const { error } = await _supabase.auth.updateUser({ password: $('newPw').value });
  if (error) { setStatus('resetMsg', /session/i.test(error.message) ? 'Lien expiré : redemande « Mot de passe oublié ».' : error.message, 'err'); return; }
  setStatus('resetMsg', 'Mot de passe changé ! Retour à la connexion...', 'ok');
  await _supabase.auth.signOut();
  setTimeout(() => { location.href = location.origin + location.pathname; }, 1200);
});

async function showPublic(token) {
  $('authView').hidden = true; $('appView').hidden = false;
  document.querySelectorAll('.topline,.nav,section.card:not(#page-facture)').forEach(e => e.hidden = true);
  document.querySelector('#page-facture > .no-print').hidden = true;
  const { data, error } = await _supabase.rpc('get_public_doc', { p_token: token });
  if (error || !data || !data.doc) { alert('Document introuvable.'); return; }
  companyData = data.company || {};
  profile = { ...profile, currency: data.doc.currency !== 'USD' ? data.doc.currency : 'CDF' };
  preparePrintArea(data.doc, data.items);
  const bar = document.createElement('div');
  bar.className = 'actions no-print'; bar.style.marginTop = '16px';
  bar.append(mk('Imprimer / PDF', 'primary', () => window.print()));
  const d = data.doc, offers = data.offers || [], lastO = offers[offers.length - 1], open = d.doc_type === 'devis' && !['approuvé', 'terminé'].includes(d.status);
  if (offers.length) {
    const t = document.createElement('div'); t.className = 'note no-print'; t.style.cssText = 'white-space:pre-wrap;margin-top:12px';
    t.textContent = 'Négociation :\n' + offers.map(o => `${o.side === 'client' ? 'Toi' : 'Prestataire'} : ${fmt(o.amount)} ${d.currency}${o.message ? ' — ' + o.message : ''}`).join('\n');
    $('page-facture').appendChild(t);
  }
  if (open) {
    if (lastO && lastO.side === 'prestataire') bar.append(mk(`J'accepte ${fmt(lastO.amount)} ${d.currency}`, 'success', async () => {
      const { error } = await _supabase.rpc('client_accept_offer', { p_token: token });
      alert(error ? 'Erreur : ' + error.message : "Merci ! C'est accepté, le prestataire est informé.");
      if (!error) location.reload();
    }));
    bar.append(mk("J'accepte le prix du devis", lastO ? 'secondary' : 'success', async () => {
      const { error } = await _supabase.rpc('approve_public_quote', { p_token: token });
      alert(error ? 'Erreur : ' + error.message : 'Merci ! Le prestataire est informé.');
    }));
    bar.append(mk('Je propose un autre prix', 'secondary', async () => {
      const base = Number(d.labor_orig ?? d.labor_amount) || 0, idea = Math.round(base * 0.9 / 100) * 100;
      const a = parseFloat(prompt(`Main-d'œuvre demandée : ${fmt(base)} ${d.currency}.\nTon prix proposé pour la main-d'œuvre (idée : -10 %) :`, idea));
      if (!(a > 0)) return;
      const msg = prompt('Un petit mot pour le prestataire (facultatif) :') || '';
      const { error } = await _supabase.rpc('submit_offer', { p_token: token, p_amount: a, p_message: msg });
      if (error) { alert('Erreur : ' + error.message); return; }
      if (confirm('Proposition envoyée Prévenir le prestataire sur WhatsApp ?')) window.open(`https://wa.me/${waNumber(companyData?.phone)}?text=` + encodeURIComponent(`Bonjour, pour le devis n°${d.number}, je propose ${fmt(a)} ${d.currency} pour la main-d'œuvre.${msg ? ' ' + msg : ''}`), '_blank');
      location.reload();
    }));
  }
  $('page-facture').appendChild(bar);
}

/* ---------- ÉQUIPE, STOCK, OBJECTIF, GRAPHIQUE, HORS-LIGNE ---------- */
async function loadProfile() {
  const code = (currentUser.user_metadata?.team_code || '').trim();
  const getTm = () => _supabase.from('team_invites').select('owner_id, role').eq('member_id', currentUser.id).maybeSingle();
  const [, tmRes] = await Promise.all([loadProfile0(), getTm()]);
  WID = currentUser.id; ROLE = 'owner'; LOCKED = false;
  let tm = tmRes.data;
  if (!tm && code) { const j = (await _supabase.rpc('join_team', { p_code: code })).data; if (j) tm = (await getTm()).data; }
  if (code && !tm) alert('Code équipe invalide ou déjà utilisé. Demande un nouveau code à ton patron.');
  if (tm) {
    WID = tm.owner_id; ROLE = tm.role;
    const { data: op } = await _supabase.from('profiles').select('plan, plan_until, business_type, currency, country').eq('id', WID).maybeSingle();
    if (op) profile = { ...profile, ...op };
    LOCKED = !(op && op.plan === 'pro' && (!op.plan_until || new Date(op.plan_until) > new Date()));
    if (!LOCKED) { const { data: tc } = await _supabase.rpc('team_company'); if (tc) companyData = tc; }
  }
}

async function loadTeam() {
  const box = $('teamList'); box.innerHTML = '';
  const { data } = await _supabase.from('team_invites').select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false });
  (data || []).forEach(t => {
    const row = document.createElement('div'); row.className = 'catalog-item';
    const info = document.createElement('div');
    info.textContent = `${t.code} · ${t.role === 'vendeur' ? 'Vendeur' : t.role === 'aide' ? 'Aide' : 'Associé'} · ${t.member_id ? 'connecté ' : 'en attente'}`;
    row.append(info, mk('Retirer', 'danger', async () => { await _supabase.from('team_invites').delete().eq('code', t.code); loadTeam(); }));
    box.appendChild(row);
  });
}
$('inviteBtn').addEventListener('click', async () => {
  if (!(await teamGate($('inviteRole').value))) return;
  const AL = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
  const code = [...crypto.getRandomValues(new Uint8Array(6))].map(n => AL[n % AL.length]).join('');
  const { error } = await _supabase.from('team_invites').insert([{ code, owner_id: currentUser.id, role: $('inviteRole').value }]);
  if (error) alert(error.message); else { alert('Code équipier : ' + code + '\nIl doit cocher « J\'ai un code équipe » en créant son compte.'); loadTeam(); }
});

async function buyStock(item) {
  const q = parseFloat(prompt('Quantité achetée de « ' + itemName(item) + ' » :'));
  if (!(q > 0)) return;
  const cost = parseFloat(prompt('Prix d\'achat total (' + currency() + ') — laisse vide si inconnu :')) || 0;
  await _supabase.from('catalog').update({ stock: (Number(item.stock) || 0) + q }).eq('id', item.id);
  if (cost > 0) await _supabase.from('expenses').insert([{ user_id: WID, description: 'Achat ' + itemName(item), category: 'Achat de marchandises', amount: cost, currency: currency(), expense_date: todayStr() }]);
  loadCatalog();
}

async function decStock() {
  const items = [...document.querySelectorAll('#invoiceItemsTable tr')].map(tr => {
    const it = catalogItems.find(c => String(c.id) === tr.dataset.cid);
    return it && it.stock != null ? { id: String(it.id), qty: parseFloat(tr.querySelector('.row-qty').value) || 0 } : null;
  }).filter(Boolean);
  if (items.length) await _supabase.rpc('adjust_stock', { p_items: items });
  loadCatalog();
}

async function loadAdvanced() {
  const cur = currency(), now = new Date(), pro = profile.plan === 'pro';
  const months = [...Array(6)].map((_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
  const idx = d => months.findIndex(m => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
  const [inv, exp] = await Promise.all([
    _supabase.from('invoices').select('client_name,total_amount,currency,created_at,paid_amount,labor_amount,supplies_amount,own_supplies').eq('user_id', WID).eq('doc_type', isPrest() ? 'devis' : 'facture').gte('created_at', months[0].toISOString()),
    _supabase.from('expenses').select('amount,currency,expense_date').eq('user_id', WID).gte('expense_date', months[0].toLocaleDateString('en-CA'))
  ]);
  const net = [0, 0, 0, 0, 0, 0], sales = [0, 0, 0, 0, 0, 0], clients = {};
  (inv.data || []).forEach(r => { if (r.currency !== cur) return; const i = idx(new Date(r.created_at)); if (i < 0) return; const v = revOf(r); sales[i] += v; net[i] += v; clients[r.client_name] = (clients[r.client_name] || 0) + v; });
  (exp.data || []).forEach(r => { if (r.currency !== cur) return; const i = idx(new Date(r.expense_date + 'T00:00:00')); if (i >= 0) net[i] -= Number(r.amount) || 0; });
  const goal = Number(companyData?.goal) || 0, pct = goal ? Math.min(100, Math.round(sales[5] / goal * 100)) : 0;
  $('goalBar').style.width = pct + '%';
  $('goalText').textContent = goal ? `${fmt(sales[5])} / ${fmt(goal)} ${cur} (${pct} %)` : 'Aucun objectif défini.';
  $('goalBtn').hidden = ROLE === 'vendeur' || ROLE === 'aide';
  const mfr = months.map(m => m.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })), parMois = {};
  mfr.forEach((n, i) => { parMois[n] = { revenu_ou_ventes: Math.round(sales[i]), benefice_net: Math.round(net[i]) }; });
  lastStats = {
    aujourd_hui: now.toLocaleDateString('fr-FR'), type_activite: isPrest() ? "prestataire de services (revenu = main-d'œuvre reçue)" : 'commerçant', devise: cur,
    mois_en_cours: mfr[5], mois_precedent: mfr[4], par_mois: parMois,
    meilleurs_clients: Object.entries(clients).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nom, total]) => ({ nom, total: Math.round(total) })),
    objectif_du_mois: goal, articles_stock_bas: catalogItems.filter(c => c.stock != null && c.stock <= 3).map(c => itemName(c))
  };
  $('proDashBox').hidden = !pro; $('proLock').hidden = pro;
  if (!pro) return;
  loadProStats();
  const max = Math.max(1, ...net.map(Math.abs));
  $('profitChart').innerHTML = net.map((v, i) => {
    const h = Math.round(Math.abs(v) / max * 45), y = v >= 0 ? 55 - h : 55;
    return `<rect x="${i * 50 + 10}" y="${y}" width="30" height="${h}" rx="3" fill="${v >= 0 ? '#16865b' : '#bd3542'}"/><text x="${i * 50 + 25}" y="115" font-size="10" text-anchor="middle" fill="#6b7a90">${months[i].toLocaleDateString('fr-FR', { month: 'short' })}</text><text x="${i * 50 + 25}" y="${v >= 0 ? y - 3 : y + h + 11}" font-size="8" text-anchor="middle" fill="#253449">${Math.round(v).toLocaleString('fr-FR')}</text>`;
  }).join('') + '<line x1="0" x2="300" y1="55" y2="55" stroke="#dce3ed"/>';
  const top = Object.entries(clients).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const box = $('topClients'); box.textContent = '';
  if (!top.length) box.textContent = 'Pas encore de ventes.';
  top.forEach(([n, v], i) => { const p = document.createElement('div'); p.textContent = `${i + 1}. ${n} — ${fmt(v)} ${cur}`; box.appendChild(p); });
}
$('goalBtn').addEventListener('click', async () => {
  const g = parseFloat(prompt('Objectif de ventes du mois (' + currency() + ') :'));
  if (!(g > 0)) return;
  const { error } = await _supabase.from('companies').update({ goal: g }).eq('id', WID);
  if (error) { alert(error.message); return; }
  companyData = { ...(companyData || {}), goal: g }; loadAdvanced();
});

async function flushQueue() {
  const q = JSON.parse(localStorage.getItem('facturix_queue') || '[]');
  if (!q.length || !navigator.onLine) return;
  const left = [];
  for (const p of q) {
    const { data: inv, error } = await _supabase.from('invoices').insert([p.inv]).select().single();
    if (error) { left.push(p); continue; }
    const { error: ie } = await _supabase.from('invoice_items').insert(p.items.map(r => ({ invoice_id: inv.id, ...r })));
    if (!ie) { autoPrintTicket(inv, p.items); if (p.order_id) _supabase.rpc('order_validate', { p_id: p.order_id, p_invoice: inv.id }); } // vente hors-ligne enfin confirmée
  }
  localStorage.setItem('facturix_queue', JSON.stringify(left));
  if (left.length < q.length) alert((q.length - left.length) + ' document(s) envoyé(s) au serveur !');
}
window.addEventListener('online', flushQueue);

/* ---------- RECHERCHE PRODUIT ---------- */
const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderChips() {
  const box = $('catalogChips'); box.innerHTML = '';
  if (isPrest()) return;
  const q = norm($('catSearch').value.trim());
  catalogItems.filter(i => !q || norm(itemName(i)).includes(q)).slice(0, 12).forEach(item => box.appendChild(mk(itemName(item), 'secondary', () => quickAdd(item))));
  if (q && !box.children.length) box.textContent = 'Aucun produit trouvé.';
}
$('catSearch').addEventListener('input', renderChips);

/* ---------- MISSIONS / JOURNÉES, RAPPORTS, BONS DE PAIEMENT ---------- */
const STEP = { envoyee: 'Envoyée', en_cours: 'En cours', terminee: 'Terminée', verifiee: 'Vérifiée', payee: 'Payée', recue: 'Reçue' };
const CALLCODE = { 'RDC': '243', 'Congo-Brazzaville': '242', 'Cameroun': '237', 'Gabon': '241', 'Sénégal': '221', "Côte d'Ivoire": '225', 'Mali': '223', 'Bénin': '229', 'Nigeria': '234', 'Ghana': '233', 'Kenya': '254', 'Tanzanie': '255', 'Ouganda': '256', 'Rwanda': '250', 'Afrique du Sud': '27', 'Maroc': '212', 'Égypte': '20', 'Togo': '228', 'Burkina Faso': '226', 'Niger': '227', 'Guinée': '224', 'Tchad': '235', 'Centrafrique': '236', 'Burundi': '257', 'Madagascar': '261', 'Zambie': '260', 'Angola': '244', 'Éthiopie': '251', 'Tunisie': '216', 'Algérie': '213' };
const waNumber = p => {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  const cc = CALLCODE[profile.country] || '';
  if (cc && d.startsWith(cc) && d.length >= cc.length + 8) return d;
  return cc ? cc + d.replace(/^0+/, '') : d;
};
const depositOf = inv => { const lab = Number(inv.labor_amount) || 0, sup = Number(inv.supplies_amount) || 0, pct = Number(inv.deposit_pct) || 0; return (lab > 0 || sup > 0) ? sup + (Number(inv.tva_amount) || 0) + lab * pct / 100 : (Number(inv.total_amount) || 0) * pct / 100; };
const isHelper = () => ROLE === 'aide' || ROLE === 'vendeur';
let pendingItems = [], pendingDevis = null, misRT = false;
const dFr = d => d ? new Date(d).toLocaleDateString('fr-FR') : '';

async function misAct(id, action) {
  const { error } = await _supabase.rpc('mission_action', { p_id: id, p_action: action });
  if (error) alert(error.message);
  loadMissions(); refreshBadge();
}
function showVoucher(m) {
  $('vText').textContent = `BON DE PAIEMENT n° ${m.voucher_no || ''}\n\nEntreprise : ${companyData?.name || ''}\nBénéficiaire : ${m.assignee_name || ''}\nObjet : ${m.title}\nMontant payé : ${fmt(m.pay_amount)} ${m.currency}\nPayé le : ${dFr(m.paid_at)}\nReçu le : ${dFr(m.received_at)}\n\nSignature : ______________________`;
  document.body.classList.add('vopen'); $('voucherArea').hidden = false;
}
$('vPrint').addEventListener('click', () => window.print());
$('vWa').addEventListener('click', () => window.open('https://wa.me/?text=' + encodeURIComponent($('vText').textContent), '_blank'));
$('vClose').addEventListener('click', () => { $('voucherArea').hidden = true; document.body.classList.remove('vopen'); });
function syncPayUI() {
  const pct = $('misPayType').value === 'percent';
  $('misPayLbl').textContent = pct ? 'Pourcentage (%)' : 'Montant';
  $('misBaseBox').hidden = !(pct && isPrest());
}
async function loadMissions() {
  const helper = isHelper(), owner = ROLE === 'owner';
  $('misTitle').textContent = helper ? (isPrest() ? 'Mes missions' : 'Ma journée') : (isPrest() ? 'Missions' : 'Journées de vente');
  $('misNew').hidden = !owner; $('misReport').hidden = !helper; $('repBox').hidden = !owner;
  if (owner) {
    $('misName').placeholder = isPrest() ? 'Ex. Peinture chez Don' : 'Ex. Vente du samedi';
    const { data: team } = await _supabase.from('team_invites').select('member_id, member_name, role').eq('owner_id', currentUser.id).not('member_id', 'is', null);
    $('misAssignee').innerHTML = '';
    (team || []).forEach(t => $('misAssignee').appendChild(new Option((t.member_name || 'Équipier') + ' (' + (t.role === 'aide' ? 'aide' : t.role === 'vendeur' ? 'vendeur' : 'associé') + ')', t.member_id)));
    if (!team || !team.length) $('misAssignee').appendChild(new Option("Crée d'abord un code dans « Équipe »", ''));
    syncPayUI();
  }
  const list = $('misList'); list.textContent = '';
  const { data } = await _supabase.from('missions').select('*').order('created_at', { ascending: false }).limit(50);
  const gb = $('gainBox'); gb.hidden = !helper;
  if (helper) { // gains à recevoir : repasse à 0 quand le paiement est confirmé (« Paiement reçu »)
    const sums = {};
    (data || []).filter(m => ['terminee', 'verifiee', 'payee'].includes(m.status)).forEach(m => {
      const v = m.pay_amount != null ? Number(m.pay_amount) : (m.pay_type === 'fixed' ? Number(m.pay_value) : 0);
      sums[m.currency || ''] = (sums[m.currency || ''] || 0) + (v || 0);
    });
    const txt = Object.entries(sums).map(([c, v]) => `${fmt(v)} ${c}`.trim()).join(' + ') || '0';
    const toConfirm = (data || []).filter(m => m.status === 'payee').length;
    gb.textContent = `Mes gains à recevoir : ${txt}\n` + (toConfirm ? `${toConfirm} paiement(s) à confirmer avec « Paiement reçu ».` : 'Le compteur repasse à 0 quand tu confirmes avoir reçu ton paiement.');
  }
  if (!data || !data.length) list.textContent = 'Aucune ' + (isPrest() ? 'mission' : 'journée') + ' pour le moment.';
  (data || []).forEach(m => {
    if (m.status === 'recue') return;
    const box = document.createElement('details'); box.open = helper && ['envoyee', 'en_cours', 'payee'].includes(m.status);
    const sum = document.createElement('summary'); sum.textContent = `${m.title} · ${STEP[m.status] || m.status}`;
    const body = document.createElement('div'); body.className = 'note'; body.style.whiteSpace = 'pre-wrap';
    const pay = m.pay_amount != null ? `${fmt(m.pay_amount)} ${m.currency}` : (m.pay_type === 'percent' ? `${m.pay_value} % ${m.kind === 'journee' ? 'des ventes de la journée' : 'de la main-d\'œuvre'}` : `${fmt(m.pay_value)} ${m.currency} (fixe)`);
    const items = (m.items || []).map(i => '• ' + i.d + (i.k === 'fourniture' ? ` × ${i.q} (à acheter)` : '')).join('\n');
    body.textContent = [!helper && m.assignee_name ? 'Confiée à : ' + m.assignee_name : '', m.details || '', items, 'Paiement : ' + pay + (m.due_date ? ' · prévu le ' + dFr(m.due_date) : ''),
      m.started_at ? 'Commencée : ' + dFr(m.started_at) : '', m.finished_at ? 'Terminée : ' + dFr(m.finished_at) : '',
      m.kind === 'journee' && m.result_amount != null ? 'Ventes de la journée : ' + fmt(m.result_amount) + ' ' + m.currency : '',
      owner && m.status === 'verifiee' && m.due_date && m.due_date <= todayStr() ? 'Paiement dû' : ''].filter(Boolean).join('\n');
    const acts = document.createElement('div'); acts.className = 'actions'; acts.style.marginTop = '8px';
    if (helper) {
      if (m.status === 'envoyee') acts.append(mk('Commencer', 'success', () => misAct(m.id, 'start')));
      if (['envoyee', 'en_cours'].includes(m.status)) acts.append(mk('Terminer', 'primary', () => misAct(m.id, 'finish')));
      if (m.status === 'payee') acts.append(mk('Paiement reçu', 'success', () => misAct(m.id, 'receive')));
    } else {
      if (m.status === 'terminee') acts.append(mk('Vérifier', 'success', () => misAct(m.id, 'verify')));
      if (m.status === 'verifiee') acts.append(mk('Marquer payé', 'primary', () => misAct(m.id, 'pay')));
      if (m.status === 'envoyee') acts.append(mk('Supprimer', 'danger', async () => { await _supabase.from('missions').delete().eq('id', m.id); loadMissions(); }));
    }
    if (m.status === 'recue') acts.append(mk('Bon de paiement', 'secondary', () => showVoucher(m)));
    box.append(sum, body, acts); list.appendChild(box);
  });
  const vs = (data || []).filter(m => m.status === 'recue'), vl = $('vouchList');
  $('vouchBox').hidden = !vs.length; vl.textContent = '';
  vs.forEach(m => { const r = document.createElement('div'); r.className = 'catalog-item'; const t = document.createElement('div'); t.textContent = `${m.voucher_no || ''} · ${m.title} · ${fmt(m.pay_amount)} ${m.currency} · ${dFr(m.received_at)}`; r.append(t, mk('Voir', 'secondary', () => showVoucher(m))); vl.appendChild(r); });
  if (owner) loadReports();
}
$('misPayType').addEventListener('change', syncPayUI);
$('misSend').addEventListener('click', async () => {
  const to = $('misAssignee').value, title = $('misName').value.trim();
  if (!to || !title) { setStatus('misStatus', 'Choisis une personne et écris un titre.', 'err'); return; }
  if (pendingDevis) { const { data: ex } = await _supabase.from('missions').select('id').eq('devis_id', pendingDevis).neq('status', 'recue').limit(1); if (ex && ex.length && !confirm("Ce devis a déjà été envoyé en mission. L'envoyer encore ?")) return; }
  $('misSend').disabled = true;
  const type = $('misPayType').value;
  const { error } = await _supabase.from('missions').insert([{ owner_id: currentUser.id, assignee_id: to, assignee_name: $('misAssignee').selectedOptions[0].textContent.replace(/ \(.*\)$/, ''), kind: isPrest() ? 'mission' : 'journee', title, details: $('misDetails').value.trim(), items: pendingItems, devis_id: pendingDevis, pay_type: type, pay_value: parseFloat($('misPayValue').value) || 0, pay_base: type === 'percent' && isPrest() ? (parseFloat($('misBase').value) || 0) : 0, currency: currency(), due_date: $('misDue').value || null }]);
  $('misSend').disabled = false;
  if (error) { setStatus('misStatus', error.message, 'err'); return; }
  setStatus('misStatus', 'Envoyée ', 'ok');
  pendingItems = []; pendingDevis = null; $('misName').value = ''; $('misDetails').value = ''; $('misPayValue').value = ''; $('misBase').value = '';
  loadMissions();
});
async function missionFromDevis(inv) {
  const { data } = await _supabase.from('invoice_items').select('description, quantity, kind').eq('invoice_id', inv.id);
  pendingItems = (data || []).map(i => ({ d: i.description, q: i.quantity, k: i.kind || 'main_oeuvre' })); pendingDevis = inv.id;
  setPage('missions');
  await loadMissions();
  $('misName').value = `${inv.client_name} — ${inv.number}`; $('misPayType').value = 'percent'; $('misBase').value = inv.labor_amount || ''; syncPayUI();
  setStatus('misStatus', 'Choisis la personne, le pourcentage, puis envoie.', 'ok');
}
$('repSend').addEventListener('click', async () => {
  const body = $('repText').value.trim();
  if (!body) return;
  const name = currentUser.user_metadata?.full_name || currentUser.email;
  const { error } = await _supabase.from('reports').insert([{ owner_id: WID, author_id: currentUser.id, author_name: name, body }]);
  if (error) { alert(error.message); return; }
  $('repText').value = '';
  const ph = waNumber(companyData?.phone);
  if (ph.length >= 9) window.open(`https://wa.me/${ph}?text=` + encodeURIComponent(`Rapport de ${name} :\n${body}`), '_blank');
  else alert(ROLE === 'owner' ? 'Rapport enregistré.' : 'Rapport enregistré Ton patron le verra dans son application.');
});
async function loadReports() {
  const { data } = await _supabase.from('reports').select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false }).limit(20);
  const box = $('repList'); box.textContent = (data || []).length ? '' : 'Aucun rapport.';
  (data || []).forEach(r => { const d = document.createElement('div'); d.className = 'catalog-item'; d.style.whiteSpace = 'pre-wrap'; d.textContent = `${r.read ? '' : ''}${r.author_name} · ${dFr(r.created_at)}\n${r.body}`; box.appendChild(d); });
  if ((data || []).some(r => !r.read)) { await _supabase.from('reports').update({ read: true }).eq('owner_id', currentUser.id).eq('read', false); refreshBadge(); }
}
async function refreshBadge() {
  const btn = document.querySelector('.nav button[data-page="missions"]');
  if (!btn || !currentUser) return;
  const cnt = async (t, f) => (await f(_supabase.from(t).select('id', { count: 'exact', head: true }))).count || 0;
  let n = 0;
  if (ROLE === 'owner') n = await cnt('missions', q => q.eq('owner_id', currentUser.id).eq('status', 'terminee')) + await cnt('reports', q => q.eq('owner_id', currentUser.id).eq('read', false));
  else if (isHelper()) n = await cnt('missions', q => q.eq('assignee_id', currentUser.id).in('status', ['envoyee', 'payee']));
  const base = isPrest() ? (isHelper() ? 'Mes missions' : 'Missions') : (isHelper() ? 'Ma journée' : 'Journées');
  btn.textContent = '' + base + (n ? ` (${n})` : '');
}
function startMissionRT() {
  if (misRT) return; misRT = true;
  const on = () => { refreshBadge(); const a = document.querySelector('.nav button.active'); if (a && a.dataset.page === 'missions') loadMissions(); };
  _supabase.channel('mis').on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, on).on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, on).subscribe();
}

/* ---------- NÉGOCIATION DE LA MAIN-D'ŒUVRE ---------- */
let neg = null;
async function openNego(inv) {
  const { data: offers } = await _supabase.from('quote_offers').select('*').eq('quote_id', inv.id).order('created_at');
  const orig = Number(inv.labor_orig ?? inv.labor_amount) || 0, last = (offers || []).slice(-1)[0], min = Number(inv.labor_min) || 0;
  neg = { inv, orig, last };
  const rows = (offers || []).map(o => `${o.side === 'client' ? 'Client' : 'Toi'} : ${fmt(o.amount)} ${inv.currency}${o.message ? ' — ' + o.message : ''}${o.accepted ? ' accepté' : ''}`);
  $('negText').textContent = [`Devis ${inv.number} · ${inv.client_name}`, `Main-d'œuvre demandée : ${fmt(orig)} ${inv.currency}`, min ? `Ton minimum (privé) : ${fmt(min)} ${inv.currency}` : '', '', ...rows,
    last && last.side === 'client' && min && Number(last.amount) < min ? '\nCette offre est sous ton minimum.' : ''].join('\n');
  const fromClient = !!last && last.side === 'client';
  $('negAccept').hidden = $('negMid').hidden = !fromClient;
  $('negArea').hidden = false;
}
async function sendCounter(amount, msg) {
  const { error } = await _supabase.rpc('counter_offer', { p_quote: neg.inv.id, p_amount: amount, p_message: msg || null });
  if (error) { alert('Erreur : ' + error.message); return; }
  const link = location.origin + location.pathname + '?d=' + neg.inv.public_token;
  if (confirm('Contre-offre enregistrée. Prévenir le client sur WhatsApp ?')) window.open(`https://wa.me/${waNumber(neg.inv.client_phone)}?text=` + encodeURIComponent(`Bonjour ${neg.inv.client_name}, pour la main-d'œuvre du devis n°${neg.inv.number}, je te propose ${fmt(amount)} ${neg.inv.currency}. Réponds ici : ${link}`), '_blank');
  $('negArea').hidden = true; loadHistory();
}
const midOf = (a, b) => Math.round((a + b) / 2 / 100) * 100;
$('negMid').addEventListener('click', () => sendCounter(midOf(neg.orig, Number(neg.last.amount)), 'On se met d\'accord au milieu'));
$('negKeep').addEventListener('click', () => sendCounter(neg.orig, 'Je maintiens mon prix'));
$('negCounter').addEventListener('click', () => {
  const a = parseFloat(prompt(`Ta contre-offre pour la main-d'œuvre (${neg.inv.currency}) :`, neg.last ? midOf(neg.orig, Number(neg.last.amount)) : neg.orig));
  if (a > 0) sendCounter(a, prompt('Un petit mot pour le client (facultatif) :') || '');
});
$('negAccept').addEventListener('click', async () => {
  const { error } = await _supabase.rpc('accept_offer', { p_offer: neg.last.id });
  alert(error ? 'Erreur : ' + error.message : `Accepté : main-d'œuvre à ${fmt(neg.last.amount)} ${neg.inv.currency}. La mission peut commencer.`);
  $('negArea').hidden = true; loadHistory();
});
$('negClose').addEventListener('click', () => { $('negArea').hidden = true; });

/* ---------- PRESTATAIRE : revenu = main-d'œuvre reçue ---------- */
let cashInfo = {};
const isPrest = () => profile.business_type === 'prestataire';
const countedOf = r => (Number(r.labor_amount) || 0) + (r.own_supplies ? (Number(r.supplies_amount) || 0) : 0);
const revOf = r => isPrest() ? Math.min(Number(r.paid_amount) || 0, countedOf(r)) : (Number(r.total_amount) || 0);
const kindSums = () => {
  const r = readRows().filter(x => x.description), sum = f => r.filter(f).reduce((a, x) => a + x.total_price, 0);
  return { labor_amount: sum(x => x.kind !== 'fourniture'), supplies_amount: sum(x => x.kind === 'fourniture'), own_supplies: $('ownSupplies').checked };
};
async function recordLabor(inv) {
  const counted = countedOf(inv), due = counted - (Number(inv.paid_amount) || 0);
  if (counted <= 0) { alert("Ce devis ne contient pas de main-d'œuvre à compter."); return; }
  if (due <= 0) { alert("La main-d'œuvre est déjà entièrement reçue."); return; }
  let a = due;
  if (profile.plan === 'pro') { a = parseFloat(prompt(`Montant reçu (reste à recevoir : ${fmt(due)} ${inv.currency}) :`, due)); if (!(a > 0)) return; }
  else if (!confirm(`Confirmer la réception de ${fmt(due)} ${inv.currency} (main-d'œuvre) ?`)) return;
  const paid = Math.min(counted, (Number(inv.paid_amount) || 0) + a);
  const { error } = await _supabase.from('invoices').update({ paid_amount: paid, status: paid >= counted ? 'terminé' : 'approuvé' }).eq('id', inv.id);
  if (error) alert('Erreur : ' + error.message);
  loadHistory();
}

/* Le mentor IA vit dans js/mentor-ia/ ; app.js lui fournit les chiffres (lastStats) */
let lastStats = {};

/* ---------- ÉCRAN PRO ---------- */
/* ============================================================
   Tamzorya PAY : paiements Mobile Money vérifiés à la main,
   activation automatique du plan PRO côté serveur (pay_decide)
   ============================================================ */
let payPlan = 'mensuel', payMethod = null, payTier = 'standard';
const planOf = per => ({ label: `${TIERS[payTier].name} — ${per === 'mensuel' ? '30 jours' : '365 jours'}`, amount: per === 'mensuel' ? TIERS[payTier].m : TIERS[payTier].y, currency: 'USD' });
const PLANS = { get mensuel() { return planOf('mensuel'); }, get annuel() { return planOf('annuel'); } }; // montant et durée sont recalculés par le serveur
const reqLabel = r => `${(TIERS[r.plan_type] || TIERS.standard).name} — ${r.plan === 'annuel' ? '365 jours' : '30 jours'}`;
const TIER_INFO = {
  standard: 'Factures et devis illimités, 2 entreprises, 2 employés + 2 associés, 100 questions IA/mois, export Excel.',
  diamant: 'Jusqu\'à 5 boutiques, 20 employés + 10 associés, 300 questions IA/mois, chat des associés. Maximum pour les prestataires.',
  platine: 'Grossistes et importateurs : jusqu\'à 15 magasins, 30 employés + 20 associés, droits d\'accès détaillés.'
};
const STATUS_ICON = { 'en_attente': 'En attente', 'confirmé': 'Confirmé', 'refusé': 'Refusé' };

function renderPayFlow() {
  const tiers = ['standard', 'diamant'];
  if (profile.business_type === 'commercant' && (profile.business_subtype || 'petit') !== 'petit') tiers.push('platine');
  if (!tiers.includes(payTier)) payTier = 'standard';
  const sel = $('payTier'); sel.innerHTML = '';
  tiers.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = `${TIERS[t].name} : ${TIERS[t].m} $/mois ou ${TIERS[t].y} $/an`; sel.appendChild(o); });
  sel.value = payTier; $('payTierInfo').textContent = TIER_INFO[payTier];
  $('payPlanM').innerHTML = `<h3 style="margin-top:0">${TIERS[payTier].name} : 30 jours</h3><p style="font-size:26px;font-weight:800;margin:6px 0">${TIERS[payTier].m} $</p><p class="note">par mois</p>`;
  $('payPlanY').innerHTML = `<h3 style="margin-top:0">${TIERS[payTier].name} : 365 jours </h3><p style="font-size:26px;font-weight:800;margin:6px 0">${TIERS[payTier].y} $</p><p class="note">par an · 2 mois offerts</p>`;
  const pl = PLANS[payPlan];
  $('payPlanM').style.borderColor = payPlan === 'mensuel' ? 'var(--green)' : '';
  $('payPlanY').style.borderColor = payPlan === 'annuel' ? 'var(--green)' : '';
  $('payMethods').innerHTML = '';
  PAY.forEach(([op]) => {
    const row = document.createElement('div'); row.className = 'catalog-item';
    const info = document.createElement('div'); info.textContent = op;
    row.append(info, mk(payMethod === op ? '✓ Choisi' : 'Choisir', payMethod === op ? 'primary' : 'secondary', () => { payMethod = op; renderPayFlow(); }));
    $('payMethods').appendChild(row);
  });
  $('payInstr').hidden = !payMethod;
  if (payMethod) {
    const num = PAY.find(p => p[0] === payMethod)[1];
    $('payTo').textContent = `Envoie exactement ${pl.amount} ${pl.currency} (${pl.label}) au ${num} par ${payMethod}.`;
    $('payCopy').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(num); alert('Numéro copié : ' + num); };
    if (!$('payAmt').value) $('payAmt').value = pl.amount;
    $('payCur').value = pl.currency;
  }
}
$('payTier').addEventListener('change', () => { payTier = $('payTier').value; $('payAmt').value = ''; renderPayFlow(); });
$('payPlanM').addEventListener('click', () => { payPlan = 'mensuel'; $('payAmt').value = ''; renderPayFlow(); });
$('payPlanY').addEventListener('click', () => { payPlan = 'annuel'; $('payAmt').value = ''; renderPayFlow(); });
$('payHelp').addEventListener('click', () => window.open(`https://wa.me/${ADMIN_WA}?text=` + encodeURIComponent('Bonjour, j\'ai une question sur le paiement du plan PRO Tamzorya. E-mail de mon compte : ' + currentUser.email), '_blank'));

$('paySubmit').addEventListener('click', async () => {
  const pl = PLANS[payPlan], ref = $('payRef').value.trim(), amt = parseFloat($('payAmt').value);
  if (!payMethod) { setStatus('payMsg', 'Choisis d\'abord un moyen de paiement.', 'err'); return; }
  if (ref.length < 4) { setStatus('payMsg', 'Écris la référence de la transaction (reçue par SMS).', 'err'); return; }
  if (!(amt > 0)) { setStatus('payMsg', 'Écris le montant que tu as envoyé.', 'err'); return; }
  const f = $('payProof').files[0];
  if (f && f.size > 3 * 1024 * 1024) { setStatus('payMsg', 'Le justificatif est trop lourd (3 Mo maximum).', 'err'); return; }
  $('paySubmit').disabled = true; setStatus('payMsg', 'Envoi en cours...');
  let proof_path = null;
  if (f) { // justificatif facultatif : s'il échoue, la demande part quand même
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    const isImg = f.type.startsWith('image/');
    const body = isImg ? await compressImage(f).catch(() => f) : f; // capture d'écran réduite avant l'envoi
    const path = `${currentUser.id}/${Date.now()}.${isImg && body !== f ? 'jpg' : ext}`;
    const up = await _supabase.storage.from('pay-proofs').upload(path, body, { contentType: body.type || f.type });
    if (!up.error) proof_path = path;
  }
  const { error } = await _supabase.from('pay_requests').insert([{ email: currentUser.email, plan: payPlan, plan_type: payTier, expected_amount: pl.amount, expected_currency: pl.currency, method: payMethod, reference: ref, amount_sent: amt, currency_sent: $('payCur').value, proof_path }]);
  $('paySubmit').disabled = false;
  if (error) { setStatus('payMsg', error.code === '23505' ? 'Cette référence a déjà été envoyée.' : /row-level security/i.test(error.message) ? 'Tu as déjà 3 demandes en attente. Attends leur vérification.' : 'Erreur : ' + error.message, 'err'); return; }
  setStatus('payMsg', 'Demande envoyée ! Elle sera vérifiée dans les plus brefs délais, ton plan PRO s\'activera automatiquement.', 'ok');
  $('payRef').value = ''; $('payAmt').value = ''; $('payProof').value = '';
  loadPayMine();
});

async function loadPayMine() {
  const box = $('payMine'); box.innerHTML = '';
  const { data } = await _supabase.from('pay_requests').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(10);
  (data || []).forEach(r => {
    const row = document.createElement('div'); row.className = 'catalog-item';
    const info = document.createElement('div');
    info.textContent = `${STATUS_ICON[r.status] || r.status} · ${reqLabel(r)} · ${r.method} · réf ${r.reference} · ${new Date(r.created_at).toLocaleDateString('fr-FR')}` + (r.status === 'refusé' && r.admin_note ? ' · ' + r.admin_note : '');
    info.className = 'note'; row.appendChild(info); box.appendChild(row);
  });
  if (!(data || []).length) box.innerHTML = '<p class="note">Aucune demande pour le moment.</p>';
}

// Confirmation au client : à l'ouverture de l'app, on lui annonce la décision et on rafraîchit son plan
async function checkPayNotices() {
  const { data } = await _supabase.from('pay_requests').select('*').eq('user_id', currentUser.id).eq('seen', false).neq('status', 'en_attente');
  if (!data || !data.length) return;
  data.forEach(r => alert(r.status === 'confirmé'
    ? `Paiement confirmé (réf ${r.reference}). Ton plan PRO est actif` + (r.expires_at ? ` jusqu'au ${new Date(r.expires_at).toLocaleDateString('fr-FR')}.` : '.')
    : `Paiement refusé (réf ${r.reference}).` + (r.admin_note ? ' Raison : ' + r.admin_note : '') + ' Écris-nous sur WhatsApp si tu penses que c\'est une erreur.'));
  await _supabase.rpc('pay_mark_seen');
  await loadProfile0(); applyProfile();
}

/* ----- Espace administrateur ----- */
async function checkAdmin() {
  const { data } = await _supabase.rpc('admin_role');
  ADMIN_ROLE = data || ''; IS_ADMIN = ADMIN_ROLE === 'admin' || ADMIN_ROLE === 'etat';
  const b = document.querySelector('.nav button[data-page="admin"]'); if (b) { b.hidden = !IS_ADMIN; b.textContent = ADMIN_ROLE === 'etat' ? 'Statistiques' : 'Administration'; }
  syncTopbar();
}
async function loadAdmin() {
  const box = $('adminList'); box.innerHTML = '<p class="note">Chargement...</p>';
  let q = _supabase.from('pay_requests').select('*').order('created_at', { ascending: false }).limit(100);
  if ($('adminFilter').value) q = q.eq('status', $('adminFilter').value);
  const { data, error } = await q;
  box.innerHTML = '';
  if (error) { box.textContent = 'Erreur : ' + error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="note">Aucune demande.</p>'; return; }
  data.forEach(r => {
    const row = document.createElement('div'); row.className = 'catalog-item'; row.style.flexWrap = 'wrap';
    const info = document.createElement('div'); info.style.flex = '1 1 240px';
    const s = document.createElement('strong'); s.textContent = r.email;
    const m = document.createElement('div'); m.className = 'note';
    const ok = Number(r.amount_sent) === Number(r.expected_amount) && r.currency_sent === r.expected_currency;
    m.textContent = `${STATUS_ICON[r.status]} · ${reqLabel(r)} · attendu ${r.expected_amount} ${r.expected_currency} · reçu ${r.amount_sent} ${r.currency_sent}${ok ? '' : ' montant différent'} · ${r.method} · réf ${r.reference} · ${new Date(r.created_at).toLocaleString('fr-FR')}` + (r.admin_note ? ' · ' + r.admin_note : '');
    info.append(s, m);
    const acts = document.createElement('div'); acts.className = 'actions';
    if (r.proof_path) acts.append(mk('Justificatif', 'secondary', async () => {
      const { data: u, error: e } = await _supabase.storage.from('pay-proofs').createSignedUrl(r.proof_path, 120);
      if (e) alert('Erreur : ' + e.message); else window.open(u.signedUrl, '_blank');
    }));
    if (r.status === 'en_attente') {
      acts.append(mk('Confirmer', 'success', () => decidePay(r, true)), mk('Refuser', 'danger', () => decidePay(r, false)));
    }
    row.append(info, acts); box.appendChild(row);
  });
}
async function decidePay(r, ok) {
  let note = null;
  if (ok) { if (!confirm(`Confirmer ${r.amount_sent} ${r.currency_sent} de ${r.email} (réf ${r.reference}) ? Le plan PRO sera activé tout de suite.`)) return; }
  else { note = prompt('Raison du refus (visible par le client) :', 'Paiement introuvable'); if (note === null) return; }
  const { error } = await _supabase.rpc('pay_decide', { p_id: r.id, p_ok: ok, p_note: note });
  if (error) { alert('Erreur : ' + error.message); return; }
  loadAdmin(); checkAdmin();
}
$('adminFilter').addEventListener('change', loadAdmin);
$('adminRefresh').addEventListener('click', loadAdmin);

/* ---------- TVA, VENTE RAPIDE, STATS PRO ---------- */
// Taux indicatifs : à vérifier selon la loi en vigueur (modifiables dans la facture)
const VAT = { 'RDC': 16, 'Congo-Brazzaville': 18.9, 'Cameroun': 19.25, 'Gabon': 18, 'Sénégal': 18, "Côte d'Ivoire": 18, 'Mali': 18, 'Bénin': 18, 'Nigeria': 7.5, 'Ghana': 15, 'Kenya': 16, 'Tanzanie': 18, 'Ouganda': 18, 'Rwanda': 18, 'Afrique du Sud': 15, 'Maroc': 20, 'Égypte': 14 };
const taxableSum = rows => rows.filter(x => x.kind !== 'main_oeuvre').reduce((a, x) => a + x.total_price, 0);
const tvaRate = () => $('tvaOn').checked ? (parseFloat($('tvaRate').value) || 0) : 0;
const tvaOf = g => Math.round(g * tvaRate()) / 100;
const tvaExtra = () => {
  const r = tvaRate(); if (!r) return {};
  const ht = taxableSum(readRows().filter(x => x.description));
  return { tva_rate: r, tva_amount: Math.round(ht * r) / 100 };
};
// PRO : dès l'enregistrement, le taux de change du commerçant et l'échéance sont figés dans le document
function lockExtra() {
  if (profile.plan !== 'pro') return {};
  const h = parseInt($('validHours').value) || 0, x = { rate_locked: effRate() };
  if (h > 0) { x.valid_hours = h; x.valid_until = new Date(Date.now() + h * 3600000).toISOString(); }
  return x;
}
function validText(h) { h = Number(h) || 24; return h >= 48 && h % 24 === 0 ? `Valide ${h / 24} jours maximum` : `Valide ${h} heures maximum`; }
// RDC : retenue à la source sur la main-d'œuvre (taux modifiable : RETENUE_PCT) et code de facture normalisée
function rdcExtra() {
  const x = {};
  if (!isRdc()) return x;
  const cufn = $('cufn').value.trim(); if (cufn) x.code_cisf = cufn;
  if (isPrest() && $('retenueOn').checked) {
    const lab = readRows().filter(r => r.description && r.kind === 'main_oeuvre').reduce((s, r) => s + r.total_price, 0);
    x.retenue_pct = RETENUE_PCT; x.retenue_amount = Math.round(lab * RETENUE_PCT) / 100;
  }
  return x;
}
$('retenueOn').addEventListener('change', calculateTotal);
const quoteExtra = () => ({ ...quoteExtra0(), ...tvaExtra(), ...lockExtra(), ...rdcExtra() });
$('tvaOn').addEventListener('change', () => {
  if ($('tvaOn').checked && profile.plan !== 'pro') { $('tvaOn').checked = false; needPro('La TVA'); return; }
  if ($('tvaOn').checked && (!companyData?.tax_id || (profile.country === 'RDC' && !companyData?.rccm))) { $('tvaOn').checked = false; alert("Pour activer la TVA, enregistre ton N° d'impôt" + (profile.country === 'RDC' ? ' et ton RCCM' : '') + ' dans « Mon entreprise ».'); return; }
  $('tvaRate').hidden = !$('tvaOn').checked; calculateTotal();
});
$('tvaRate').addEventListener('input', calculateTotal);

function quickAdd(item) {
  document.querySelectorAll('#invoiceItemsTable tr').forEach(tr => { if (!tr.querySelector('.row-desc').value.trim()) tr.remove(); });
  const row = [...document.querySelectorAll('#invoiceItemsTable tr')].find(tr => tr.dataset.cid === String(item.id));
  if (row) { const q = row.querySelector('.row-qty'); q.value = (parseFloat(q.value) || 0) + 1; calculateTotal(); return; }
  addInvoiceRow(itemName(item), item.price, 1);
  $('invoiceItemsTable').lastElementChild.dataset.cid = item.id;
}

async function loadProStats() {
  const prest = profile.business_type === 'prestataire', d = new Date(), start = new Date(d.getFullYear(), d.getMonth() - 5, 1).toISOString();
  $('topItemsTitle').textContent = prest ? 'Services les plus demandés (6 mois)' : 'Plus vendus (6 mois)';
  $('quoteBox').hidden = !prest;
  const { data } = await _supabase.from('invoice_items').select('description, quantity, invoices!inner(created_at, doc_type)')
    .eq('invoices.doc_type', prest ? 'devis' : 'facture').gte('invoices.created_at', start).limit(1000);
  const agg = {};
  (data || []).forEach(r => { const k = (r.description || '').trim(); if (k) agg[k] = (agg[k] || 0) + (Number(r.quantity) || 0); });
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 5), box = $('topItems');
  lastStats.plus_vendus_ou_demandes = top.map(([nom, quantite]) => ({ nom, quantite }));
  box.textContent = top.length ? '' : 'Pas encore de données.';
  top.forEach(([n, q], i) => { const p = document.createElement('div'); p.textContent = `${i + 1}. ${n} — ×${(+q).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`; box.appendChild(p); });
  if (!prest) return;
  const { data: qs } = await _supabase.from('invoices').select('status').eq('user_id', WID).eq('doc_type', 'devis').gte('created_at', start);
  const n = (qs || []).length, ok = (qs || []).filter(x => x.status === 'approuvé').length, wait = (qs || []).filter(x => ['brouillon', 'envoyé', 'negociation'].includes(x.status)).length;
  lastStats.devis = { total: n, approuves: ok, en_attente: wait };
  $('quoteStats').textContent = n ? `${n} devis · ${ok} approuvés (${Math.round(ok / n * 100)} %) · ${wait} en attente de réponse` : 'Pas encore de devis.';
}

/* ---------- USAGE (gratuit) ET EXPORT EXCEL (PRO) ---------- */
async function showUsage() {
  if (profile.plan === 'pro' || ROLE !== 'owner') return;
  const d = new Date(), start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  const cnt = async t => (await _supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('user_id', WID).eq('doc_type', t).gte('created_at', start)).count || 0;
  const [f, q] = await Promise.all([cnt('facture'), cnt('devis')]);
  $('planBar').textContent = (isPrest() ? `Plan Gratuit · ce mois : ${q}/${LIMITS.devis} devis` : `Plan Gratuit · ce mois : ${f}/${LIMITS.facture} factures`);
}
$('csvBtn').addEventListener('click', async () => {
  if (!needPro("L'export Excel")) return;
  const { data } = await _supabase.from('invoices').select('number,doc_type,status,client_name,client_phone,total_amount,paid_amount,currency,created_at').eq('user_id', WID).order('created_at', { ascending: false });
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Numéro', 'Type', 'Statut', 'Client', 'Téléphone', 'Total', 'Payé', 'Devise', 'Date'];
  const rows = (data || []).map(r => [r.number, r.doc_type, r.status, r.client_name, r.client_phone, r.total_amount, r.paid_amount, r.currency, new Date(r.created_at).toLocaleDateString('fr-FR')].map(esc).join(';'));
  const blob = new Blob(['\ufeff' + [head.map(esc).join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'factures-tamzorya.csv'; a.click();
});

/* ---------- DEVIS : SUGGESTIONS, ACOMPTE, DUPLICATION ---------- */
const quoteExtra0 = () => $('docType').value === 'devis' ? { valid_days: parseInt($('qValid').value) || 15, deposit_pct: parseFloat($('qDeposit').value) || 0, note: $('qNote').value.trim(), ...kindSums(), labor_min: parseFloat($('qMin').value) || null } : {};
let lineSugg = {};
async function loadSuggestions() {
  const dl = $('lineSuggest'); dl.innerHTML = '';
  const { data } = await _supabase.from('invoice_items').select('description, unit_price').limit(300);
  (data || []).forEach(r => { if (r.description && !lineSugg[r.description]) lineSugg[r.description] = { price: r.unit_price }; });
  ["Main-d'œuvre", 'Déplacement / transport', 'Diagnostic', 'Installation', 'Réparation', 'Maintenance', 'Formation', 'Livraison', ...Object.keys(lineSugg)].forEach(t => dl.appendChild(new Option(t)));
}
$('addLaborBtn').addEventListener('click', () => addInvoiceRow('', 0, 1, 'main_oeuvre'));
$('addMaterialBtn').addEventListener('click', () => addInvoiceRow('', 0, 1, 'fourniture'));

async function duplicateDoc(inv) {
  const { data: items } = await _supabase.from('invoice_items').select('*').eq('invoice_id', inv.id);
  setPage('facture');
  await resetInvoice();
  $('docType').value = inv.doc_type === 'devis' ? 'devis' : 'facture';
  await generateInvoiceNumber();
  $('clientName').value = inv.client_name || ''; $('clientPhone').value = inv.client_phone || ''; $('clientEmail').value = inv.client_email || '';
  $('invoiceItemsTable').innerHTML = '';
  (items || []).forEach(it => addInvoiceRow(it.description, it.unit_price, it.quantity, it.kind || ''));
  if (inv.doc_type === 'devis') { $('qValid').value = inv.valid_days || 15; $('qDeposit').value = inv.deposit_pct ?? 50; $('qNote').value = inv.note || ''; $('ownSupplies').checked = !!inv.own_supplies; }
  calculateTotal();
  setStatus('invoiceStatus', 'Document copié : change le client si besoin, puis enregistre.', 'ok');
}

$('isTeam').addEventListener('change', () => { $('ownerFields').hidden = $('isTeam').checked; $('teamField').hidden = !$('isTeam').checked; });

/* ---------- ENCAISSÉ, FILTRES, RÉSEAU ---------- */
const statusNow = () => $('docType').value === 'devis' ? 'brouillon' : ($('paidNow').checked ? 'payée' : 'impayée');

function showCash(rows) {
  const t = { CDF: [0, 0], USD: [0, 0] }; // [encaissé, à encaisser]
  (rows || []).forEach(r => { const tot = Number(r.total_amount) || 0, p = r.status === 'payée' ? tot : Math.min(tot, Number(r.paid_amount) || 0), b = t[r.currency === 'USD' ? 'USD' : 'CDF']; b[0] += p; b[1] += tot - p; });
  cashInfo = { [isPrest() ? 'recu' : 'encaisse']: { local: Math.round(t.CDF[0]), usd: Math.round(t.USD[0]) }, [isPrest() ? 'a_recevoir' : 'a_encaisser']: { local: Math.round(t.CDF[1]), usd: Math.round(t.USD[1]) } };
  const owe = {};
  (rows || []).forEach(r => { if (r.status !== 'payée') { const k = r.client_name + ' (' + (r.currency === 'USD' ? 'USD' : locCur()) + ')'; owe[k] = (owe[k] || 0) + (Number(r.total_amount) || 0) - (Number(r.paid_amount) || 0); } });
  const topOwe = Object.entries(owe).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('cashText').textContent = ['CDF', 'USD'].map(c => `${c === 'CDF' ? locCur() : c} : ${fmt(t[c][0])} ${isPrest() ? 'reçu' : 'encaissé'} · ${fmt(t[c][1])} ${isPrest() ? 'à recevoir' : 'à encaisser'}`).join('\n') + (topOwe.length ? '\n\nÀ relancer :\n' + topOwe.map(([n, v]) => `${n} : ${fmt(v)}`).join('\n') : '');
}

function histMatch(inv) {
  const q = $('histSearch').value.trim().toLowerCase(), f = $('histFilter').value;
  if (q && !(inv.number + ' ' + inv.client_name).toLowerCase().includes(q)) return false;
  if (f === 'attente') return ['brouillon', 'envoyé', 'negociation'].includes(inv.status);
  if (f === 'cours') return inv.status === 'approuvé';
  if (f === 'fini') return inv.status === 'terminé';
  if (f === 'devis' || f === 'facture') return inv.doc_type === f;
  if (f === 'payee') return inv.doc_type !== 'devis' && inv.status === 'payée';
  if (f === 'impayee') return inv.doc_type !== 'devis' && inv.status !== 'payée';
  return true;
}
let histTimer;
$('histSearch').addEventListener('input', () => { clearTimeout(histTimer); histTimer = setTimeout(loadHistory, 300); });
$('histFilter').addEventListener('change', loadHistory);

const netState = () => { $('netBadge').hidden = navigator.onLine; };
window.addEventListener('online', netState); window.addEventListener('offline', netState); netState();

/* ---------- APPLICATION INSTALLABLE (PWA) ---------- */
// (installation sur l'écran d'accueil : voir le bloc « INSTALLATION » plus bas)
if (/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone) $('installHint').hidden = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Nouvelle version installée : l'application se recharge une fois toute seule
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!sessionStorage.getItem('fx_reload')) { sessionStorage.setItem('fx_reload', '1'); location.reload(); } });
}

/* ---------- NAVIGATION ---------- */
function setPage(target) {
  syncTopbar(target); // barre du haut à 6 onglets
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('active', x.dataset.page === target));
  
  ['entreprise', 'catalogue', 'facture', 'historique', 'politique', 'dashboard', 'depenses', 'equipe', 'pro', 'mentor', 'missions', 'admin', 'annuaire', 'chat', 'boutique', 'commandes', 'recues', 'accueil', 'parametres'].forEach(p => { 
    const el = $('page-' + p);
    if (el) el.hidden = (p !== target); 
  });
  
  if (target === 'historique') loadHistory();
  if (target === 'depenses') loadExpenses();
  if (target === 'equipe') loadTeam();
  if (target === 'mentor') { if (window.FX_IA) FX_IA.open(); else mentorMissing(); }
  if (target === 'pro') { renderPayFlow(); loadPayMine(); }
  if (target === 'admin') initAdmin();
  if (target === 'annuaire') initDirectory();
  if (target === 'entreprise' && ROLE === 'owner') { loadEstab(); initActType(); initEntrepriseRdc(); }
  if (target === 'commandes') loadOrders();
  if (target === 'recues') loadReceived();
  if (target === 'accueil') initFeed();
  if (target === 'parametres') initSettings();
  if (target === 'chat') { chatCur = null; $('chatThread').hidden = true; $('chatList').hidden = false; loadConvs(); }
  if (target === 'missions') loadMissions();
  if (target === 'dashboard') loadDashboard(); // Déclenche le calcul automatique
}


$('dashPeriod').addEventListener('change', loadDashboard);
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));

/* ---------- PASSERELLE POUR LES MODULES (js/mentor-ia) ---------- */
window.FX = {
  $, mk, supabase: _supabase, loadDashboard, setPage, isPrest,
  get profile() { return profile; },
  get user() { return currentUser; },
  searchDir: (q, kind) => { dirPreset = { q: String(q || '').slice(0, 60), kind: kind || '' }; setPage('annuaire'); },
  stats: () => ({ ...lastStats, ...cashInfo })
};
function mentorMissing() {
  $('chatBox').innerHTML = '';
  const b = document.createElement('div'); b.className = 'status err';
  b.textContent = "Le module Mentor n'est pas chargé (js/mentor-ia/core-ia.js introuvable). Vérifie que les 3 fichiers sont bien dans le dossier js/mentor-ia/ puis recharge la page.";
  $('chatBox').appendChild(b);
}
if (window.FX_IA) FX_IA.init();
else { $('mentorBtn').addEventListener('click', mentorMissing); $('chatReset').addEventListener('click', mentorMissing); }

/* ============================================================
   ANNUAIRE PAR PAYS + DEVIS FLASH
   Le cloisonnement par pays est appliqué par la base (RLS) :
   le navigateur ne peut pas voir les fiches d'un autre pays.
   ============================================================ */
const waDigits = n => waNumber(n); // ajoute l'indicatif du pays si le numéro est local
const waOk = n => { const d = waDigits(n); return d.length >= 8 && d.length <= 15; };
const waLink = (n, txt) => `https://wa.me/${waDigits(n)}` + (txt ? '?text=' + encodeURIComponent(txt) : '');

let dirPreset = null; // recherche demandée par l'assistant d'achat
function initDirectory() {
  $('dirScope').textContent = `Professionnels et commerces actifs en ${profile.country || 'ton pays'}. Tu ne vois que ton propre pays.`;
  const canList = ROLE === 'owner' && ['commercant', 'prestataire'].includes(profile.business_type);
  $('dirMine').hidden = !canList;
  $('dirPublish').hidden = true; // remplacé par le catalogue photo en direct
  const sub = profile.business_subtype || 'petit';
  $('dirSubField').hidden = !canList || profile.business_type !== 'commercant';
  $('dirStockField').hidden = $('dirSubField').hidden;
  $('dirSubtype').value = sub;
  $('dirDetail').hidden = true; $('dirResults').hidden = false;
  if (canList) loadMyEntry();
  if (dirPreset) { $('dirQ').value = dirPreset.q; $('dirKind').value = dirPreset.kind; dirPreset = null; }
  dirSearch();
}
async function loadMyEntry() {
  const { data } = await _supabase.from('directory_entries').select('*').eq('user_id', currentUser.id).maybeSingle();
  $('dirListed').checked = !!(data && data.listed);
  $('dirCategory').value = (data && data.category) || (currentUser.user_metadata && currentUser.user_metadata.trade) || '';
  $('dirAbout').value = (data && data.about) || '';
  $('dirWa').value = (data && data.whatsapp) || '';
  $('dirStock').value = String((data && data.niveau_stock) || 1);
  $('dirAddr').value = (data && data.address) || ''; $('dirGalerie').value = (data && data.galerie) || ''; $('dirAcces').value = (data && data.acces_details) || '';
  $('dirLat').value = data && data.latitude != null ? data.latitude : ''; $('dirLng').value = data && data.longitude != null ? data.longitude : '';
}
$('dirSave').addEventListener('click', async () => {
  if (!companyData || !companyData.name) { setStatus('dirStatus', 'Remplis d\'abord « Mon entreprise » (nom et ville).', 'err'); return; }
  const wa = $('dirWa').value.trim();
  if (wa && !waOk(wa)) { setStatus('dirStatus', 'Numéro WhatsApp invalide : écris-le avec l\'indicatif (ex. +243...).', 'err'); return; }
  $('dirSave').disabled = true; setStatus('dirStatus', 'Enregistrement...');
  if (profile.business_type === 'commercant' && $('dirSubtype').value !== (profile.business_subtype || 'petit')) {
    const { error: se } = await _supabase.rpc('set_business_subtype', { p_sub: $('dirSubtype').value });
    if (se) { $('dirSave').disabled = false; setStatus('dirStatus', se.message, 'err'); return; }
    profile.business_subtype = $('dirSubtype').value;
  }
  const { error } = await _supabase.from('directory_entries').upsert({
    user_id: currentUser.id, name: companyData.name, city: companyData.city || '', rate: effRate(), niveau_stock: parseInt($('dirStock').value, 10) || 1, address: $('dirAddr').value.trim(), galerie: $('dirGalerie').value.trim(), acces_details: $('dirAcces').value.trim(), latitude: numOrNull('dirLat'), longitude: numOrNull('dirLng'),
    category: $('dirCategory').value.trim(), about: $('dirAbout').value.trim(), whatsapp: wa ? '+' + waDigits(wa) : '', listed: $('dirListed').checked
  }, { onConflict: 'user_id' });
  $('dirSave').disabled = false;
  setStatus('dirStatus', error ? 'Erreur : ' + error.message : ($('dirListed').checked ? 'Ta fiche est visible dans l\'annuaire.' : 'Fiche enregistrée (non visible).'), error ? 'err' : 'ok');
});
$('dirPublish').addEventListener('click', async () => {
  if (!catalogItems.length) { setStatus('dirStatus', 'Ton catalogue est vide.', 'err'); return; }
  $('dirPublish').disabled = true; setStatus('dirStatus', 'Publication...');
  const items = catalogItems.slice(0, 200).map(i => ({ name: i.name, price: Number(i.price) || 0, unit: i.unit || '', currency: currency() }));
  await _supabase.from('directory_entries').update({ rate: effRate() }).eq('user_id', currentUser.id);
  const { data, error } = await _supabase.rpc('dir_publish_catalog', { p_items: items });
  $('dirPublish').disabled = false;
  setStatus('dirStatus', error ? 'Erreur : ' + error.message : `${data} produit(s) publié(s). Le stock n'est pas publié.`, error ? 'err' : 'ok');
});

async function dirSearch() {
  const box = $('dirList'); box.innerHTML = '<p class="note">Recherche...</p>';
  const { data, error } = await _supabase.rpc('dir_search', { p_q: $('dirQ').value.trim().slice(0, 60), p_kind: $('dirKind').value });
  box.innerHTML = '';
  if (error) { box.textContent = 'Erreur : ' + error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="note">Aucun résultat dans ton pays pour le moment.</p>'; return; }
  const mIds = data.filter(e => e.kind === 'commercant').map(e => e.user_id);
  if (mIds.length) {
    const { data: reps } = await _supabase.rpc('reputation_for', { p_ids: mIds });
    const repMap = new Map((reps || []).map(r => [r.merchant_id, r]));
    data.forEach(e => { if (e.kind === 'commercant') e._rep = repMap.get(e.user_id) || null; });
  }
  data.forEach(e => {
    const row = document.createElement('div'); row.className = 'catalog-item'; row.style.flexWrap = 'wrap';
    const info = document.createElement('div'); info.style.flex = '1 1 200px';
    const s = document.createElement('strong'); s.textContent = e.name;
    const m = document.createElement('div'); m.className = 'note';
    if (e.certifie_rdc) { const cb = document.createElement('span'); cb.className = 'cert-badge'; cb.textContent = '' + (e.kind === 'commercant' ? 'Commerçant' : 'Prestataire') + ' Certifié RDC'; info.appendChild(cb); }
    m.textContent = (e.kind === 'commercant' ? '' : '') + [e.category, e.city, repLabel(e), (e.kind === 'commercant' && e.plan_type && e.plan_type !== 'gratuit') ? 'Sponsorisé' : ''].filter(Boolean).join(' · ');
    info.append(s, m);
    const acts = document.createElement('div'); acts.className = 'actions';
    acts.append(mk('Voir', 'primary', () => openDirDetail(e)));
    if (e.user_id !== currentUser.id) acts.append(mk('Message', 'secondary', () => openChatWith(e.user_id, e)));
    if (waOk(e.whatsapp)) acts.append(mk('WhatsApp', 'success', () => window.open(waLink(e.whatsapp), '_blank')));
    row.append(info, acts); box.appendChild(row);
  });
}
$('dirGo').addEventListener('click', dirSearch);
$('dirQ').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); dirSearch(); } });
$('dirBack').addEventListener('click', () => { $('dirDetail').hidden = true; $('dirResults').hidden = false; });

async function openDirDetail(e) {
  $('dirResults').hidden = true; $('dirDetail').hidden = false;
  $('dirTitle').textContent = e.name;
  $('dirMeta').textContent = [e.kind === 'commercant' ? 'Commerce' : 'Artisan / service', e.category, e.city, e.rate ? `taux du commerçant : 1 USD = ${fmt(e.rate)}` : ''].filter(Boolean).join(' · ');
  $('dirAboutShow').textContent = e.about || '';
  $('dirRep').textContent = repLabel(e);
  $('dirCert').hidden = !e.certifie_rdc; $('dirCert').textContent = '' + (e.kind === 'commercant' ? 'Commerçant' : 'Prestataire') + ' Certifié RDC';
  const acts = $('dirActs'); acts.innerHTML = '';
  if (e.user_id !== currentUser.id) acts.append(mk('Message', 'primary', () => openChatWith(e.user_id, e)));
  if (waOk(e.whatsapp)) acts.append(mk('WhatsApp', 'success', () => window.open(waLink(e.whatsapp), '_blank')));
  if (e.kind === 'commercant' && profile.business_type === 'prestataire' && ROLE === 'owner') acts.append(mk('Fiabilité détaillée', 'secondary', () => showRepDetail(e)));
  $('dirProducts').innerHTML = '';
  const geo = [e.address ? 'Adresse : ' + e.address : '', e.galerie ? 'Galerie : ' + e.galerie : '', e.acces_details ? 'Accès : ' + e.acces_details : ''].filter(Boolean).join('\n');
  $('dirGeoInfo').textContent = geo; $('dirGeoInfo').hidden = !geo;
  if (geo || (e.latitude != null && e.longitude != null)) acts.append(mk('Guider jusqu\'au fournisseur', 'primary', () => guideTo(e.latitude, e.longitude, [e.name, e.address, e.city].filter(Boolean).join(', '))));
  if (e.kind === 'commercant') acts.append(mk('Catalogue photo', 'primary', () => openShop(e.user_id, e)));
}

// Devis Flash (PRO) : ouvre l'éditeur avec le commerçant et le produit déjà remplis
function flashQuote(e, p) {
  if (!needPro('Devis Flash')) return;
  setPage('facture');
  $('clientName').value = e.name;
  $('clientPhone').value = e.whatsapp || '';
  [...$('invoiceItemsTable').children].forEach(tr => { // retire les lignes vides
    if (!tr.querySelector('.row-desc').value.trim() && !parseFloat(tr.querySelector('.row-price').value)) tr.remove();
  });
  let price = Number(p.price) || 0, note = '';
  const cur = currency(), pc = p.currency || cur, rate = Number(e.rate) || 0;
  if (pc !== cur && rate > 0 && (pc === 'USD' || cur === 'USD')) { // conversion au taux du commerçant
    price = Math.round((pc === 'USD' ? price * rate : price / rate) * 100) / 100;
    note = ` Converti au taux du commerçant (1 USD = ${fmt(rate)}).`;
  }
  addInvoiceRow(p.name, price, p.qty || 1, 'fourniture');
  calculateTotal(); saveDraft();
  setStatus('invoiceStatus', `Devis pré-rempli pour ${e.name}. Le prix du catalogue est indicatif : modifie-le librement selon la négociation.${note} Après l'enregistrement, envoie-le dans la conversation avec le .`, 'ok');
}

/* ============================================================
   MESSAGERIE : texte, temps réel, non lus
   Une seule connexion temps réel ; la base (RLS) ne livre que les
   messages des conversations dont l'utilisateur est membre.
   ============================================================ */
let chatStarted = false, chatCur = null, chatSeen = new Set(), chatOldest = null, chatDocEls = new Map(), chatNames = new Map();
const chatTime = d => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function startChat() {
  if (chatStarted) return;
  chatStarted = true;
  refreshChatBadge();
  _supabase.channel('chat-msgs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onChatMsg(p.new)).subscribe();
}
async function refreshChatBadge() {
  const { data } = await _supabase.rpc('chat_unread_total');
  const n = data || 0, b = document.querySelector('.nav button[data-page="chat"]');
  if (b) b.textContent = 'Messages' + (n ? ` (${n})` : '');
  syncTopbar();
}
function onChatMsg(m) {
  if (m.sender_id !== currentUser.id) notifySound();
  const onChat = !$('page-chat').hidden;
  if (chatCur && onChat && m.conversation_id === chatCur.id) {
    addBubble(m);
    refreshDocsLive();
    if (m.sender_id !== currentUser.id) _supabase.rpc('chat_mark_read', { p_conv: chatCur.id });
    return;
  }
  refreshChatBadge();
  if (onChat && !chatCur) loadConvs();
}

async function openAssocChat() {
  const { data, error } = await _supabase.rpc('assoc_chat_open');
  if (error) {
    if (/LIMITE_PLAN/.test(error.message)) { if (ROLE === 'owner') upgradePopup('Le chat des associés est inclus dans le plan Diamant.', 'diamant'); else alert('Le chat des associés n\'est pas activé sur le plan de ton entreprise.'); }
    else alert(error.message);
    return;
  }
  chatNames = new Map((data.members || []).map(m => [m.id, m.name]));
  openThread({ id: data.id, other_name: 'Chat des associés', other_kind: null, other_wa: null, group: true });
}
async function loadConvs() {
  const box = $('chatConvs'); box.innerHTML = '<p class="note">Chargement...</p>';
  const { data, error } = await _supabase.rpc('chat_list');
  box.innerHTML = '';
  if ((ROLE === 'owner' || ROLE === 'associe') && profile.business_type !== 'normal') {
    const g = document.createElement('div'); g.className = 'catalog-item conv';
    const gi = document.createElement('div'); const gs = document.createElement('strong'); gs.textContent = 'Chat des associés';
    const gn = document.createElement('div'); gn.className = 'note'; gn.textContent = 'Discussion privée entre le patron et les associés · plan Diamant';
    gi.append(gs, gn); g.appendChild(gi); g.addEventListener('click', openAssocChat); box.appendChild(g);
  }
  if (error) { box.appendChild(document.createTextNode('Erreur : ' + error.message)); return; }
  if (!data.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Aucune conversation pour le moment.'; box.appendChild(p); return; }
  data.forEach(c => {
    const row = document.createElement('div'); row.className = 'catalog-item conv';
    const info = document.createElement('div');
    const s = document.createElement('strong'); s.textContent = c.other_name;
    if (c.unread) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = c.unread; s.appendChild(bd); }
    const m = document.createElement('div'); m.className = 'note';
    m.textContent = (c.preview || 'Nouvelle conversation') + (c.last_at ? ' · ' + chatTime(c.last_at) : '');
    info.append(s, m); row.appendChild(info);
    row.addEventListener('click', () => openThread(c));
    box.appendChild(row);
  });
}

function addBubble(m, prepend) {
  if (chatSeen.has(m.id)) return;
  const att = m.kind === 'document' ? (m.message_attachments || [])[0] : null;
  if (m.kind === 'document' && !att) { fetchDocMsg(m.id); return; } // temps réel : on relit le message avec sa pièce jointe
  chatSeen.add(m.id);
  const d = document.createElement('div');
  d.className = 'bubble' + (m.sender_id === currentUser.id ? ' me' : '') + (att ? ' doc' : '');
  if (chatCur && chatCur.group && m.sender_id !== currentUser.id) { const w = document.createElement('strong'); w.style.display = 'block'; w.textContent = chatNames.get(m.sender_id) || 'Associé'; d.appendChild(w); }
  if (att) d.appendChild(buildDocCard(att)); else d.appendChild(document.createTextNode(m.body));
  const t = document.createElement('span'); t.className = 't'; t.textContent = chatTime(m.created_at);
  d.appendChild(t);
  const box = $('chatMsgs');
  if (prepend) box.insertBefore(d, box.firstChild);
  else { box.appendChild(d); box.scrollTop = box.scrollHeight; }
}
async function fetchDocMsg(id) {
  const { data } = await _supabase.from('messages').select('id, sender_id, body, kind, created_at, message_attachments(*)').eq('id', id).maybeSingle();
  if (data && data.message_attachments && data.message_attachments.length) addBubble(data);
}
async function loadMsgs(older) {
  let q = _supabase.from('messages').select('id, sender_id, body, kind, created_at, message_attachments(*)').eq('conversation_id', chatCur.id).order('created_at', { ascending: false }).limit(30);
  if (older && chatOldest) q = q.lt('created_at', chatOldest);
  const { data, error } = await q;
  if (error) { setStatus('chatStatus', 'Erreur : ' + error.message, 'err'); return; }
  const rows = data || [];
  if (rows.length) chatOldest = rows[rows.length - 1].created_at;
  $('chatMore').hidden = rows.length < 30;
  if (older) rows.forEach(m => addBubble(m, true));          // du plus récent au plus ancien, chaque message passe en haut
  else [...rows].reverse().forEach(m => addBubble(m));
}
async function openThread(c) {
  chatCur = c; chatSeen = new Set(); chatOldest = null; chatDocEls = new Map();
  $('chatList').hidden = true; $('chatThread').hidden = false;
  $('chatShare').hidden = true; $('chatDoc').hidden = true;
  $('chatWith').textContent = c.other_name;
  $('chatProfile').hidden = !c.other_kind;
  $('chatWa').hidden = !waOk(c.other_wa);
  $('chatAttach').hidden = ROLE !== 'owner';
  $('chatMsgs').innerHTML = ''; setStatus('chatStatus', '');
  await loadMsgs(false);
  refreshDocsLive();
  _supabase.rpc('chat_mark_read', { p_conv: c.id }).then(refreshChatBadge);
}
async function openChatWith(userId, entry) {
  if (userId === currentUser.id) return;
  const { data: cid, error } = await _supabase.rpc('chat_open', { p_other: userId });
  if (error) { alert('Impossible d\'ouvrir la conversation : ' + error.message); return; }
  setPage('chat');
  openThread({ id: cid, other_id: userId, other_name: entry.name, other_kind: entry.kind, other_wa: entry.whatsapp });
}
async function sendChat() {
  const body = $('chatInput').value.trim();
  if (!body || !chatCur) return;
  $('chatSend').disabled = true;
  const { data, error } = await _supabase.from('messages').insert([{ conversation_id: chatCur.id, body }]).select('id, sender_id, body, kind, created_at').single();
  $('chatSend').disabled = false;
  if (error) { setStatus('chatStatus', 'Message non envoyé : ' + error.message, 'err'); return; }
  $('chatInput').value = ''; setStatus('chatStatus', '');
  addBubble(data);
}
$('chatSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); sendChat(); } });
$('chatMore').addEventListener('click', () => loadMsgs(true));
$('chatBack').addEventListener('click', () => { chatCur = null; $('chatThread').hidden = true; $('chatList').hidden = false; loadConvs(); refreshChatBadge(); });
$('chatToDir').addEventListener('click', () => setPage('annuaire'));
$('chatWa').addEventListener('click', () => { if (chatCur) window.open(waLink(chatCur.other_wa), '_blank'); });
$('chatProfile').addEventListener('click', async () => {
  const { data } = await _supabase.from('directory_entries').select('*').eq('user_id', chatCur.other_id).maybeSingle();
  if (!data) { setStatus('chatStatus', 'Cette fiche n\'est plus visible dans l\'annuaire.', 'err'); return; }
  setPage('annuaire'); openDirDetail(data);
});

/* ============================================================
   DOCUMENTS DANS LE CHAT : cartes liées à l'enregistrement
   Le document n'est jamais copié : la carte pointe vers l'original.
   Une empreinte prise à l'envoi détecte toute modification ensuite.
   ============================================================ */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC_LABEL = { devis: 'DEVIS', facture: 'FACTURE', bon_commande: 'BON DE COMMANDE' };

function docStatusLabel(att, live) {
  if (live && live.deleted) return 'Supprimé par son émetteur';
  if (live && live.modified) return 'Modifié depuis l\'envoi';
  if (att.doc_type === 'devis') {
    if (att.decision === 'accepté') return att.generated_invoice_id ? 'Accepté · facture émise' : 'Accepté';
    if (att.decision === 'refusé') return 'Refusé';
    if (live && live.expired) return 'Expiré';
    return 'En attente';
  }
  const st = live ? live.status : '';
  return st === 'payée' ? 'Payée' : st === 'partielle' ? 'Partiellement payée' : 'Non payée / À encaisser';
}
function buildDocCard(att) {
  const w = document.createElement('div'); w.className = 'doccard';
  const line = (txt, strong) => { const d = document.createElement('div'); if (strong) { const s = document.createElement('strong'); s.textContent = txt; d.appendChild(s); } else d.textContent = txt; w.appendChild(d); return d; };
  line(`${DOC_LABEL[att.doc_type] || 'DOCUMENT'} Tamzorya`, true);
  line(`N° : ${att.doc_number}`);
  line(`${att.sender_id === currentUser.id ? 'Émetteur : toi' : 'Fournisseur : ' + (att.seller_name || '-')}`);
  line(`Montant : ${fmt(att.shared_total)} ${att.shared_currency || ''}`);
  const st = line('Statut : ' + docStatusLabel(att, null));
  const acts = document.createElement('div'); acts.className = 'actions';
  acts.append(mk(att.doc_type === 'devis' ? 'Consulter le devis' : 'Consulter', 'primary', () => openDocViewer(att.id)), mk('Télécharger le PDF', 'secondary', () => docPdf(att.id)));
  w.appendChild(acts);
  chatDocEls.set(att.id, { att, st });
  return w;
}
async function refreshDocsLive() {
  const ids = [...chatDocEls.keys()];
  if (!ids.length) return;
  const { data } = await _supabase.rpc('chat_docs_live', { p_att_ids: ids.slice(0, 50) });
  (data || []).forEach(r => {
    const x = chatDocEls.get(r.att_id); if (!x) return;
    x.att.decision = r.decision; x.att.generated_invoice_id = r.generated_invoice_id;
    x.st.textContent = 'Statut : ' + docStatusLabel(x.att, r);
  });
}

// Partager un de mes documents
$('chatAttach').addEventListener('click', async () => {
  const box = $('chatShare');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = '<p class="note">Chargement...</p>';
  const { data, error } = await _supabase.from('invoices').select('id, number, doc_type, client_name, total_amount, currency, status').eq('user_id', WID).order('created_at', { ascending: false }).limit(15);
  box.innerHTML = '';
  const h = document.createElement('strong'); h.textContent = 'Quel document envoyer ?'; box.appendChild(h);
  if (error) { box.appendChild(document.createTextNode(' Erreur : ' + error.message)); return; }
  if (!data.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Aucun document enregistré.'; box.appendChild(p); return; }
  data.forEach(inv => {
    const row = document.createElement('div'); row.className = 'catalog-item';
    const info = document.createElement('div'); info.className = 'note';
    info.textContent = `${inv.doc_type === 'devis' ? 'Devis' : 'Facture'} ${inv.number} · ${inv.client_name} · ${fmt(inv.total_amount)} ${inv.currency}`;
    row.append(info, mk('Envoyer', 'success', async () => {
      const { data: mid, error: e } = await _supabase.rpc('chat_share_document', { p_conv: chatCur.id, p_invoice: inv.id });
      if (e) { alert('Envoi impossible : ' + e.message); return; }
      box.hidden = true; fetchDocMsg(mid);
    }));
    box.appendChild(row);
  });
});

function docAlt(d) {
  const rate = Number(d.doc.rate_locked) || Number(d.company.exchange_rate) || OFFICIAL_RATE || 0; if (!rate) return '';
  const cur = d.doc.currency, loc = (d.company.currency && d.company.currency !== 'USD') ? d.company.currency : 'CDF';
  const alt = cur === 'USD' ? d.doc.total_amount * rate : d.doc.total_amount / rate;
  return `Soit environ : ${fmt(alt)} ${cur === 'USD' ? loc : 'USD'} (taux ${d.doc.rate_locked ? 'figé' : 'du jour'} : 1 USD = ${fmt(rate)} ${loc})`;
}
const docValidity = d => d.doc.valid_until ? `${validText(d.doc.valid_hours)} (jusqu'au ${chatTime(d.doc.valid_until)})` : '';

async function openDocViewer(attId) {
  const box = $('chatDoc'); box.hidden = false; box.innerHTML = '<p class="note">Chargement...</p>';
  const { data: d, error } = await _supabase.rpc('chat_get_document', { p_att: attId });
  box.innerHTML = '';
  const add = (tag, txt, cls) => { const e = document.createElement(tag); e.textContent = txt; if (cls) e.className = cls; box.appendChild(e); return e; };
  if (error) { add('p', 'Erreur : ' + error.message, 'status err'); box.appendChild(mk('Fermer', 'secondary', () => { box.hidden = true; })); return; }
  if (d.deleted) { add('p', 'Ce document a été supprimé par son émetteur.', 'status err'); box.appendChild(mk('Fermer', 'secondary', () => { box.hidden = true; })); return; }
  const doc = d.doc, a = d.att;
  add('h3', `${DOC_LABEL[doc.doc_type] || 'DOCUMENT'} n° ${doc.number}`);
  add('p', `Émetteur : ${d.company.name || '-'} · ${chatTime(doc.created_at)}\nClient : ${doc.client_name}`, 'note').style.whiteSpace = 'pre-line';
  if (d.modified) add('p', 'Ce document a été modifié depuis son envoi : les montants peuvent différer de la carte. Demande à l\'émetteur de le renvoyer.', 'status err');
  if (d.expired) add('p', 'Ce document a expiré : les prix et le taux ne sont plus garantis.', 'status err');
  const wrap = document.createElement('div'); wrap.style.overflowX = 'auto';
  const tb = document.createElement('table'); tb.className = 'doctable';
  tb.innerHTML = '<thead><tr><th>Article</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead>';
  const body = document.createElement('tbody');
  d.items.forEach(it => { const tr = document.createElement('tr'); [it.description, it.quantity, fmt(it.unit_price), fmt(it.total_price)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); body.appendChild(tr); });
  tb.appendChild(body); wrap.appendChild(tb); box.appendChild(wrap);
  add('p', `Total : ${fmt(doc.total_amount)} ${doc.currency}`).style.fontWeight = '700';
  if (docAlt(d)) add('p', docAlt(d), 'note');
  if (docValidity(d)) add('p', docValidity(d) + '. Prix et taux figés à la validation.', 'note');
  const acts = document.createElement('div'); acts.className = 'actions';
  const canInvoice = profile.business_type === 'commercant' && ROLE === 'owner';
  if (!d.is_sender && a.doc_type === 'devis') {
    if (a.decision === 'en_attente' && !d.expired && !d.modified) {
      acts.append(mk(canInvoice ? 'Accepter et générer la facture' : 'Accepter', 'success', () => acceptDevis(a, d, false)));
      acts.append(mk('Refuser', 'danger', () => refuseDevis(a)));
    } else if (a.decision === 'accepté' && !a.generated_invoice_id && canInvoice) {
      acts.append(mk('Générer la facture', 'success', () => acceptDevis(a, d, true)));
    }
  }
  if (!d.is_sender && a.doc_type === 'facture' && doc.status === 'payée' && profile.business_type === 'prestataire' && ROLE === 'owner') {
    acts.append(mk('Noter le commerçant', 'secondary', () => profile.plan === 'pro' ? rateMerchant(a.id) : needPro('La notation des commerçants')));
  }
  acts.append(mk('Télécharger le PDF', 'secondary', () => printDocWindow(d)), mk('Fermer', 'secondary', () => { box.hidden = true; }));
  box.appendChild(acts);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function docPdf(attId) {
  const { data: d, error } = await _supabase.rpc('chat_get_document', { p_att: attId });
  if (error || d.deleted) { alert(error ? error.message : 'Document supprimé.'); return; }
  printDocWindow(d);
}
function printDocWindow(d) {
  const w = window.open('', '_blank');
  if (!w) { alert('Autorise l\'ouverture de fenêtres pour télécharger le PDF.'); return; }
  const doc = d.doc, co = d.company || {}, color = /^#[0-9a-f]{3,8}$/i.test(co.brand_color || '') ? co.brand_color : '#123b70';
  const rows = d.items.map(i => `<tr><td>${esc(i.description)}</td><td>${esc(i.quantity)}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.total_price)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#222}h1{font-size:22px;color:${color};margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.n{color:#555;font-size:13px;margin:4px 0}.t{text-align:right;font-size:18px;font-weight:700;margin-top:14px}</style></head><body><h1>${esc(co.name || 'Tamzorya')}</h1><div class="n">${esc([co.address, co.city].filter(Boolean).join(', '))}${co.phone ? ' | Tél : ' + esc(co.phone) : ''}</div><h2>${esc(DOC_LABEL[doc.doc_type] || 'DOCUMENT')} n° ${esc(doc.number)}</h2><div class="n">Date : ${esc(new Date(doc.created_at).toLocaleDateString('fr-FR'))}<br>Client : ${esc(doc.client_name)}</div><table><thead><tr><th>Article</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="t">TOTAL : ${fmt(doc.total_amount)} ${esc(doc.currency)}</div><div class="n" style="text-align:right">${esc(docAlt(d))}</div><div class="n" style="text-align:right"><b>${esc(docValidity(d))}</b></div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// Numéro de facture du commerçant (même format que l'éditeur)
async function nextDocNumber(pre) {
  const prefix = `${pre}-${new Date().getFullYear()}-`; let next = 1;
  const { data } = await _supabase.from('invoices').select('number').eq('user_id', WID).like('number', prefix + '%');
  (data || []).forEach(r => { const m = r.number.match(new RegExp('^' + pre + '-\\d{4}-(\\d+)$')); if (m) next = Math.max(next, parseInt(m[1], 10) + 1); });
  return prefix + String(next).padStart(4, '0');
}
async function refuseDevis(a) {
  const note = prompt('Raison du refus (facultatif) :', '');
  if (note === null) return;
  const { error } = await _supabase.rpc('chat_decide_document', { p_att: a.id, p_accept: false, p_note: note || null });
  if (error) { alert('Erreur : ' + error.message); return; }
  $('chatDoc').hidden = true; refreshDocsLive();
}
async function acceptDevis(a, d, alreadyAccepted) {
  const canInvoice = profile.business_type === 'commercant' && ROLE === 'owner';
  if (canInvoice) { const lim = await checkLimit('facture'); if (lim) return; }
  if (!alreadyAccepted) {
    const { error } = await _supabase.rpc('chat_decide_document', { p_att: a.id, p_accept: true, p_note: null });
    if (error) { alert('Erreur : ' + error.message); return; }
  }
  if (!canInvoice) { alert('Devis accepté. L\'émetteur est prévenu.'); $('chatDoc').hidden = true; refreshDocsLive(); return; }
  try {
    const number = await nextDocNumber('FAC'), doc = d.doc;
    const { data: inv, error } = await _supabase.from('invoices').insert([{
      user_id: WID, number, client_name: d.company.name || 'Client', client_phone: d.company.phone || '', client_email: d.company.email || '',
      total_amount: doc.total_amount, currency: doc.currency, doc_type: 'facture', status: 'impayée',
      ...(profile.plan === 'pro' ? { rate_locked: effRate() } : {})
    }]).select().single();
    if (error) throw error;
    const items = d.items.map(it => ({ invoice_id: inv.id, description: it.description, kind: null, quantity: it.quantity, unit_price: it.unit_price, total_price: it.total_price }));
    const { error: ie } = await _supabase.from('invoice_items').insert(items);
    if (ie) { await _supabase.from('invoices').delete().eq('id', inv.id); throw ie; }
    const stock = d.items.map(it => { const c = catalogItems.find(x => x.name === it.description && x.stock != null); return c ? { id: String(c.id), qty: Number(it.quantity) || 0 } : null; }).filter(Boolean);
    if (stock.length) { await _supabase.rpc('adjust_stock', { p_items: stock }); loadCatalog(); }
    const { error: le } = await _supabase.rpc('chat_issue_invoice', { p_att: a.id, p_invoice: inv.id });
    if (le) throw le;
    alert(`Facture ${number} créée : « Non payée / À encaisser ». Elle reste ainsi jusqu'à ce que tu confirmes avoir reçu l'argent dans « Mes factures ».`);
  } catch (err) { alert('Erreur : ' + err.message + '\nLe devis est accepté : touche « Générer la facture » pour réessayer.'); }
  $('chatDoc').hidden = true; refreshDocsLive();
}

/* ============================================================
   FIABILITÉ DES COMMERÇANTS (note /5 calculée chaque jour par la base)
   A 40 % : avis des prestataires PRO · B 40 % : devis acceptés honorés
   C 20 % : rapidité de réponse au chat
   ============================================================ */
function repLabel(e) {
  if (e.kind !== 'commercant' || e._rep === undefined) return '';
  const r = e._rep;
  return r && r.score != null ? `${Number(r.score).toFixed(1).replace('.', ',')}${r.ratings_count ? ` (${r.ratings_count} avis)` : ''}` : 'Nouveau';
}
const fmtDelay = m => m < 60 ? Math.round(m) + ' min' : m < 1440 ? (m / 60).toFixed(1).replace('.', ',') + ' h' : Math.round(m / 1440) + ' j';
async function showRepDetail(e) {
  if (profile.plan !== 'pro') { needPro('Les statistiques de fiabilité'); return; }
  const { data, error } = await _supabase.rpc('reputation_detail', { p_id: e.user_id });
  if (error) { $('dirRep').textContent = 'Erreur : ' + error.message; return; }
  $('dirRep').textContent = [
    repLabel(e),
    'Avis de prestataires PRO : ' + (data.stars_avg != null ? `${Number(data.stars_avg).toFixed(1)}/5 (${data.ratings_count} avis)` : 'aucun avis'),
    'Devis acceptés honorés : ' + (data.accepted_count ? `${data.honored_count} sur ${data.accepted_count} (${Math.round(data.conversion_pct)} %)` : 'pas encore de données'),
    'Réactivité du chat : ' + (data.avg_reply_min != null ? 'réponse en moyenne en ' + fmtDelay(data.avg_reply_min) : 'pas encore de données'),
    'Mise à jour : ' + new Date(data.computed_at).toLocaleDateString('fr-FR')
  ].join('\n');
}
async function rateMerchant(attId) {
  const s = parseInt(prompt('Ta note pour ce commerçant (de 1 à 5) :', '5'), 10);
  if (!(s >= 1 && s <= 5)) return;
  const c = prompt('Un commentaire (facultatif) :') || '';
  const { error } = await _supabase.rpc('rate_merchant', { p_att: attId, p_stars: s, p_comment: c.slice(0, 300) });
  alert(error ? error.message : 'Merci ! Ta note est enregistrée.');
}

/* ============================================================
   LIMITES DES PLANS : fenêtres contextuelles + contrôle à l'ouverture
   (le serveur applique les mêmes limites : la base refuse si on triche)
   ============================================================ */
async function teamGate(role) {
  const t = curTier(), L = TIERS[t], emp = role !== 'associe';
  const { data } = await _supabase.from('team_invites').select('role').eq('owner_id', currentUser.id);
  const n = (data || []).filter(r => (r.role === 'associe') !== emp).length;
  const max = emp ? L.employees : L.associes;
  if (n < max) return true;
  const word = emp ? (isPrest() ? 'aide' : 'vendeur') : 'associé';
  if (t === 'gratuit') upgradePopup(`Le plan Gratuit n'inclut pas d'équipe : impossible d'ajouter un ${word}.`, 'standard');
  else if (t === 'standard') upgradePopup(`Ton plan Standard permet ${max} ${emp ? (isPrest() ? 'aides' : 'vendeurs') : 'associés'} au maximum.`, 'diamant'); // Standard → Diamant
  else if (t === 'diamant' && !isPrest()) upgradePopup(`Ton plan Diamant est limité à ${max} ${emp ? 'employés' : 'associés'}.`, 'platine');
  else upgradePopup(`Limite atteinte : ${max} ${emp ? 'employés' : 'associés'} au maximum avec ton plan.`);
  return false;
}
async function estabGate() {
  const t = curTier(), L = TIERS[t];
  const { count } = await _supabase.from('establishments').select('id', { count: 'exact', head: true }).eq('owner_id', currentUser.id);
  if (1 + (count || 0) < L.estab) return true;
  if (t === 'gratuit') upgradePopup('Le plan Gratuit est limité à 1 entreprise.', 'standard');
  else if (t === 'standard') upgradePopup('Ton plan Standard est limité à 2 entreprises. Ajouter une 3ᵉ demande le plan Diamant.', 'diamant'); // Standard → Diamant
  else if (t === 'diamant' && !isPrest()) upgradePopup('Ton plan Diamant est limité à 5 boutiques. Une 6ᵉ demande le plan Platine.', 'platine'); // Diamant → Platine
  else upgradePopup(`Limite atteinte : ${L.estab} établissements au maximum avec ton plan.`);
  return false;
}
async function loadEstab() {
  const L = TIERS[curTier()], box = $('estabList'); box.innerHTML = '';
  const { data } = await _supabase.from('establishments').select('*').eq('owner_id', currentUser.id).order('created_at');
  $('estabInfo').textContent = `Entreprise principale + ${(data || []).length} autre(s) · limite de ton plan ${TIERS[curTier()].name} : ${L.estab} au total.`;
  (data || []).forEach(x => {
    const row = document.createElement('div'); row.className = 'catalog-item';
    const info = document.createElement('div'); info.className = 'note'; info.textContent = x.name + (x.address ? ' · ' + x.address : '');
    row.append(info, mk('Retirer', 'danger', async () => { await _supabase.from('establishments').delete().eq('id', x.id); loadEstab(); }));
    box.appendChild(row);
  });
}
$('estabAdd').addEventListener('click', async () => {
  const name = $('estabName').value.trim();
  if (name.length < 2) { setStatus('estabStatus', 'Écris le nom de l\'établissement.', 'err'); return; }
  if (!(await estabGate())) return;
  const { error } = await _supabase.from('establishments').insert([{ name, address: $('estabAddr').value.trim() }]);
  if (error) { setStatus('estabStatus', error.message, 'err'); return; }
  $('estabName').value = ''; $('estabAddr').value = ''; setStatus('estabStatus', 'Ajouté.', 'ok'); loadEstab();
});

// Vérification globale à l'ouverture : l'essai ou l'abonnement est-il terminé ?
async function checkSubscription() {
  const { data } = await _supabase.rpc('sub_check');
  if (!data) return;
  if (data.changed) { await loadProfile0(); applyProfile(); }
  if (data.expired_paid) {
    const t = TIERS[data.plan_type] || TIERS.standard;
    $('appView').hidden = true; $('planLockView').hidden = false;
    $('lockTitle').textContent = data.was_trial ? `Ton essai ${t.name} est terminé` : `Ton abonnement ${t.name} a expiré`;
    $('lockText').textContent = `Pour retrouver toutes les fonctions du plan ${t.name}, règle ${t.m} $/mois (ou ${t.y} $/an) par Mobile Money. Tes données sont conservées. Tu peux aussi continuer avec le plan Gratuit.`;
    payTier = data.plan_type;
  }
}
$('lockPay').addEventListener('click', () => { $('planLockView').hidden = true; $('appView').hidden = false; setPage('pro'); });
$('lockFree').addEventListener('click', async () => {
  await _supabase.rpc('sub_downgrade_free');
  await loadProfile0(); applyProfile();
  $('planLockView').hidden = true; $('appView').hidden = false;
});

/* ============================================================
   DICTÉE VOCALE DU DEVIS (prestataire) : on parle, l'écran remplit
   Reconnaissance du navigateur (gratuite) + lecture des phrases simples.
   ============================================================ */
/*VOICE-PARSE-START*/
const NUMW = { 'zéro': 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16 };
const NUMT = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
function wordsToDigits(text) {
  const words = text.replace(/(\p{L})-(?=\p{L})/gu, '$1 ').split(/\s+/).filter(Boolean), out = [];
  const split = w => { const m = w.match(/^(.*?)([.,;:!?]*)$/u); return [m[1].toLowerCase(), m[2]]; };
  const isNum = c => c in NUMW || c in NUMT || c === 'cent' || c === 'cents' || c === 'mille';
  let i = 0;
  while (i < words.length) {
    if (!isNum(split(words[i])[0])) { out.push(words[i]); i++; continue; }
    let total = 0, cur = 0, punct = '', prevTens = false;
    while (i < words.length) {
      const [x, p] = split(words[i]), nx = i + 1 < words.length ? split(words[i + 1])[0] : '';
      if (x === 'et' && prevTens && isNum(nx)) { prevTens = false; i++; continue; }          // « vingt et un »
      let used = 1;
      if (x === 'quatre' && /^vingts?$/.test(nx)) { cur += 80; used = 2; prevTens = false; }
      else if (x in NUMW) { cur += NUMW[x]; prevTens = false; }
      else if (x in NUMT) { cur += NUMT[x]; prevTens = true; }
      else if (x === 'cent' || x === 'cents') { cur = (cur || 1) * 100; prevTens = false; }
      else if (x === 'mille') { total += (cur || 1) * 1000; cur = 0; prevTens = false; }
      else break;
      punct = used === 2 ? split(words[i + 1])[1] : p; i += used;
      if (punct) break;
    }
    out.push(String(total + cur) + punct);
  }
  return out.join(' ');
}
const DIGW = { 'zéro': 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9 };
const LAB_RE = /^(?:la\s+)?(?:main[\s-]*d['’\s]*(?:œ|oe|o)\s*[a-z]*\s*uvre|main[\s-]*d['’\s]*[a-zœ]*uvre|travail|pose|installation|montage|intervention|d[ée]placement)/i;
const ITEM_RE = /^(?:(\d+(?:[.,]\d+)?)\s+)?(.+?)\s*(?:à|a|prix|pour|:|=|coûte|coute|fait)?\s*(\d+(?:[.,]\d+)?)\s*(\$|dollars?|usd|fc|francs?|cdf|fcfa|xaf|xof)?(?:\s+(?:le|la|l['’]|chacun|chacune|pi[èe]ce|unit[ée]|par)\b.*)?$/i;
function parseDevisVocal(raw, cur, rate) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  const res = { client: '', phone: '', lines: [], skipped: [] };
  // 1) téléphone (chiffres ou chiffres dictés un par un)
  const km = t.match(/(?:t[ée]l[ée]phone|t[ée]l|num[ée]ro|contact|whatsapp)\s*(?:est|:|au)?\s*/i);
  if (km) {
    const before = t.slice(0, km.index), toks = t.slice(km.index + km[0].length).split(' ');
    let digits = '', used = 0;
    for (const w of toks) {
      const lw = w.toLowerCase().replace(/[.,;]+$/, '');
      let d = null;
      if (/^\+?[\d-]+$/.test(lw)) d = lw.replace(/[^\d+]/g, '');
      else if (lw in DIGW) d = String(DIGW[lw]);
      if (d === null) break;
      const n = digits.replace(/\D/g, '').length;
      if (n >= (digits.startsWith('0') ? 10 : 12)) break;
      digits += d; used++;
      if (/[.;,]$/.test(w)) break;
    }
    if (digits.replace(/\D/g, '').length >= 8) {
      const endP = used && /[.;,]$/.test(toks[used - 1]) ? '. ' : ' ';   // la fin de phrase reste une fin de phrase
      res.phone = digits; t = (before + endP + toks.slice(used).join(' ')).replace(/\s+/g, ' ').trim();
    }
  }
  // 2) nom du client
  const cm = t.slice(0, 80).match(/(?:devis\s+)?(?:pour|client|cliente|chez)\s+([^.,;\d]+)/i);
  if (cm) {
    const stop = new Set(['téléphone', 'telephone', 'tél', 'tel', 'numéro', 'numero', 'contact', 'puis', 'ensuite', 'et', 'avec', 'voici', 'il', 'elle']);
    const words = []; for (const w of cm[1].trim().split(' ')) { if (stop.has(w.toLowerCase())) break; words.push(w); if (words.length >= 4) break; }
    res.client = words.join(' ').replace(/\b\p{L}/gu, m => m.toUpperCase());
    t = (t.slice(0, cm.index) + ' ' + t.slice(cm.index + cm[0].length - (cm[1].length - words.join(' ').length))).replace(/\s+/g, ' ').replace(/^[\s,.;:]+/, '').trim();
  }
  // 3) lignes du devis
  t = wordsToDigits(t);
  const segs = t.split(/[;!?\n]+|\.(?=\s|$)|,\s+(?=\D)|\s+(?:puis|ensuite|après|ajoute|ajouter)\s+/i).map(s => s.replace(/^[\s,.;:]+/, '').replace(/^(?:et|avec|puis|ensuite|après|ajoute|ajouter|il y a|plus)\s+/i, '').trim()).filter(Boolean);
  const num = x => parseFloat(String(x).replace(',', '.'));
  for (const s of segs) {
    if (/^(?:devis|total|merci|voilà|voila)\b/i.test(s)) continue;
    const m = s.match(ITEM_RE);
    if (!m) { res.skipped.push(s); continue; }
    let qty = m[1] ? num(m[1]) : 1, price = num(m[3]), desc = m[2].replace(/\s+(?:de|du|des|à|a)$/i, '').trim();
    const tok = (m[4] || '').toLowerCase(), isUsd = /^(\$|dollars?|usd)$/.test(tok), isLoc = /^(fc|francs?|cdf|fcfa|xaf|xof)$/.test(tok);
    if (rate > 0 && isUsd && cur !== 'USD') price = price * rate;
    else if (rate > 0 && isLoc && cur === 'USD') price = price / rate;
    price = Math.round(price * 100) / 100;
    if (!desc || !(price > 0) || !(qty > 0)) { res.skipped.push(s); continue; }
    if (LAB_RE.test(desc)) {                                // main-d'œuvre : un seul montant
      const um = desc.match(/(\d+(?:[.,]\d+)?)\s*(jours?|heures?|h|mois)\b/i);
      if (um) { price = Math.round(price * num(um[1]) * 100) / 100; desc = desc.replace(/\s*\d+(?:[.,]\d+)?\s*(?:jours?|heures?|h|mois)\b/i, '').trim() + ` (${um[1]} ${um[2]})`; }
      else if (m[1]) price = Math.round(price * qty * 100) / 100;
      res.lines.push({ desc: desc.charAt(0).toUpperCase() + desc.slice(1), qty: 1, price, kind: 'main_oeuvre' });
    } else {
      const qm = !m[1] && desc.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s+(\p{L}[\p{L}'’ -]*)$/u);
      if (qm) { qty = num(qm[2]); desc = `${qm[1]} (${qm[3]})`; }
      res.lines.push({ desc: desc.charAt(0).toUpperCase() + desc.slice(1), qty, price, kind: 'fourniture' });
    }
  }
  return res;
}
/*VOICE-PARSE-END*/

let recog = null;
// Appel de l'IA : elle nettoie la phrase et range les infos ; les conversions et les produits sont calculés ici (fiable)
async function aiDictee(txt) {
  const cur = currency(), rate = effRate();
  const { data, error } = await _supabase.functions.invoke('tamzorya-dictee', { body: { texte: txt.slice(0, 1500), devise: cur, pays: profile.country || '' } });
  if (error || !data || !Array.isArray(data.lignes)) {
    let code = '';
    try { code = (await error.context.json()).error; } catch (_) { /* pas de détail */ }
    const e = new Error(code || 'indisponible'); e.code = code; throw e;
  }
  const conv = (p, dev) => rate > 0 && dev === 'USD' && cur !== 'USD' ? p * rate : rate > 0 && dev === 'LOCAL' && cur === 'USD' ? p / rate : p;
  const res = { client: String(data.client || '').slice(0, 60), phone: String(data.telephone || '').replace(/[^\d+]/g, '').slice(0, 16), lines: [], skipped: (data.non_compris || []).map(x => String(x).slice(0, 80)), left: data.left };
  for (const l of data.lignes.slice(0, 30)) {
    const labour = l.type === 'main_oeuvre';
    let qty = Number(l.quantite) > 0 ? Number(l.quantite) : 1, unit = Number(l.prix_unitaire) || 0;
    if (!(unit > 0) || !String(l.designation || '').trim()) { res.skipped.push(String(l.designation || '?') + ' (prix manquant)'); continue; }
    let price = Math.round(conv(unit, l.devise) * 100) / 100;
    if (labour) { price = Math.round(price * qty * 100) / 100; qty = 1; }
    res.lines.push({ desc: String(l.designation).trim().slice(0, 120), qty, price, kind: labour ? 'main_oeuvre' : 'fourniture' });
  }
  if (rate <= 0 && data.lignes.some(l => (l.devise === 'USD' && cur !== 'USD') || (l.devise === 'LOCAL' && cur === 'USD'))) res.skipped.push('Taux de change absent : renseigne-le dans « Mon entreprise » pour convertir.');
  return res;
}
async function applyVoice() {
  const txt = $('voiceText').value.trim();
  if (!txt) { $('voiceResult').textContent = 'Parle ou écris d\'abord ce que tu veux mettre dans le devis.'; return; }
  $('voiceApply').disabled = true; $('voiceBtn').disabled = true; $('voiceState').textContent = 'Je réfléchis...';
  let r = null, mode = 'ia';
  try { r = await aiDictee(txt); }
  catch (e) {
    $('voiceApply').disabled = false; $('voiceBtn').disabled = false; $('voiceState').textContent = '';
    if (e.code === 'LIMIT') {
      const t = curTier();
      upgradePopup(t === 'gratuit' ? 'Tes 3 dictées IA du mois sont utilisées.' : 'Tes 20 dictées IA du mois sont utilisées. Le plan Diamant les rend illimitées.', t === 'gratuit' ? 'standard' : 'diamant');
      $('voiceResult').textContent = 'Limite de dictées IA atteinte pour ce mois.';
      return;
    }
    r = parseDevisVocal(txt, currency(), effRate()); mode = 'simple'; // IA indisponible : lecture simple
  }
  $('voiceApply').disabled = false; $('voiceBtn').disabled = false; $('voiceState').textContent = '';
  if (r.client) $('clientName').value = r.client;
  if (r.phone) $('clientPhone').value = r.phone;
  [...$('invoiceItemsTable').children].forEach(tr => { // retire les lignes vides avant d'ajouter
    if (!tr.querySelector('.row-desc').value.trim() && !parseFloat(tr.querySelector('.row-price').value)) tr.remove();
  });
  r.lines.forEach(l => addInvoiceRow(l.desc, l.price, l.qty, isPrest() ? l.kind : undefined)); // le commerçant n'a pas de « main-d'œuvre » : simples lignes
  calculateTotal(); saveDraft();
  const sum = [];
  if (r.client) sum.push('Client : ' + r.client);
  if (r.phone) sum.push('Téléphone : ' + r.phone);
  r.lines.forEach(l => sum.push(`${l.kind === 'main_oeuvre' ? '' : ''} ${l.desc}${l.kind === 'main_oeuvre' ? '' : ' × ' + l.qty} : ${fmt(l.price)} ${currency()}`));
  if (r.skipped.length) sum.push('À vérifier ou à ajouter à la main : ' + r.skipped.join(' / '));
  if (mode === 'simple') sum.push('L\'IA est indisponible : lecture simple utilisée (phrases courtes du type « article, quantité, prix »).');
  else if (r.left >= 0 && r.left != null) sum.push(`Dictées IA restantes ce mois : ${r.left}`);
  if (!r.client && !r.phone && !r.lines.length) sum.push('Je n\'ai rien compris. Dis par exemple : « Peinture 3 seaux à 25 dollars. Main d\'œuvre 50 dollars. »');
  $('voiceResult').textContent = sum.join('\n');
  if (r.lines.length || r.client || r.phone) { $('voiceText').value = ''; $('invoiceForm').scrollIntoView({ behavior: 'smooth' }); }
}
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('voiceState').textContent = 'Micro non disponible ici : utilise Chrome, ou le micro du clavier dans la zone de texte.'; $('voiceText').focus(); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR(); recog.lang = 'fr-FR'; recog.interimResults = true; recog.continuous = false;
  let finalTxt = $('voiceText').value ? $('voiceText').value.trim() + ' ' : '';
  recog.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalTxt += r[0].transcript + ' '; else interim += r[0].transcript; }
    $('voiceText').value = (finalTxt + interim).trim();
  };
  recog.onerror = ev => { $('voiceState').textContent = ev.error === 'not-allowed' ? 'Autorise le micro pour dicter.' : ev.error === 'no-speech' ? 'Je n\'ai rien entendu, réessaie.' : 'Erreur micro : ' + ev.error; };
  recog.onend = () => { recog = null; $('voiceBtn').textContent = 'Dicter le devis'; if ($('voiceText').value.trim()) { $('voiceState').textContent = ''; applyVoice(); } };
  try { recog.start(); $('voiceBtn').textContent = 'Terminer'; $('voiceState').textContent = 'Je t\'écoute...'; } catch (_) { recog = null; }
}
$('voiceBtn').addEventListener('click', startVoice);
const dicteeNav = document.querySelector('.nav button[data-action="dictee"]');
if (dicteeNav) dicteeNav.addEventListener('click', () => { setPage('facture'); $('voiceBox').hidden = false; $('voiceBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); startVoice(); });
$('voiceApply').addEventListener('click', applyVoice);

/* ============================================================
   BOUTIQUE EN LIGNE, COMMANDES À RETIRER, GUIDAGE GPS, QR
   ============================================================ */
const itemName = i => i.name || 'Article';
const numOrNull = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : null; };
const photoUrl = p => _supabase.storage.from('catalog-photos').getPublicUrl(p).data.publicUrl;
let pendingOrder = null, shop = null, shopCart = new Map();

function stockInfo(it) { // le nombre n'est montré que si le commerçant ne l'a pas masqué
  const inStock = it.stock == null || Number(it.stock) > 0;
  if (it.masquer_stock) return { text: inStock ? 'En stock' : 'Rupture de stock', cls: inStock ? 'ok' : 'out' };
  if (it.stock == null) return { text: 'En stock', cls: 'ok' };
  return { text: Number(it.stock) > 0 ? 'Stock : ' + it.stock : 'Rupture de stock', cls: Number(it.stock) <= 0 ? 'out' : Number(it.stock) <= 3 ? 'low' : 'ok' };
}
function photoBox(path, alt, badgeText, badgeCls) { // photo carrée + pastille de stock en haut à droite
  const w = document.createElement('div'); w.className = 'cat-img' + (path ? '' : ' noimg');
  if (path) { const img = document.createElement('img'); img.loading = 'lazy'; img.alt = alt; img.src = photoUrl(path); w.appendChild(img); }
  const b = document.createElement('span'); b.className = 'stock-badge ' + badgeCls; b.textContent = badgeText; w.appendChild(b);
  return w;
}
async function compressImage(file, maxBytes = 100 * 1024) { // réduit n'importe quelle photo à 100 Ko max, EN LOCAL (Canvas)
  const bmp = await createImageBitmap(file);
  let side = 1024, q = 0.72, blob = null;
  for (let i = 0; i < 10; i++) {                       // on baisse d'abord la qualité, puis la taille
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', q));
    if (blob && blob.size <= maxBytes) break;
    if (q > 0.45) q -= 0.1; else side = Math.round(side * 0.8);
  }
  return blob;
}
function guideTo(lat, lng, label) { // GPS du téléphone : itinéraire en voiture depuis la position actuelle
  const has = lat != null && lng != null && isFinite(lat) && isFinite(lng);
  const dest = has ? `${lat},${lng}` : encodeURIComponent(label || '');
  if (!dest) { alert('La position de ce fournisseur n\'est pas renseignée.'); return; }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`, '_blank');
}

// Position GPS de ma boutique
$('dirGeoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { setStatus('dirStatus', 'Ton téléphone ne donne pas sa position.', 'err'); return; }
  setStatus('dirStatus', 'Recherche de ta position...');
  navigator.geolocation.getCurrentPosition(p => {
    $('dirLat').value = p.coords.latitude.toFixed(6); $('dirLng').value = p.coords.longitude.toFixed(6);
    setStatus('dirStatus', 'Position trouvée : pense à enregistrer ta fiche.', 'ok');
  }, () => setStatus('dirStatus', 'Autorise la localisation pour utiliser ta position.', 'err'), { enableHighAccuracy: true, timeout: 15000 });
});

// Catalogue visuel d'un fournisseur (QR local ou fiche de l'annuaire)
const unitFor = (it, q) => (it.prix_gros != null && it.quantite_seuil_gros != null && q >= Number(it.quantite_seuil_gros)) ? Number(it.prix_gros) : Number(it.price);
function cartSummary() {
  let tot = 0, n = 0;
  shopCart.forEach((q, id) => { const it = shop.items.find(x => String(x.id) === id); if (it) { tot += unitFor(it, q) * q; n++; } });
  $('shopCartBar').hidden = n === 0;
  $('shopTotal').textContent = `Total : ${fmt(tot)} ${shop.currency}`;
  $('shopCount').textContent = `${n} article(s)`;
}
async function openShop(sellerId, entry) {
  setPage('boutique'); shopCart = new Map(); shop = null;
  $('shopDone').hidden = true; $('shopCartBar').hidden = true; $('shopActs').innerHTML = '';
  $('shopTitle').textContent = 'Catalogue'; $('shopMeta').textContent = ''; $('shopGrid').innerHTML = '<p class="note">Chargement...</p>';
  if (!entry) { const { data } = await _supabase.from('directory_entries').select('*').eq('user_id', sellerId).maybeSingle(); entry = data; }
  const { data, error } = await _supabase.rpc('catalog_public', { p_seller: sellerId });
  if (error || !entry) { $('shopGrid').textContent = ''; $('shopMeta').textContent = error ? error.message : 'Cette boutique n\'est pas disponible dans ton annuaire.'; return; }
  shop = { id: sellerId, entry, currency: data.currency || '', items: data.items || [] };
  $('shopTitle').textContent = '' + entry.name;
  $('shopCert').hidden = !entry.certifie_rdc; $('shopCert').textContent = 'Commerçant Certifié RDC';
  $('shopMeta').textContent = [entry.address ? '' + entry.address : '', entry.galerie ? '' + entry.galerie : '', entry.acces_details ? '' + entry.acces_details : ''].filter(Boolean).join('\n');
  if (entry.latitude != null || entry.address) $('shopActs').appendChild(mk('Guider jusqu\'au fournisseur', 'secondary', () => guideTo(entry.latitude, entry.longitude, [entry.name, entry.address, entry.city].filter(Boolean).join(', '))));
  const grid = $('shopGrid'); grid.innerHTML = '';
  if (!shop.items.length) { grid.innerHTML = '<p class="note">Ce fournisseur n\'a pas encore ajouté de produits.</p>'; return; }
  const canQuote = profile.business_type === 'prestataire' && ROLE === 'owner';
  shop.items.forEach(it => {
    const id = String(it.id), st = it.in_stock ? (it.stock_text === 'En stock' ? 'ok' : (Number(it.stock_qty) <= 3 ? 'low' : 'ok')) : 'out';
    const card = document.createElement('div'); card.className = 'cat-card';
    card.appendChild(photoBox(it.photo_path, itemName(it), it.stock_text, st));
    const body = document.createElement('div'); body.className = 'cat-body';
    const nm = document.createElement('div'); nm.className = 'cat-name'; nm.textContent = it.name || 'Sans nom';
    const pr = document.createElement('div'); pr.className = 'cat-price'; pr.textContent = `${fmt(it.price)} ${shop.currency}`;
    body.append(nm, pr);
    if (it.prix_gros != null && it.quantite_seuil_gros != null) { const g = document.createElement('div'); g.className = 'cat-gros'; g.textContent = `Gros : ${fmt(it.prix_gros)} dès ${it.quantite_seuil_gros}`; body.appendChild(g); }
    if (it.negociable) { const n = document.createElement('div'); n.className = 'cat-gros'; n.textContent = 'Négociable : discute du prix au comptoir'; body.appendChild(n); }
    const applied = document.createElement('div'); applied.className = 'cat-gros'; body.appendChild(applied);
    const qrow = document.createElement('div'); qrow.className = 'cat-qty';
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '1'; inp.value = '0'; inp.inputMode = 'numeric'; inp.disabled = !it.in_stock;
    const setQ = v => {
      let q = Math.max(0, Math.floor(Number(v) || 0)); if (it.stock_qty != null) q = Math.min(q, Number(it.stock_qty));
      inp.value = q; if (q > 0) shopCart.set(id, q); else shopCart.delete(id);
      applied.textContent = q > 0 ? `${fmt(unitFor(it, q))} ${shop.currency} l'unité${unitFor(it, q) !== Number(it.price) ? ' · prix de gros ' : ''}` : '';
      cartSummary();
    };
    inp.addEventListener('input', () => setQ(inp.value));
    qrow.append(mk('−', 'secondary', () => setQ((Number(inp.value) || 0) - 1)), inp, mk('+', 'secondary', () => setQ((Number(inp.value) || 0) + 1)));
    body.appendChild(qrow);
    if (canQuote) body.appendChild(mk('Créer un devis', 'primary', () => flashQuote(entry, { name: itemName(it), price: unitFor(it, Math.max(1, Number(inp.value) || 1)), qty: Math.max(1, Number(inp.value) || 1), currency: shop.currency })));
    card.appendChild(body); grid.appendChild(card);
  });
}
$('shopBack').addEventListener('click', () => setPage('annuaire'));
$('shopOrder').addEventListener('click', async () => {
  if (!shop || !shopCart.size) return;
  let ph = (currentUser.user_metadata && currentUser.user_metadata.phone) || (companyData && companyData.phone) || '';
  if (!ph) { // une seule fois : le numéro est ensuite enregistré dans le compte
    const typed = prompt('Ton numéro de téléphone ou WhatsApp (le vendeur en a besoin pour ta facture) :');
    if (!typed || waDigits(typed).length < 8) { alert('Numéro nécessaire pour commander.'); return; }
    const { data: u } = await _supabase.auth.updateUser({ data: { phone: phoneWithCode(typed, profile.country) } });
    if (u && u.user) currentUser = u.user;
  }
  $('shopOrder').disabled = true;
  const items = [...shopCart].map(([id, qty]) => ({ id, qty }));
  const { data, error } = await _supabase.rpc('order_create', { p_seller: shop.id, p_items: items });
  $('shopOrder').disabled = false;
  if (error) { alert('Commande impossible : ' + error.message); return; }
  shopCart = new Map(); cartSummary(); $('shopCartBar').hidden = true;
  $('shopCode').textContent = data.code; $('shopDone').hidden = false;
  const acts = $('shopDoneActs'); acts.innerHTML = '';
  acts.append(mk('Itinéraire GPS', 'primary', () => guideTo(shop.entry.latitude, shop.entry.longitude, [shop.entry.name, shop.entry.address, shop.entry.city].filter(Boolean).join(', '))), mk('Mes commandes', 'secondary', () => setPage('commandes')));
  $('shopDone').scrollIntoView({ behavior: 'smooth' });
});

// Mes commandes (tous les profils)
async function loadOrders() {
  const box = $('orderList'); box.innerHTML = '<p class="note">Chargement...</p>';
  const { data, error } = await _supabase.from('commandes_flash').select('*').eq('id_acheteur', currentUser.id).order('created_at', { ascending: false }).limit(30);
  box.innerHTML = '';
  if (error) { box.textContent = 'Erreur : ' + error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="note">Aucune commande pour le moment. Ouvre le catalogue photo d\'un fournisseur dans l\'annuaire.</p>'; return; }
  data.forEach(o => {
    const row = document.createElement('div'); row.className = 'catalog-item'; row.style.flexWrap = 'wrap';
    const info = document.createElement('div'); info.style.flex = '1 1 200px';
    const s = document.createElement('strong'); s.textContent = o.nom_boutique_copie || 'Boutique';
    const m = document.createElement('div'); m.className = 'note';
    m.textContent = `${new Date(o.created_at).toLocaleDateString('fr-FR')} · ${o.statut === 'validee' ? 'Validée' : 'En attente'} · ${fmt(o.total)} ${o.currency}\n` + (o.items || []).map(i => `${i.qty} × ${i.name}`).join(', ');
    m.style.whiteSpace = 'pre-line';
    const code = document.createElement('div'); code.className = 'cat-price'; code.textContent = 'Code : ' + o.code_retrait; code.style.letterSpacing = '4px';
    info.append(s, m, code); row.appendChild(info);
    if (o.statut === 'en_attente') row.appendChild(mk('Itinéraire GPS', 'primary', () => guideTo(o.latitude_boutique, o.longitude_boutique, o.nom_boutique_copie)));
    box.appendChild(row);
  });
}

// Retrait au comptoir : le code remplit la facture, puis la vente valide la commande
$('retraitGo').addEventListener('click', async () => {
  const code = $('retraitCode').value.trim();
  if (!/^\d{4}$/.test(code)) { $('retraitMsg').textContent = 'Le code a 4 chiffres.'; return; }
  const { data, error } = await _supabase.rpc('order_lookup', { p_code: code });
  if (error) { $('retraitMsg').textContent = '' + error.message; return; }
  [...$('invoiceItemsTable').children].forEach(tr => tr.remove());
  data.items.forEach(it => { addInvoiceRow(it.name, it.unit_price, it.qty); $('invoiceItemsTable').lastElementChild.dataset.cid = it.id; });
  $('clientName').value = data.buyer_name; $('clientPhone').value = data.buyer_phone || '';
  $('paidNow').checked = true; // le client est venu avec son code : l'argent est compté tout de suite
  calculateTotal(); saveDraft();
  pendingOrder = { id: data.id }; $('retraitCode').value = '';
  $('retraitMsg').textContent = `Commande de ${data.buyer_name} chargée (${fmt(data.total)} ${data.currency}).\nPaiement encaissé : le client est venu avec son code.\nEnregistre la vente : la caisse, le stock, le ticket et la commande se mettent à jour.`;
});

// QR du comptoir (génération) et scanner (lecture)
const shopLink = () => `${location.origin}${location.pathname}?shop=${currentUser.id}`;
$('dirQr').addEventListener('click', () => {
  const box = $('dirQrBox'); box.hidden = !box.hidden;
  if (!box.hidden) { $('dirQrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(shopLink()); $('dirQrUrl').textContent = shopLink() + '  — fais une capture d\'écran, imprime-la et pose-la sur ton comptoir.'; }
});
const shopIdFromUrl = s => { try { const id = new URL(s).searchParams.get('shop'); return /^[0-9a-f-]{36}$/i.test(id || '') ? id : null; } catch (_) { return null; } };
$('dirScan').addEventListener('click', async () => {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Scanne le QR avec l\'appareil photo de ton téléphone : il ouvrira directement la boutique.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (_) { alert('Autorise l\'appareil photo pour scanner.'); return; }
  const box = $('qrScan'), video = $('qrVideo'); box.hidden = false; video.srcObject = stream; await video.play();
  const det = new BarcodeDetector({ formats: ['qr_code'] }); let on = true;
  const stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); box.hidden = true; };
  $('qrCancel').onclick = stop;
  const loop = async () => {
    if (!on) return;
    try { for (const c of await det.detect(video)) { const id = shopIdFromUrl(c.rawValue); if (id) { stop(); openShop(id); return; } } } catch (_) { /* image pas prête */ }
    setTimeout(loop, 400);
  };
  loop();
});
(() => { const id = shopIdFromUrl(location.href); if (id) { sessionStorage.setItem('tamzorya_shop', id); history.replaceState(null, '', location.pathname); } })();

// Changer de type d'activité
function initActType() {
  const ok = ['commercant', 'prestataire'].includes(profile.business_type);
  $('actTypeBox').hidden = !ok; if (ok) $('actType').value = profile.business_type;
}
$('actTypeBtn').addEventListener('click', async () => {
  const to = $('actType').value;
  if (to === profile.business_type) { setStatus('actTypeStatus', 'C\'est déjà ton type d\'activité.', 'err'); return; }
  if (!confirm(to === 'commercant' ? 'Passer en Commerçant : tu verras le catalogue de produits et la vente au comptoir. Tes données sont conservées.' : 'Passer en Prestataire : tu verras les devis, les missions et les fournitures. Tes données sont conservées.')) return;
  const { error } = await _supabase.rpc('change_business_type', { p_type: to });
  if (error) { setStatus('actTypeStatus', error.message, 'err'); return; }
  localStorage.removeItem('facturix_ctx'); location.reload();
});

/* ============================================================
   COMMANDES REÇUES (vendeur) : liste, compteurs, filtre, temps réel
   ============================================================ */
function phoneWithCode(raw, country) { // numéro local -> format international avec l'indicatif du pays
  const code = CALLCODE[country] || '', r = String(raw || '').trim(), d = r.replace(/\D/g, '');
  if (!d) return '';
  if (r.startsWith('+')) return '+' + d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0')) return code ? '+' + code + d.slice(1) : d;
  return code && d.length <= 9 ? '+' + code + d : '+' + d;
}
let rcData = [], ordersStarted = false;
async function refreshOrdersBadge() {
  const { count } = await _supabase.from('commandes_flash').select('id', { count: 'exact', head: true }).eq('id_vendeur', WID).eq('statut', 'en_attente');
  const b = document.querySelector('.nav button[data-page="recues"]'); if (b) b.textContent = 'Commandes reçues' + (count ? ` (${count})` : ''); syncTopbar();
}
function startOrders() {
  if (ordersStarted) return; ordersStarted = true;
  refreshOrdersBadge();
  _supabase.channel('orders-rt').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commandes_flash' }, p => {
    if (p.new.id_acheteur === currentUser.id || p.new.id_vendeur !== WID) return;
    notifySound(); if (localStorage.getItem('tamzorya_toast') !== '0') showToast(`Nouvelle commande de ${p.new.buyer_name || 'un client'} : ${fmt(p.new.total)} ${p.new.currency}`, 'Voir', () => setPage('recues'), 8000);
    refreshOrdersBadge(); if (!$('page-recues').hidden) loadReceived();
  }).subscribe();
}
async function loadReceived() {
  $('rcList').innerHTML = '<p class="note">Chargement...</p>';
  const { data, error } = await _supabase.from('commandes_flash').select('*').eq('id_vendeur', WID).order('created_at', { ascending: false }).limit(200);
  if (error) { $('rcList').textContent = 'Erreur : ' + error.message; return; }
  rcData = data || []; renderReceived(); refreshOrdersBadge();
}
function renderReceived() {
  const f = $('rcFilter').value, q = $('rcSearch').value.trim().toLowerCase();
  const pend = rcData.filter(o => o.statut === 'en_attente').length;
  $('rcPending').textContent = `${pend} en attente`; $('rcDone').textContent = `${rcData.length - pend} validée(s)`;
  const box = $('rcList'); box.innerHTML = '';
  const list = rcData.filter(o => (!f || o.statut === f) && (!q || [o.buyer_name, o.buyer_phone, o.code_retrait].some(v => String(v || '').toLowerCase().includes(q))));
  if (!list.length) { box.innerHTML = '<p class="note">Aucune commande.</p>'; return; }
  list.forEach(o => {
    const row = document.createElement('div'); row.className = 'catalog-item'; row.style.flexWrap = 'wrap';
    const info = document.createElement('div'); info.style.flex = '1 1 220px';
    const s = document.createElement('strong'); s.textContent = (o.buyer_name || 'Client') + (o.buyer_phone ? ' · ' + o.buyer_phone : '');
    const m = document.createElement('div'); m.className = 'note'; m.style.whiteSpace = 'pre-line';
    m.textContent = `${new Date(o.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${o.statut === 'validee' ? 'Validée' : 'En attente'} · ${fmt(o.total)} ${o.currency}\n` + (o.items || []).map(i => `${i.qty} × ${i.name}`).join(', ');
    const code = document.createElement('div'); code.className = 'cat-price'; code.style.letterSpacing = '4px'; code.textContent = 'Code : ' + o.code_retrait;
    info.append(s, m, code);
    const acts = document.createElement('div'); acts.className = 'actions';
    if (o.statut === 'en_attente') acts.append(mk('Traiter à la caisse', 'primary', () => { setPage('facture'); $('retraitCode').value = o.code_retrait; $('retraitGo').click(); }));
    if (o.buyer_phone && waOk(o.buyer_phone)) acts.append(mk('WhatsApp', 'success', () => window.open(waLink(o.buyer_phone, `Bonjour ${o.buyer_name || ''}, ta commande est prête au retrait.`), '_blank')));
    row.append(info, acts); box.appendChild(row);
  });
}
$('rcFilter').addEventListener('change', renderReceived);
$('rcSearch').addEventListener('input', renderReceived);
$('rcRefresh').addEventListener('click', loadReceived);

/* ============================================================
   BARRE DU HAUT : 6 ONGLETS (Accueil, Marketplace, Gérance,
   Discussions, Mon Hub, Paramètres). Les anciens boutons deviennent
   le sous-menu de l'onglet choisi : aucune fonction n'a changé.
   ============================================================ */
const svg = p => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const TAB_ICONS = {
  accueil: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  marketplace: svg('<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M10 20v-4.5h4V20"/>'),
  gerance: svg('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>'),
  discussions: svg('<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l.9-4.2A8 8 0 1 1 20 12z"/>'),
  hub: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2c2.6.3 4.5 2.4 4.5 5.1"/>'),
  parametres: svg('<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>')
};
const TOPTABS = [['accueil', '', 'Accueil'], ['marketplace', '', 'Marketplace'], ['gerance', '', 'Gérance'], ['discussions', '', 'Discussions'], ['hub', '', 'Mon Hub'], ['parametres', '', 'Paramètres']];
const GROUP_OF = { accueil: 'accueil', annuaire: 'marketplace', boutique: 'marketplace', commandes: 'marketplace', recues: 'marketplace', facture: 'gerance', historique: 'gerance', dashboard: 'gerance', depenses: 'gerance', catalogue: 'gerance', mentor: 'gerance', chat: 'discussions', equipe: 'hub', missions: 'hub', entreprise: 'parametres', pro: 'parametres', politique: 'parametres', parametres: 'parametres', admin: 'parametres' };
document.querySelectorAll('.nav button[data-page]').forEach(b => { b.dataset.group = GROUP_OF[b.dataset.page] || 'gerance'; });
TOPTABS.forEach(([g, icon, label]) => {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.grp = g; b.setAttribute('aria-label', label);
  const i = document.createElement('span'); i.className = 'tb-ico'; i.innerHTML = TAB_ICONS[g]; // dessin intégré, pas de texte saisi par l'utilisateur
   const s = document.createElement('small'); s.textContent = label;
  const d = document.createElement('span'); d.className = 'dot'; d.hidden = true;
  b.append(i, s, d); b.addEventListener('click', () => goGroup(g)); $('topbar').appendChild(b);
});
// Qui a droit à quoi : une seule règle, appliquée à chaque affichage du menu
function navAllowed(b) {
  if (typeof profile === 'undefined' || !profile || !profile.business_type) return true;
  const t = profile.business_type, owner = ROLE === 'owner', assoc = ROLE === 'associe', vend = ROLE === 'vendeur', aide = ROLE === 'aide';
  const biz = t === 'commercant' || t === 'prestataire', staff = owner || assoc, p = b.dataset.page;
  if (b.dataset.action === 'dictee') return biz && staff;
  switch (p) {
    case 'facture': case 'historique': return biz && (staff || vend);
    case 'dashboard': case 'depenses': return biz && staff;
    case 'catalogue': case 'recues': return t === 'commercant' && staff;
    case 'mentor': return (biz && staff) || t === 'normal';
    case 'equipe': return biz && owner;
    case 'missions': return biz && (staff || aide);
    case 'entreprise': return biz && staff;
    case 'annuaire': case 'commandes': case 'chat': return (biz && staff) || t === 'normal';
    case 'admin': return IS_ADMIN;
    default: return true; // réglages et politique : pour tout le monde
  }
}
// l'assistant d'achat du particulier est rangé dans Marketplace, le mentor des pros dans Gérance
const grpOf = x => (x.dataset.page === 'mentor' && profile && profile.business_type === 'normal') ? 'marketplace' : x.dataset.group;
function goGroup(g) {
  if (g === 'accueil') { setPage('accueil'); return; }
  const b = [...document.querySelectorAll('.nav button[data-group]')].find(x => !x.hidden && grpOf(x) === g);
  setPage(b ? b.dataset.page : 'accueil');
}
function syncTopbar(target) {
  const navBtns = [...document.querySelectorAll('.nav button[data-group]')];
  navBtns.forEach(x => { if (!navAllowed(x)) x.hidden = true; }); // jamais d'onglet d'un autre profil
  const tgt = target ? navBtns.find(x => x.dataset.page === target) : null;
  const cur = (tgt ? grpOf(tgt) : GROUP_OF[target]) || document.body.dataset.group || 'accueil';
  document.body.dataset.group = cur;
  const count = page => { const b = document.querySelector('.nav button[data-page="' + page + '"]'); const m = b && b.textContent.match(/\((\d+)\)/); return m ? m[1] : ''; };
  document.querySelectorAll('#topbar button').forEach(tb => {
    const g = tb.dataset.grp;
    tb.hidden = !(g === 'accueil' || navBtns.some(x => grpOf(x) === g && !x.hidden)); // un onglet sans page autorisée est masqué
    tb.classList.toggle('on', g === cur);
    const n = g === 'discussions' ? count('chat') : g === 'marketplace' ? count('recues') : '';
    const dot = tb.querySelector('.dot'); dot.textContent = n; dot.hidden = !n;
  });
  navBtns.forEach(x => x.classList.toggle('grp-off', grpOf(x) !== cur));
  const nav = document.querySelector('.nav'); if (nav) nav.hidden = navBtns.filter(x => grpOf(x) === cur && !x.hidden).length < 2;
}

/* ============================================================
   PARAMÈTRES : mode sombre, notifications, compte
   ============================================================ */
function applyTheme(t) {
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
  localStorage.setItem('tamzorya_theme', t === 'dark' ? 'dark' : 'light');
}
function notifySound() { // petit « bip » + vibration, si l'utilisateur les a activés
  if (localStorage.getItem('tamzorya_sound') === '0') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12);
    if (navigator.vibrate) navigator.vibrate(80);
  } catch (_) { /* son indisponible */ }
}
function initSettings() {
  const dark = localStorage.getItem('tamzorya_theme') === 'dark';
  $('themeLight').checked = !dark; $('themeDark').checked = dark;
  $('setSound').checked = localStorage.getItem('tamzorya_sound') !== '0';
  $('setBanner').checked = localStorage.getItem('tamzorya_toast') !== '0';
  $('setEntreprise').hidden = $('setPlan').hidden = ROLE !== 'owner' || profile.business_type === 'normal';
}
$('themeLight').addEventListener('change', () => applyTheme('light'));
$('themeDark').addEventListener('change', () => applyTheme('dark'));
$('setSound').addEventListener('change', () => localStorage.setItem('tamzorya_sound', $('setSound').checked ? '1' : '0'));
$('setBanner').addEventListener('change', () => localStorage.setItem('tamzorya_toast', $('setBanner').checked ? '1' : '0'));
$('setTest').addEventListener('click', () => { notifySound(); showToast('Voilà à quoi ressemble une notification.', null, null, 3000); });
$('setEntreprise').addEventListener('click', () => setPage('entreprise'));
$('setPlan').addEventListener('click', () => setPage('pro'));
$('setPolicy').addEventListener('click', () => setPage('politique'));

/* ============================================================
   ACCUEIL : FIL D'ACTUALITÉ (léger : 10 publications par page,
   photos réduites à 100 Ko, J'aime, signalement)
   ============================================================ */
const FEED_SIZE = 10, POST_BUCKET = 'post-photos';
let feedCursor = null, feedEnd = false, feedBusy = false, feedLoadedAt = 0;
const hiddenPosts = () => { try { return new Set(JSON.parse(localStorage.getItem('tamzorya_hidden_posts') || '[]')); } catch (_) { return new Set(); } };
const hidePostLocal = id => { const s = hiddenPosts(); s.add(id); localStorage.setItem('tamzorya_hidden_posts', JSON.stringify([...s].slice(-300))); };
const agoText = iso => { const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000); return s < 3600 ? `il y a ${Math.round(s / 60) || 1} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`; };
const postPhoto = p => _supabase.storage.from(POST_BUCKET).getPublicUrl(p).data.publicUrl;
const canPublish = () => ['commercant', 'prestataire'].includes(profile.business_type) && ROLE === 'owner' && curTier() !== 'gratuit';

function initFeed() {
  const ok = canPublish();
  $('composeForm').hidden = !ok; $('composeLock').hidden = ok;
  if (!ok) {
    const freeMerchant = ['commercant', 'prestataire'].includes(profile.business_type) && ROLE === 'owner';
    $('composeLockText').textContent = freeMerchant ? 'Publie tes arrivages, tes stocks ou tes chantiers pour être vu dans tout ton pays : réservé aux plans Standard, Diamant et Platine.' : 'Les publications sont réservées aux commerçants et prestataires abonnés. Toi, tu peux suivre le fil et aimer les annonces.';
    $('composeUp').hidden = !freeMerchant;
  }
  if (!feedLoadedAt || Date.now() - feedLoadedAt > 120000) loadFeed(true);
}
async function loadFeed(reset) {
  if (feedBusy) return; feedBusy = true;
  if (reset) { feedCursor = null; feedEnd = false; $('feedList').innerHTML = ''; }
  const { data, error } = await _supabase.rpc('feed_page', { p_before: feedCursor, p_limit: FEED_SIZE });
  feedBusy = false;
  if (error) { $('feedEmpty').hidden = false; $('feedEmpty').textContent = 'Erreur : ' + error.message; return; }
  feedLoadedAt = Date.now();
  const rows = data || [], hid = hiddenPosts();
  if (rows.length) feedCursor = rows[rows.length - 1].created_at;
  feedEnd = rows.length < FEED_SIZE;
  rows.filter(p => !hid.has(p.id)).forEach(p => $('feedList').appendChild(feedCard(p)));
  $('feedMore').hidden = feedEnd;
  $('feedEmpty').hidden = !!$('feedList').children.length; $('feedEmpty').textContent = 'Aucune publication pour le moment dans ton pays.';
}
function closeMenus() { document.querySelectorAll('.postmenu').forEach(m => m.hidden = true); }
document.addEventListener('click', ev => { if (!ev.target.closest('.post-head')) closeMenus(); });

function feedCard(p) {
  const card = document.createElement('div'); card.className = 'card post';
  const head = document.createElement('div'); head.className = 'post-head';
  let av;
  if (p.logo_url) { av = document.createElement('img'); av.src = p.logo_url; av.alt = ''; av.loading = 'lazy'; } else { av = document.createElement('div'); av.textContent = (p.author_name || '?').charAt(0).toUpperCase(); }
  av.className = 'avatar';
  const who = document.createElement('div'); who.className = 'post-who';
  const nm = document.createElement('strong'); nm.textContent = p.author_name;
  const tm = document.createElement('span'); tm.className = 'note'; tm.textContent = agoText(p.created_at);
  who.append(nm, tm);
  // menu « trois points » : signaler, masquer, supprimer
  const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'post-menu-btn'; mb.textContent = '···'; mb.setAttribute('aria-label', 'Options');
  const menu = document.createElement('div'); menu.className = 'postmenu'; menu.hidden = true;
  const item = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { closeMenus(); fn(); }); menu.appendChild(b); };
  if (!p.mine) item('Signaler la publication', async () => {
    const reason = prompt('Pourquoi signales-tu cette publication ? (facultatif)', '');
    if (reason === null) return;
    const { error } = await _supabase.rpc('post_report', { p_post: p.id, p_reason: reason.slice(0, 200) });
    if (error) { alert(error.message); return; }
    hidePostLocal(p.id); card.remove(); alert('Merci, ton signalement est enregistré.');
  });
  item('Masquer', () => { hidePostLocal(p.id); card.remove(); });
  if (p.mine || IS_ADMIN) item('Supprimer', async () => {
    if (!confirm('Supprimer cette publication ?')) return;
    const { error } = await _supabase.from('posts').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    if ((p.photos || []).length) _supabase.storage.from(POST_BUCKET).remove(p.photos);
    card.remove();
  });
  mb.addEventListener('click', () => { const open = menu.hidden; closeMenus(); menu.hidden = !open; });
  head.append(av, who, mb, menu);
  card.appendChild(head);
  if (p.body) { const b = document.createElement('div'); b.className = 'post-body'; b.textContent = p.body; card.appendChild(b); }
  const pics = (p.photos || []).slice(0, 2);
  if (pics.length) {
    const g = document.createElement('div'); g.className = 'postpics ' + (pics.length === 1 ? 'one' : 'two');
    pics.forEach(path => { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = 'Photo de la publication'; im.src = postPhoto(path); g.appendChild(im); });
    card.appendChild(g);
  }
  if (p.hidden) { const w = document.createElement('p'); w.className = 'note'; w.textContent = 'Cette publication est masquée du fil à cause de plusieurs signalements.'; card.appendChild(w); }
  // « J'aime » (pas de commentaires, pour rester léger)
  let liked = p.liked, count = p.likes;
  const lb = document.createElement('button'); lb.type = 'button';
  const paint = () => { lb.className = 'btn ' + (liked ? 'primary' : 'secondary'); lb.textContent = `J'aime (${count})`; };
  paint();
  lb.addEventListener('click', async () => {
    liked = !liked; count += liked ? 1 : -1; paint();
    const { data, error } = await _supabase.rpc('post_like_toggle', { p_post: p.id });
    if (error) { liked = !liked; count += liked ? 1 : -1; paint(); return; }
    liked = data.liked; count = data.count; paint();
  });
  card.appendChild(lb);
  return card;
}
$('feedMore').addEventListener('click', () => loadFeed(false));
$('composeUp').addEventListener('click', () => upgradePopup('Publier dans le fil est réservé aux plans Standard et supérieurs.', 'standard'));
$('composeSend').addEventListener('click', async () => {
  const text = $('composeText').value.trim(), all = [...$('composePics').files];
  if (all.length > 2) { setStatus('composeMsg', 'Maximum 2 photos.', 'err'); return; }
  if (text.length < 3 && !all.length) { setStatus('composeMsg', 'Écris un message ou ajoute une photo.', 'err'); return; }
  $('composeSend').disabled = true; setStatus('composeMsg', 'Réduction des photos et envoi...');
  const paths = [];
  try {
    for (const [i, f] of all.entries()) {
      const blob = await compressImage(f);                 // 100 Ko max avant l'envoi
      const path = `${currentUser.id}/${Date.now()}_${i}.jpg`;
      const up = await _supabase.storage.from(POST_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      paths.push(path);
    }
    const { error } = await _supabase.from('posts').insert([{ body: text, photos: paths }]);
    if (error) throw error;
    $('composeText').value = ''; $('composePics').value = ''; setStatus('composeMsg', 'Publié !', 'ok');
    await loadFeed(true);
  } catch (e) {
    if (paths.length) _supabase.storage.from(POST_BUCKET).remove(paths);
    if (/LIMITE_PLAN/.test(e.message)) { setStatus('composeMsg', '', ''); upgradePopup('Publier dans le fil est réservé aux plans Standard et supérieurs.', 'standard'); }
    else setStatus('composeMsg', 'Erreur : ' + e.message, 'err');
  }
  $('composeSend').disabled = false;
});

/* ============================================================
   RDC : constantes fiscales (à confirmer auprès de la DGI / d'un comptable)
   ============================================================ */
const SYNTH_PCT = 1;     // Impôt Synthétique : % du chiffre d'affaires (indicatif)
const RETENUE_PCT = 10;  // Retenue à la source sur la main-d'œuvre : % (indicatif, modifiable ici)

async function loadOfficialRate() {
  try {
    const { data } = await _supabase.from('taux_officiels').select('taux, date_taux, source').eq('paire', 'USD/CDF').maybeSingle();
    if (data) { OFFICIAL_RATE = Number(data.taux) || 0; window.__rateInfo = data; }
  } catch (_) { /* hors-ligne : on garde le dernier taux connu */ }
}
function initEntrepriseRdc() {
  const sn = currentUser.user_metadata && currentUser.user_metadata.shop_name;
  if (sn && !$('coName').value.trim()) $('coName').value = sn; // proposé à l'inscription, à enregistrer
  const rdc = isRdc();
  $('rdcBox').hidden = !rdc;
  if (!Number($('coRate').value)) $('coRate').value = '';
  const ri = window.__rateInfo;
  $('coRateHint').textContent = rdc && OFFICIAL_RATE ? `Laisse vide pour utiliser le taux officiel du jour : 1 USD = ${fmt(OFFICIAL_RATE)} CDF${ri ? ' (' + new Date(ri.date_taux).toLocaleDateString('fr-FR') + ' · ' + ri.source + ')' : ''}.` : 'Laisse vide pour utiliser le taux par défaut.';
  if (rdc) {
    document.querySelector('label[for="coTax"]').textContent = "NIF (Numéro d'Impôt)";
    document.querySelector('label[for="coRccm"]').textContent = 'RCCM';
    const miss = [['NIF', 'coTax'], ['RCCM', 'coRccm'], ['Patente', 'coPatente']].filter(([, id]) => String($(id).value).trim().length < 4).map(([n]) => n);
    $('certState').textContent = miss.length ? `Pour afficher le badge « Certifié RDC » dans l'annuaire, renseigne aussi : ${miss.join(', ')}.` : 'Badge « Certifié RDC » actif dans l\'annuaire une fois ta fiche enregistrée.';
  }
}
$('dashTaxInfoBtn').addEventListener('click', () => { $('dashTaxInfo').hidden = !$('dashTaxInfo').hidden; });

/* ============================================================
   ESPACE ADMINISTRATEUR : double authentification (2FA) obligatoire
   Les chiffres viennent de fonctions serveur qui refusent toute
   personne non admin ou sans 2FA : cacher l'écran ne suffit pas, la base protège.
   ============================================================ */
async function initAdmin() {
  $('adminMain').hidden = true; $('adminGate').hidden = false; setStatus('adminGateStatus', '');
  const mfa = _supabase.auth.mfa;
  const { data: aal } = await mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.currentLevel === 'aal2') { openAdmin(); return; }
  const { data: fl } = await mfa.listFactors();
  const factor = ((fl && fl.totp) || []).find(f => f.status === 'verified');
  if (factor) { // 2FA déjà installée : on demande le code
    $('adminEnroll').hidden = true; $('adminGateMsg').textContent = 'Entre le code à 6 chiffres de ton application d\'authentification.';
    $('adminVerify').onclick = () => verifyAdmin(factor.id);
    return;
  }
  // première fois : on installe la double authentification
  ((fl && fl.totp) || []).filter(f => f.status !== 'verified').forEach(f => mfa.unenroll({ factorId: f.id }));
  const { data: en, error } = await mfa.enroll({ factorType: 'totp', friendlyName: 'Tamzorya admin' });
  if (error) { $('adminGateMsg').textContent = 'Impossible d\'activer la double authentification : ' + error.message + ' (vérifie que le MFA TOTP est activé dans Supabase > Authentication).'; return; }
  $('adminQr').src = en.totp.qr_code; $('adminEnroll').hidden = false;
  $('adminGateMsg').textContent = 'Première connexion : scanne ce QR avec Google Authenticator, Authy ou Microsoft Authenticator, puis entre le code à 6 chiffres.';
  $('adminVerify').onclick = () => verifyAdmin(en.id);
}
async function verifyAdmin(factorId) {
  const code = $('adminCode').value.trim();
  if (!/^\d{6}$/.test(code)) { setStatus('adminGateStatus', 'Le code a 6 chiffres.', 'err'); return; }
  const ch = await _supabase.auth.mfa.challenge({ factorId });
  if (ch.error) { setStatus('adminGateStatus', ch.error.message, 'err'); return; }
  const v = await _supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  if (v.error) { setStatus('adminGateStatus', 'Code incorrect.', 'err'); return; }
  $('adminCode').value = ''; openAdmin();
}
function openAdmin() {
  $('adminGate').hidden = true; $('adminMain').hidden = false;
  const full = ADMIN_ROLE === 'admin';
  $('adminPayBox').hidden = !full; $('adminRateBox').hidden = !full;
  loadAdminStats();
  if (full) loadAdmin();
}
async function loadAdminStats() {
  const box = $('adminStats'); box.innerHTML = '<p class="note">Chargement...</p>';
  const { data: s, error } = await _supabase.rpc('admin_stats');
  box.innerHTML = '';
  if (error) { box.textContent = 'Erreur : ' + error.message; return; }
  const kpis = (arr) => { const g = document.createElement('div'); g.className = 'adm-grid'; arr.forEach(([label, val]) => { const k = document.createElement('div'); k.className = 'adm-kpi'; const b = document.createElement('b'); b.textContent = val; k.append(b, document.createTextNode(label)); g.appendChild(k); }); return g; };
  const u = s.users;
  box.appendChild(kpis([['Inscrits', u.total], ['Commerçants', u.commercants], ['Prestataires', u.prestataires], ['Particuliers', u.particuliers], ['Équipiers', u.equipiers], ['Nouveaux (30 j)', u.nouveaux_30j]]));
  box.appendChild(kpis([['Argent reçu (total)', fmt(s.revenu_total_usd) + ' $'], ['Fiches visibles', s.annuaire.fiches_visibles], ['Certifiés RDC', s.annuaire.certifies_rdc], ['Paiements en attente', s.paiements_en_attente], ['Publications masquées', s.publications_masquees]]));
  const tbl = (title, head, rows) => { const h = document.createElement('strong'); h.textContent = title; const t = document.createElement('table'); t.className = 'doctable'; const hr = document.createElement('tr'); head.forEach(x => { const th = document.createElement('th'); th.textContent = x; hr.appendChild(th); }); t.appendChild(hr); rows.forEach(r => { const tr = document.createElement('tr'); r.forEach(x => { const td = document.createElement('td'); td.textContent = x; tr.appendChild(td); }); t.appendChild(tr); }); box.append(h, t); };
  tbl('Abonnés par catégorie (commerçants et prestataires)', ['Plan', 'Statut', 'Nombre'], s.plans.map(p => [p.plan, p.statut, p.n]));
  tbl('Argent reçu chaque mois (abonnements confirmés)', ['Mois', 'Paiements', 'Montant ($)'], s.revenus.map(r => [r.mois, r.n, fmt(r.usd)]));
  tbl('Inscrits par pays', ['Pays', 'Nombre'], s.pays.map(p => [p.pays, p.n]));
  if (s.taux) $('adminRateNow').textContent = `Taux actuel : 1 USD = ${fmt(s.taux.taux)} CDF · ${new Date(s.taux.date_taux).toLocaleDateString('fr-FR')} · ${s.taux.source}`;
  else $('adminRateNow').textContent = 'Aucun taux officiel enregistré pour le moment.';
}
$('adminRateSave').addEventListener('click', async () => {
  const v = parseFloat($('adminRate').value);
  if (!(v >= 100)) { alert('Écris le taux du jour (1 USD = ? CDF).'); return; }
  const { error } = await _supabase.rpc('admin_set_rate', { p_taux: v });
  if (error) { alert(error.message); return; }
  $('adminRate').value = ''; await loadOfficialRate(); loadAdminStats();
});

/* ============================================================
   INSTALLATION SUR L'ÉCRAN D'ACCUEIL (à l'entrée du site)
   ============================================================ */
let installEvt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function showInstall() {
  if (isStandalone()) { $('installBox').hidden = true; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (installEvt) { $('installBox').hidden = false; $('installBtn').hidden = false; $('installText').textContent = 'Ouvre Tamzorya comme une application, sans passer par le navigateur.'; }
  else if (ios) { $('installBox').hidden = false; $('installBtn').hidden = true; $('installText').textContent = 'Touche le bouton Partager (carré avec une flèche), puis « Sur l\'écran d\'accueil ».'; }
}
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; showInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; $('installBox').hidden = true; });
$('installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBox').hidden = true; });
showInstall();

const pubToken = new URLSearchParams(location.search).get('d');
if (recovering) showReset(); else if (confirmErr || confirming) showConfirm(); else if (pubToken) showPublic(pubToken); else checkSession();
})();

