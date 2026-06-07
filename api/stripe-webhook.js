// api/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function confirmarPedido(pedidoId) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pedido`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_pedido_id: pedidoId })
  });
  if (!r.ok) throw new Error(await r.text());
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Lê o body — na Vercel vem como objeto parseado
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  // Verifica se é um evento válido do Stripe
  if (!body || !body.type) {
    return res.status(400).json({ error: 'Body inválido' });
  }

  console.log('[webhook] Evento recebido:', body.type);

  if (body.type === 'checkout.session.completed') {
    const session = body.data?.object;
    const pedidoId = session?.metadata?.pedido_id;

    if (!pedidoId) {
      console.error('[webhook] pedido_id ausente nos metadados');
      return res.status(400).json({ error: 'pedido_id ausente' });
    }

    try {
      await confirmarPedido(pedidoId);
      console.log(`[webhook] Pedido ${pedidoId} confirmado com sucesso`);
    } catch (err) {
      console.error('[webhook] Erro ao confirmar:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(200).json({ received: true });
}

module.exports = handler;
