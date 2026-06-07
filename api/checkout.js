// api/checkout.js
// Recebe os itens do carrinho, grava as inscrições como 'pendente' no Supabase
// e cria uma Checkout Session no Stripe para redirecionar o atleta ao pagamento.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY; // chave de serviço (não a pública)

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

export default async function handler(req, res) {
  // Aceita apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

    if (!itens || !itens.length || !pedido) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }

    // 1. Grava cada inscrição no Supabase como 'pendente'
    for (const it of itens) {
      await rpc('criar_inscricao', { dados: { ...it, pedido, cupom: cupom || '' } });
    }

    // 2. Calcula o total (o servidor já calculou o desconto via criar_inscricao,
    //    mas para o Stripe precisamos do valor final de cada item)
    const lineItems = itens.map(it => ({
      price_data: {
        currency: 'brl',
        product_data: {
          name: `${it.kit} — ${it.modalidade}`,
          description: `${evento_nome || it.evento} · ${it.modalidade}`,
        },
        // valor em centavos; desconto já aplicado pelo servidor
        unit_amount: Math.round(Number(it.valor) * 100),
      },
      quantity: 1,
    }));

    // 3. Cria a Checkout Session no Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: forma_pagamento === 'PIX' ? ['pix'] : ['card'],
      line_items: lineItems,
      mode: 'payment',
      // URLs de retorno após pagamento
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://jbx-sports.vercel.app'}/?pedido=${pedido}&status=sucesso`,
      cancel_url:  `${process.env.NEXT_PUBLIC_SITE_URL || 'https://jbx-sports.vercel.app'}/?pedido=${pedido}&status=cancelado`,
      // Metadados para o webhook identificar o pedido
      metadata: {
        pedido_id: pedido,
        qtd_atletas: String(itens.length),
      },
      // PIX expira em 30 minutos
      ...(forma_pagamento === 'PIX' && {
        payment_intent_data: {
          payment_method_options: {
            pix: { expires_after_seconds: 1800 }
          }
        }
      }),
      // Locale em português
      locale: 'pt-BR',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout]', err);
    return res.status(500).json({ error: err.message });
  }
}
