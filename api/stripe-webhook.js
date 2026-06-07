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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Na Vercel, req.body já vem como string quando Content-Type é text/plain
  // ou como objeto quando é application/json.
  // O Stripe envia como application/json, então precisamos do raw string.
  let rawBody = req.body;

  // Se já é string, usa direto. Se é objeto, serializa de volta.
  if (typeof rawBody === 'object') {
    rawBody = JSON.stringify(rawBody);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[webhook] Assinatura inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const pedidoId = session.metadata?.pedido_id;
    if (!pedidoId) return res.status(400).json({ error: 'pedido_id ausente' });

    try {
      await confirmarPedido(pedidoId);
      console.log(`[webhook] Pedido ${pedidoId} confirmado`);
    } catch (err) {
      console.error('[webhook] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(200).json({ received: true });
};

// Desabilita o body parser da Vercel para receber o raw body
module.exports.config = {
  api: { bodyParser: false }
};
