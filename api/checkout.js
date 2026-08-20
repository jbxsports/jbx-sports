// api/checkout.js — Mercado Pago Checkout Pro
const { MercadoPagoConfig, Preference } = require('mercadopago');

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL       = process.env.SITE_URL || 'https://jbxsports.com.br';

async function buscarDadosAtleta(cpf) {
  try {
    const cpfLimpo = cpf.replace(/\D/g, '');

    const res = await fetch(`${SB_URL}/rest/v1/atletas_contas?cpf=eq.${cpfLimpo}&limit=1&select=nome,telefone,email`, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data = await res.json();
    if (data && data.length > 0 && data[0].telefone) return data[0];

    const res2 = await fetch(`${SB_URL}/rest/v1/inscricoes?cpf=eq.${cpfLimpo}&telefone=not.is.null&order=id.desc&limit=1&select=nome,telefone,email`, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data2 = await res2.json();
    if (data2 && data2.length > 0) return data2[0];

  } catch(e) {
    console.error('[checkout] buscarDadosAtleta erro:', e.message);
  }
  return null;
}

async function criarInscricoes(itens, pedido, cupom, formaPagamento, eventoNome) {
  const resultados = [];
  for (const item of itens) {
    try {
      const dados = {
        pedido, evento: eventoNome || '',
        evento_id:           item.evento_id           || '',
        ref:                 item.ref                 || '',
        cpf:                 item.cpf                 || '',
        kit_id:              item.kit_id              || '',
        lote_id:             item.lote_id             || '',
        kit:                 item.kit                 || '',
        modalidade:          item.modalidade          || '',
        tamanho_camisa:      item.tamanho_camisa      || '',
        cupom:               cupom                    || '',
        forma_pagamento:     formaPagamento           || 'cartao',
        nome:                item.nome                || '',
        nascimento:          item.nascimento          || '',
        genero:              item.genero              || '',
        email:               item.email               || '',
        telefone:            item.telefone            || '',
        cep:                 item.cep                 || '',
        rua:                 item.rua                 || '',
        numero:              item.numero              || '',
        complemento:         item.complemento         || '',
        bairro:              item.bairro              || '',
        cidade:              item.cidade              || '',
        estado:              item.estado              || '',
        emergencia_nome:     item.emergencia_nome     || '',
        emergencia_telefone: item.emergencia_telefone || '',
        valor:               item.valor               || 0,
        valor_inscricao:     item.valor_inscricao     || '',
        // Taxa de serviço do evento (%). O index.html envia, mas o campo não constava
        // nesta lista e era descartado aqui — o banco gravava valor_taxa = 0.
        taxa_pct:            Number(item.taxa_pct)    || 0,
        produtos:            Array.isArray(item.produtos) ? item.produtos : [],
      };

      const res = await fetch(`${SB_URL}/rest/v1/rpc/criar_inscricao`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ dados })
      });

      const text = await res.text();
      console.log('[checkout] criar_inscricao status:', res.status, text);

      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).message || JSON.parse(text).error || text; } catch(e){}
        // violação do índice único ux_inscricao_cpf_evento
        if (/23505|ux_inscricao_cpf_evento|duplicate key/i.test(text)) {
          msg = 'Este CPF já possui inscrição neste evento. Cada atleta pode se inscrever uma única vez.';
        }
        resultados.push({ ok: false, erro: msg });
        continue;
      }

      resultados.push({ ok: true, valor_cents: Math.round(item.valor * 100) });
    } catch(e) {
      resultados.push({ ok: false, erro: e.message });
    }
  }
  return resultados;
}

// ══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES DA INSCRIÇÃO GRATUITA
// O fluxo pago é notificado pelo api/mp-webhook.js. Como a inscrição
// gratuita não passa pelo Mercado Pago, o aviso sai daqui.
// ══════════════════════════════════════════════════════════════
const ZAPI_INSTANCE     = '3F457758AC68513DE147E6B1C9468980';
const ZAPI_TOKEN        = 'CD007B54BA8BD1111B802279';
const ZAPI_CLIENT_TOKEN = 'Fbe7af069c70a4f1281ad63eee20c5cbeS';
const ZAPI_URL          = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

// ══════════════════════════════════════════════════════════════
// CHAVE GERAL DO WHATSAPP — mesma lógica do api/mp-webhook.js.
// Desligado por padrão. Só liga com WHATSAPP_ATIVO === "true".
// ══════════════════════════════════════════════════════════════
const WHATSAPP_ATIVO = process.env.WHATSAPP_ATIVO === 'true';

async function enviarWhatsApp(telefone, mensagem) {
  if (!WHATSAPP_ATIVO) {
    console.log('[checkout] WhatsApp DESLIGADO (WHATSAPP_ATIVO != true) — nada enviado.');
    return;
  }
  try {
    let digits = String(telefone || '').replace(/[^0-9]/g, '');
    if (!digits) return;
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 10) digits = digits.slice(0, 2) + '9' + digits.slice(2);
    const numero = '55' + digits;
    const res = await fetch(ZAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: numero, message: mensagem })
    });
    const respText = await res.text();
    console.log('[checkout] WhatsApp gratuito para', numero.slice(0,6) + '****', '| status:', res.status, '| resp:', respText.slice(0,120));
  } catch (e) {
    console.error('[checkout] Erro Z-API:', e.message);
  }
}

async function enviarEmailConfirmacao(email, nome, item, dataEvento) {
  if (!email) return;
  try {
    const r = await fetch(`${SITE_URL}/api/enviar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'confirmacao_inscricao', email, nome, item, data_evento: dataEvento })
    });
    console.log('[checkout] E-mail gratuito status:', r.status, 'para', email.slice(0,4) + '***');
  } catch (e) {
    console.error('[checkout] Erro e-mail confirmação:', e.message);
  }
}

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
  } catch (e) { return null; }
}

function formatarDataEvento(dataStr, hora) {
  if (!dataStr) return '—';
  const d = new Date(dataStr + 'T12:00:00');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}${hora ? ' · ' + hora : ''}`;
}

function montarMensagemGratuita(item, dataEvento) {
  const primeiroNome = (item.nome || 'Atleta').split(' ')[0];
  return (
    `🎽 *Inscrição confirmada, ${primeiroNome}!*\n\n` +
    `Sua inscrição na *JBX Sports* foi confirmada com sucesso. ✅\n\n` +
    `📋 *Detalhes da inscrição:*\n` +
    `• Evento: *${item.evento || '—'}*\n` +
    `• Data: *${dataEvento}*\n` +
    `• Modalidade: *${item.modalidade || '—'}*\n` +
    `• Kit: *${item.kit || '—'}*\n` +
    `• Camiseta: *${item.camisa || '—'}*\n` +
    `• Inscrição: *Gratuita*\n\n` +
    `📍 Fique de olho nas nossas redes para informações sobre retirada de kit e concentração.\n\n` +
    `📸 *@jbx.sports*\n\n` +
    `Boa corrida! Vamos juntos! 🧡🏁`
  );
}

// Notifica todos os atletas de um pedido gratuito (WhatsApp + e-mail)
async function notificarGratuitos(itens, eventoNome) {
  const evento     = await buscarEvento(eventoNome);
  const dataEvento = evento ? formatarDataEvento(evento.data, evento.hora) : '—';

  for (const it of itens) {
    let nome     = it.nome     || '';
    let telefone = it.telefone || '';
    let email    = it.email    || '';

    // fluxo do cadastro protegido: o item vem sem os dados pessoais
    if (it.cpf && (!telefone || !email || !nome)) {
      const dadosBanco = await buscarDadosAtleta(it.cpf);
      if (dadosBanco) {
        nome     = nome     || dadosBanco.nome     || '';
        telefone = telefone || dadosBanco.telefone || '';
        email    = email    || dadosBanco.email    || '';
      }
    }

    const item = {
      nome,
      evento:         eventoNome || '',
      kit:            it.kit            || '',
      modalidade:     it.modalidade     || '',
      camisa:         it.tamanho_camisa || '',
      tamanho_camisa: it.tamanho_camisa || '',
      valor:          0,
    };

    console.log('[checkout] notificando gratuito —', nome, '| tel:', telefone ? 'sim' : 'não', '| email:', email ? 'sim' : 'não');

    if (telefone) await enviarWhatsApp(telefone, montarMensagemGratuita(item, dataEvento));
    if (email)    await enviarEmailConfirmacao(email, nome, item, dataEvento);
  }
}

// 1 CPF por evento: consulta a RPC cpf_ja_inscrito antes de gravar qualquer coisa.
// Retorna null se estiver liberado, ou a mensagem de erro.
async function validarCpfUnico(itens) {
  const vistos = new Set();
  for (const item of itens) {
    const cpf = (item.cpf || '').replace(/\D/g, '');
    const ref = item.ref || '';
    if (!item.evento_id) continue;
    if (cpf.length !== 11 && !ref) continue;

    const chave = `${item.evento_id}|${cpf.length === 11 ? cpf : 'ref:' + ref}`;
    if (vistos.has(chave)) {
      return 'Há dois atletas com o mesmo CPF neste pedido. Cada atleta pode se inscrever uma única vez no evento.';
    }
    vistos.add(chave);

    try {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/cpf_ja_inscrito`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          p_evento_id: item.evento_id,
          p_cpf: cpf.length === 11 ? cpf : null,
          p_ref: ref || null
        })
      });
      const txt = await r.text();
      if (!r.ok) {
        console.error('[checkout] cpf_ja_inscrito status:', r.status, txt);
        continue; // o índice único no banco ainda protege
      }
      if (txt.trim() === 'true') {
        return 'Este CPF já possui inscrição neste evento. Cada atleta pode se inscrever uma única vez.';
      }
    } catch (e) {
      console.error('[checkout] cpf_ja_inscrito erro:', e.message);
    }
  }
  return null;
}

// Valida se o pedido é realmente gratuito, consultando o preço publicado do kit.
// Retorna null se estiver tudo certo, ou a mensagem de erro.
async function validarPedidoGratuito(itens) {
  const cache = {};
  for (const item of itens) {
    if (Number(item.valor || 0) > 0.009) return 'Valor inválido.';
    if (Array.isArray(item.produtos) && item.produtos.length) {
      return 'Produtos adicionais não são permitidos em inscrição gratuita.';
    }
    const evId = item.evento_id;
    if (!evId) return 'Evento não identificado.';

    if (!cache[evId]) {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/rpc/kits_evento_publicos`, {
          method: 'POST',
          headers: {
            'apikey':        SB_SERVICE_KEY,
            'Authorization': `Bearer ${SB_SERVICE_KEY}`,
            'Content-Type':  'application/json'
          },
          body: JSON.stringify({ p_evento_id: evId })
        });
        if (!r.ok) {
          console.error('[checkout] kits_evento_publicos status:', r.status, await r.text());
          return 'Não foi possível validar o kit gratuito.';
        }
        cache[evId] = await r.json();
      } catch (e) {
        console.error('[checkout] kits_evento_publicos erro:', e.message);
        return 'Não foi possível validar o kit gratuito.';
      }
    }

    const kits = (cache[evId] && Array.isArray(cache[evId].kits)) ? cache[evId].kits : [];
    if (!kits.length) return 'Nenhum kit disponível para este evento.';

    const kitEscolhido = item.kit_id
      ? kits.find(k => String(k.id) === String(item.kit_id))
      : null;
    if (!kitEscolhido) return 'Kit não localizado para este evento.';
    if (Number(kitEscolhido.preco || 0) > 0.009) return 'Valor inválido.';
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// PREÇO AUTORITATIVO — lê de volta o que o banco gravou.
//
// O criar_inscricao é quem sabe o preço de verdade: busca o valor em
// lote_precos, aplica o desconto 60+ (pela data de nascimento que ele tem
// no cadastro), aplica cupom, calcula a taxa e valida os produtos.
// O navegador não tem esses dados — no caso do atleta com cadastro salvo
// ele nem conhece a data de nascimento, então calculava sem o desconto 60+.
// Cobrar o número do navegador foi o que gerou a cobrança cheia com registro
// descontado. Daqui em diante o Mercado Pago cobra o que está no banco.
// ══════════════════════════════════════════════════════════════
async function lerInscricoesGravadas(pedido) {
  const cols = 'id,nome,cpf,email,telefone,valor,valor_base,valor_taxa,desconto_pct,kit,modalidade,tamanho_camisa';
  const res = await fetch(`${SB_URL}/rest/v1/inscricoes?pedido_id=eq.${pedido}&select=${cols}&order=criado_em.asc`, {
    headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
  });
  if (!res.ok) throw new Error('Não foi possível confirmar os valores da inscrição.');
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('Inscrições não localizadas após a gravação.');
  return rows;
}

// Apaga as inscrições de um pedido que não chegou ao fim.
// Sem isto, qualquer falha depois da gravação deixa linha órfã em 'pendente'.
async function deletarInscricoesPedido(pedido) {
  if (!pedido) return;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/inscricoes?pedido_id=eq.${pedido}`, {
      method: 'DELETE',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json'
      }
    });
    console.log('[checkout] limpeza do pedido', pedido, '| status:', res.status);
  } catch (e) {
    console.error('[checkout] erro ao limpar pedido:', e.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

  const token = process.env.MP_ACCESS_TOKEN || '';
  console.log('[checkout] TOKEN prefixo:', token.slice(0, 15), '| tamanho:', token.length);

  if (!itens || !itens.length) {
    return res.status(400).json({ error: 'Nenhum item no pedido.' });
  }

  // 1 CPF por evento — barra antes de gravar qualquer inscrição
  const erroCpf = await validarCpfUnico(itens);
  if (erroCpf) {
    console.warn('[checkout] duplicidade de CPF:', erroCpf);
    return res.status(409).json({ error: erroCpf });
  }

  // Total calculado a partir dos itens, ANTES de gravar qualquer coisa.
  const totalPedido = itens.reduce((acc, it) => acc + Number(it.valor || 0), 0);
  const ehGratuito  = totalPedido <= 0.005;

  // ── VALIDAÇÃO DO PEDIDO GRATUITO — AGORA ANTES DA GRAVAÇÃO ──
  // Antes esta conferência rodava depois de gravar. Quando ela recusava
  // (kit fora do lote vigente, kit oculto, preço mudou), a inscrição já
  // estava no banco e ficava presa em 'pendente' para sempre.
  if (ehGratuito) {
    const erroGratuito = await validarPedidoGratuito(itens);
    if (erroGratuito) {
      console.warn('[checkout] gratuito recusado (nada gravado):', erroGratuito);
      return res.status(400).json({ error: erroGratuito });
    }
  }

  // Cria inscrições no Supabase
  const resultados = await criarInscricoes(itens, pedido, cupom, forma_pagamento, evento_nome);
  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    // Um item falhou: apaga os que já entraram, para não sobrar meio pedido.
    await deletarInscricoesPedido(pedido);
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  // ── Valores autoritativos: o que o banco realmente gravou ──
  let gravadas;
  try {
    gravadas = await lerInscricoesGravadas(pedido);
  } catch (e) {
    console.error('[checkout] leitura autoritativa falhou:', e.message);
    await deletarInscricoesPedido(pedido);
    return res.status(500).json({ error: e.message });
  }

  const totalBanco = gravadas.reduce((acc, r) => acc + Number(r.valor || 0), 0);
  const totalCents = Math.round(totalBanco * 100);

  // Alerta de divergência: se navegador e banco discordam, o log registra.
  // Era exatamente este o sintoma do caso 60+ com cadastro salvo.
  if (Math.abs(totalPedido - totalBanco) > 0.005) {
    console.warn('[checkout] DIVERGÊNCIA de valor — navegador:', totalPedido.toFixed(2),
      '| banco:', totalBanco.toFixed(2), '| pedido:', pedido,
      '| descontos no banco:', gravadas.map(r => (r.desconto_pct || 0) + '%').join(','));
  }

  // ── INSCRIÇÃO GRATUITA (total R$ 0,00) ──
  if (totalCents <= 0) {
    try {
      const rc = await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pagamento`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ p_pedido: pedido, p_forma_pagamento: 'gratuito' })
      });
      const tc = await rc.text();
      console.log('[checkout] gratuito — confirmar_pagamento:', rc.status, tc);
      if (!rc.ok) {
        let msg = tc;
        try { msg = JSON.parse(tc).message || JSON.parse(tc).error || tc; } catch (e) {}
        // Não conseguiu confirmar: apaga em vez de deixar 'pendente' órfã.
        await deletarInscricoesPedido(pedido);
        return res.status(400).json({ error: msg || 'Erro ao confirmar inscrição gratuita.' });
      }
    } catch (e) {
      console.error('[checkout] gratuito — erro confirmar_pagamento:', e.message);
      await deletarInscricoesPedido(pedido);
      return res.status(500).json({ error: e.message });
    }

    // avisa cada atleta (WhatsApp + e-mail) — o fluxo pago faz isso no webhook
    try {
      await notificarGratuitos(gravadas, evento_nome);
    } catch (e) {
      console.error('[checkout] gratuito — erro ao notificar:', e.message);
    }

    return res.status(200).json({
      url: `${SITE_URL}/atleta.html?pedido=${pedido}&status=gratuito`,
      gratuito: true
    });
  }

  // Metadados dos atletas para o webhook — vêm da linha gravada, que já traz
  // nome/e-mail/telefone resolvidos inclusive no fluxo de cadastro protegido.
  const metadataItens = gravadas.map(r => ({
    nome:       String(r.nome     || '').slice(0, 40),
    tel:        String(r.telefone || '').replace(/[^0-9]/g, '').slice(0, 15),
    email:      String(r.email    || '').slice(0, 60),
    evento:     (evento_nome || '').slice(0, 40),
    kit:        String(r.kit || '').slice(0, 20),
    modalidade: String(r.modalidade || '').slice(0, 20),
    camisa:     String(r.tamanho_camisa || '').slice(0, 10),
    valor:      Math.round(Number(r.valor || 0) * 100) / 100,
  }));

  // Itens da preferência MP — preço do banco, nunca o do navegador.
  // Linhas de valor zero ficam de fora: o MP recusa item com unit_price 0.
  const mpItems = gravadas
    .filter(r => Number(r.valor || 0) > 0)
    .map((r, i) => ({
      id:          `${pedido}-${i}`,
      title:       `${r.kit || 'Kit'} — ${r.modalidade || ''} (${r.nome || 'Atleta'})`,
      description: evento_nome || 'JBX Sports',
      quantity:    1,
      unit_price:  Math.round(Number(r.valor) * 100) / 100,
      currency_id: 'BRL',
    }));

  try {
    const preference = new Preference(mp);
    const response = await preference.create({
      body: {
        items: mpItems,
        external_reference: pedido,
        metadata: {
          pedido,
          evento_nome: evento_nome || '',
          cupom:       cupom       || '',
          itens:       JSON.stringify(metadataItens),
        },
        payment_methods: {
          excluded_payment_types: [
            { id: 'ticket' },
            { id: 'debit_card' },
          ],
        },
        back_urls: {
          success: `${SITE_URL}/atleta.html?pedido=${pedido}`,
          failure: `${SITE_URL}/?status=cancelado`,
          pending: `${SITE_URL}/atleta.html?pedido=${pedido}&status=pendente`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/api/mp-webhook`,
        statement_descriptor: 'JBX SPORTS',
      }
    });

    console.log('[checkout] Preferência MP criada:', response.id);
    return res.status(200).json({ url: response.init_point });

  } catch(e) {
    console.error('[checkout] Mercado Pago error:', e.message);
    // A preferência não foi criada: o atleta nunca vai ver tela de pagamento.
    // Apaga as inscrições para não sobrar 'pendente' que ninguém consegue pagar.
    await deletarInscricoesPedido(pedido);
    return res.status(500).json({ error: e.message });
  }
};
