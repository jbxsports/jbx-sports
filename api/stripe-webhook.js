// api/stripe-webhook.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ZAPI_INSTANCE = '3F457758AC68513DE147E6B1C9468980';
const ZAPI_TOKEN    = 'CD007B54BA8BD1111B802279';
const ZAPI_URL      = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Lê o body raw como Buffer ──
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Envia WhatsApp via Z-API ──
async function enviarWhatsApp(telefone, mensagem) {
  try {
    const digits = telefone.replace(/\D/g, '');
    const numero = digits.startsWith('55') ? digits : '55' + digits;
    const res = await fetch(ZAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: numero, message: mensagem })
    });
    console.log('[webhook] WhatsApp enviado para', numero.slice(0,6) + '****', '| status:', res.status);
  } catch(e) {
    console.error('[webhook] Erro Z-API:', e.message);
  }
}

// ── Marca pedido como pago no Supabase ──
async function marcarComoPago(pedido) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pagamento`, {
      method: 'POST',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_pedido: pedido })
    });
    const text = await res.text();
    console.log('[webhook] confirmar_pagamento status:', res.status, text);
  } catch(e) {
    console.error('[webhook] Erro confirmar_pagamento:', e.message);
  }
}

// ── Busca dados do evento ──
async function buscarEvento(eventoNome) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eventos_publicos`, {
      method: 'POST',
      headers: { 'apikey': SB_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const eventos = await res.json();
    if (!Array.isArray(eventos)) return null;
    return eventos.find(e => e.nome === eventoNome) || null;
  } catch(e) { return null; }
}

// ── Formata data ──
function formatarData(dataStr, hora) {
  if (!dataStr) return '—';
  const d = new Date(dataStr + 'T12:00:00');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}${hora ? ' · ' + hora : ''}`;
}

// ── Monta mensagem de confirmação ──
function montarMensagem(item, evento) {
  const primeiroNome = (item.nome || item.rotulo || 'Atleta').split(' ')[0];
  const dataEvento = evento ? formatarData(evento.data, evento.hora) : '—';
  return (
    `🎽 *Inscrição confirmada, ${primeiroNome}!*\n\n` +
    `Sua inscrição na *JBX Sports* foi confirmada com sucesso. ✅\n\n` +
    `📋 *Detalhes da inscrição:*\n` +
    `• Evento: *${item.evento || '—'}*\n` +
    `• Data: *${dataEvento}*\n` +
    `• Modalidade: *${item.modalidade || '—'}*\n` +
    `• Kit: *${item.kit || '—'}*\n` +
    `• Camiseta: *${item.tamanho_camisa || '—'}*\n\n` +
    `📍 Fique de olho nas nossas redes para informações sobre retirada de kit e concentração.\n\n` +
    `📸 *@jbx.sports*\n\n` +
    `Boa corrida! Vamos juntos! 🧡🏁`
  );
}

// ── Handler principal ──
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Lê o body raw ANTES de qualquer parse
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch(err) {
    console.error('[webhook] Assinatura inválida:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log('[webhook] evento recebido:', event.type);

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session  = event.data.object;
  const metadata = session.metadata || {};
  const pedido   = metadata.pedido || session.id;

  console.log('[webhook] pedido:', pedido);

  // Parse dos itens
  let itens = [];
  try { itens = JSON.parse(metadata.itens || '[]'); } catch(e) {}

  // Marca como pago no Supabase
  await marcarComoPago(pedido);

  // Busca dados do evento para a mensagem
  const eventoNome = metadata.evento_nome || (itens[0]?.evento || '');
  const evento = await buscarEvento(eventoNome);

  // Envia WhatsApp para cada atleta
  for (const item of itens) {
    const telefone = item.telefone || '';
    if (!telefone) { console.log('[webhook] sem telefone para', item.nome); continue; }
    const mensagem = montarMensagem(item, evento);
    await enviarWhatsApp(telefone, mensagem);
  }

  return res.status(200).json({ received: true, itens: itens.length });
}

// ── CRÍTICO: desativa o bodyParser da Vercel para preservar o raw body ──
export const config = {
  api: { bodyParser: false }
};
