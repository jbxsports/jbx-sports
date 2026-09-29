// api/div-foto.js
// Gera um link temporário (1 hora) para o admin ver a foto de um divulgador.
// As fotos ficam no bucket FECHADO "div-fotos" — só quem está logado no admin
// com a aba Divulgadores (ou master) consegue o link.

const SB_URL = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'div-fotos';
const VALIDADE_SEG = 3600;

function sbHeaders() {
  return {
    apikey: SB_SERVICE,
    Authorization: 'Bearer ' + SB_SERVICE,
    'Content-Type': 'application/json'
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'metodo' });
  }
  if (!SB_SERVICE) {
    console.error('[div-foto] SUPABASE_SERVICE_KEY não configurada');
    return res.status(500).json({ erro: 'config' });
  }

  // 1) confere a sessão do admin
  const token = String(req.headers['x-admin-token'] || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return res.status(401).json({ erro: 'sem_sessao' });
  }

  let sessao = null;
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/admin_sessao_validar', {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ p_token: token })
    });
    if (r.ok) sessao = await r.json();
  } catch (e) {
    console.error('[div-foto] erro ao validar sessão', e);
  }
  if (!sessao || !sessao.token) {
    return res.status(401).json({ erro: 'sem_sessao' });
  }
  const abas = String(sessao.abas || '').split(',');
  if (!sessao.master && abas.indexOf('divulgadores') === -1) {
    return res.status(403).json({ erro: 'sem_permissao' });
  }

  // 2) confere o caminho da foto
  const caminho = String(req.query.path || '').replace(/^\/+/, '');
  if (!caminho || caminho.length > 300 || caminho.indexOf('..') !== -1) {
    return res.status(400).json({ erro: 'caminho' });
  }

  // 3) pede o link assinado ao Supabase Storage
  try {
    const url = SB_URL + '/storage/v1/object/sign/' + BUCKET + '/' +
      caminho.split('/').map(encodeURIComponent).join('/');
    const r = await fetch(url, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ expiresIn: VALIDADE_SEG })
    });
    const corpo = await r.json().catch(() => null);
    const assinado = corpo && (corpo.signedURL || corpo.signedUrl);
    if (!r.ok || !assinado) {
      console.error('[div-foto] assinatura falhou', r.status, corpo);
      return res.status(404).json({ erro: 'nao_encontrada' });
    }
    return res.status(200).json({ url: SB_URL + '/storage/v1' + assinado });
  } catch (e) {
    console.error('[div-foto] erro', e);
    return res.status(500).json({ erro: 'falha' });
  }
};
