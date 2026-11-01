/* ============================================================
   core-ia.js — Mentor IA : moteur commun à tous les profils
   - Choisit les instructions selon le profil (commerçant / prestataire)
   - Appelle la fonction Supabase « facturix-mentor » (la clé Gemini
     reste CÔTÉ SERVEUR, jamais dans le navigateur)
   - Gère l'écran de conversation (messages, questions rapides, historique)

   Modèle Gemini : il se règle dans Supabase (secret GEMINI_MODEL).
   « gemini-1.5-flash » n'existe plus : utilise « gemini-2.5-flash ».
   ============================================================ */
(function () {
  'use strict';
  const CONFIG = { fonction: 'facturix-mentor', historique: 8, gardes: 20, questionMax: 500 };

  const $ = id => document.getElementById(id);
  const profil = () => FX.profile.business_type === 'normal' ? 'normal' : (FX.isPrest() ? 'prestataire' : 'commercant');
  const ACHAT = {
    accueil: 'Bonjour ! Dis-moi ce que tu veux faire (par exemple : « Je veux refaire le plafond de ma chambre ») et je te liste les matériaux à prévoir, puis je te montre qui peut te les vendre.',
    questionsRapides: ['Je veux refaire le plafond de ma chambre', 'Je veux carreler ma cuisine', 'Je veux installer un robinet', 'Je construis un mur de clôture'],
    instructions: ''
  };
  const prompts = () => profil() === 'normal' ? ACHAT : ((window.FX_PROMPTS || {})[profil()] || {});
  let chat = [];
  const cle = () => 'facturix_chat_' + FX.user.id;

  function garder(t, me) { chat.push({ t, me }); localStorage.setItem(cle(), JSON.stringify(chat.slice(-CONFIG.gardes))); }

  function bulle(texte, moi) {
    const b = document.createElement('div');
    b.textContent = texte;
    b.style.cssText = 'white-space:pre-wrap;padding:10px 12px;border-radius:12px;max-width:88%;font-size:15px;line-height:1.45;' +
      (moi ? 'align-self:flex-end;background:#123b70;color:#fff' : 'align-self:flex-start;background:#f3f6fb;border:1px solid #dce3ed');
    $('chatBox').appendChild(b);
    $('chatBox').scrollTop = $('chatBox').scrollHeight;
    return b;
  }

  async function open() {
    try { await ouvrir(); }
    catch (e) {
      console.error(e);
      $('chatBox').innerHTML = '';
      bulle('Le mentor ne peut pas s\'ouvrir : ' + (e && e.message ? e.message : e), false);
    }
  }

  async function ouvrir() {
    const p = prompts(), achat = profil() === 'normal';
    $('mentorTitle').textContent = achat ? '🛒 Assistant d\'achat Tamzorya' : '🧑‍🏫 Mentor Tamzorya';
    const AIQ = { standard: 100, diamant: 300, platine: 300 }, nq = FX.profile.plan === 'pro' ? (AIQ[FX.profile.plan_type] || 100) : 3;
    $('mentorLeft').textContent = nq === 3 ? 'Plan gratuit : 3 questions par mois.' : `Plan ${FX.profile.plan_type || 'PRO'} : ${nq} questions par mois.`;
    if (!$('chatBox').children.length) {
      chat = JSON.parse(localStorage.getItem(cle()) || '[]');
      if (chat.length) chat.forEach(m => bulle(m.t, m.me));
      else bulle(p.accueil || 'Bonjour ! Que veux-tu savoir sur ton activité ?', false);
    }
    $('chatChips').innerHTML = '';
    (p.questionsRapides || []).forEach(q => $('chatChips').appendChild(FX.mk(q, 'secondary', () => ask(q))));
    if (!achat) try { await FX.loadDashboard(); } catch (_) { /* le chat reste utilisable */ } // met à jour les chiffres envoyés au mentor
  }

  async function ask(question) {
    const q = (question || '').trim().slice(0, CONFIG.questionMax);
    if (!q) return;
    $('mentorQ').value = '';
    bulle(q, true); garder(q, true);
    const attente = bulle('⏳ Le mentor réfléchit...', false);
    $('mentorBtn').disabled = true;
    const stats = profil() === 'normal' ? null : { ...FX.stats(), periode_choisie: $('dashPeriod').selectedOptions[0].text, depenses_periode: $('dashExpCDF').textContent + ' · ' + $('dashExpUSD').textContent };
    const history = chat.slice(-(CONFIG.historique + 1), -1).map(m => ({ role: m.me ? 'user' : 'model', text: m.t }));
    const { data, error } = await FX.supabase.functions.invoke(CONFIG.fonction, {
      body: { question: q, profil: profil(), instructions: prompts().instructions || '', stats, history }
    });
    $('mentorBtn').disabled = false;
    if (error || !data?.answer) {
      let m = 'Le mentor est indisponible, réessaie dans un instant.';
      try {
        const j = await error.context.json();
        if (j.error === 'LIMIT') m = FX.profile.plan === 'pro' ? 'Limite du mois atteinte.' : '🔒 Limite gratuite atteinte (3 questions par mois).' + (profil() === 'normal' ? ' Reviens le mois prochain.' : ' Passe à un plan payant pour plus de conseils.');
        else if (j.detail) m += ' (' + String(j.detail).slice(0, 140) + ')';
      } catch (_) { /* pas de détail */ }
      attente.textContent = m; return;
    }
    if (profil() === 'normal') {
      const liste = (data.materiaux || []).map(x => `• ${x.nom} : ${x.quantite}`).join('\n');
      const txt = data.answer + (liste ? '\n\n🧱 À prévoir (estimation à vérifier) :\n' + liste : '');
      attente.textContent = txt; garder(txt, false);
      const bar = document.createElement('div'); bar.className = 'actions'; bar.style.alignSelf = 'flex-start';
      const mats = (data.materiaux || []).slice(0, 3);
      if (mats.length) bar.appendChild(FX.mk('👉 Voir les quincailleries à proximité qui ont ces stocks', 'primary', () => FX.searchDir(mats[0].nom, 'commercant')));
      mats.slice(1).forEach(x => bar.appendChild(FX.mk('👉 Trouver : ' + x.nom, 'secondary', () => FX.searchDir(x.nom, 'commercant'))));
      if (data.metier) bar.appendChild(FX.mk('👉 Contacter un ' + data.metier, 'primary', () => FX.searchDir(data.metier, 'prestataire')));
      if (bar.children.length) $('chatBox').appendChild(bar);
    } else { attente.textContent = data.answer; garder(data.answer, false); }
    if (typeof data.left === 'number') $('mentorLeft').textContent = `Il te reste ${data.left} question(s) ce mois-ci.`;
    $('chatBox').scrollTop = $('chatBox').scrollHeight;
  }

  function init() {
    $('mentorBtn').addEventListener('click', () => ask($('mentorQ').value));
    $('mentorQ').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ask($('mentorQ').value); } });
    $('chatReset').addEventListener('click', () => { localStorage.removeItem(cle()); chat = []; $('chatBox').innerHTML = ''; open(); });
    $('mentorOpen').addEventListener('click', () => FX.setPage('mentor'));
  }

  window.FX_IA = { init, open, ask, config: CONFIG };
})();
