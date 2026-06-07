// api/stripe-webhook.js
// Recebe eventos do Stripe e confirma as inscrições no Supabase
// quando o pagamento é concluído (checkout.session.completed).

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function confirmarPedido(pedidoId) {
  // Busca todas as inscrições do pedido e confirma cada uma
  const r = await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pedido`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_pedido_id: pedidoId })
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Supabase error: ${text}`);
  }
  return r.text();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verifica a assinatura do webhook (garante que veio do Stripe)
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] Assinatura inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processa apenas o evento de pagamento concluído
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const pedidoId = session.metadata?.pedido_id;

    if (!pedidoId) {
      console.error('[webhook] pedido_id ausente nos metadados');
      return res.status(400).json({ error: 'pedido_id ausente' });
    }

    try {
      await confirmarPedido(pedidoId);
      console.log(`[webhook] Pedido ${pedidoId} confirmado com sucesso`);
    } catch (err) {
      console.error(`[webhook] Erro ao confirmar pedido ${pedidoId}:`, err.message);
      // Retorna 500 para o Stripe retentar o webhook
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(200).json({ received: true });
}

// Importante: desabilita o bodyParser do Next.js para o Stripe
// conseguir verificar a assinatura com o body raw
export const config = {
  api: {
    bodyParser: false,
  },
};
