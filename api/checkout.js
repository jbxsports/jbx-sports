// api/checkout.js
// Cria sessão de pagamento no Stripe e redireciona para o checkout

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Valida e cria inscrições no Supabase (preço autoritativo no servidor) ──
async function criarInscricoes(itens, pedido) {
  const resultados = [];
  for (const item of itens) {
    try {
      const payload = {
        p_pedido:             pedido,
        p_ref:                item.ref             || '',
        p_cpf:                item.cpf             || '',
        p_kit_id:             item.kit_id          || '',
        p_lote_id:            item.lote_id         || '',
        p_modalidade:         item.modalidade      || '',
        p_tamanho_camisa:     item.tamanho_camisa  || '',
        p_cupom:              item.cupom           || '',
        p_nome:               item.nome            || '',
        p_nascimento:         item.nascimento      || '',
        p_genero:             item.genero          || '',
        p_email:              item.email           || '',
        p_telefone:           item.telefone        || '',
        p_cep:                item.cep             || '',
        p_rua:                item.rua             || '',
        p_numero:             item.numero          || '',
        p_complemento:        item.complemento     || '',
        p_bairro:             item.bairro          || '',
        p_cidade:             item.cidade          || '',
        p_estado:             item.estado          || '',
        p_emergencia_nome:    item.emergencia_nome     || '',
        p_emergencia_telefone:item.emergencia_telefone || ''
      };

      console.log('[checkout] chamando criar_inscricao:', JSON.stringify(payload));

      const res = await fetch(`${SB_URL}/rest/v1/rpc/criar_inscricao`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY || '',
          'Authorization': `Bearer ${SB_SERVICE_KEY || ''}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      console.log('[checkout] criar_inscricao status:', res.status, 'body:', text);

      let data = {};
      try { data = JSON.parse(text); } catch(e) { data = { ok: false, erro: text }; }

      if (!res.ok) {
        resultados.push({ ok: false, erro: data.message || data.error || text });
      } else {
        resultados.push({ ok: data.ok, valor_cents: data.valor_cents, erro: data.erro });
      }
    } catch (e) {
      console.error('[checkout] erro fetch criar_inscricao:', e.message);
      resultados.push({ ok: false, erro: e.message });
    }
  }
  return resultados;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

  console.log('[checkout] recebido pedido:', pedido, '| itens:', itens?.length, '| SB_KEY presente:', !!SB_SERVICE_KEY);

  if (!itens || !itens.length) {
    return res.status(400).json({ error: 'Nenhum item no pedido.' });
  }

  // ── 1. Cria inscrições no Supabase (preço calculado no servidor) ──
  const resultados = await criarInscricoes(itens, pedido);
  console.log('[checkout] resultados:', JSON.stringify(resultados));

  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  // ── 2. Soma total autoritativo (vem do servidor, não do cliente) ──
  const totalCents = resultados.reduce((acc, r) => acc + (r.valor_cents || 0), 0);
  if (totalCents <= 0) {
    return res.status(400).json({ error: 'Valor inválido calculado pelo servidor.' });
  }

  // ── 3. Monta line_items para o Stripe ──
  const line_items = itens.map((item, i) => ({
    price_data: {
      currency: 'brl',
      product_data: {
        name: `${item.kit || 'Kit'} — ${item.modalidade || ''} (${item.nome || item.rotulo || 'Atleta'})`,
        description: evento_nome || '',
      },
      unit_amount: resultados[i].valor_cents,
    },
    quantity: 1,
  }));

  // ── 4. Metadados para o webhook ──
  const metadataItens = itens.map(it => ({
    ref:            it.ref           || '',
    cpf:            it.cpf           || '',
    nome:           it.nome          || it.rotulo || '',
    telefone:       it.telefone      || '',
    email:          it.email         || '',
    evento:         evento_nome      || '',
    kit:            it.kit           || '',
    modalidade:     it.modalidade    || '',
    tamanho_camisa: it.tamanho_camisa|| '',
  }));

  // ── 5. Método de pagamento ──
  const payment_method_types = forma_pagamento === 'pix' ? ['pix'] : ['card'];

  // ── 6. Cria sessão no Stripe ──
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types,
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL || 'https://jbx-sports.vercel.app'}/?status=sucesso&pedido=${pedido}`,
      cancel_url:  `${process.env.SITE_URL || 'https://jbx-sports.vercel.app'}/?status=cancelado`,
      metadata: {
        pedido:      pedido,
        evento_nome: evento_nome || '',
        cupom:       cupom       || '',
        itens:       JSON.stringify(metadataItens).slice(0, 500),
      },
    });

    console.log('[checkout] sessão Stripe criada:', session.id);
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('[checkout] Stripe error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
