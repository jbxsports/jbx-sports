// api/checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, params = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

    if (!itens || !itens.length || !pedido) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }

    // Grava inscrições como pendente no Supabase
    for (const it of itens) {
      await rpc('criar_inscricao', { dados: { ...it, pedido, cupom: cupom || '' } });
    }

    // Monta line items para o Stripe
    const lineItems = itens.map(it => ({
      price_data: {
        currency: 'brl',
        product_data: {
          name: `${it.kit} — ${it.modalidade}`,
          description: `${evento_nome || it.evento}`,
        },
        unit_amount: Math.round(Number(it.valor) * 100),
      },
      quantity: 1,
    }));

    const SITE = 'https://jbx-sports.vercel.app';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: forma_pagamento === 'PIX' ? ['pix'] : ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${SITE}/?pedido=${pedido}&status=sucesso`,
      cancel_url:  `${SITE}/?pedido=${pedido}&status=cancelado`,
      metadata: {
        pedido_id: pedido,
        qtd_atletas: String(itens.length),
      },
      locale: 'pt-BR',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
