export default async function handler(req, res) {
  // ====== ENV VARS ======
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const API_VERSION = process.env.META_API_VERSION || "v20.0";

  // ====== VERIFICATION (GET) ======
  if (req.method === "GET") {
    try {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verificado com sucesso.");
        return res.status(200).send(challenge);
      } else {
        console.warn("Falha na verificação do webhook: token inválido.");
        return res.sendStatus(403);
      }
    } catch (e) {
      console.error("Erro no GET /webhook:", e);
      return res.sendStatus(500);
    }
  }

  // ====== RECEIVE MESSAGE (POST) ======
  if (req.method === "POST") {
    try {
      // Sempre responda rápido com 200 OK ao Meta (até 10s).
      // Vamos processar a mensagem e enviar a resposta logo em seguida.
      const body = req.body;
      console.log("Webhook recebido:", JSON.stringify(body, null, 2));

      // Checagem mínima de estrutura
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Às vezes chegam eventos "statuses" (entregue/lida). Só respondemos a "messages".
      const messageObj = value?.messages?.[0];
      if (!messageObj) {
        // Não é mensagem do usuário (pode ser status). Retornamos 200 e encerramos.
        return res.status(200).json({ received: true, type: "non-message-event" });
      }

      // Dados principais
      const from = messageObj.from; // "55349..."
      const textBody = messageObj.text?.body || "";

      // Montar o "to" (E.164) — adiciona o '+'
      const to = from.startsWith("+") ? from : `+${from}`;

      // Defina aqui a resposta que quer mandar (texto livre dentro de 24h)
      const replyText = textBody
        ? `Recebi: "${textBody}". Teste OK ✅`
        : "Recebi sua mensagem. Tudo certo! ✅";

      // Monta payload de sessão (texto livre) – válido se dentro da janela de 24h
      const sessionPayload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: replyText },
      };

      // Envia para Graph
      const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
      const graphResp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sessionPayload),
      });

      const graphData = await graphResp.json();
      console.log("Resposta do Graph:", graphResp.status, JSON.stringify(graphData, null, 2));

      if (!graphResp.ok) {
        // Erros comuns: 190 (token), 100 (ID), 200/10x/131047 (permissões/assets), 470 (24h)
        // Se for fora de 24h, você pode cair para TEMPLATE aqui.
        return res.status(200).json({
          received: true,
          sent: false,
          errorFromGraph: { status: graphResp.status, data: graphData },
        });
      }

      // Sucesso
      return res.status(200).json({
        received: true,
        sent: true,
        graphMessageId: graphData?.messages?.[0]?.id || null,
      });
    } catch (e) {
      console.error("Erro no POST /webhook:", e);
      // Mesmo em erro interno, responda 200 para não quebrar a assinatura
      return res.status(200).json({ received: true, sent: false, internalError: true });
    }
  }

  // ====== MÉTODO NÃO SUPORTADO ======
  res.setHeader("Allow", "GET, POST");
  return res.status(405).end("Method Not Allowed");
}
