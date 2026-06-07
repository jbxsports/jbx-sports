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

// Lê o body raw como Buffer
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).send('Erro ao ler body');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] Assinatura inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const pedidoId = session.metadata?.pedido_id;

    if (!pedidoId) {
      console.error('[webhook] pedido_id ausente');
      return res.status(400).json({ error: 'pedido_id ausente' });
    }

    try {
      await confirmarPedido(pedidoId);
      console.log(`[webhook] Pedido ${pedidoId} confirmado`);
    } catch (err) {
      console.error(`[webhook] Erro:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(200).json({ received: true });
};
