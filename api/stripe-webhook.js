// api/stripe-webhook.js
// Webhook do Stripe — escuta checkout.session.completed
// Dispara WhatsApp de confirmação de inscrição via Z-API

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ZAPI_INSTANCE = '3F457758AC68513DE147E6B1C9468980';
const ZAPI_TOKEN    = 'CD007B54BA8BD1111B802279';
const ZAPI_URL      = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

// ── Supabase (service key para marcar inscrição como paga) ──
const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Formata data para exibição ──
function formatarData(dataStr, hora) {
  if (!dataStr) return '—';
  const d = new Date(dataStr + 'T12:00:00');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}${hora ? ' · ' + hora : ''}`;
}

// ── Envia WhatsApp via Z-API ──
async function enviarWhatsApp(telefone, mensagem) {
  const digits = telefone.replace(/\D/g, '');
  const numero = digits.startsWith('55') ? digits : '55' + digits;

  const res = await fetch(ZAPI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: numero, message: mensagem })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Z-API erro:', err);
  }
}

// ── Monta a mensagem de confirmação ──
function montarMensagem(item, evento) {
  const primeiroNome = (item.nome || item.rotulo || 'Atleta').split(' ')[0];
  const dataEvento = formatarData(evento?.data, evento?.hora);

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

// ── Busca dados do evento no Supabase ──
async function buscarEvento(eventoNome) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eventos_publicos`, {
      method: 'POST',
      headers: {
        'apikey': SB_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    const eventos = await res.json();
    if (!Array.isArray(eventos)) return null;
    return eventos.find(e => e.nome === eventoNome) || null;
  } catch (e) {
    console.error('Erro ao buscar evento:', e);
    return null;
  }
}

// ── Marca inscrições do pedido como pagas no Supabase ──
async function marcarComoPago(pedido) {
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pagamento`, {
      method: 'POST',
      headers: {
        'apikey': SB_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_pedido: pedido })
    });
  } catch (e) {
    console.error('Erro ao marcar como pago:', e);
  }
}

// ── Handler principal ──
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,          // raw body (ver config abaixo)
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Só processa pagamento confirmado
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};

  // Os itens do pedido ficam em metadata.itens (JSON stringificado no checkout)
  let itens = [];
  try {
    itens = JSON.parse(metadata.itens || '[]');
  } catch (e) {
    console.error('Erro ao parsear itens do metadata:', e);
    return res.status(200).json({ received: true });
  }

  if (!itens.length) {
    return res.status(200).json({ received: true });
  }

  const pedido = metadata.pedido || session.id;
  const eventoNome = metadata.evento_nome || (itens[0]?.evento || '');

  // Busca dados completos do evento (data, hora, local)
  const evento = await buscarEvento(eventoNome);

  // Marca como pago no Supabase
  await marcarComoPago(pedido);

  // Envia WhatsApp para cada atleta que tem telefone
  for (const item of itens) {
    const telefone = item.telefone || item.dados?.telefone || '';
    if (!telefone) {
      console.log(`Atleta sem telefone — pedido ${pedido}, ref ${item.ref}`);
      continue;
    }

    const mensagem = montarMensagem(item, evento);
    await enviarWhatsApp(telefone, mensagem);
    console.log(`WhatsApp enviado para ${telefone.slice(0,4)}****`);
  }

  return res.status(200).json({ received: true, itens: itens.length });
}

// ── IMPORTANTE: Vercel precisa do raw body para validar assinatura do Stripe ──
export const config = {
  api: {
    bodyParser: false,
  },
};
