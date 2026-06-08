// api/checkout.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Cria inscrições no Supabase — função recebe { dados: jsonb } ──
async function criarInscricoes(itens, pedido, cupom, formaPagamento, eventoNome) {
  const resultados = [];
  for (const item of itens) {
    try {
      // Monta o objeto "dados" exatamente como a função criar_inscricao espera
      const dados = {
        pedido:               pedido,
        evento:               eventoNome      || '',
        ref:                  item.ref        || '',
        cpf:                  item.cpf        || '',
        kit_id:               item.kit_id     || '',
        lote_id:              item.lote_id    || '',
        kit:                  item.kit        || '',
        modalidade:           item.modalidade || '',
        tamanho_camisa:       item.tamanho_camisa || '',
        cupom:                cupom           || '',
        forma_pagamento:      formaPagamento  || 'cartao',
        nome:                 item.nome       || '',
        cpf_dados:            item.cpf        || '',
        nascimento:           item.nascimento || '',
        genero:               item.genero     || '',
        email:                item.email      || '',
        telefone:             item.telefone   || '',
        cep:                  item.cep        || '',
        rua:                  item.rua        || '',
        numero:               item.numero     || '',
        complemento:          item.complemento|| '',
        bairro:               item.bairro     || '',
        cidade:               item.cidade     || '',
        estado:               item.estado     || '',
        emergencia_nome:      item.emergencia_nome      || '',
        emergencia_telefone:  item.emergencia_telefone  || '',
        valor:                item.valor      || 0,
      };

      console.log('[checkout] criar_inscricao dados:', JSON.stringify(dados));

      const res = await fetch(`${SB_URL}/rest/v1/rpc/criar_inscricao`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY || '',
          'Authorization': `Bearer ${SB_SERVICE_KEY || ''}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ dados })  // ← passa como { dados: jsonb }
      });

      const text = await res.text();
      console.log('[checkout] criar_inscricao status:', res.status, 'resp:', text);

      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).message || JSON.parse(text).error || text; } catch(e){}
        resultados.push({ ok: false, erro: msg });
        continue;
      }

      // Função retorna o UUID da inscrição criada
      // Precisamos calcular valor_cents para o Stripe
      const inscricaoId = text.replace(/"/g,'').trim();
      resultados.push({ ok: true, inscricao_id: inscricaoId, valor_cents: Math.round(item.valor * 100) });

    } catch (e) {
      console.error('[checkout] erro fetch:', e.message);
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

  console.log('[checkout] pedido:', pedido, '| itens:', itens?.length, '| SB_KEY ok:', !!SB_SERVICE_KEY);

  if (!itens || !itens.length) {
    return res.status(400).json({ error: 'Nenhum item no pedido.' });
  }

  // ── 1. Cria inscrições no Supabase ──
  const resultados = await criarInscricoes(itens, pedido, cupom, forma_pagamento, evento_nome);
  console.log('[checkout] resultados:', JSON.stringify(resultados));

  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  // ── 2. Total em centavos ──
  const totalCents = resultados.reduce((acc, r) => acc + (r.valor_cents || 0), 0);
  if (totalCents <= 0) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }

  // ── 3. Line items para o Stripe ──
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

  // ── 4. Metadados para o webhook (WhatsApp pós-pagamento) ──
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
